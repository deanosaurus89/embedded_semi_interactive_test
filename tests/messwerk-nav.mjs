import * as THREE from "three";
import { tumble } from "../js/tumble.js";
import { TumbleControls } from "../js/tumble-controls.js";
import { pickGesture, tapSlop } from "../js/pointertap.js";
import { keepLegacyFit, projectOutline } from "../js/polyline.js";
import { fitType } from "../js/fit.js";

const pose = tumble([10, -3, 4], [0, 0, 1], 0.2, -0.15);
const before = Math.hypot(10, -3, 4);
const after = Math.hypot(...pose.offset);
if (Math.abs(before - after) > 1e-6) throw new Error(`Tumble aendert den Abstand ${before} -> ${after}`);
const expect = [9.632070, -5.182572, 2.316066];
pose.offset.forEach((value, index) => {
  if (Math.abs(value - expect[index]) > 5e-4) throw new Error(`Tumble weicht von MessWerk ab: ${pose.offset}`);
});
if (Math.abs(Math.hypot(...pose.up) - 1) > 1e-6) throw new Error("up nicht normiert");

const handlers = {};
const dom = {
  clientHeight: 600,
  addEventListener(type, fn) { handlers[type] = fn; },
  removeEventListener() {},
};
const camera = new THREE.PerspectiveCamera(35, 1.4, 0.1, 1000);
camera.up.set(0, 0, 1);
camera.position.set(10, -13, 11);
const controls = new TumbleControls(camera, dom);
controls.target.set(1, 2, 3);
const target = controls.target.clone();
handlers.wheel({ deltaY: 120, clientX: 400, clientY: 300, preventDefault() {} });
if (controls.target.distanceTo(target) > 1e-8) throw new Error("Mausrad verschiebt das Ziel");
const offset = camera.position.clone().sub(controls.target);
const start = new THREE.Vector3(9, -15, 8);
if (offset.distanceTo(start.clone().multiplyScalar(1.08)) > 1e-6) throw new Error(`Dolly-Faktor ist nicht 1.08: ${offset.toArray()}`);

if (tapSlop("mouse") !== 8 || tapSlop("touch") !== 24) throw new Error("Klick-Toleranz weicht von pointertap ab");
const tap = pickGesture({ pointerType: "mouse", moved: 7, dt: 200, multi: false, dragged: false, wide: true });
const drag = pickGesture({ pointerType: "mouse", moved: 9, dt: 200, multi: false, dragged: true, wide: true });
const slow = pickGesture({ pointerType: "mouse", moved: 2, dt: 800, multi: false, dragged: false, wide: true });
if (tap !== "pick" || drag === "pick" || slow === "pick") throw new Error(`Klick-Erkennung ${tap}/${drag}/${slow}`);

const points = [[0, 0, 0.2], [4, 0, -0.1], [4, 3, 0.4], [1, 3, -0.2], [0.5, 1.2, 0.8]];
const fit = fitType("Ebene", points, [], false);
const outline = projectOutline(points, fit);
const first = outline[0];
const last = outline[outline.length - 1];
if (outline.length !== points.length + 1) throw new Error(`Linienzug nicht geschlossen: ${outline.length}`);
if (first.x !== last.x || first.y !== last.y || first.z !== last.z) throw new Error("letzter Punkt ist nicht der erste");
const n = fit.normal;
for (const point of outline) {
  const d = (point.x - fit.center[0]) * n[0] + (point.y - fit.center[1]) * n[1] + (point.z - fit.center[2]) * n[2];
  if (Math.abs(d) > 1e-6) throw new Error("Umriss liegt nicht auf der Ebene");
}

const legacy = { id: "old", type: "plane", mode: "fit", center: { x: 1, y: 2, z: 3 }, normal: { x: 0, y: 0, z: 1 } };
if (!keepLegacyFit(legacy)) throw new Error("alte Ebene ohne Umriss wird verworfen");
if (keepLegacyFit({ mode: "3", center: { x: 1, y: 2, z: 3 } })) throw new Error("Kreis als alte Ebene erkannt");

console.log("messwerk-nav ok");
