import { Point, clamp, add, sub, mul, length, normalize, distance, dot, cross, samePoint, EPSILON } from "./geometry";

type Segment =
    | {
          type: "line";
          a: Point;
          b: Point;
      }
    | {
          type: "bezier";
          p0: Point;
          p1: Point;
          p2: Point;
          p3: Point;
      };

// ============================================================
// TUNING
// ============================================================

/**
 * Minimum angular separation between initial vertices,
 * expressed as a fraction of the ideal angular spacing.
 *
 * Example with 8 vertices:
 *   ideal spacing = 45°
 *   factor = 0.35
 *   minimum spacing = 15.75°
 */
const MIN_INITIAL_ANGLE_FACTOR = 0.5;

/**
 * Initial vertices are generated between these fractions of the
 * normalized radius.
 *
 * Keeping them away from the exact center helps avoid pathological
 * skinny starting polygons.
 */
const MIN_INITIAL_RADIUS = 0.5;
const MAX_INITIAL_RADIUS = 1.0;

const MAX_DENT_ANGLE_DEVIATION = Math.PI / 4;

/**
 * Minimum and maximum dent positions relative to the selected edge length.
 */
const MIN_DENT_POSITION = 0.3;
const MAX_DENT_POSITION = 0.7;

/**
 * Don't dent very short edges.
 */
const MIN_EDGE_LENGTH = 0.08;

/**
 * Dent minimum clearance to the nearest edge and minimum depth.
 */
const DENT_MIN_CLEARANCE = 0.1;
const DENT_MIN_DEPTH = 0.05;

/**
 * Bézier bow amount relative to edge length.
 */
const BEZIER_CURVATURE_MIN = 0.1;
const BEZIER_CURVATURE_MAX = 0.45;

/**
 * Number of points sampled from every Bézier curve.
 *
 * This is also the resolution used to validate the final boundary.
 */
const BEZIER_SAMPLES = 128;

/**
 * Number of attempts to find a valid Bézier configuration.
 */
const MAX_SMOOTH_ATTEMPTS = 50;

const MIN_BOUNDARY_CLEARANCE = 0.025;

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Generates an irregular closed shape.
 *
 * `size` is the approximate diameter of the resulting shape.
 *
 * All geometry is generated in normalized coordinates around
 * the origin and scaled by `size` exactly once at the end.
 *
 * Returns only the final boundary coordinates.
 */
export function generateRandomShape(initialVertices: number, dentChance: number, smoothChance: number, size: number, random: () => number): Point[] {
    validateInputs(initialVertices, dentChance, smoothChance, size);

    let polygon = generateInitialPolygon(initialVertices, random);

    // for (let pass = 0; pass < DENT_PASSES; pass++) {
    //     polygon = dentPolygon(polygon, dentChance);
    // }

    polygon = dentPolygon(polygon, dentChance, random);

    if (!isSimplePolygon(polygon)) {
        throw new Error("Failed to generate a valid polygon.");
    }

    const points = generateFinalBoundary(polygon, smoothChance, random);

    return scaleToBoundingSize(points, size);
}

// ============================================================
// INPUT VALIDATION
// ============================================================

function validateInputs(initialVertices: number, dentChance: number, smoothChance: number, size: number): void {
    if (!Number.isInteger(initialVertices) || initialVertices < 3) {
        throw new Error("initialVertices must be an integer >= 3.");
    }

    if (!Number.isFinite(dentChance) || dentChance < 0 || dentChance > 1) {
        throw new Error("dentChance must be between 0 and 1.");
    }

    if (!Number.isFinite(smoothChance) || smoothChance < 0 || smoothChance > 1) {
        throw new Error("smoothChance must be between 0 and 1.");
    }

    if (!Number.isFinite(size) || size <= 0) {
        throw new Error("size must be a positive finite number.");
    }

    if (MIN_INITIAL_ANGLE_FACTOR <= 0 || MIN_INITIAL_ANGLE_FACTOR > 1) {
        throw new Error("MIN_INITIAL_ANGLE_FACTOR must be > 0 and <= 1.");
    }

    if (MIN_INITIAL_RADIUS <= 0 || MIN_INITIAL_RADIUS > MAX_INITIAL_RADIUS) {
        throw new Error("Invalid initial radius tuning constants.");
    }

    if (BEZIER_SAMPLES < 2) {
        throw new Error("BEZIER_SAMPLES must be >= 2.");
    }
}

// ============================================================
// INITIAL POLYGON
// ============================================================

/**
 * Generates angularly-separated points in a normalized disk,
 * then connects them in angular order.
 *
 * Since every vertex lies on a distinct ray from the origin,
 * angular ordering gives us a simple initial polygon.
 */
