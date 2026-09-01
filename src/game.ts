import {
    clamp,
    degrees,
    angleFromHorizontal,
    findVerticalSupport,
    pointInPolygon,
    Point,
    centerOfMass,
    transformPolygon,
    SupportResult,
    randomNormal,
    pointInShapeBounds,
} from "./geometry";
import { createDailyPuzzle, PuzzleDefinition } from "./puzzles";
import { save, load } from "./persistence/local";

export type GameState = "interaction" | "calc" | "anim" | "stats" | "end";
type InteractionState = "idle" | "dragging" | "rotating" | "locked";
export type AnimState = "dropping" | "success" | "failure" | "retry";

export interface Pose {
    x: number;
    y: number;
    rotation: number;
    vx: number;
    vy: number;
    vr: number;
}

interface ConfettiParticle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    color: string;
    lifetime: number;
    age: number;
}

interface TextHint {
    text: string;
    visibleText: string;
    elapsed: number;
}

export const WORLD_HEIGHT = 1000;
export const FULCRUM_X = 0;
export const FULCRUM_Y = WORLD_HEIGHT - 200;

const FULCRUM_BASE_HALF_WIDTH = 30;
const FULCRUM_BASE_HEIGHT = 60;

const GRAVITY = 3000;
const ROTATION_CURSOR_DISTANCE = 8;
const MIN_ERROR = 12;
const VELOCITY_ERROR_FACTOR = 2;
const SPIN_ERROR_FACTOR = 0.05;
const MAX_ERROR_BOUNCE = 10;
const SHAKE_DURATION = 0.3;
const SHAKE_INTENSITY_SCALAR = 1;
const SUCCESS_DURATION = 0.8;
const SUCCESS_SQUASH = 30;
const CONFETTI_COUNT = 100;
const HINT_CHAR_SPEED = 0.05;
const HINT_HOLD_DURATION = 1.5;
const HINT_GAP_DURATION = 0.4;

const HINTS = {
    edgeHints: [
        "Look for a flat surface.",
    ],

    comHints: [
        "Find the center of mass.",
    ],
};

export class Balancedle {
    // Core refs
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    public readonly puzzle: PuzzleDefinition;

    // Game state
    private gameState: GameState = "interaction";
    private interactionState: InteractionState = "idle";
    private animState: AnimState = "dropping";
    private hintStage: number = 0;
    private onFinished: (attempts: number) => void;

    // Shape state
    private pose: Pose = {
        x: Math.random() * 200 - 100,
        y: 300,
        rotation: 0,
        vx: 0,
        vy: 0,
        vr: 0,
    };
    private dropPose: Pose = { ...this.pose };

    private dragOffset: Point = { x: 0, y: 0 };
    private rotationOffset = 0;
    private supportData: SupportResult | null = null;
    private dropError: number = 0;

    // Render/timing
    private frameHandle: number = 0;
    private devicePixelRatio = 1;
    private pixelsPerUnit = 1;
    private visibleLogicalWidth = WORLD_HEIGHT;
    private animStartTime = 0;
    private animPrevFrameTime = 0;
    private animElapsedTime = 0;
    private renderOffset: Point = { x: 0, y: 0 };

    private confetti: ConfettiParticle[] = [];
    private textHintQueue: TextHint[] = [];
    private usedHints = new Set<string>();

    // Stats
    private attempts = 0;

    // Callbacks
    private readonly onResize = (): void => this.resize();
    private readonly onPointerMove = (event: PointerEvent): void => this.pointerMove(event);
    private readonly onPointerUp = (event: PointerEvent): void => this.pointerUp(event);
    private readonly onPointerCancel = (event: PointerEvent): void => this.pointerCancel(event);
    private readonly onPointerDown = (event: PointerEvent): void => this.pointerDown(event);

