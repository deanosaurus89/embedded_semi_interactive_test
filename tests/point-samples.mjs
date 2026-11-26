import fs from "node:fs";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { buildMesh, growRegion, regionSamples } from "../js/mesh-select.js";
import { autoFit, axisFromNormals, basis, dot, fitType, sub } from "../js/fit.js";

export function loadWeldedMesh() {
  const text = fs.readFileSync(new URL("../models/milkyway.obj", import.meta.url), "utf8");
  const group = new OBJLoader().parse(text);
  let geometry = null;
  group.traverse((obj) => {
    if (!geometry && obj.isMesh) geometry = obj.geometry;
  });
  if (!geometry || geometry.index) throw new Error("OBJLoader-Pfad fehlt");
  return buildMesh(geometry.attributes.position.array, null);
}

function regionFit(mesh) {
  const seen = new Uint8Array(mesh.faces.length);
  let cylinder = null;
  const planes = [];
  for (let face = 0; face < mesh.faces.length && (!cylinder || planes.length < 6); face += 1) {
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
    if (!cylinder && fit.type === "Zylinder" && Math.abs(fit.diameter - 80) < 0.05) cylinder = { faces, fit };
    if (fit.type === "Ebene" && faces.length > 80 && (fit.form ?? 1) < 1e-3) planes.push(faces);
  }
  if (!cylinder || !planes.length) throw new Error("Zylinder oder Ebene nicht gefunden");
  return { cylinder, plane: { faces: planes[0] }, planes };
}

function vertexIds(mesh, faces) {
  const ids = new Set();
  for (const faceId of faces) {
    const face = mesh.faces[faceId];
    ids.add(face.i0);
    ids.add(face.i1);
    ids.add(face.i2);
  }
  return [...ids];
}

function angleOf(point, origin, u, v) {
  const d = sub(point, origin);
  return Math.atan2(dot(d, v), dot(d, u));
}

export function findPointSamples(mesh = loadWeldedMesh()) {
  const { cylinder, plane, planes } = regionFit(mesh);
  const ids = vertexIds(mesh, cylinder.faces);
  const axis = cylinder.fit.normal;
  const origin = cylinder.fit.center;
  const [u, v] = basis(axis);
  const ranked = ids.map((id) => {
    const point = mesh.vertices[id];
    const radial = sub(point, origin);
    const axial = dot(radial, axis);
    const radius = Math.hypot(dot(radial, u), dot(radial, v));
    return { id, point, normal: mesh.vertexNormals[id], axial, radius, angle: angleOf(point, origin, u, v) };
  }).filter((item) => Math.abs(item.radius - 40) < 0.8 && Math.abs(dot(item.normal, axis)) < 0.15);

  const sectors = new Map();
  for (const item of ranked) {
    const key = Math.round(((item.angle + Math.PI) / (2 * Math.PI)) * 36) % 36;
    const slot = sectors.get(key) || [];
    slot.push(item);
    sectors.set(key, slot);
  }
  const around = [];
  for (const slot of sectors.values()) {
    slot.sort((a, b) => a.axial - b.axial);
    around.push(slot[0], slot[Math.floor(slot.length / 2)], slot[slot.length - 1]);
  }
  around.sort((a, b) => a.angle - b.angle || a.axial - b.axial);
  if (around.length < 5) throw new Error("zu wenige Zylinderknoten");
  const cylinderPoints = [0, 1, 2, 3, 4].map((step) => around[Math.floor((step * around.length) / 5)]);

  const end = Math.max(...ranked.map((item) => item.axial));
  const rim = ranked.filter((item) => Math.abs(item.axial - end) < 0.4);
  const circlePoints = [];
  for (const item of rim) {
    if (circlePoints.every((kept) => Math.abs(Math.atan2(Math.sin(item.angle - kept.angle), Math.cos(item.angle - kept.angle))) > 0.5)) {
      circlePoints.push(item);
    }
    if (circlePoints.length === 3) break;
  }
  if (circlePoints.length < 3) throw new Error("Kreisrand nicht gefunden");

  const planePoints = cluster(mesh, plane.faces);

  const pack = (items) => items.map((item) => ({
    point: item.point,
    normal: item.normal,
    angle: item.angle ?? 0,
    axial: item.axial ?? null,
  }));
  const maxAxial = Math.max(...ranked.map((item) => item.axial));
  const minAxial = Math.min(...ranked.map((item) => item.axial));
  const nearEnd = ranked.filter((item) => Math.abs(item.axial - maxAxial) < 0.8);
  const farEnd = ranked.filter((item) => Math.abs(item.axial - minAxial) < 0.8);
  const cylinderQuads = [
    ...sectionQuads(nearEnd, farEnd[0], 1),
    ...sectionQuads(farEnd, nearEnd[0], -1),
  ].map((quad) => {
    const fit = fitType("Zylinder", quad.map((item) => item.point), [], false);
    return { points: pack(quad), diameter: fit.diameter, length: fit.length, eyeSign: quad.eyeSign };
  }).filter((quad) => Math.abs(quad.diameter - 80) < 0.05 && quad.length > 20);
  if (!cylinderQuads.length) throw new Error("Zylinder-Schnitt nicht gefunden");
  const cylinderPick = pack(cylinderPoints);
  const circlePick = pack(circlePoints);
  const planePick = pack(planePoints);
  const ends = [-1, 1].map((sign) => {
    const limit = sign > 0 ? Math.max(...ranked.map((item) => item.axial)) : Math.min(...ranked.map((item) => item.axial));
    return pack(ranked.filter((item) => Math.abs(item.axial - limit) < 0.4));
  });
  return {
    cylinder: cylinderPick,
    circle: circlePick,
    plane: planePick,
    cylinderWall: pack(ranked),
    cylinderQuads,
    cylinderCandidates: pack(around),
    circleCandidates: ends,
    planeGroups: planes.map((faces, region) => pack(spread(vertexIds(mesh, faces).map((id) => ({
      id,
      point: mesh.vertices[id],
      normal: mesh.vertexNormals[id],
      angle: 0,
    })), 8).map((item, index) => ({ ...item, angle: index + 1 })))),
    fits: {
      cylinder: fitType("Zylinder", cylinderPick.map((item) => item.point), cylinderPick.map((item) => item.normal), false),
      circle: fitType("Kreis", circlePick.map((item) => item.point), circlePick.map((item) => item.normal), false),
      plane: fitType("Ebene", planePick.map((item) => item.point), planePick.map((item) => item.normal), false),
    },
    axisCheck: axisFromNormals(cylinderPick.map((item) => item.normal)).axis,
    pose: {
      center: cylinder.fit.center,
      axis: cylinder.fit.normal,
      length: cylinder.fit.length,
    },
  };
}

