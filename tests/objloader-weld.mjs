// Regression: three.js OBJLoader returns non-indexed triangles. Region growing
// must weld those vertices before adjacency, using the same buildMesh path as
// the page (indexLoadedModel passes position.array and a null index).

import fs from "node:fs";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { buildMesh, growRegion, regionSamples } from "../js/mesh-select.js";
import { autoFit } from "../js/fit.js";

const text = fs.readFileSync(new URL("../models/milkyway.obj", import.meta.url), "utf8");
const group = new OBJLoader().parse(text);
let geometry = null;
group.traverse((obj) => {
  if (!geometry && obj.isMesh) geometry = obj.geometry;
});
if (!geometry) throw new Error("OBJLoader fand kein Mesh");
if (geometry.index) throw new Error("OBJLoader lieferte indizierte Geometrie; der Test prueft den Non-Index-Pfad");

const positions = geometry.attributes.position.array;
const rawVertices = positions.length / 3;
const rawShared = sharedEdgeCount(positions);
if (rawShared !== 0) {
  throw new Error(`Non-Index-Kanten ohne Verschweissen sind nicht isoliert: ${rawShared}`);
}

const mesh = buildMesh(positions, null);
if (mesh.vertices.length >= rawVertices / 2) {
  throw new Error(`Verschweissen hat zu wenig zusammengefasst: ${mesh.vertices.length} von ${rawVertices}`);
}
if (mesh.vertices.length < 1000) throw new Error(`zu wenige geschweisste Punkte: ${mesh.vertices.length}`);

const grown = growRegion(mesh, 0, 18);
if (grown.length < 2) throw new Error("Region bleibt am angeklickten Dreieck haengen");

const seen = new Uint8Array(mesh.faces.length);
let cylinder = null;
let plane = null;
for (let face = 0; face < mesh.faces.length; face += 1) {
  if (seen[face]) continue;
  const faces = growRegion(mesh, face, 18);
  for (const id of faces) seen[id] = 1;
  if (faces.length < 40) continue;
  const samples = regionSamples(mesh, faces, "surface");
  let fit;
  try {
    fit = autoFit(samples.points, samples.normals).best;
  } catch {
    continue;
  }
  if (!cylinder && fit.type === "Zylinder" && Math.abs(fit.diameter - 80) < 0.05) {
    cylinder = { fit, face: faces[0], count: faces.length };
  }
  if (!plane && fit.type === "Ebene" && faces.length > 80) {
    plane = { fit, face: faces[0], count: faces.length };
  }
  if (cylinder && plane) break;
}

if (!cylinder) throw new Error("kein Zylinder mit Durchmesser 80 mm nach OBJLoader-Verschweissen");
if (!plane) throw new Error("keine Ebene nach OBJLoader-Verschweissen");

const report = {
  rawVertices,
  weldedVertices: mesh.vertices.length,
  rawSharedEdges: rawShared,
  seedRegionFaces: grown.length,
  cylinderDiameter: cylinder.fit.diameter,
  cylinderFaces: cylinder.count,
  cylinderForm: cylinder.fit.form,
  planeFaces: plane.count,
  planeForm: plane.fit.form,
};
console.log(JSON.stringify(report, null, 2));

function sharedEdgeCount(source) {
  const edges = new Map();
  const triangles = source.length / 9;
  const add = (a, b) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    edges.set(key, (edges.get(key) || 0) + 1);
  };
  let shared = 0;
  for (let face = 0; face < triangles; face += 1) {
    const i0 = face * 3;
    add(i0, i0 + 1);
    add(i0 + 1, i0 + 2);
    add(i0 + 2, i0);
  }
  for (const count of edges.values()) if (count === 2) shared += 1;
  return shared;
}
