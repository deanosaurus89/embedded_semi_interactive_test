// Pure geometry in OBJ millimetres. No three.js dependency.

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length(a) {
  return Math.hypot(a.x, a.y, a.z);
}

export function normalize(a) {
  const len = length(a);
  if (len < 1e-12) return null;
  return scale(a, 1 / len);
}

export function basisFromNormal(normal) {
  const n = normalize(normal);
  if (!n) return null;
  const helper = Math.abs(n.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = normalize(cross(helper, n));
  const v = cross(n, u);
  return { n, u, v };
}

// Circumcircle of three points. Null when the points are colinear.
export function circleFromThreePoints(a, b, c) {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const n = cross(ab, ac);
  const n2 = dot(n, n);
  if (n2 < 1e-8) return null;
  const center = add(
    a,
    scale(add(scale(cross(n, ab), dot(ac, ac)), scale(cross(ac, n), dot(ab, ab))), 1 / (2 * n2)),
  );
  return {
    center,
    normal: scale(n, 1 / Math.sqrt(n2)),
    radius: length(sub(center, a)),
  };
}

// Circle in the plane of `normal` through `center`, radius from `edge`.
export function circleFromCenterAndEdge(center, edge, normal) {
  const n = normalize(normal);
  if (!n) return null;
  const radial = sub(edge, center);
  const inPlane = sub(radial, scale(n, dot(radial, n)));
  const radius = length(inPlane);
  if (radius < 1e-4) return null;
  return { center: { ...center }, normal: n, radius };
}

// Rectangle: a = origin, b = end of the width edge, c = a point on the height side.
export function rectangleFromThreePoints(a, b, c) {
  const widthVec = sub(b, a);
  const width = length(widthVec);
  if (width < 1e-4) return null;
  const xAxis = scale(widthVec, 1 / width);
  const toC = sub(c, a);
  const normal = normalize(cross(xAxis, toC));
  if (!normal) return null;
  const yAxis = cross(normal, xAxis);
  const height = dot(toC, yAxis);
  if (Math.abs(height) < 1e-4) return null;
  const y = scale(yAxis, height);
  const x = widthVec;
  const corners = [a, add(a, x), add(add(a, x), y), add(a, y)].map((p) => ({ ...p }));
  return { corners, normal, width, height: Math.abs(height) };
}

export function sampleCircle(center, normal, radius, segments) {
  const basis = basisFromNormal(normal);
  if (!basis) return [];
  const points = [];
  for (let i = 0; i < segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    const dir = add(scale(basis.u, Math.cos(t)), scale(basis.v, Math.sin(t)));
    points.push(add(center, scale(dir, radius)));
  }
  return points;
}

export const GEOMETRY_PALETTE = [
  "#d0121a",
  "#2456b5",
  "#1b7a46",
  "#e07a00",
  "#6b3fa0",
  "#0e7490",
  "#b4539a",
  "#3f6212",
  "#7c3aed",
  "#a16207",
];
