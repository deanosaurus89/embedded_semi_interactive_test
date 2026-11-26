// Least-squares fits ported from the MessWerk fit (Linie, Ebene, Kreis, Langloch, Zylinder, Kegel, Kugel).
// Vectors are [x, y, z]. No three.js.

export function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function norm(a) { return Math.hypot(a[0], a[1], a[2]); }
export function unit(a) {
  const n = norm(a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
}
export function basis(n) {
  const a = unit(n);
  const helper = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross(helper, a));
  const v = cross(a, u);
  return [u, v];
}

export function centroid(points) {
  let x = 0, y = 0, z = 0;
  for (const q of points) { x += q[0]; y += q[1]; z += q[2]; }
  const n = points.length || 1;
  return [x / n, y / n, z / n];
}

function scatter(points, c = [0, 0, 0]) {
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const q of points) {
    const d = [q[0] - c[0], q[1] - c[1], q[2] - c[2]];
    for (let i = 0; i < 3; i += 1) for (let j = i; j < 3; j += 1) m[i][j] += d[i] * d[j];
  }
  m[1][0] = m[0][1]; m[2][0] = m[0][2]; m[2][1] = m[1][2];
  return m;
}

export function eigSym3(matrix) {
  const a = matrix.map((row) => row.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iter = 0; iter < 32; iter += 1) {
    let p = 0, q = 1, max = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > max) { max = Math.abs(a[0][2]); p = 0; q = 2; }
    if (Math.abs(a[1][2]) > max) { max = Math.abs(a[1][2]); p = 1; q = 2; }
    if (max < 1e-15) break;
    const app = a[p][p], aqq = a[q][q], apq = a[p][q];
    const tau = (aqq - app) / (2 * apq);
    const t = Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;
    for (let k = 0; k < 3; k += 1) {
      const aik = a[k][p], aiq = a[k][q];
      a[k][p] = c * aik - s * aiq;
      a[k][q] = s * aik + c * aiq;
    }
    for (let k = 0; k < 3; k += 1) {
      const akp = a[p][k], akq = a[q][k];
      a[p][k] = c * akp - s * akq;
      a[q][k] = s * akp + c * akq;
    }
    a[p][q] = a[q][p] = 0;
    for (let k = 0; k < 3; k += 1) {
      const vip = v[k][p], viq = v[k][q];
      v[k][p] = c * vip - s * viq;
      v[k][q] = s * vip + c * viq;
    }
  }
  const values = [a[0][0], a[1][1], a[2][2]];
  const order = [0, 1, 2].sort((i, j) => values[i] - values[j]);
  return {
    values: order.map((i) => values[i]),
    vectors: order.map((i) => unit([v[0][i], v[1][i], v[2][i]])),
  };
}