function generateInitialPolygon(count: number, random: () => number): Point[] {
    const angles = generateAngles(count, random);

    const polygon = angles.map((angle) => {
        const radius = randomRange(MIN_INITIAL_RADIUS, MAX_INITIAL_RADIUS, random);

        return {
            // Radius 0.5 means the normalized shape has an
            // approximate diameter of 1. It is scaled by `size`
            // at the very end.
            x: Math.cos(angle) * radius * 0.5,
            y: Math.sin(angle) * radius * 0.5,
        };
    });

    // Angular sorting already produces CCW order because angles
    // are ascending.
    return polygon;
}

/**
 * Generate random angles and reject any set where two adjacent
 * vertices are too close angularly.
 */
function generateAngles(count: number, random: () => number): number[] {
    const idealSpacing = (Math.PI * 2) / count;

    const minimumSpacing = idealSpacing * MIN_INITIAL_ANGLE_FACTOR;
    let angles = null;
    do {
        angles = Array.from({ length: count }, () => randomRange(minimumSpacing, Math.PI * 2 - minimumSpacing, random)).sort((a, b) => a - b);
    } while (!hasMinimumAngularSeparation(angles, minimumSpacing));

    return angles;
}

function hasMinimumAngularSeparation(sortedAngles: number[], minimumSpacing: number): boolean {
    for (let i = 1; i < sortedAngles.length; i++) {
        if (sortedAngles[i] - sortedAngles[i - 1] < minimumSpacing) {
            return false;
        }
    }

    // Circular gap between the final and first vertex.
    const wrapGap = Math.PI * 2 - sortedAngles[sortedAngles.length - 1] + sortedAngles[0];

    return wrapGap >= minimumSpacing;
}

// ============================================================
// DENTING
// ============================================================

function dentPolygon(polygon: Point[], chance: number, random: () => number): Point[] {
    let result = [...polygon];

    for (let i = 0; i < result.length; i++) {
        if (random() > chance) {
            continue;
        }

        const a = result[i];

        const b = result[(i + 1) % result.length];

        const edgeIndex = i;
        const edgeLength = distance(a, b);

        if (edgeLength < MIN_EDGE_LENGTH) {
            continue;
        }

        const position = randomRange(MIN_DENT_POSITION, MAX_DENT_POSITION, random);

        const candidate = makeDent(result, edgeIndex, position, random);

        if (candidate !== null && isSimplePolygon(candidate)) {
            result = candidate;
        }
    }
    return result;
}

function makeDent(polygon: Point[], edgeIndex: number, position: number, random: () => number): Point[] | null {
    const a = polygon[edgeIndex];
    const b = polygon[(edgeIndex + 1) % polygon.length];

    const edge = sub(b, a);
    const edgeLength = length(edge);

    if (edgeLength < EPSILON) {
        return null;
    }

    const direction = normalize(edge);

    // CCW polygon → left side is inward.
    const inward = {
        x: -direction.y,
        y: direction.x,
    };

    const deviation = randomRange(-MAX_DENT_ANGLE_DEVIATION, MAX_DENT_ANGLE_DEVIATION, random);
    const dentDirection = {
        x: inward.x * Math.cos(deviation) - inward.y * Math.sin(deviation),
        y: inward.x * Math.sin(deviation) + inward.y * Math.cos(deviation),
    };

    const edgePoint = add(a, mul(edge, position));

    const availableDepth = distanceToNearestEdge(polygon, edgeIndex, edgePoint, dentDirection);
    const maxPathDepth = availableDepth - DENT_MIN_CLEARANCE;
    const steps = 64;
    let safeDepth = 0;

    for (let i = 1; i <= steps; i++) {
        const depth = (maxPathDepth * i) / steps;

        const point = add(edgePoint, mul(dentDirection, depth));

        let valid = true;

        for (let j = 0; j < polygon.length; j++) {
            // Ignore the edge from which the dent originates.
            if (j === edgeIndex) {
                continue;
            }

            const edgeA = polygon[j];
            const edgeB = polygon[(j + 1) % polygon.length];

            if (pointToSegmentDistance(point, edgeA, edgeB) < DENT_MIN_CLEARANCE) {
                valid = false;
                break;
            }
        }

        if (!valid) {
            break;
        }

        safeDepth = depth;
    }

    if (safeDepth <= DENT_MIN_DEPTH) {
        return null;
    }

    const depth = randomRange(DENT_MIN_DEPTH, safeDepth, random);
    
    const dentPoint = add(edgePoint, mul(dentDirection, depth));

    return [...polygon.slice(0, edgeIndex + 1), dentPoint, ...polygon.slice(edgeIndex + 1)];
}

