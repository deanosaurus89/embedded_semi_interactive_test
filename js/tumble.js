import { add, cross, dot, norm, scale, unit } from "./mw-vec.js";

/** Rotate the camera offset (camera - target) by dx about the vertical screen
 *  axis and dy about the horizontal screen axis. Angles are radians. */
export function tumble(offset, up, dx, dy) {
  let o = [offset[0], offset[1], offset[2]];
  let u = unit(up);
  const apply = (axis, ang) => {
    if (!ang || norm(axis) < 1e-12) return;
    const a = unit(axis);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const rot = (v) => add(add(scale(v, c), scale(cross(a, v), s)), scale(a, dot(a, v) * (1 - c)));
    o = rot(o);
    u = unit(rot(u));
  };
  const view = scale(unit(o), -1);
  const right = cross(view, u);
  const screenUp = cross(right, view);
  apply(screenUp, -dx);
  const view2 = scale(unit(o), -1);
  const right2 = cross(view2, u);
  apply(right2, -dy);
  if (norm(o) < 1e-9) o = offset;
  return { offset: o, up: u };
}
