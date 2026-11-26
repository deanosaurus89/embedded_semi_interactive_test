export function keepLegacyFit(geometry) {
  return geometry?.mode === "fit" && Boolean(geometry.center);
}

export function projectOutline(points, fit) {
  if (!fit?.normal || !fit.center || points.length < 3) return null;
  const n = fit.normal;
  const c = fit.center;
  const projected = points.map((point) => {
    const d = (point[0] - c[0]) * n[0] + (point[1] - c[1]) * n[1] + (point[2] - c[2]) * n[2];
    return { x: point[0] - n[0] * d, y: point[1] - n[1] * d, z: point[2] - n[2] * d };
  });
  const first = projected[0];
  const last = projected[projected.length - 1];
  if (first.x !== last.x || first.y !== last.y || first.z !== last.z) projected.push({ ...first });
  return projected;
}