function distanceToNearestEdge(polygon: Point[], edgeIndex: number, origin: Point, direction: Point): number {
    let nearest = Infinity;

    for (let i = 0; i < polygon.length; i++) {
        if (i === edgeIndex) continue;

        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];

        const edge = sub(b, a);
        const toEdge = sub(a, origin);

        const denominator = cross(direction, edge);

        if (Math.abs(denominator) < EPSILON) {
            continue;
        }

        const t = cross(toEdge, edge) / denominator;
        const u = cross(toEdge, direction) / denominator;

        // t = distance along ray
        // u = position along polygon edge
        if (t > EPSILON && u >= 0 && u <= 1) {
            nearest = Math.min(nearest, t);
        }
    }

    return nearest;
}

// ============================================================
// BÉZIER GENERATION
// ============================================================

/**
 * Creates the final boundary and validates the actual sampled
 * result.
 *
 * This is intentionally done as a whole rather than validating
 * individual Béziers against the original polygon.
 */
function generateFinalBoundary(polygon: Point[], smoothChance: number, random: () => number): Point[] {
    for (let attempt = 0; attempt < MAX_SMOOTH_ATTEMPTS; attempt++) {
        const segments = createSegments(polygon, smoothChance, random);

        // Sample exactly what we intend to return.
        const points = sampleBoundary(segments);

        // Validate the actual sampled boundary.
        if (isSimplePolygon(points)) {
            return points;
        }
    }

    /*
     * The polygon itself is known to be valid, so this is a safe
     * fallback if the requested Bézier configuration cannot fit.
     */
    return [...polygon];
}

function createSegments(polygon: Point[], smoothChance: number, random: () => number): Segment[] {
    const segments: Segment[] = [];

    for (let i = 0; i < polygon.length; i++) {
        const current = polygon[i];

        const next = polygon[(i + 1) % polygon.length];

        if (random() > smoothChance) {
            segments.push({
                type: "line",
                a: current,
                b: next,
            });

            continue;
        }

        segments.push(makeBezier(current, next, random));
    }

    return segments;
}

/**
 * Creates a cubic Bézier that bows perpendicular to the
 * original polygon edge.
 */
function makeBezier(a: Point, b: Point, random: () => number): Segment {
    const edge = sub(b, a);
    const edgeLength = length(edge);

    if (edgeLength < EPSILON) {
        return {
            type: "line",
            a,
            b,
        };
    }

    const direction = normalize(edge);

    const normal = {
        x: -direction.y,
        y: direction.x,
    };

    // Randomly bow to either side.
    const curvature = edgeLength * randomRange(BEZIER_CURVATURE_MIN, BEZIER_CURVATURE_MAX, random) * (random() < 0.5 ? -1 : 1);

    const handleLength = edgeLength * 0.33;

    return {
        type: "bezier",

        p0: a,

        p1: add(a, add(mul(direction, handleLength), mul(normal, curvature))),

        p2: add(b, add(mul(direction, -handleLength), mul(normal, curvature))),

        p3: b,
    };
}

// ============================================================
// SAMPLING
// ============================================================

function sampleBoundary(segments: Segment[]): Point[] {
    const points: Point[] = [];

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];

        let samples: Point[];

        if (segment.type === "line") {
            samples = [segment.a, segment.b];
        } else {
            samples = sampleBezier(segment, BEZIER_SAMPLES);
        }

        /*
         * Consecutive segments share an endpoint.
         * Keep only one copy.
         */
        if (points.length > 0) {
            points.push(...samples.slice(1));
        } else {
            points.push(...samples);
        }
    }

    /*
     * The final segment ends at the first point, so remove
     * the duplicated closing coordinate.
     */
    if (points.length > 1) {
        points.pop();
    }

    return points;
}

function sampleBezier(curve: Extract<Segment, { type: "bezier" }>, count: number): Point[] {
    const points: Point[] = [];

    for (let i = 0; i <= count; i++) {
        points.push(cubicBezier(curve, i / count));
    }

    return points;
}

function cubicBezier(curve: Extract<Segment, { type: "bezier" }>, t: number): Point {
    const u = 1 - t;

    const uu = u * u;
    const tt = t * t;

    return {
        x: uu * u * curve.p0.x + 3 * uu * t * curve.p1.x + 3 * u * tt * curve.p2.x + tt * t * curve.p3.x,

        y: uu * u * curve.p0.y + 3 * uu * t * curve.p1.y + 3 * u * tt * curve.p2.y + tt * t * curve.p3.y,
    };
}

// ============================================================
// POLYGON VALIDATION
// ============================================================

/**
 * Tests whether a closed point sequence forms a simple,
 * non-degenerate polygon.
 */