    constructor(canvas: HTMLCanvasElement, onFinished: (attempts: number) => void = () => {}) {
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Could not create 2D canvas context");

        this.canvas = canvas;
        this.ctx = ctx;
        this.puzzle = createDailyPuzzle();
        this.onFinished = onFinished;

        this.bindEvents();
        this.resize();
        this.reset();
        this.loadGame();
        this.frame();
    }

    private bindEvents(): void {
        window.addEventListener("resize", this.onResize);
        this.canvas.addEventListener("pointerdown", this.onPointerDown);
        this.canvas.addEventListener("pointermove", this.onPointerMove);
        this.canvas.addEventListener("pointerup", this.onPointerUp);
        this.canvas.addEventListener("pointercancel", this.onPointerCancel);
    }

    private resize(): void {
        const rect = this.canvas.getBoundingClientRect();
        this.devicePixelRatio = window.devicePixelRatio || 1;

        this.canvas.width = rect.width * this.devicePixelRatio;
        this.canvas.height = rect.height * this.devicePixelRatio;

        this.pixelsPerUnit = rect.height / WORLD_HEIGHT;
        this.visibleLogicalWidth = rect.width / this.pixelsPerUnit;

        this.applyWorldTransform();
    }

    private applyWorldTransform(): void {
        const transformScale = this.pixelsPerUnit * this.devicePixelRatio;
        this.ctx.resetTransform();
        this.ctx.translate(this.canvas.width / 2, 0);
        this.ctx.scale(transformScale, transformScale);
    }

    public reset(): void {
        this.pose = { ...this.dropPose };
        this.gameState = "interaction";
        this.interactionState = "idle";
        this.canvas.style.cursor = "grab";
        if (this.attempts == 3) {
            this.hintStage = 1;
        } else if (this.attempts == 6) {
            this.hintStage = 2;
        }
    }

    private loadGame(): void {
        const saved = load();
        if (saved) {
            if (saved.puzzleId !== this.puzzle.id) {
                return;
            }
            this.gameState = saved.gameState;
            this.attempts = saved.attempts;
            this.hintStage = saved.hintStage;
            this.pose = { ...this.pose, x: saved.x, y: saved.y, rotation: saved.rotation };
        } else {
        }
    }

    private pointerDown(event: PointerEvent): void {
        if (this.gameState !== "interaction") return;

        const pointer = this.eventPoint(event);

        if (pointInShapeBounds(pointer, this.currentShape())) {
            this.interactionState = "dragging";
            this.dragOffset = {
                x: pointer.x - this.pose.x,
                y: pointer.y - this.pose.y,
            };
            this.canvas.style.cursor = "grabbing";
        } else {
            const pointerVector = {
                x: pointer.x - this.pose.x,
                y: pointer.y - this.pose.y,
            };
            if (Math.hypot(pointerVector.x, pointerVector.y) < ROTATION_CURSOR_DISTANCE) return;
            this.interactionState = "rotating";
            this.rotationOffset = Math.atan2(pointerVector.y, pointerVector.x) - this.pose.rotation;
            this.canvas.style.cursor = "crosshair";
        }
        this.canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
    }

    private pointerMove(event: PointerEvent): void {
        if (this.gameState !== "interaction") return;

        const pointer = this.eventPoint(event);

        if (this.interactionState === "dragging") {
            this.pose.x = clamp(pointer.x - this.dragOffset.x, -300, 300);
            this.pose.y = clamp(pointer.y - this.dragOffset.y, 200, 450);
        } else if (this.interactionState === "rotating") {
            const pointerVector = {
                x: pointer.x - this.pose.x,
                y: pointer.y - this.pose.y,
            };
            if (Math.hypot(pointerVector.x, pointerVector.y) < ROTATION_CURSOR_DISTANCE) return;
            this.pose.rotation = Math.atan2(pointerVector.y, pointerVector.x) - this.rotationOffset;
        }
    }

    private pointerUp(event: PointerEvent): void {
        if (this.gameState !== "interaction") return;
        if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);