function sectionQuads(section, depth, eyeSign) {
  if (!depth || section.length < 3) return [];
  const ordered = section.slice().sort((a, b) => a.angle - b.angle);
  const ring = ordered.concat(ordered.map((item) => ({ ...item, angle: item.angle + Math.PI * 2 })));
  const quads = [];
  for (let i = 0; i < ordered.length; i += Math.max(1, Math.floor(ordered.length / 6))) {
    const window = ring.filter((item) => item.angle >= ordered[i].angle && item.angle <= ordered[i].angle + 1.15);
    if (window.length < 3) continue;
    const triple = [window[0], window[Math.floor(window.length / 2)], window[window.length - 1]];
    const quad = [...triple, depth];
    quad.eyeSign = eyeSign;
    quads.push(quad);
  }
  return quads;
}

function spreadAngle(list, count) {
  const pool = list.slice();
  const chosen = [];
  while (chosen.length < count && pool.length) {
    let best = 0;
    let gap = -1;
    pool.forEach((item, index) => {
      const next = chosen.length
        ? Math.min(...chosen.map((kept) => Math.abs(Math.atan2(Math.sin(item.angle - kept.angle), Math.cos(item.angle - kept.angle)))))
        : 1;
      if (next > gap) {
        gap = next;
        best = index;
      }
    });
    if (chosen.length && gap < 0.45) break;
    chosen.push(pool.splice(best, 1)[0]);
  }
  return chosen;
}

function cluster(mesh, faces) {
  const ids = vertexIds(mesh, faces);
  const origin = [0, 0, 0];
  for (const id of ids) {
    origin[0] += mesh.vertices[id][0];
    origin[1] += mesh.vertices[id][1];
    origin[2] += mesh.vertices[id][2];
  }
  origin[0] /= ids.length;
  origin[1] /= ids.length;
  origin[2] /= ids.length;
  const sorted = ids.map((id) => ({
    id,
    point: mesh.vertices[id],
    normal: mesh.vertexNormals[id],
    distance: Math.hypot(mesh.vertices[id][0] - origin[0], mesh.vertices[id][1] - origin[1], mesh.vertices[id][2] - origin[2]),
  })).sort((a, b) => a.distance - b.distance);
  const chosen = [];
  for (const item of sorted) {
    if (item.distance > 35) break;
    if (chosen.some((kept) => Math.hypot(kept.point[0] - item.point[0], kept.point[1] - item.point[1], kept.point[2] - item.point[2]) < 6)) continue;
    chosen.push(item);
    if (chosen.length === 4) return chosen;
  }
  return spread(sorted, 4);
}

function spread(items, count) {
  const chosen = [items[0]];
  while (chosen.length < count) {
    let best = null;
    let bestDistance = -1;
    for (const item of items) {
      const distance = Math.min(...chosen.map((kept) => Math.hypot(
        item.point[0] - kept.point[0],
        item.point[1] - kept.point[1],
        item.point[2] - kept.point[2],
      )));
      if (distance > bestDistance) {
        best = item;
        bestDistance = distance;
      }
    }
    chosen.push(best);
  }
  return chosen;
}

if (process.argv[1] && process.argv[1].endsWith("point-samples.mjs")) {
  const samples = findPointSamples();
  const brief = (fit) => ({ type: fit.type, diameter: fit.diameter ?? null, form: fit.form, n: fit.n });
  console.log(JSON.stringify({
    cylinder: brief(samples.fits.cylinder),
    circle: brief(samples.fits.circle),
    plane: brief(samples.fits.plane),
  }, null, 2));
}