export function solveSmall(matrix, vector) {
  const A = matrix.map((row) => row.slice());
  const b = vector.slice();
  const n = b.length;
  for (let i = 0; i < n; i += 1) {
    let pivot = i;
    for (let r = i + 1; r < n; r += 1) if (Math.abs(A[r][i]) > Math.abs(A[pivot][i])) pivot = r;
    if (Math.abs(A[pivot][i]) < 1e-14) return null;
    [A[i], A[pivot]] = [A[pivot], A[i]];
    [b[i], b[pivot]] = [b[pivot], b[i]];
    for (let r = i + 1; r < n; r += 1) {
      const factor = A[r][i] / A[i][i];
      for (let c = i; c < n; c += 1) A[r][c] -= factor * A[i][c];
      b[r] -= factor * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = b[i];
    for (let c = i + 1; c < n; c += 1) sum -= A[i][c] * x[c];
    x[i] = sum / A[i][i];
  }
  return x;
}

export function levenbergMarquardt(fn, x0, count, opts = {}) {
  const maxIter = opts.maxIter ?? 60;
  let x = x0.slice();
  let lambda = 1e-3;
  const step = 1e-6;
  const residual = new Float64Array(count);
  fn(x, residual);
  let cost = 0;
  for (let i = 0; i < count; i += 1) cost += residual[i] * residual[i];
  for (let iter = 0; iter < maxIter; iter += 1) {
    const n = x.length;
    const J = Array.from({ length: count }, () => new Float64Array(n));
    for (let j = 0; j < n; j += 1) {
      const next = x.slice();
      next[j] += step;
      const trial = new Float64Array(count);
      fn(next, trial);
      for (let i = 0; i < count; i += 1) J[i][j] = (trial[i] - residual[i]) / step;
    }
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    const g = new Array(n).fill(0);
    for (let i = 0; i < count; i += 1) {
      for (let j = 0; j < n; j += 1) {
        g[j] += J[i][j] * residual[i];
        for (let k = 0; k < n; k += 1) A[j][k] += J[i][j] * J[i][k];
      }
    }
    for (let j = 0; j < n; j += 1) A[j][j] += lambda;
    const delta = solveSmall(A, g.map((value) => -value));
    if (!delta) { lambda *= 8; continue; }
    const xn = x.map((value, index) => value + delta[index]);
    const nextResidual = new Float64Array(count);
    fn(xn, nextResidual);
    let nextCost = 0;
    for (let i = 0; i < count; i += 1) nextCost += nextResidual[i] * nextResidual[i];
    if (nextCost < cost) {
      x = xn;
      residual.set(nextResidual);
      cost = nextCost;
      lambda = Math.max(lambda * 0.3, 1e-12);
      if (cost < 1e-16) break;
    } else {
      lambda *= 6;
      if (lambda > 1e12) break;
    }
  }
  return { x };
}

function stats(residual) {
  let sum = 0, min = Infinity, max = -Infinity;
  for (const value of residual) {
    sum += value * value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const ok = residual.length > 0;
  return { rms: ok ? Math.sqrt(sum / residual.length) : 0, form: ok ? max - min : 0, maxPos: ok ? max : 0, maxNeg: ok ? min : 0, n: residual.length };
}

export function fitPlane(points, normalHint) {
  if (points.length < 3) throw new Error("Ebene braucht mindestens 3 Punkte, bitte mehr Fläche anmalen.");
  const center = centroid(points);
  let normal = eigSym3(scatter(points, center)).vectors[0];
  if (normalHint && dot(normal, normalHint) < 0) normal = scale(normal, -1);
  const residual = new Float64Array(points.length);
  points.forEach((q, i) => { residual[i] = dot(sub(q, center), normal); });
  return { type: "Ebene", center, normal, residuals: residual, ...stats(residual) };
}

export function fitLine(points, plane) {
  if (points.length < 2) throw new Error("Linie braucht mindestens 2 Punkte, bitte mehr Fläche anmalen.");
  const projected = plane
    ? points.map((q) => sub(q, scale(plane.normal, dot(sub(q, plane.center), plane.normal))))
    : points;
  const center0 = centroid(projected);
  const vectors = eigSym3(scatter(projected, center0)).vectors;
  let direction = vectors[2];
  if (plane) direction = unit(sub(direction, scale(plane.normal, dot(direction, plane.normal))));
  const side = plane ? unit(cross(plane.normal, direction)) : vectors[1];
  let lo = Infinity, hi = -Infinity;
  const residual = new Float64Array(projected.length);
  projected.forEach((q, i) => {
    const v = sub(q, center0);
    const t = dot(v, direction);
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
    residual[i] = plane ? dot(v, side) : norm(sub(v, scale(direction, t)));
  });
  const center = add(center0, scale(direction, (lo + hi) / 2));
  const big = [0, 1, 2].reduce((a, b) => (Math.abs(direction[b]) > Math.abs(direction[a]) ? b : a), 0);
  if (direction[big] < 0) direction = scale(direction, -1);
  return { type: "Linie", center, normal: direction, direction, length: hi - lo, residuals: residual, ...stats(residual) };
}

export function fitCircle2D(xy) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sz = 0, sxz = 0, syz = 0;
  const n = xy.length;
  for (const [x, y] of xy) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sz += z; sxz += x * z; syz += y * z;
  }
  const solved = solveSmall(
    [[4 * sxx, 4 * sxy, 2 * sx], [4 * sxy, 4 * syy, 2 * sy], [2 * sx, 2 * sy, n]],
    [2 * sxz, 2 * syz, sz],
  ) ?? [0, 0, 0];
  const r0 = Math.sqrt(Math.max(solved[2] + solved[0] ** 2 + solved[1] ** 2, 1e-12));
  const out = levenbergMarquardt((q, o) => {
    for (let i = 0; i < n; i += 1) o[i] = Math.hypot(xy[i][0] - q[0], xy[i][1] - q[1]) - q[2];
  }, [solved[0], solved[1], r0], n);
  return { cx: out.x[0], cy: out.x[1], r: Math.abs(out.x[2]) };
}

