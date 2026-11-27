import * as THREE from "three";
import { tumble } from "./tumble.js";

export class TumbleControls {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.enabled = true;
    this.enableDamping = false;
    this.screenSpacePanning = true;
    this.target = new THREE.Vector3();
    this.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    this.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.listeners = new Map();
    this.pointers = new Map();
    this.mode = null;
    this.last = { x: 0, y: 0, dist: 0 };
    this.onDown = this.onDown.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onUp = this.onUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    dom.addEventListener("pointerdown", this.onDown);
    dom.addEventListener("wheel", this.onWheel, { passive: false });
    dom.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  addEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type, fn) {
    const list = this.listeners.get(type);
    if (list) this.listeners.set(type, list.filter((item) => item !== fn));
  }

  emit(type) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }

  update() {
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  dispose() {
    this.dom.removeEventListener("pointerdown", this.onDown);
    this.dom.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
  }

  onDown(event) {
    if (!this.enabled) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) {
      const pan = event.button === 1 || event.button === 2;
      this.mode = pan ? "pan" : "rotate";
      this.last = { x: event.clientX, y: event.clientY, dist: 0 };
    } else if (this.pointers.size === 2) {
      this.mode = "dolly";
      this.last.dist = this.span();
    }
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    this.emit("start");
  }

  span() {
    const points = [...this.pointers.values()];
    return points.length >= 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
  }

  mid() {
    const points = [...this.pointers.values()];
    return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  }

  onMove(event) {
    if (!this.enabled || !this.pointers.has(event.pointerId)) return;
    const prev = this.pointers.get(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size >= 2) {
      const dist = this.span();
      if (this.last.dist > 1 && dist > 1) this.dolly(this.last.dist / dist);
      const middle = this.mid();
      if (this.last.x) this.pan(middle.x - this.last.x, middle.y - this.last.y);
      this.last = { x: middle.x, y: middle.y, dist };
      return;
    }
    const dx = event.clientX - prev.x;
    const dy = event.clientY - prev.y;
    if (this.mode === "pan") this.pan(dx, dy);
    else if (this.mode === "rotate") this.rotate(dx, dy);
  }

  onUp(event) {
    const had = this.mode != null;
    this.pointers.delete(event.pointerId);
    if (!this.pointers.size) {
      this.mode = null;
      window.removeEventListener("pointermove", this.onMove);
      window.removeEventListener("pointerup", this.onUp);
      if (had) this.emit("end");
    }
  }

  onWheel(event) {
    if (!this.enabled) return;
    event.preventDefault();
    this.dolly(event.deltaY > 0 ? 1.08 : 0.92);
    this.emit("end");
  }

  rotate(dx, dy) {
    const height = this.dom.clientHeight || 600;
    const offset = this.camera.position.clone().sub(this.target);
    const up = this.camera.up.clone();
    const turned = tumble(offset.toArray(), up.toArray(), (2 * Math.PI * dx) / height, (2 * Math.PI * dy) / height);
    this.camera.up.set(turned.up[0], turned.up[1], turned.up[2]);
    this.camera.position.copy(this.target).add(new THREE.Vector3(turned.offset[0], turned.offset[1], turned.offset[2]));
    this.camera.lookAt(this.target);
  }

  pan(dx, dy) {
    this.camera.updateMatrixWorld();
    const height = this.dom.clientHeight || 1;
    const dist = this.camera.position.distanceTo(this.target);
    const fov = (this.camera.fov * Math.PI) / 180;
    const world = 2 * Math.tan(fov / 2) * dist;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const move = right.multiplyScalar((-dx / height) * world).add(up.multiplyScalar((dy / height) * world));
    this.camera.position.add(move);
    this.target.add(move);
  }

  dolly(factor) {
    const offset = this.camera.position.clone().sub(this.target).multiplyScalar(factor);
    const distance = offset.length();
    if (distance < 1e-4 || distance > 1e7) return;
    this.camera.position.copy(this.target).add(offset);
  }
}
