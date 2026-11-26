import { add, dot, norm, scale, sub, unit } from "./mw-vec.js";

const WORLD = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

export function snapAxisView(clicked, fromTarget, camUp, axes) {
  const A = (axes ?? WORLD).map((a) => unit(norm(a) > 1e-8 ? a : [0, 0, 1]));
  const click = norm(clicked) > 1e-8 ? unit(clicked) : [0, 0, 1];
  const view = norm(fromTarget) > 1e-8 ? unit(fromTarget) : click;
  const parts = [];
  for (let k = 0; k < 3; k += 1) {
    if (Math.abs(clicked[k]) < 0.5) continue;
    const w = [0, 0, 0];
    w[k] = Math.sign(clicked[k]) || 1;
    let best = 0;
    let bestD = -1;
    let sign = 1;
    for (let i = 0; i < 3; i += 1) {
      const dp = dot(w, A[i]);
      if (Math.abs(dp) > bestD) {
        bestD = Math.abs(dp);
        best = i;
        sign = dp >= 0 ? 1 : -1;
      }
    }
    parts.push(scale(A[best], sign));
  }
  let dir = parts.length ? parts.reduce((s, p) => add(s, p), [0, 0, 0]) : view;
  if (norm(dir) < 1e-8) dir = view;
  dir = unit(dir);
  if (parts.length === 1 && dot(dir, view) < 0 && dot(click, view) > 0.2) dir = scale(dir, -1);
  const up0 = norm(camUp) > 1e-8 ? unit(camUp) : [0, 0, 1];
  let up = [0, 0, 1];
  let best = -Infinity;
  for (const a of A) {
    if (Math.abs(dot(unit(a), dir)) > 0.85) continue;
    for (const s of [1, -1]) {
      const c = scale(a, s);
      const score = dot(c, up0);
      if (score > best) {
        best = score;
        up = c;
      }
    }
  }
  const proj = sub(up, scale(dir, dot(up, dir)));
  if (norm(proj) > 1e-6) up = unit(proj);
  return { dir, up };
}

export function standardViewDir(name) {
  const signed = (i, s) => scale(WORLD[i], s);
  let dir;
  if (name === "iso") dir = unit(add(add(signed(0, 1), scale(signed(1, 1), -1.3)), scale(signed(2, 1), 1.1)));
  else {
    const sign = name.startsWith("-") ? -1 : 1;
    const axis = name.endsWith("X") ? 0 : name.endsWith("Y") ? 1 : 2;
    dir = signed(axis, sign);
  }
  let up = Math.abs(dot(dir, WORLD[2])) > 0.9 ? WORLD[1] : WORLD[2];
  const proj = sub(up, scale(dir, dot(up, dir)));
  up = norm(proj) > 1e-6 ? unit(proj) : WORLD[0];
  return { dir, up };
}