export function fitCircle3D(points, normal) {
  if (points.length < 3) throw new Error("Kreis braucht mindestens 3 Punkte, bitte mehr Fläche anmalen.");
  const n = normal ? unit(normal) : fitPlane(points).normal;
  const c = centroid(points);
  const [u, v] = basis(n);
  const xy = points.map((q) => { const d = sub(q, c); return [dot(d, u), dot(d, v)]; });
  const k = fitCircle2D(xy);
  const center = add(c, add(scale(u, k.cx), scale(v, k.cy)));
  const residual = new Float64Array(points.length);
  xy.forEach((q, i) => { residual[i] = Math.hypot(q[0] - k.cx, q[1] - k.cy) - k.r; });
  return { type: "Kreis", center, normal: n, radius: k.r, diameter: 2 * k.r, residuals: residual, ...stats(residual) };
}

export function fitSphere(points) {
  if (points.length < 4) throw new Error("Kugel braucht mindestens 4 Punkte, bitte mehr Fläche anmalen.");
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const b = [0, 0, 0, 0];
  for (const q of points) {
    const row = [2 * q[0], 2 * q[1], 2 * q[2], 1];
    const z = dot(q, q);
    for (let i = 0; i < 4; i += 1) {
      b[i] += row[i] * z;
      for (let j = 0; j < 4; j += 1) A[i][j] += row[i] * row[j];
    }
  }
  const s = solveSmall(A, b) ?? [0, 0, 0, 1];
  const c0 = [s[0], s[1], s[2]];
  const r0 = Math.sqrt(Math.max(s[3] + dot(c0, c0), 1e-12));
  const fn = (x, o) => {
    for (let i = 0; i < points.length; i += 1) o[i] = Math.hypot(points[i][0] - x[0], points[i][1] - x[1], points[i][2] - x[2]) - x[3];
  };
  const out = levenbergMarquardt(fn, [...c0, r0], points.length);
  const residual = new Float64Array(points.length);
  fn(out.x, residual);
  const center = [out.x[0], out.x[1], out.x[2]];
  const radius = Math.abs(out.x[3]);
  const normal = unit(sub(centroid(points), center));
  return { type: "Kugel", center, normal: norm(normal) > 0 ? normal : [0, 0, 1], radius, diameter: 2 * radius, residuals: residual, ...stats(residual) };
}

export function axisFromNormals(normals, centered = false) {
  const c = centered ? centroid(normals) : [0, 0, 0];
  const e = eigSym3(scatter(normals, c));
  return { axis: e.vectors[0], ratio: e.values[0] / Math.max(e.values[2], 1e-300) };
}

function tiltAxis(d0, a, b) {
  const [u, v] = basis(d0);
  return unit(add(d0, add(scale(u, a), scale(v, b))));
}

