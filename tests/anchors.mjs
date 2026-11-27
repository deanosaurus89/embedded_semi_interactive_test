import { centerPoint, constrainToContour, distancePointToTriangle, distanceToFeature, footOnFeature, nearestFoot } from "../js/anchors.js";
import { viewDocument } from "../js/views.js";

const circle = { type: "circle", center: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, radius: 10 };
const center = centerPoint(circle);
if (center.x !== 0 || center.y !== 0 || center.z !== 0) throw new Error("Mitte ist nicht der Kreismittelpunkt");
if (!footOnFeature(center, circle, "center")) throw new Error("Mitte gilt nicht als auf der Geometrie");

for (const target of [
  { x: 100, y: 0, z: 4 },
  { x: 0, y: -40, z: -2 },
  { x: -8, y: 30, z: 1 },
]) {
  const snapped = constrainToContour(circle, target);
  const radial = Math.hypot(snapped.x, snapped.y);
  if (Math.abs(radial - 10) > 1e-6 || Math.abs(snapped.z) > 1e-6) throw new Error(`Aussenkontur verfehlt den Kreis: ${JSON.stringify(snapped)}`);
  if (!footOnFeature(snapped, circle, "contour")) throw new Error("gezogener Punkt liegt nicht auf der Kontur");
}
if (footOnFeature({ x: 0, y: 0, z: 0 }, circle, "contour")) throw new Error("Kreismitte wurde als Kontur akzeptiert");

const slot = {
  type: "slot",
  center: { x: 0, y: 0, z: 0 },
  direction: { x: 1, y: 0, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
  radius: 5,
  length: 30,
};
const slotPoint = constrainToContour(slot, { x: 40, y: 40, z: 9 });
if (distanceToFeature(slotPoint, slot) > 1e-6) throw new Error("Langloch-Kontur nicht geschlossen getroffen");

const nearest = nearestFoot(circle, (point) => ({ x: point.x, y: point.y }), { x: 0, y: 80 });
if (Math.abs(nearest.y) < 8) throw new Error("Naechster Punkt zeigt nicht zur Beschriftung");
if (distanceToFeature(nearest, circle) > 1e-6) throw new Error("Naechster Punkt liegt nicht auf dem Kreis");

const onFace = distancePointToTriangle({ x: 0.2, y: 0.2, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
const offFace = distancePointToTriangle({ x: 0.2, y: 0.2, z: 8 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
if (onFace > 1e-6 || offFace < 4) throw new Error(`Dreiecksabstand ${onFace} / ${offFace}`);

const saved = viewDocument({
  name: "ansicht-1",
  projectId: "proj-alpha",
  templateId: "tpl-1",
  models: [{ name: "Gehaeuse.prt", hash: "abc", enabled: true }],
  labelSize: "small",
  controls: [{ id: "ctl-1", objectName: "Objekt 1", name: "Merkmal A", color: "#2456b5", nominal: 10, usl: 10.2, lsl: 9.9 }],
  placements: { "ctl-1": { color: "#2456b5", anchor: { kind: "geometry", geometryId: "geo-1", mode: "contour", point: { x: 1, y: 0, z: 0 } } } },
});
const again = viewDocument(JSON.parse(JSON.stringify(saved)));
if (again.projectId !== "proj-alpha" || again.templateId !== "tpl-1" || again.controls[0].color !== "#2456b5") throw new Error("Ansicht verliert Projekt oder Farbe");
if (again.placements["ctl-1"].anchor.mode !== "contour" || again.models[0].hash !== "abc" || again.labelSize !== "small") throw new Error("Ansicht verliert Fuss oder Modell");
let rejected = false;
try { viewDocument({ name: "../secret" }); } catch { rejected = true; }
if (!rejected) throw new Error("unsicherer Ansichtsname war erlaubt");

console.log("anchors ok");
