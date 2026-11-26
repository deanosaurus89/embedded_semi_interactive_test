// OBJLoader emits non-indexed triangles. Vertices are welded by position so a
// click can snap to a shared Knotenpunkt and so adjacency stays available.

export function weldPositions(positions, indices, tolerance = 1e-4) {
  const triCount = indices ? indices.length / 3 : positions.length / 9;
  const scale = 1 / tolerance;
  const map = new Map();
  const welded = [];
  const remap = new Map();
  const keyOf = (vertex) => {
    const offset = vertex * 3;
    return `${Math.round(positions[offset] * scale)},${Math.round(positions[offset + 1] * scale)},${Math.round(positions[offset + 2] * scale)}`;
  };
  const weld = (vertex) => {
    const known = remap.get(vertex);
    if (known !== undefined) return known;
    const key = keyOf(vertex);
    let id = map.get(key);
    if (id === undefined) {
      id = welded.length / 3;
      const offset = vertex * 3;
      welded.push(positions[offset], positions[offset + 1], positions[offset + 2]);
      map.set(key, id);
    }
    remap.set(vertex, id);
    return id;
  };
  const out = new Uint32Array(triCount * 3);
  for (let face = 0; face < triCount; face += 1) {
    const i0 = indices ? indices[face * 3] : face * 3;
    const i1 = indices ? indices[face * 3 + 1] : face * 3 + 1;
    const i2 = indices ? indices[face * 3 + 2] : face * 3 + 2;
    out[face * 3] = weld(i0);
    out[face * 3 + 1] = weld(i1);
    out[face * 3 + 2] = weld(i2);
  }
  return { positions: welded, indices: out };
}

export function buildMesh(positions, indices, tolerance = 1e-4) {
  const welded = weldPositions(positions, indices, tolerance);
  const source = welded.positions;
  const index = welded.indices;
  const faces = [];
  const triCount = index.length / 3;
  const vertexNormals = Array.from({ length: source.length / 3 }, () => [0, 0, 0]);
  for (let face = 0; face < triCount; face += 1) {
    const i0 = index[face * 3];
    const i1 = index[face * 3 + 1];
    const i2 = index[face * 3 + 2];
    const a = at(source, i0);
    const b = at(source, i1);
    const c = at(source, i2);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const raw = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const len = Math.hypot(raw[0], raw[1], raw[2]) || 1;
    const n = [raw[0] / len, raw[1] / len, raw[2] / len];
    faces.push({ i0, i1, i2, a, b, c, n });
    for (const id of [i0, i1, i2]) {
      vertexNormals[id][0] += n[0];
      vertexNormals[id][1] += n[1];
      vertexNormals[id][2] += n[2];
    }
  }
  for (const normal of vertexNormals) {
    const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
    normal[0] /= len;
    normal[1] /= len;
    normal[2] /= len;
  }
  const edges = new Map();
  const addEdge = (ia, ib, face) => {
    if (ia === ib) return;
    const key = ia < ib ? `${ia},${ib}` : `${ib},${ia}`;
    const list = edges.get(key);
    if (list) list.push(face);
    else edges.set(key, [face]);
  };
  faces.forEach((face, faceIndex) => {
    addEdge(face.i0, face.i1, faceIndex);
    addEdge(face.i1, face.i2, faceIndex);
    addEdge(face.i2, face.i0, faceIndex);
  });
  const neighbors = faces.map(() => []);
  for (const list of edges.values()) {
    if (list.length === 2) {
      neighbors[list[0]].push(list[1]);
      neighbors[list[1]].push(list[0]);
    }
  }
  const vertices = [];
  for (let i = 0; i < source.length; i += 3) vertices.push([source[i], source[i + 1], source[i + 2]]);
  return { faces, neighbors, edges, vertices, vertexNormals, positions: source, indices: index };
}

function at(positions, index) {
  const offset = index * 3;
  return [positions[offset], positions[offset + 1], positions[offset + 2]];
}