export function canonical(d) {
  const i = [0, 1, 2].reduce((a, b) => (Math.abs(d[b]) > Math.abs(d[a]) + 1e-9 ? b : a), 2);
  return d[i] < 0 ? scale(d, -1) : d;
}

export function fitCylinder(points, axisHint) {
  if (points.length < 5) throw new Error("Zylinder braucht mindestens 5 Punkte, bitte mehr Fläche anmalen.");
  const d0 = unit(axisHint);
  const c0 = centroid(points);
  const [u, v] = basis(d0);
  const xy = points.map((q) => { const d = sub(q, c0); return [dot(d, u), dot(d, v)]; });
  const k = fitCircle2D(xy);
  const fn = (x, o) => {
    const d = tiltAxis(d0, x[0], x[1]);
    const c = add(c0, add(scale(u, x[2]), scale(v, x[3])));
    for (let i = 0; i < points.length; i += 1) {
      const w = sub(points[i], c);
      const t = dot(w, d);
      o[i] = Math.hypot(w[0] - t * d[0], w[1] - t * d[1], w[2] - t * d[2]) - x[4];
    }
  };
  const out = levenbergMarquardt(fn, [0, 0, k.cx, k.cy, k.r], points.length);
  const x = out.x;
  const d = tiltAxis(d0, x[0], x[1]);
  const c = add(c0, add(scale(u, x[2]), scale(v, x[3])));
  let tmin = Infinity, tmax = -Infinity;
  for (const q of points) {
    const t = dot(sub(q, c), d);
    tmin = Math.min(tmin, t);
    tmax = Math.max(tmax, t);
  }
  const residual = new Float64Array(points.length);
  fn(x, residual);
  const radius = Math.abs(x[4]);
  return { type: "Zylinder", center: add(c, scale(d, 0.5 * (tmin + tmax))), normal: canonical(d), radius, diameter: 2 * radius, length: tmax - tmin, residuals: residual, ...stats(residual) };
}

export function fitCone(points, normals) {
  if (points.length < 6) throw new Error("Kegel braucht mindestens 6 Punkte, bitte mehr Fläche anmalen.");
  let d0 = axisFromNormals(normals, true).axis;
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const b = [0, 0, 0];
  normals.forEach((n, i) => {
    const np = dot(n, points[i]);
    for (let r = 0; r < 3; r += 1) {
      b[r] += n[r] * np;
      for (let c = 0; c < 3; c += 1) M[r][c] += n[r] * n[c];
    }
  });
  const solved = solveSmall(M, b);
  let apex0 = solved ? [solved[0], solved[1], solved[2]] : centroid(points);
  const cp = centroid(points);
  if (dot(sub(cp, apex0), d0) < 0) d0 = scale(d0, -1);
  let sa = 0;
  for (const q of points) {
    const w = sub(q, apex0);
    const t = dot(w, d0);
    sa += Math.atan2(norm(sub(w, scale(d0, t))), t);
  }
  const alpha0 = sa / points.length;
  const sc = Math.max(norm(sub(cp, apex0)), 1e-6);
  const fn = (x, o) => {
    const d = tiltAxis(d0, x[0], x[1]);
    const ap = [apex0[0] + x[2] * sc, apex0[1] + x[3] * sc, apex0[2] + x[4] * sc];
    const ca = Math.cos(x[5]), sn = Math.sin(x[5]);
    for (let i = 0; i < points.length; i += 1) {
      const w = sub(points[i], ap);
      const t = dot(w, d);
      const rad = Math.hypot(w[0] - t * d[0], w[1] - t * d[1], w[2] - t * d[2]);
      o[i] = rad * ca - t * sn;
    }
  };
  const out = levenbergMarquardt(fn, [0, 0, 0, 0, 0, alpha0], points.length);
  const x = out.x;
  const d = tiltAxis(d0, x[0], x[1]);
  const apex = [apex0[0] + x[2] * sc, apex0[1] + x[3] * sc, apex0[2] + x[4] * sc];
  let tmin = Infinity, tmax = -Infinity;
  for (const q of points) {
    const t = dot(sub(q, apex), d);
    tmin = Math.min(tmin, t);
    tmax = Math.max(tmax, t);
  }
  const tm = 0.5 * (tmin + tmax);
  const ha = Math.abs(x[5]);
  const residual = new Float64Array(points.length);
  fn(x, residual);
  const radius = tm * Math.tan(ha);
  return { type: "Kegel", center: add(apex, scale(d, tm)), normal: d, apex, halfAngle: ha, radius, diameter: 2 * radius, length: tmax - tmin, residuals: residual, ...stats(residual) };
}