function isSimplePolygon(polygon: Point[]): boolean {
    if (polygon.length < 3) {
        return false;
    }

    if (Math.abs(signedArea(polygon)) < EPSILON) {
        return false;
    }

    // Reject zero-length edges.
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];

        const b = polygon[(i + 1) % polygon.length];

        if (distance(a, b) < EPSILON) {
            return false;
        }
    }

    // Reject intersections between non-adjacent edges.
    for (let i = 0; i < polygon.length; i++) {
        const a0 = polygon[i];

        const a1 = polygon[(i + 1) % polygon.length];

        for (let j = i + 1; j < polygon.length; j++) {
            // Adjacent edges are allowed to share vertices.
            if (j === i || j === (i + 1) % polygon.length || i === (j + 1) % polygon.length) {
                continue;
            }

            const b0 = polygon[j];

            const b1 = polygon[(j + 1) % polygon.length];

            if (segmentsIntersect(a0, a1, b0, b1)) {
                return false;
            }
        }
    }

    return true;
}

function isValidFinalBoundary(points: Point[]): boolean {
    if (!isSimplePolygon(points)) {
        return false;
    }

    const count = points.length;

    for (let i = 0; i < count; i++) {
        const a0 = points[i];
        const a1 = points[(i + 1) % count];

        for (let j = i + 1; j < count; j++) {
            // Adjacent sampled segments share a vertex by design.
            if (j === i || j === (i + 1) % count || i === (j + 1) % count) {
                continue;
            }

            const b0 = points[j];
            const b1 = points[(j + 1) % count];

            // They may not intersect.
            if (segmentsIntersect(a0, a1, b0, b1)) {
                return false;
            }

            // They may not come closer than the configured clearance.
            if (segmentDistance(a0, a1, b0, b1) < MIN_BOUNDARY_CLEARANCE) {
                return false;
            }
        }
    }

    return true;
}

function scaleToBoundingSize(points: Point[], size: number): Point[] {
    if (points.length === 0) {
        return [];
    }

    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;

    for (const point of points) {
        if (point.x < minX) minX = point.x;
        if (point.x > maxX) maxX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
    }

    const width = maxX - minX;
    const height = maxY - minY;

    if (width === 0 || height === 0) {
        return points;
    }

    const scale = size / Math.max(width, height);

    return points.map((point) => ({
        x: (point.x - minX) * scale,
        y: (point.y - minY) * scale,
    }));
}

// ============================================================
// GEOMETRY
// ============================================================

function signedArea(polygon: Point[]): number {
    let area = 0;

    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];

        const b = polygon[(i + 1) % polygon.length];

        area += a.x * b.y - b.x * a.y;
    }

    return area * 0.5;
}

function findEdge(polygon: Point[], a: Point, b: Point): number {
    for (let i = 0; i < polygon.length; i++) {
        const p0 = polygon[i];

        const p1 = polygon[(i + 1) % polygon.length];

        if (samePoint(p0, a) && samePoint(p1, b)) {
            return i;
        }
    }

    return -1;
}

function pointToSegmentDistance(point: Point, a: Point, b: Point): number {
    const ab = sub(b, a);

    const lengthSq = ab.x * ab.x + ab.y * ab.y;

    if (lengthSq < EPSILON) {
        return distance(point, a);
    }

    const ap = sub(point, a);

    const t = clamp(dot(ap, ab) / lengthSq, 0, 1);

    return distance(point, add(a, mul(ab, t)));
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
    if (segmentsIntersect(a, b, c, d)) {
        return 0;
    }

    return Math.min(pointToSegmentDistance(a, c, d), pointToSegmentDistance(b, c, d), pointToSegmentDistance(c, a, b), pointToSegmentDistance(d, a, b));
}

// ============================================================
// INTERSECTION
// ============================================================

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
    const ab = sub(b, a);
    const ac = sub(c, a);
    const ad = sub(d, a);

    const cd = sub(d, c);
    const ca = sub(a, c);
    const cb = sub(b, c);

    const d1 = cross(ab, ac);
    const d2 = cross(ab, ad);
    const d3 = cross(cd, ca);
    const d4 = cross(cd, cb);

    // Proper intersection.
    if (((d1 > EPSILON && d2 < -EPSILON) || (d1 < -EPSILON && d2 > EPSILON)) && ((d3 > EPSILON && d4 < -EPSILON) || (d3 < -EPSILON && d4 > EPSILON))) {
        return true;
    }

    // Collinear / touching cases.
    if (Math.abs(d1) <= EPSILON && onSegment(a, b, c)) {
        return true;
    }

    if (Math.abs(d2) <= EPSILON && onSegment(a, b, d)) {
        return true;
    }

    if (Math.abs(d3) <= EPSILON && onSegment(c, d, a)) {
        return true;
    }

    if (Math.abs(d4) <= EPSILON && onSegment(c, d, b)) {
        return true;
    }

    return false;
}

function onSegment(a: Point, b: Point, p: Point): boolean {
    return p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON && p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON;
}

export function randomRange(min: number, max: number, random: () => number): number {
    return min + random() * (max - min);
}
