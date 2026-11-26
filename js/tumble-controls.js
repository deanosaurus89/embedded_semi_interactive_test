// Screen-space tumble, pan and zoom. A horizontal drag is not stopped by a polar clamp.
import * as THREE from "three";

export class TumbleControls {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.enabled = true;
    this.target = new THREE.Vector3();
    this.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.pickSlop = 4;
    this.listeners = new Map();
    this.pointers = new Map();
    this.mode = null;
    this.moved = false;
    this.last = { x: 0, y: 0, dist: 0 };
    this.down = { x: 0, y: 0 };
    this.raycaster = new THREE.Raycaster();
    this.onDown = this.onDown.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onUp = this.onUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    dom.addEventListener("pointerdown", this.onDown);
    dom.addEventListener("wheel", this.onWheel, { passive: false });
    dom.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  addEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  emit(type, event) {
    for (const fn of this.listeners.get(type) || []) fn(event);
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

  actionFor(button) {
    const chosen = button === 0 ? this.mouseButtons.LEFT : button === 1 ? this.mouseButtons.MIDDLE : this.mouseButtons.RIGHT;
    if (chosen === THREE.MOUSE.PAN) return "pan";
    if (chosen === THREE.MOUSE.DOLLY) return "dolly";
    if (chosen === THREE.MOUSE.ROTATE) return "rotate";
    return null;
  }

  onDown(event) {
    if (!this.enabled) return;
    const action = this.actionFor(event.button);
    if (!action) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.down = { x: event.clientX, y: event.clientY };
    this.moved = false;
    this.mode = action;
    this.last = { x: event.clientX, y: event.clientY, dist: this.span() };
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
  }

  span() {
    const points = [...this.pointers.values()];
    return points.length >= 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
  }

  onMove(event) {
    if (!this.enabled || !this.pointers.has(event.pointerId) || !this.mode) return;
    const prev = this.pointers.get(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const travel = Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y);
    if (!this.moved && travel < this.pickSlop) return;
    if (!this.moved) this.emit("start");
    this.moved = true;
    const dx = event.clientX - prev.x;
    const dy = event.clientY - prev.y;
    if (this.mode === "pan") this.pan(dx, dy);
    else if (this.mode === "dolly") this.dollyToCursor(dy > 0 ? 1.04 : 0.96, event.clientX, event.clientY);
    else this.rotate(dx, dy);
    this.last = { x: event.clientX, y: event.clientY, dist: this.span() };
  }

  onUp(event) {
    const wasClick = this.mode === "rotate" && !this.moved
      && Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) < this.pickSlop;
    const had = this.mode != null;
    this.pointers.delete(event.pointerId);
    if (this.pointers.size) return;
    this.mode = null;
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    if (wasClick) this.emit("click", event);
    else if (had && this.moved) this.emit("end");
  }

  onWheel(event) {
    if (!this.enabled) return;
    event.preventDefault();
    const scale = event.deltaY > 0 ? 1.08 : 0.92;
    this.dollyToCursor(scale, event.clientX, event.clientY);
    this.emit("end");
  }

  rotate(dx, dy) {
    const height = this.dom.clientHeight || 600;
    const yaw = (2 * Math.PI * dx) / height;
    const pitch = (2 * Math.PI * dy) / height;
    const offset = this.camera.position.clone().sub(this.target);
    const up = this.camera.up.clone().normalize();
    const right = new THREE.Vector3().crossVectors(offset, up);
    if (right.lengthSq() < 1e-10) return;
    right.normalize();
    const yawQ = new THREE.Quaternion().setFromAxisAngle(up, -yaw);
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(right, -pitch);
    const turn = pitchQ.multiply(yawQ);
    offset.applyQuaternion(turn);
    this.camera.up.applyQuaternion(turn).normalize();
    this.camera.position.copy(this.target).add(offset);
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

  dollyToCursor(scale, clientX, clientY) {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.camera.updateMatrixWorld();
    const view = new THREE.Vector3();
    this.camera.getWorldDirection(view);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(view, this.target);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    const offset = this.camera.position.clone().sub(this.target).multiplyScalar(scale);
    if (offset.length() < 1e-3 || offset.length() > 1e7 || !this.raycaster.ray.intersectPlane(plane, hit)) {
      if (offset.length() >= 1e-3 && offset.length() <= 1e7) this.camera.position.copy(this.target).add(offset);
      return;
    }
    this.camera.position.copy(this.target).add(offset);
    this.camera.updateMatrixWorld();
    this.camera.lookAt(this.target);
    this.raycaster.setFromCamera(ndc, this.camera);
    const next = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, next)) return;
    const shift = hit.sub(next);
    this.camera.position.add(shift);
    this.target.add(shift);
    this.camera.lookAt(this.target);
  }
}
