// Region growing on a tessellated mesh. Adjacent faces join while their normals stay within the angle.

export function buildMesh(positions, indices) {
  const faces = [];
  const triCount = indices ? indices.length / 3 : positions.length / 9;
  for (let face = 0; face < triCount; face += 1) {
    const i0 = indices ? indices[face * 3] : face * 3;
    const i1 = indices ? indices[face * 3 + 1] : face * 3 + 1;
    const i2 = indices ? indices[face * 3 + 2] : face * 3 + 2;
    const a = at(positions, i0, !indices);
    const b = at(positions, i1, !indices);
    const c = at(positions, i2, !indices);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    faces.push({ i0, i1, i2, a, b, c, n: [n[0] / len, n[1] / len, n[2] / len] });
  }
  const edges = new Map();
  const addEdge = (ia, ib, face) => {
    const key = ia < ib ? `${ia},${ib}` : `${ib},${ia}`;
    const list = edges.get(key);
    if (list) list.push(face);
    else edges.set(key, [face]);
  };
  faces.forEach((face, index) => {
    addEdge(face.i0, face.i1, index);
    addEdge(face.i1, face.i2, index);
    addEdge(face.i2, face.i0, index);
  });
  const neighbors = faces.map(() => []);
  for (const list of edges.values()) {
    if (list.length === 2) {
      neighbors[list[0]].push(list[1]);
      neighbors[list[1]].push(list[0]);
    }
  }
  return { faces, neighbors, edges };
}

function at(positions, index, flat) {
  const o = flat ? index * 3 : index * 3;
  return [positions[o], positions[o + 1], positions[o + 2]];
}

export function growRegion(mesh, startFace, angleDeg) {
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
      const d = normal[0] * other[0] + normal[1] * other[1] + normal[2] * other[2];
      if (d >= cos) {
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
    for (const point of loop) {
      points.push(point);
      normals.push(mesh.faces[faceIds[0]].n);
    }
    return { points, normals };
  }
  const seen = new Set();
  for (const id of faceIds) {
    const face = mesh.faces[id];
    for (const index of [face.i0, face.i1, face.i2]) {
      if (seen.has(index)) continue;
      seen.add(index);
      points.push(index === face.i0 ? face.a : index === face.i1 ? face.b : face.c);
      normals.push(face.n);
    }
  }
  return { points, normals };
}

function boundaryLoops(mesh, inside) {
  const segments = [];
  const push = (ia, ib, a, b, face) => {
    const key = ia < ib ? `${ia},${ib}` : `${ib},${ia}`;
    const users = mesh.edges.get(key) || [];
    const outside = users.filter((id) => !inside.has(id));
    if (users.length === 1 || outside.length) segments.push([a, b]);
  };
  for (const id of inside) {
    const face = mesh.faces[id];
    push(face.i0, face.i1, face.a, face.b, id);
    push(face.i1, face.i2, face.b, face.c, id);
    push(face.i2, face.i0, face.c, face.a, id);
  }
  return [segments.flatMap(([a, b]) => [a, b])];
}
