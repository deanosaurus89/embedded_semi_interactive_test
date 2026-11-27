import * as THREE from "three";
import { snapAxisView } from "./viewsnap.js";

const FACES = [["RECHTS", [1, 0, 0]], ["LINKS", [-1, 0, 0]], ["OBEN", [0, 0, 1]], ["UNTEN", [0, 0, -1]], ["VORNE", [0, -1, 0]], ["HINTEN", [0, 1, 0]]];

function chamferedCube(k) {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const bp = box.getAttribute("position");
  const bu = box.getAttribute("uv");
  const pos = [];
  const uv = [];
  const groups = [];
  for (let f = 0; f < 6; f += 1) {
    const a = f >> 1;
    const sg = f % 2 ? -1 : 1;
    const b = (a + 1) % 3;
    const c = (a + 2) % 3;
    const P = [0, 1, 2].map((i) => [bp.getComponent(4 * f + i, b), bp.getComponent(4 * f + i, c)]);
    const U = [0, 1, 2].map((i) => [bu.getX(4 * f + i), bu.getY(4 * f + i)]);
    const det = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
    const uvAt = (x, y) => {
      const s1 = ((x - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (y - P[0][1])) / det;
      const t1 = ((P[1][0] - P[0][0]) * (y - P[0][1]) - (x - P[0][0]) * (P[1][1] - P[0][1])) / det;
      return [U[0][0] + s1 * (U[1][0] - U[0][0]) + t1 * (U[2][0] - U[0][0]), U[0][1] + s1 * (U[1][1] - U[0][1]) + t1 * (U[2][1] - U[0][1])];
    };
    const m = 1 - k;
    const oct = [[1, m], [m, 1], [-m, 1], [-1, m], [-1, -m], [-m, -1], [m, -1], [1, -m]];
    const v3 = (x, y) => {
      const q = [0, 0, 0];
      q[a] = sg;
      q[b] = x;
      q[c] = y;
      return q;
    };
    const start = pos.length / 3;
    for (let i = 0; i < 8; i += 1) {
      let [x0, y0] = oct[i];
      let [x1, y1] = oct[(i + 1) % 8];
      if (sg < 0) [x0, y0, x1, y1] = [x1, y1, x0, y0];
      for (const [x, y] of [[0, 0], [x0, y0], [x1, y1]]) {
        pos.push(...v3(x, y));
        uv.push(...uvAt(x, y));
      }
    }
    groups.push([start, 24, f]);
  }
  const cs = pos.length / 3;
  for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
    let tri = [[sx * (1 - k), sy, sz], [sx, sy * (1 - k), sz], [sx, sy, sz * (1 - k)]];
    if (sx * sy * sz < 0) tri = [tri[0], tri[2], tri[1]];
    for (const q of tri) {
      pos.push(...q);
      uv.push(0, 0);
    }
  }
  groups.push([cs, 24, 6]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  for (const [start, count, materialIndex] of groups) geometry.addGroup(start, count, materialIndex);
  geometry.computeVertexNormals();
  box.dispose();
  return geometry;
}

export class ViewCube {
  constructor(host, camera, controls, onViewDir) {
    this.host = host;
    this.mainCamera = camera;
    this.controls = controls;
    this.onViewDir = onViewDir;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    this.rig = new THREE.Group();
    const mats = FACES.map(([label]) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#e9eef4";
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = "#7d8b9a";
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, 122, 122);
      ctx.fillStyle = "#22303f";
      ctx.font = `bold ${label.length > 5 ? 22 : 26}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, 64, 66);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    });
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0xc9d3de, side: THREE.DoubleSide });
    this.cube = new THREE.Mesh(chamferedCube(0.32), [...mats, edgeMat]);
    this.cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(this.cube.geometry, 10), new THREE.LineBasicMaterial({ color: 0x6f7f90 })));
    this.cube.rotation.x = Math.PI / 2;
    this.rig.add(this.cube);
    this.scene.add(this.rig);
    const origin = new THREE.Vector3(-1.15, -1.15, -0.9);
    for (const [txt, d, col] of [["X", [1, 0, 0], 0xd32f2f], ["Y", [0, 1, 0], 0x2e9d3a], ["Z", [0, 0, 1], 0x1f5fa8]]) {
      const dir = new THREE.Vector3(...d);
      const length = 2.2;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, length - 0.35, 10), new THREE.MeshBasicMaterial({ color: col }));
      shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      shaft.position.copy(origin).addScaledVector(dir, (length - 0.35) / 2);
      this.rig.add(shaft);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.4, 14), new THREE.MeshBasicMaterial({ color: col }));
      tip.quaternion.copy(shaft.quaternion);
      tip.position.copy(origin).addScaledVector(dir, length - 0.2);
      this.rig.add(tip);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffffd0";
      ctx.beginPath();
      ctx.arc(32, 32, 26, 0, 7);
      ctx.fill();
      ctx.fillStyle = `#${col.toString(16).padStart(6, "0")}`;
      ctx.font = "bold 42px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(txt, 32, 35);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
      sprite.renderOrder = 5;
      sprite.position.copy(origin).addScaledVector(dir, length + 0.25);
      sprite.scale.setScalar(0.55);
      this.rig.add(sprite);
    }
    this.hl = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x1f5fa8, transparent: true, opacity: 0.45, depthTest: false }));
    this.hl.visible = false;
    this.cube.add(this.hl);
    this.el = document.createElement("div");
    this.el.id = "navcube";
    this.el.title = "Ansicht: Flaeche, Kante oder Ecke";
    host.appendChild(this.el);
    const dirAt = (event) => {
      this.syncCam();
      const rect = this.el.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), this.cam);
      const hit = ray.intersectObject(this.cube, false)[0];
      if (!hit) return null;
      const local = this.cube.worldToLocal(hit.point.clone());
      const s = (value) => (Math.abs(value) > 0.55 ? Math.sign(value) : 0);
      const d = [s(local.x), s(local.y), s(local.z)];
      return d[0] || d[1] || d[2] ? d : null;
    };
    this.el.addEventListener("pointermove", (event) => {
      const d = dirAt(event);
      this.highlight(d);
      this.el.style.cursor = d ? "pointer" : "default";
    });
    this.el.addEventListener("pointerleave", () => this.highlight(null));
    this.el.addEventListener("pointerdown", (event) => event.stopPropagation());
    this.el.addEventListener("click", (event) => {
      const d = dirAt(event);
      if (!d) return;
      this.cube.updateMatrixWorld();
      const world = new THREE.Vector3(d[0], d[1], d[2]).transformDirection(this.cube.matrixWorld);
      const offset = this.mainCamera.position.clone().sub(this.controls.target);
      const snapped = snapAxisView([world.x, world.y, world.z], offset.toArray(), [this.mainCamera.up.x, this.mainCamera.up.y, this.mainCamera.up.z]);
      this.onViewDir(snapped);
    });
  }

  highlight(d) {
    if (!d) {
      this.hl.visible = false;
      return;
    }
    this.hl.visible = true;
    const n = Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]);
    this.hl.scale.set(1, 1, 1);
    for (let k = 0; k < 3; k += 1) this.hl.scale.setComponent(k, d[k] ? 0.08 : n === 1 ? 1.3 : 1.1);
    if (n === 2) for (let k = 0; k < 3; k += 1) if (d[k]) this.hl.scale.setComponent(k, 0.45);
    if (n === 3) this.hl.scale.setScalar(0.45);
    this.hl.position.set(d[0] * (n === 1 ? 1.02 : 0.8), d[1] * (n === 1 ? 1.02 : 0.8), d[2] * (n === 1 ? 1.02 : 0.8));
  }

  syncCam() {
    const q = this.mainCamera.quaternion;
    this.cam.quaternion.copy(q);
    this.cam.position.set(0, 0, 8.6).applyQuaternion(q);
    this.cam.updateMatrixWorld();
  }

  setVisible(visible) {
    this.el.hidden = !visible;
  }

  render(renderer) {
    if (this.el.hidden) return;
    const size = this.el.clientWidth;
    if (!size) return;
    this.syncCam();
    const host = this.host.getBoundingClientRect();
    const box = this.el.getBoundingClientRect();
    const canvas = renderer.domElement.getBoundingClientRect();
    const x = (box.left - canvas.left) * (renderer.domElement.width / canvas.width);
    const y = (canvas.bottom - box.bottom) * (renderer.domElement.height / canvas.height);
    const pixel = size * (renderer.domElement.width / canvas.width);
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, pixel, pixel);
    renderer.setViewport(x, y, pixel, pixel);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.cam);
    renderer.setScissorTest(false);
    renderer.autoClear = true;
    renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
    void host;
  }
}