function stadium(x, y, cx, cy, th, h, r) {
  const c = Math.cos(th), s = Math.sin(th);
  const lx = (x - cx) * c + (y - cy) * s;
  const ly = -(x - cx) * s + (y - cy) * c;
  const lc = Math.max(-h, Math.min(h, lx));
  return Math.hypot(lx - lc, ly) - r;
}

export function fitSlot(points, axis) {
  if (points.length < 8) throw new Error("Langloch braucht mindestens 8 Punkte, bitte mehr Fläche anmalen.");
  const n = canonical(unit(axis));
  const c0 = centroid(points);
  const [u, v] = basis(n);
  const xy = points.map((q) => { const d = sub(q, c0); return [dot(d, u), dot(d, v)]; });
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of xy) { sxx += x * x; syy += y * y; sxy += x * y; }
  const th0 = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let lmax = 0, wmax = 0;
  for (const [x, y] of xy) {
    lmax = Math.max(lmax, Math.abs(x * Math.cos(th0) + y * Math.sin(th0)));
    wmax = Math.max(wmax, Math.abs(-x * Math.sin(th0) + y * Math.cos(th0)));
  }
  const fn = (q, o) => {
    for (let i = 0; i < xy.length; i += 1) o[i] = stadium(xy[i][0], xy[i][1], q[0], q[1], q[2], Math.abs(q[3]), q[4]);
  };
  const out = levenbergMarquardt(fn, [0, 0, th0, Math.max(lmax - wmax, 1e-3), wmax], points.length, { maxIter: 80 });
  const q = out.x;
  const residual = new Float64Array(points.length);
  fn(q, residual);
  const dir = unit(add(scale(u, Math.cos(q[2])), scale(v, Math.sin(q[2]))));
  let tmin = Infinity, tmax = -Infinity;
  for (const pt of points) {
    const t = dot(sub(pt, c0), n);
    tmin = Math.min(tmin, t);
    tmax = Math.max(tmax, t);
  }
  const center = add(c0, add(add(scale(u, q[0]), scale(v, q[1])), scale(n, 0.5 * (tmin + tmax))));
  const radius = Math.abs(q[4]);
  const h = Math.abs(q[3]);
  return { type: "Langloch", center, normal: n, direction: canonical(dir), radius, width: 2 * radius, length: 2 * h + 2 * radius, residuals: residual, ...stats(residual) };
}

function robust(run, points, normals, k = 3) {
  let result = run(points, normals);
  let P = points, N = normals;
  for (let iter = 0; iter < 3; iter += 1) {
    const residual = result.residuals;
    const abs = Array.from(residual, Math.abs).sort((a, b) => a - b);
    const sigma = 1.4826 * (abs[Math.floor(abs.length / 2)] || 0);
    const thr = Math.max(k * sigma, 1e-9);
    const keep = [];
    residual.forEach((value, i) => { if (Math.abs(value) <= thr) keep.push(i); });
    if (keep.length === P.length || keep.length < 8) break;
    P = keep.map((i) => P[i]);
    N = N.length ? keep.map((i) => N[i]) : N;
    result = run(P, N);
  }
  result.outliers = points.length - P.length;
  return result;
}

