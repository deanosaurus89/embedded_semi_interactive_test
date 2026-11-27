import { add, basisFromNormal, cross, dot, length, normalize, scale, sub } from "./geometry.js";

export const FOOT_MODES = ["center", "contour", "nearest", "mesh"];

export function footTolerance(geometry) {
  const span = Math.max(Number(geometry?.radius) || 0, Number(geometry?.length) || 0, Number(geometry?.drawRadius) || 0, 1);
  return Math.max(0.75, span * 0.02);
}

export function centerPoint(geometry) {
  if (!geometry) return null;
  if (geometry.type === "plane" && geometry.outline?.length) return centroid(openLoop(geometry.outline));
  if (geometry.type === "rect" && geometry.corners?.length) return centroid(geometry.corners);
  if (geometry.center) return geometry.center;
  if (geometry.start) return geometry.start;
  return null;
}

export function contourLoops(geometry) {
  if (!geometry) return [];
  if (geometry.type === "circle" && geometry.center && geometry.normal && geometry.radius) {
    return [circleLoop(geometry.center, geometry.normal, geometry.radius, 48)];
  }
  if (geometry.type === "cylinder" && geometry.radius) {
    const ends = axisEnds(geometry);
    if (!ends) return [];
    return [circleLoop(ends[0], ends[2], geometry.radius, 36), circleLoop(ends[1], ends[2], geometry.radius, 36)];
  }
  if (geometry.type === "cone") {
    const ends = axisEnds(geometry);
    if (!ends) return [];
    const r1 = Number(geometry.radius) || 0;
    const r2 = Number(geometry.endRadius ?? geometry.radius) || 0;
    const loops = [];
    if (r1 > 0) loops.push(circleLoop(ends[0], ends[2], r1, 36));
    if (r2 > 0 && Math.abs(r2 - r1) > 1e-6) loops.push(circleLoop(ends[1], ends[2], r2, 36));
    return loops;
  }
  if (geometry.type === "sphere" && geometry.center && geometry.radius) {
    return [circleLoop(geometry.center, geometry.normal || { x: 0, y: 0, z: 1 }, geometry.radius, 48)];
  }
  if (geometry.type === "slot" && geometry.center && geometry.direction && geometry.normal && geometry.radius) {
    return [slotLoop(geometry)];
  }
  if (geometry.type === "plane") {
    if (geometry.outline?.length >= 3) return [openLoop(geometry.outline)];
    if (geometry.center && geometry.normal) return [circleLoop(geometry.center, geometry.normal, geometry.drawRadius || geometry.radius || 20, 48)];
  }
  if (geometry.type === "line" && geometry.center && geometry.direction && geometry.length) {
    const dir = normalize(geometry.direction);
    if (!dir) return [];
    const half = geometry.length / 2;
    return [[add(geometry.center, scale(dir, -half)), add(geometry.center, scale(dir, half))]];
  }
  if (geometry.type === "rect" && geometry.corners?.length >= 3) return [geometry.corners.slice()];
  return [];
}

export function constrainToContour(geometry, target) {
  const loops = contourLoops(geometry);
  if (!loops.length) return centerPoint(geometry);
  const aim = target || centerPoint(geometry);
  let best = null;
  let bestDistance = Infinity;
  for (const loop of loops) {
    const hit = closestOnPolyline(loop, aim, loop.length > 2);
    if (hit.distance < bestDistance) {
      bestDistance = hit.distance;
      best = hit.point;
    }
  }
  return best;
}