        const prev = this.interactionState;

        this.interactionState = "idle";
        this.canvas.style.cursor = "grab";

        if (prev === "dragging") {
            this.gameState = "calc";
        }
        save({
            puzzleId: this.puzzle.id,
            attempts: this.attempts,
            gameState: this.gameState,
            x: this.pose.x,
            y: this.pose.y,
            rotation: this.pose.rotation,
            hintStage: this.hintStage,
        });
    }

    private pointerCancel(event: PointerEvent): void {
        if (this.gameState !== "interaction") return;
        if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
        this.interactionState = "idle";
        this.canvas.style.cursor = "grab";
    }

    private initDrop(): void {
        this.attempts += 1;
        this.gameState = "anim";
        this.setAnimState("dropping");
        this.canvas.style.cursor = "not-allowed";
        this.dropPose = { ...this.pose };
        this.supportData = findVerticalSupport(this.currentShape(), FULCRUM_X);
    }

    private currentShape(): Point[] {
        return transformPolygon(this.puzzle.shape, { x: this.pose.x, y: this.pose.y }, this.pose.rotation);
    }

    private eventPoint(event: PointerEvent): Point {
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || this.pixelsPerUnit === 0) {
            return { x: FULCRUM_X, y: 0 };
        }

        return {
            x: (event.clientX - rect.left - rect.width / 2) / this.pixelsPerUnit,
            y: (event.clientY - rect.top) / this.pixelsPerUnit,
        };
    }

    private frame = (): void => {
        this.update();
        this.render();
        this.frameHandle = requestAnimationFrame(this.frame);
    };

    private update(): void {
        const currFrame = performance.now();
        const frametime = (currFrame - this.animPrevFrameTime) / 1000;
        if (this.gameState === "calc") {
            this.initDrop();
        } else if (this.gameState === "anim") {
            this.canvas.style.cursor = "not-allowed";
            this.animElapsedTime = (currFrame - this.animStartTime) / 1000;
            if (this.animState === "dropping") {
                this.pose.vy += GRAVITY * frametime;
                this.pose.y += this.pose.vy * frametime;
                if (this.supportData) {
                    if (this.pose.y + (this.supportData.contact.y - this.dropPose.y) >= FULCRUM_Y) {
                        this.pose.y = FULCRUM_Y - (this.supportData.contact.y - this.dropPose.y);
                        this.evalDrop();
                    }
                } else if (this.isShapeOffscreen()) {
                    this.setAnimState("retry", currFrame);
                }
            } else if (this.animState === "success") {
                this.renderOffset = { x: 0, y: this.getSuccessOffsetY() };
                if (this.animElapsedTime >= SUCCESS_DURATION) {
                    this.gameState = "stats";
                    save({
                        puzzleId: this.puzzle.id,
                        attempts: this.attempts,
                        gameState: this.gameState,
                        x: this.pose.x,
                        y: this.pose.y,
                        rotation: this.pose.rotation,
                        hintStage: this.hintStage,
                    });
                }
            } else if (this.animState === "failure") {
                this.pose.vy += GRAVITY * frametime;
                this.pose.x += this.pose.vx * frametime;
                this.pose.y += this.pose.vy * frametime;
                this.pose.rotation += this.pose.vr * frametime;
                this.renderOffset = this.getShakeOffset();

                if (this.isShapeOffscreen()) {
                    this.setAnimState("retry", currFrame);
                }
            } else if (this.animState === "retry") {
                this.reset();
                save({
                    puzzleId: this.puzzle.id,
                    attempts: this.attempts,
                    gameState: this.gameState,
                    x: this.pose.x,
                    y: this.pose.y,
                    rotation: this.pose.rotation,
                    hintStage: this.hintStage,
                });
            }
        } else if (this.gameState === "stats") {
            this.spawnConfetti();
            this.onFinished(this.attempts);
            this.canvas.style.cursor = "not-allowed";
            this.gameState = "end";
        } else if (this.gameState === "end") {
            // Do nothing
        }
        this.updateConfetti(frametime);
        this.updateTextHint(frametime);
        this.animPrevFrameTime = currFrame;
    }

    private render(): void {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.applyWorldTransform();

        this.ctx.fillStyle = "#f4f1e8";
        this.ctx.fillRect(-this.visibleLogicalWidth / 2, 0, this.visibleLogicalWidth, WORLD_HEIGHT);

        this.drawAttemptCount();
        this.drawTextHint();

        this.drawHintLine();

        this.ctx.translate(this.renderOffset.x, this.renderOffset.y);
        this.drawFulcrum();
        this.drawPolygon(this.currentShape());
        this.drawComHint();
        this.drawConfetti();
    }

    private drawFulcrum(): void {
        this.ctx.fillStyle = "#b6542b";
        this.ctx.beginPath();
        this.ctx.moveTo(FULCRUM_X, FULCRUM_Y);
        this.ctx.lineTo(FULCRUM_X - FULCRUM_BASE_HALF_WIDTH, FULCRUM_Y + FULCRUM_BASE_HEIGHT);
        this.ctx.lineTo(FULCRUM_X + FULCRUM_BASE_HALF_WIDTH, FULCRUM_Y + FULCRUM_BASE_HEIGHT);
        this.ctx.closePath();
        this.ctx.fill();
    }

    private drawPolygon(polygon: Point[]): void {
        this.ctx.fillStyle = "#171612";
        this.ctx.beginPath();
        polygon.forEach((point, index) => {
            if (index === 0) this.ctx.moveTo(point.x, point.y);
            else this.ctx.lineTo(point.x, point.y);
        });
        this.ctx.closePath();
        this.ctx.fill();
    }

    private drawAttemptCount(): void {
        this.ctx.fillStyle = "#d8d4ca";
        this.ctx.font = "800 200px Inter, sans-serif";
        if (this.visibleLogicalWidth < 1000) {
            this.ctx.font = "800 180px Inter, sans-serif";
        }
        this.ctx.textAlign = "right";
        this.ctx.textBaseline = "top";
        this.ctx.fillText(String(this.attempts).padStart(2, "0"), this.visibleLogicalWidth / 2 - 40, 35);
    }

    private evalDrop(): void {
        if (!this.supportData) throw new Error("This should only be called after a drop with support data");
        const edgeAngle = angleFromHorizontal(this.supportData.edgeAngle);
        const normalTorque =
            this.supportData.contactOffset.x * Math.cos(edgeAngle) +
            -Math.sign(this.supportData.contactOffset.y) *
                Math.min(Math.abs(this.supportData.contactOffset.y), 100) *
                Math.sin(edgeAngle);
        const gravityTorque = this.supportData.contactOffset.x;

        console.log(`Gravity: ${gravityTorque}, Normal: ${normalTorque}, Angle: ${edgeAngle}`);

        if (Math.abs(gravityTorque) < MIN_ERROR && Math.abs(normalTorque) < (MIN_ERROR * 2) / 3) {
            this.dropError = 0;
            this.setAnimState("success");
        } else {
            this.dropError = gravityTorque + normalTorque * 0.3;
            this.pose.vx = -Math.sign((Math.abs(gravityTorque) >= MIN_ERROR) ? gravityTorque : edgeAngle) * clamp(Math.abs(this.dropError), 100, 200) * VELOCITY_ERROR_FACTOR;
            this.pose.vy = -Math.min(Math.abs(this.dropError), MAX_ERROR_BOUNCE) * VELOCITY_ERROR_FACTOR;
            this.pose.vr = -Math.sign(this.dropError) * Math.min(Math.abs(this.dropError), 200) * SPIN_ERROR_FACTOR;
            if (this.textHintQueue.length === 0 && this.hintStage >= 1) {
                const hintText = this.getRandomHint(gravityTorque, normalTorque);
                if (hintText) {
                    this.addTextHint(hintText);
                }
            }
            this.setAnimState("failure");
        }
    }

    private getRandomHint(gravityTorque: number, normalTorque: number): string | null {
        if (Math.random() < 0.0001) {
            return "I miss her.";
        }
        let hints: string[] = [];
        if (Math.abs(gravityTorque) >= MIN_ERROR && Math.sign(this.dropError) === Math.sign(gravityTorque)) {
            hints = HINTS.comHints;
        } else if (Math.abs(gravityTorque) < MIN_ERROR) {
            hints = HINTS.edgeHints;
        }
        const hint = this.getUnusedHint(hints);
        if (hint) {
            return hint;
        }
        return null;
    }

    private getUnusedHint(hints: string[]): string | null {
        const availableHints = hints.filter((hint) => !this.usedHints.has(hint));
        if (availableHints.length === 0) {
            return null;
        }
        const hint = availableHints[Math.floor(Math.random() * availableHints.length)];
        this.usedHints.add(hint);
        return hint;
    }

    private isShapeOffscreen(margin = 120): boolean {
        const polygon = this.currentShape();

        const minX = Math.min(...polygon.map((point) => point.x));
        const maxX = Math.max(...polygon.map((point) => point.x));
        const minY = Math.min(...polygon.map((point) => point.y));
        const maxY = Math.max(...polygon.map((point) => point.y));

        const left = -this.visibleLogicalWidth / 2;
        const right = this.visibleLogicalWidth / 2;

        return maxX < left - margin || minX > right + margin || maxY < -margin || minY > WORLD_HEIGHT + margin;
    }

    private getShakeOffset(): Point {
        const t = Math.min(this.animElapsedTime / SHAKE_DURATION, 1);
        if (t >= 1) {
            return { x: 0, y: 0 };
        }
        const intensity = clamp(Math.abs(this.dropError) * SHAKE_INTENSITY_SCALAR, 55, 150);
        const strength = intensity * SHAKE_DURATION * (1 - t) * (1 - t);

        return { x: (Math.random() * 2 - 1) * strength, y: 0 };
    }

    private getSuccessOffsetY(): number {
        const t = Math.min(this.animElapsedTime / SUCCESS_DURATION, 1);

        if (t < 0.4) {
            const p = t / 0.4;
            const eased = 1 - Math.pow(1 - p, 3);

            return SUCCESS_SQUASH * eased;
        }

        const p = (t - 0.4) / 0.6;

        const spring = Math.exp(-5 * p) * Math.cos(Math.PI * 2.5 * p);

        return SUCCESS_SQUASH * spring;
    }

    private setAnimState(state: AnimState, now: number = performance.now()): void {
        this.animState = state;
        this.animStartTime = now;
        this.animPrevFrameTime = this.animStartTime;
        this.animElapsedTime = 0;
    }

    private addTextHint(text: string): void {
        this.textHintQueue.push({
            text,
            visibleText: "",
            elapsed: 0,
        });
    }

    private updateTextHint(deltaTime: number): void {
        const hint = this.textHintQueue[0];

        if (!hint) {
            return;
        }

        hint.elapsed += deltaTime;
        const revealDuration = hint.text.length * HINT_CHAR_SPEED;
        const holdEnd = revealDuration + HINT_HOLD_DURATION;
        const disappearEnd = holdEnd + revealDuration;
        const removeTime = disappearEnd + HINT_GAP_DURATION;

        if (hint.elapsed >= removeTime) {
            this.textHintQueue.shift();
            return;
        }

        if (hint.elapsed < revealDuration) {
            const characters = Math.floor(hint.elapsed / HINT_CHAR_SPEED);
            hint.visibleText = hint.text.slice(0, characters);
            return;
        }

        if (hint.elapsed < holdEnd) {
            hint.visibleText = hint.text;
            return;
        }

        if (hint.elapsed < disappearEnd) {
            const disappearTime = hint.elapsed - holdEnd;
            const characters = hint.text.length - Math.floor(disappearTime / HINT_CHAR_SPEED);
            hint.visibleText = hint.text.slice(0, characters);
            return;
        }

        hint.visibleText = "";
    }

    private drawTextHint(): void {
        const hint = this.textHintQueue[0];

        if (!hint || !hint.visibleText) {
            return;
        }

        this.ctx.save();

        this.ctx.fillStyle = "#d8d4ca";
        this.ctx.font = "800 30px Inter, sans-serif";
        if (this.visibleLogicalWidth < 1000) {
            this.ctx.font = "800 26px Inter, sans-serif";
        }
        this.ctx.textAlign = "left";
        this.ctx.textBaseline = "bottom";

        this.ctx.fillText(hint.visibleText, -this.visibleLogicalWidth / 2 + 40, WORLD_HEIGHT - 50);

        this.ctx.restore();
    }

    private spawnConfetti(): void {
        const colors = ["#e4572e", "#f26a3d", "#f48c4a", "#f3a35c", "#d94a24", "#c94020"];

        const particleCount = CONFETTI_COUNT;
        const particlesPerSide = particleCount / 2;

        for (const side of [-1, 1]) {
            // Spawn at the corners/edges of the world.
            const originX = side * (this.visibleLogicalWidth / 2) + 20;

            for (let index = 0; index < particlesPerSide; index += 1) {
                this.confetti.push({
                    x: originX,
                    y: WORLD_HEIGHT + 20,

                    // Shoot inward toward the center.
                    // The random variation allows some particles to cross x = 0.
                    vx: -side * (500 + randomNormal() * 200),

                    // Strong upward burst.
                    vy: -(1700 + randomNormal() * 300),

                    // Circular particles.
                    size: 15 + Math.random() * 10,

                    color: colors[Math.floor(Math.random() * colors.length)],

                    lifetime: 1.5 + Math.random() * 0.8,
                    age: 0,
                });
            }
        }
    }

    private updateConfetti(deltaTime: number): void {
        for (const particle of this.confetti) {
            particle.age += deltaTime;

            const drag = 0.95 + (particle.size / 25) * 0.04;
            particle.vx *= Math.pow(drag, deltaTime * 60);
            particle.vy += GRAVITY * 0.5 * deltaTime;
            if (particle.vy < 0) particle.vy *= Math.pow(drag, deltaTime * 60);
            particle.x += particle.vx * deltaTime;
            particle.y += particle.vy * deltaTime;
        }

        this.confetti = this.confetti.filter((particle) => particle.age < particle.lifetime);
    }

    private drawConfetti(): void {
        for (const particle of this.confetti) {
            const opacity = 1 - particle.age / particle.lifetime;

            this.ctx.save();
            this.ctx.translate(particle.x, particle.y);
            this.ctx.globalAlpha = opacity;
            this.ctx.fillStyle = particle.color;

            this.ctx.beginPath();
            this.ctx.arc(0, 0, particle.size / 2, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.restore();
        }
        this.ctx.globalAlpha = 1;
    }

    private drawHintLine(): void {
        if (this.hintStage < 1) {
            return;
        }

        const t = performance.now() / 1000;

        this.ctx.save();

        this.ctx.globalAlpha = 0.4;
        this.ctx.strokeStyle = "#555";
        this.ctx.lineWidth = 2;

        this.ctx.setLineDash([4, 8]);

        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.lineTo(0, FULCRUM_Y);
        this.ctx.stroke();

        this.ctx.restore();
    }

    private drawComHint(): void {
        if (this.hintStage < 2) {
            return;
        }

        const com = centerOfMass(this.currentShape());

        this.ctx.save();

        this.ctx.fillStyle = "#e87532";

        this.ctx.beginPath();
        this.ctx.arc(com.x, com.y, 5, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.restore();
    }
}
