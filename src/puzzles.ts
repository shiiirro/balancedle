import { Point } from "./geometry";
import { generateRandomShape } from "./shapes";

export interface PuzzleDefinition {
    id: string;
    seed: number;
    shape: Point[];
}

function hashString(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function mulberry32(seed: number): () => number {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function centerShape(shape: Point[]): Point[] {
    const minX = Math.min(...shape.map((p) => p.x));
    const maxX = Math.max(...shape.map((p) => p.x));
    const minY = Math.min(...shape.map((p) => p.y));
    const maxY = Math.max(...shape.map((p) => p.y));

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    return shape.map((point) => ({
        x: point.x - centerX,
        y: point.y - centerY,
    }));
}

/** Uses UTC so every player receives the same daily puzzle worldwide. */
export function getDayKey(date = new Date()): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

export function createDailyPuzzle(dayKey = getDayKey()): PuzzleDefinition {
    // dayKey = Math.random().toString(36).substring(2, 8);
    const seed = hashString(dayKey);
    const random = mulberry32(seed);
    const tmp = generateRandomShape(4, 0.35, 0.55, 350, random);
    const shape = centerShape(tmp).map((point) => ({
        x: point.x,
        y: point.y,
    }));

    return {
        id: dayKey,
        seed,
        shape,
    };
}