export function growRegion(mesh, startFace, angleDeg) {
  if (startFace == null || startFace < 0 || startFace >= mesh.faces.length) return [];
  const cos = Math.cos((angleDeg * Math.PI) / 180);
  const seen = new Uint8Array(mesh.faces.length);
  const stack = [startFace];
  seen[startFace] = 1;
  const faces = [];
  while (stack.length) {
    const face = stack.pop();
    faces.push(face);
    const normal = mesh.faces[face].n;
    for (const next of mesh.neighbors[face]) {
      if (seen[next]) continue;
      const other = mesh.faces[next].n;
      const agree = normal[0] * other[0] + normal[1] * other[1] + normal[2] * other[2];
      if (agree >= cos) {
        seen[next] = 1;
        stack.push(next);
      }
    }
  }
  return faces;
}

export function regionSamples(mesh, faceIds, mode) {
  const inside = new Set(faceIds);
  const points = [];
  const normals = [];
  if (mode === "boundary") {
    const loops = boundaryLoops(mesh, inside);
    const loop = loops.sort((a, b) => a.length - b.length).at(-1) || [];
    const fallback = mesh.faces[faceIds[0]]?.n || [0, 0, 1];
    for (const point of loop) {
      points.push(point);
      normals.push(fallback);
    }
    return { points, normals };
  }
  const seen = new Set();
  for (const id of faceIds) {
    const face = mesh.faces[id];
    for (const index of [face.i0, face.i1, face.i2]) {
      if (seen.has(index)) continue;
      seen.add(index);
      points.push(mesh.vertices[index]);
      normals.push(mesh.vertexNormals[index]);
    }
  }
  return { points, normals };
}

export function brushSelect(mesh, center, radius, facing) {
  const limit = radius * radius;
  const minDot = Math.cos((70 * Math.PI) / 180);
  const chosen = new Set();
  const faces = facing ? mesh.faces : null;
  for (let i = 0; i < mesh.vertices.length; i += 1) {
    const point = mesh.vertices[i];
    const dx = point[0] - center[0];
    const dy = point[1] - center[1];
    const dz = point[2] - center[2];
    if (dx * dx + dy * dy + dz * dz > limit) continue;
    if (facing) {
      const normal = mesh.vertexNormals[i];
      const agree = normal[0] * facing[0] + normal[1] * facing[1] + normal[2] * facing[2];
      if (agree < minDot) continue;
    }
    chosen.add(i);
  }
  if (faces) {
    for (const face of faces) {
      const agree = face.n[0] * facing[0] + face.n[1] * facing[1] + face.n[2] * facing[2];
      if (agree < minDot) continue;
      if (pointToTriangle(center, face.a, face.b, face.c) > radius) continue;
      chosen.add(face.i0);
      chosen.add(face.i1);
      chosen.add(face.i2);
    }
  }
  return [...chosen];
}

function pointToTriangle(p, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const d1 = dot3(ab, ap);
  const d2 = dot3(ac, ap);
  if (d1 <= 0 && d2 <= 0) return dist3(p, a);
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
  const d3 = dot3(ab, bp);
  const d4 = dot3(ac, bp);
  if (d3 >= 0 && d4 <= d3) return dist3(p, b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return dist3(p, lerp(a, ab, d1 / (d1 - d3)));
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const d5 = dot3(ab, cp);
  const d6 = dot3(ac, cp);
  if (d6 >= 0 && d5 <= d6) return dist3(p, c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return dist3(p, lerp(a, ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const edge = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    return dist3(p, lerp(b, edge, (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return dist3(p, [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function lerp(origin, direction, t) {
  return [origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t];
}

function boundaryLoops(mesh, inside) {
  const segments = [];
  const push = (ia, ib, a, b) => {
    if (ia === ib) return;
    const key = ia < ib ? `${ia},${ib}` : `${ib},${ia}`;
    const users = mesh.edges.get(key) || [];
    const outside = users.some((id) => !inside.has(id));
    if (users.length < 2 || outside) segments.push([a, b]);
  };
  for (const id of inside) {
    const face = mesh.faces[id];
    push(face.i0, face.i1, face.a, face.b);
    push(face.i1, face.i2, face.b, face.c);
    push(face.i2, face.i0, face.c, face.a);
  }
  return [segments.flatMap(([a, b]) => [a, b])];
}