export function fitType(type, points, normals, robustFit = true) {
  const run = (pp, nn) => {
    switch (type) {
      case "Ebene": return fitPlane(pp, nn.length ? centroid(nn) : undefined);
      case "Kugel": return fitSphere(pp);
      case "Zylinder": return fitCylinder(pp, axisFromNormals(nn.length ? nn : pp.map(() => [0, 0, 1])).axis);
      case "Kreis": return fitCircle3D(pp, nn.length ? axisFromNormals(nn).axis : undefined);
      case "Langloch": return fitSlot(pp, axisFromNormals(nn.length ? nn : pp).axis);
      case "Kegel": return fitCone(pp, nn.length ? nn : pp.map(() => [0, 0, 1]));
      case "Linie": return fitLine(pp);
      default: throw new Error("Typ nicht ausgleichbar: " + type);
    }
  };
  return robustFit && type !== "Linie" ? robust(run, points, normals, 3) : run(points, normals);
}

function extent(points) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const q of points) for (let i = 0; i < 3; i += 1) { min[i] = Math.min(min[i], q[i]); max[i] = Math.max(max[i], q[i]); }
  return norm(sub(max, min));
}

export function autoFit(points, normals) {
  const ext = Math.max(extent(points), 1e-6);
  const candidates = [];
  const tryFit = (type) => { try { candidates.push(fitType(type, points, normals)); } catch { /* skip */ } };
  tryFit("Ebene");
  if (candidates[0] && normals.length) {
    const pn = candidates[0].normal;
    let inside = 0;
    for (const q of normals) if (Math.abs(dot(unit(q), pn)) > Math.cos(3 * Math.PI / 180)) inside += 1;
    if (inside > 0.95 * normals.length) return { best: candidates[0], candidates };
  }
  tryFit("Kugel");
  tryFit("Zylinder");
  tryFit("Kegel");
  tryFit("Langloch");
  const valid = candidates.filter((c) => {
    if (!Number.isFinite(c.rms)) return false;
    if (c.type === "Kugel" || c.type === "Zylinder") return (c.radius ?? 0) < 3 * ext && (c.radius ?? 0) > 1e-6;
    if (c.type === "Kegel") return (c.halfAngle ?? 0) > 0.035 && (c.halfAngle ?? 0) < 1.4;
    if (c.type === "Langloch") return (c.length ?? 0) - (c.width ?? 0) > 0.15 * (c.width ?? 1);
    return true;
  });
  const order = ["Ebene", "Zylinder", "Langloch", "Kugel", "Kegel", "Kreis", "Linie"];
  const penalty = { Kugel: 1.4 };
  const eff = (c) => c.rms * (penalty[c.type] ?? 1);
  valid.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  const minRms = Math.min(...valid.map(eff));
  let best = valid.find((c) => eff(c) <= 1.3 * minRms + 1e-4 * ext) ?? valid[0];
  if (best && best.type === "Zylinder" && (best.length ?? 0) < 0.25 * (best.diameter ?? 1)) {
    try { best = fitType("Kreis", points, normals); } catch { /* keep cylinder */ }
  }
  return { best, candidates };
}

export function formatFit(fit) {
  const mm = (value) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const bits = [fit.type];
  if (fit.diameter) bits.push(`Durchmesser ${mm(fit.diameter)} mm`);
  else if (fit.radius) bits.push(`Radius ${mm(fit.radius)} mm`);
  if (fit.length) bits.push(`Laenge ${mm(fit.length)} mm`);
  if (fit.width && fit.type === "Langloch") bits.push(`Breite ${mm(fit.width)} mm`);
  if (fit.halfAngle) bits.push(`Winkel ${mm(fit.halfAngle * 180 / Math.PI)} Grad`);
  bits.push(`Form ${mm(fit.form)} mm`);
  return bits.join(" · ");
}
