export interface Point {
    x: number;
    y: number;
}

export interface SupportResult {
    edgeIndex: number;
    contact: Point;
    contactOffset: Point;
    edgeAngle: number;
    isVertex: boolean;
}

export const EPSILON = 1e-8;

export function rotatePoint(point: Point, radians: number): Point {
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    return {
        x: point.x * c - point.y * s,
        y: point.x * s + point.y * c,
    };
}

export function transformPolygon(polygon: Point[], position: Point, rotation: number): Point[] {
    return polygon.map((point) => {
        const rotated = rotatePoint(point, rotation);
        return {
            x: rotated.x + position.x,
            y: rotated.y + position.y,
        };
    });
}

export function translatePolygon(polygon: Point[], delta: Point): Point[] {
    return polygon.map((point) => ({
        x: point.x + delta.x,
        y: point.y + delta.y,
    }));
}

export function centerOfMass(polygon: Point[]): Point {
    let twiceArea = 0;
    let cx = 0;
    let cy = 0;

    for (let i = 0; i < polygon.length; i += 1) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const cross = a.x * b.y - b.x * a.y;
        twiceArea += cross;
        cx += (a.x + b.x) * cross;
        cy += (a.y + b.y) * cross;
    }

    if (Math.abs(twiceArea) < EPSILON) {
        throw new Error("Polygon has zero area");
    }

    return {
        x: cx / (3 * twiceArea),
        y: cy / (3 * twiceArea),
    };
}

export function angleFromHorizontal(radians: number): number {
    let result = radians;
    if (result > Math.PI / 2) result -= Math.PI;
    if (result < -Math.PI / 2) result += Math.PI;
    return result;
}

export function normalizeRadians(angle: number): number {
    let result = angle;
    while (result <= -Math.PI) result += Math.PI * 2;
    while (result > Math.PI) result -= Math.PI * 2;
    return result;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function calculateVertexAngle(polygon: Point[], vertexIndex: number): number | null {
    const vertex = polygon[vertexIndex];
    const previous = polygon[(vertexIndex - 1 + polygon.length) % polygon.length];
    const next = polygon[(vertexIndex + 1) % polygon.length];

    const incoming = Math.atan2(-(vertex.y - previous.y), vertex.x - previous.x);
    const outgoing = Math.atan2(-(next.y - vertex.y), next.x - vertex.x);

    return (incoming + outgoing) / 2;
}

// origin of the shape is no longer the center of mass
export function findVerticalSupport(polygon: Point[], fulcrumX: number): SupportResult | null {
    const candidates: SupportResult[] = [];
    const com = centerOfMass(polygon);

    for (let i = 0; i < polygon.length; i += 1) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;

        if (Math.abs(dx) <= EPSILON) {
            if (Math.abs(a.x - fulcrumX) <= EPSILON) {
                const contactIndex = a.y >= b.y ? i : (i + 1) % polygon.length;
                const angle = calculateVertexAngle(polygon, contactIndex);
                candidates.push({
                    edgeIndex: i,
                    contact: {
                        x: fulcrumX,
                        y: polygon[contactIndex].y,
                    },
                    contactOffset: {
                        x: fulcrumX - com.x,
                        y: polygon[contactIndex].y - com.y,
                    },
                    isVertex: angle ? true : false,
                    edgeAngle: angle ?? Math.atan2(-dy, dx),
                });
            }
        } else {
            const t = (fulcrumX - a.x) / dx;
            if (t < -EPSILON || t > 1 + EPSILON) continue;
            const clampedT = clamp(t, 0, 1);
            let edgeAngle = Math.atan2(-dy, dx);
            let vertexAngle = null;
            let isVertex = false;
            if (Math.abs(a.x - fulcrumX) < 5 && (vertexAngle = calculateVertexAngle(polygon, i)) && Math.abs(angleFromHorizontal(vertexAngle)) < Math.abs(angleFromHorizontal(edgeAngle))) {
                edgeAngle = vertexAngle;
                isVertex = true;
            }
            if (Math.abs(b.x - fulcrumX) < 5 && (vertexAngle = calculateVertexAngle(polygon, (i + 1) % polygon.length)) && Math.abs(angleFromHorizontal(vertexAngle)) < Math.abs(angleFromHorizontal(edgeAngle))) {
                edgeAngle = vertexAngle;
                isVertex = true;
            }
            candidates.push({
                edgeIndex: i,
                contact: {
                    x: fulcrumX,
                    y: a.y + dy * clampedT,
                },
                contactOffset: {
                    x: fulcrumX - com.x,
                    y: a.y + dy * clampedT - com.y,
                },
                isVertex,
                edgeAngle,
            });
        }
    }

    if (candidates.length === 0) return null;

    return candidates.reduce((lowest, current) => {
        if (current.contactOffset.y > lowest.contactOffset.y + EPSILON) return current;
        if (Math.abs(current.contactOffset.y - lowest.contactOffset.y) <= EPSILON) {
            const currentAngle = Math.abs(angleFromHorizontal(current.edgeAngle));
            const lowestAngle = Math.abs(angleFromHorizontal(lowest.edgeAngle));
            return currentAngle < lowestAngle ? current : lowest;
        }
        return lowest;
    });
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i];
        const b = polygon[j];
        const crossesScanline = a.y > point.y !== b.y > point.y;

        if (!crossesScanline) continue;

        const intersectionX = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;

        if (point.x < intersectionX) {
            inside = !inside;
        }
    }

    return inside;
}

export function pointInShapeBounds(point: Point, polygon: Point[]): boolean {
    const xs = polygon.map((p) => p.x);
    const ys = polygon.map((p) => p.y);

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return (
        point.x >= minX &&
        point.x <= maxX &&
        point.y >= minY &&
        point.y <= maxY
    );
}

export function rotatePolygonAroundPoint(polygon: Point[], pivot: Point, radians: number): Point[] {
    const c = Math.cos(radians);
    const s = Math.sin(radians);

    return polygon.map((point) => {
        const dx = point.x - pivot.x;
        const dy = point.y - pivot.y;
        return {
            x: pivot.x + dx * c - dy * s,
            y: pivot.y + dx * s + dy * c,
        };
    });
}

export function degrees(radians: number): number {
    return (radians * 180) / Math.PI;
}

export const randomNormal = (): number => {
    const u = 1 - Math.random();
    const v = 1 - Math.random();

    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

export function add(a: Point, b: Point): Point {
    return {
        x: a.x + b.x,
        y: a.y + b.y,
    };
}

export function sub(a: Point, b: Point): Point {
    return {
        x: a.x - b.x,
        y: a.y - b.y,
    };
}

export function mul(v: Point, scalar: number): Point {
    return {
        x: v.x * scalar,
        y: v.y * scalar,
    };
}

export function length(v: Point): number {
    return Math.hypot(v.x, v.y);
}

export function normalize(v: Point): Point {
    const len = length(v);

    if (len < EPSILON) {
        return {
            x: 0,
            y: 0,
        };
    }

    return {
        x: v.x / len,
        y: v.y / len,
    };
}

export function distance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

export function dot(a: Point, b: Point): number {
    return a.x * b.x + a.y * b.y;
}

export function cross(a: Point, b: Point): number {
    return a.x * b.y - a.y * b.x;
}

export function samePoint(a: Point, b: Point): boolean {
    return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
}