export function nearestFoot(geometry, project, label) {
  const samples = featureSamples(geometry);
  if (!samples.length || !project || !label) return centerPoint(geometry);
  let best = null;
  let bestDistance = Infinity;
  for (const point of samples) {
    const screen = project(point);
    if (!screen) continue;
    const distance = (screen.x - label.x) ** 2 + (screen.y - label.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best || samples[0];
}

export function footOnFeature(point, geometry, mode) {
  if (!point || !geometry) return false;
  if (mode === "mesh") return false;
  if (mode === "center") {
    const center = centerPoint(geometry);
    return Boolean(center) && length(sub(point, center)) <= 1e-4;
  }
  const tol = mode === "contour" ? Math.max(1e-3, footTolerance(geometry) * 0.05) : footTolerance(geometry);
  return distanceToFeature(point, geometry) <= tol;
}

export function distanceToFeature(point, geometry) {
  const loops = contourLoops(geometry);
  let best = Infinity;
  for (const loop of loops) {
    const hit = closestOnPolyline(loop, point, loop.length > 2);
    if (hit.distance < best) best = hit.distance;
  }
  if (geometry.type === "sphere" && geometry.center && geometry.radius) {
    best = Math.min(best, Math.abs(length(sub(point, geometry.center)) - geometry.radius));
  }
  if ((geometry.type === "cylinder" || geometry.type === "cone") && geometry.radius) {
    const ends = axisEnds(geometry);
    if (ends) best = Math.min(best, distanceToCylinder(point, ends[0], ends[1], geometry.radius, geometry.endRadius ?? geometry.radius));
  }
  return best;
}

export function distancePointToTriangle(point, a, b, c) {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(point, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return length(ap);
  const bp = sub(point, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return length(bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return length(sub(point, add(a, scale(ab, v))));
  }
  const cp = sub(point, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return length(cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return length(sub(point, add(a, scale(ac, w))));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return length(sub(point, add(b, scale(sub(c, b), w))));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return length(sub(point, add(a, add(scale(ab, v), scale(ac, w)))));
}

function featureSamples(geometry) {
  const samples = [];
  for (const loop of contourLoops(geometry)) samples.push(...loop);
  const center = centerPoint(geometry);
  if (center) samples.push(center);
  if (geometry.type === "sphere" && geometry.center && geometry.radius) {
    const basis = basisFromNormal(geometry.normal || { x: 0, y: 0, z: 1 });
    if (basis) {
      for (let i = 0; i < 8; i += 1) {
        for (let j = 1; j <= 3; j += 1) {
          const lat = (j / 4) * Math.PI - Math.PI / 2;
          const lon = (i / 8) * Math.PI * 2;
          const dir = add(add(scale(basis.n, Math.sin(lat)), scale(basis.u, Math.cos(lat) * Math.cos(lon))), scale(basis.v, Math.cos(lat) * Math.sin(lon)));
          samples.push(add(geometry.center, scale(dir, geometry.radius)));
        }
      }
    }
  }
  if (geometry.type === "cylinder" && geometry.radius) {
    const ends = axisEnds(geometry);
    const basis = ends && basisFromNormal(ends[2]);
    if (ends && basis) {
      for (let i = 0; i < 8; i += 1) {
        const angle = (i / 8) * Math.PI * 2;
        const radial = add(scale(basis.u, Math.cos(angle) * geometry.radius), scale(basis.v, Math.sin(angle) * geometry.radius));
        for (const t of [0.25, 0.5, 0.75]) {
          samples.push(add(add(ends[0], scale(sub(ends[1], ends[0]), t)), radial));
        }
      }
    }
  }
  return samples;
}

function closestOnPolyline(points, target, closed) {
  if (!points?.length || !target) return { point: null, distance: Infinity };
  if (points.length === 1) return { point: points[0], distance: length(sub(points[0], target)) };
  let best = points[0];
  let bestDistance = Infinity;
  const span = closed ? points.length : points.length - 1;
  for (let i = 0; i < span; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const point = closestOnSegment(a, b, target);
    const distance = length(sub(point, target));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return { point: best, distance: bestDistance };
}

function closestOnSegment(a, b, point) {
  const ab = sub(b, a);
  const denom = dot(ab, ab);
  if (denom < 1e-12) return a;
  const t = Math.min(1, Math.max(0, dot(sub(point, a), ab) / denom));
  return add(a, scale(ab, t));
}

function circleLoop(center, normal, radius, segments) {
  const basis = basisFromNormal(normal);
  if (!basis || !(radius > 0)) return [];
  const points = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(add(center, add(scale(basis.u, Math.cos(angle) * radius), scale(basis.v, Math.sin(angle) * radius))));
  }
  return points;
}

function slotLoop(geometry) {
  const dir = normalize(geometry.direction);
  const normal = normalize(geometry.normal);
  const side = dir && normal ? normalize(cross(normal, dir)) : null;
  if (!dir || !side) return [];
  const radius = geometry.radius;
  const span = Math.max((geometry.length || radius * 2) - 2 * radius, 0);
  const c1 = add(geometry.center, scale(dir, -span / 2));
  const c2 = add(geometry.center, scale(dir, span / 2));
  const steps = 18;
  const loop = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = Math.PI / 2 + (Math.PI * i) / steps;
    loop.push(add(c1, add(scale(dir, Math.cos(angle) * radius), scale(side, Math.sin(angle) * radius))));
  }
  for (let i = 0; i <= steps; i += 1) {
    const angle = -Math.PI / 2 + (Math.PI * i) / steps;
    loop.push(add(c2, add(scale(dir, Math.cos(angle) * radius), scale(side, Math.sin(angle) * radius))));
  }
  return loop;
}

function axisEnds(geometry) {
  const axis = normalize(geometry.normal || geometry.direction);
  if (!axis) return null;
  if (geometry.start && geometry.length) return [geometry.start, add(geometry.start, scale(axis, geometry.length)), axis];
  if (!geometry.center) return null;
  const half = (Number(geometry.length) || 0) / 2;
  return [add(geometry.center, scale(axis, -half)), add(geometry.center, scale(axis, half)), axis];
}

function distanceToCylinder(point, start, end, radius, endRadius) {
  const axis = sub(end, start);
  const len2 = dot(axis, axis);
  if (len2 < 1e-12) return distanceToCircle(point, start, { x: 0, y: 0, z: 1 }, radius);
  const t = Math.min(1, Math.max(0, dot(sub(point, start), axis) / len2));
  const onAxis = add(start, scale(axis, t));
  const radial = length(sub(point, onAxis));
  const expected = radius + (endRadius - radius) * t;
  return Math.abs(radial - expected);
}

function distanceToCircle(point, center, normal, radius) {
  const n = normalize(normal);
  if (!n) return Infinity;
  const rel = sub(point, center);
  const along = dot(rel, n);
  const radial = length(sub(rel, scale(n, along)));
  return Math.hypot(along, radial - radius);
}

function openLoop(points) {
  if (points.length > 1 && samePoint(points[0], points[points.length - 1])) return points.slice(0, -1);
  return points.slice();
}

function centroid(points) {
  if (!points.length) return null;
  return scale(points.reduce((sum, point) => add(sum, point), { x: 0, y: 0, z: 0 }), 1 / points.length);
}

function samePoint(a, b) {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}
