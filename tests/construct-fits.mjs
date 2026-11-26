import { fitType } from "../js/fit.js";

const assertClose = (value, expected, label) => {
  if (Math.abs(value - expected) > 1e-6) throw new Error(`${label}: ${value} statt ${expected}`);
};

const line = fitType("Linie", [[0, 0, 0], [3, 4, 0]], [], false);
assertClose(line.length, 5, "Linie Laenge");

const radius = 8;
const sphere = fitType("Kugel", [
  [radius, 0, 0],
  [0, radius, 0],
  [0, 0, radius],
  [-radius, 0, 0],
], [], false);
assertClose(sphere.diameter, 16, "Kugel Durchmesser");
assertClose(sphere.center[0], 0, "Kugel Mitte");

const r1 = 10;
const circle = [0, 1, 2].map((i) => {
  const angle = (i * 2 * Math.PI) / 3;
  return [r1 * Math.cos(angle), r1 * Math.sin(angle), 0];
});
const cone = fitType("Kegel", [...circle, [16, 0, 20]], [], false);
assertClose(cone.length, 20, "Kegel Laenge");
assertClose(cone.radius, 10, "Kegel r1");
assertClose(cone.endRadius, 16, "Kegel r2");
assertClose(cone.halfAngle, Math.atan(6 / 20), "Kegel Winkel");

const slotRadius = 5;
const slot = fitType("Langloch", [
  [slotRadius, 0, 0],
  [-slotRadius / 2, slotRadius * Math.sin(2 * Math.PI / 3), 0],
  [-slotRadius / 2, -slotRadius * Math.sin(2 * Math.PI / 3), 0],
  [25, 0, 0],
], [], false);
assertClose(slot.width, 10, "Langloch Breite");
assertClose(slot.length, 30, "Langloch Laenge");

console.log(JSON.stringify({
  line: line.length,
  sphere: sphere.diameter,
  cone: { length: cone.length, halfAngleDeg: cone.halfAngle * 180 / Math.PI, r2: cone.endRadius },
  slot: { length: slot.length, width: slot.width },
}, null, 2));
