import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

// Anchors are stored in the original OBJ coordinate system (millimetres,
// untransformed). Flag positions are the card's top-left as a fraction of
// the stage. The mesh itself is not moved, so a raycast hit is already in
// that same space and can be written straight into the layout.

const LAYOUT_KEY = "milkyway-merkmale-layout-v1";
const FILTER_KEY = "milkyway-merkmale-filter-v1";
const SVG_NS = "http://www.w3.org/2000/svg";

const UI = {
  loading: "Modell wird geladen …",
  modelError: "Das Modell konnte nicht geladen werden.",
  dataError: "Die Beispieldaten konnten nicht geladen werden.",
  webglError: "WebGL ist in diesem Browser nicht verfügbar.",
  emptyModel: "Das Modell enthält keine Flächen.",
  hintIdle: "Fähnchen ziehen zum Positionieren. Ein Klick auf die Oberfläche setzt den Fußpunkt.",
  pickFirst: "Zuerst ein Fähnchen auswählen.",
  pickMiss: "Kein Treffer auf der Oberfläche.",
  anchorSet: "Fußpunkt gesetzt.",
  exported: "Layout exportiert.",
  imported: "Layout importiert.",
  reset: "Layout zurückgesetzt.",
  importInvalid: "Die Datei enthält kein gültiges Layout.",
  noValues: "Keine Istwerte",
  inTol: "in Toleranz",
  outTol: "außer Toleranz",
};

const els = {
  partName: document.getElementById("part-name"),
  badge: document.getElementById("example-badge"),
  filter: document.getElementById("filter"),
  modeView: document.getElementById("mode-view"),
  modeEdit: document.getElementById("mode-edit"),
  exportBtn: document.getElementById("export"),
  importBtn: document.getElementById("import"),
  importFile: document.getElementById("import-file"),
  resetBtn: document.getElementById("reset"),
  stage: document.getElementById("stage"),
  view: document.getElementById("view"),
  leaders: document.getElementById("leaders"),
  flags: document.getElementById("flags"),
  hint: document.getElementById("hint"),
  toast: document.getElementById("toast"),
  loading: document.getElementById("loading"),
  loadingText: document.getElementById("loading-text"),
};

const fmt = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

const state = {
  data: null,
  baked: null,
  placements: {},
  filter: "25",
  edit: false,
  selectedId: null,
  model: null,
};

const leaderNodes = new Map();
const scratch = new THREE.Vector3();
const pointerNdc = new THREE.Vector2();

let renderer;
let scene;
let camera;
let controls;
let raycaster;
let resetTimer = 0;
let toastTimer = 0;
let loopOn = false;
let pointerDown = null;
let cameraMovedByUser = false;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

main().catch((error) => {
  console.error(error);
  if (document.body.dataset.ready !== "error") fail(UI.dataError);
});

async function main() {
  bindUi();
  restoreFilter();
  initViewer();

  const dataUrl = new URL("../data/example-measurements.json", import.meta.url);
  const layoutUrl = new URL("../data/layout.json", import.meta.url);
  const modelUrl = new URL("../models/milkyway.obj", import.meta.url);

  const dataPromise = fetchJson(dataUrl);
  const layoutPromise = fetchJson(layoutUrl).catch(() => ({ placements: {} }));
  const modelPromise = loadModel(modelUrl.href);

  const [data, baked, model] = await Promise.all([dataPromise, layoutPromise, modelPromise]);
  state.data = normalizeData(data);
  state.baked = baked && typeof baked === "object" ? baked : { placements: {} };
  state.model = model;

  if (state.data.part?.name) els.partName.textContent = state.data.part.name;
  if (state.data.source !== "example") els.badge.hidden = true;

  initPlacements();
  resizeRenderer();
  renderFlags();
  frameModel(model, measureFlagBand());
  autoPlace();
  applyAllPositions();
  syncLeaderNodes();
  updateLeaders();
  reveal();
  startLoop();

  const observer = new ResizeObserver(() => {
    resizeRenderer();
    if (!cameraMovedByUser && state.model) frameModel(state.model, measureFlagBand());
    autoPlace();
    applyAllPositions();
    updateLeaders();
  });
  observer.observe(els.stage);

  if (new URLSearchParams(location.search).has("debug")) {
    window.__merkmale = {
      state,
      currentLayout,
      projectToStage,
    };
  }
}

function bindUi() {
  els.filter.addEventListener("change", () => {
    state.filter = els.filter.value;
    try {
      localStorage.setItem(FILTER_KEY, state.filter);
    } catch {
      /* private mode */
    }
    refreshFlagContents();
    autoPlace();
    applyAllPositions();
    updateLeaders();
  });

  els.modeView.addEventListener("click", () => setEdit(false));
  els.modeEdit.addEventListener("click", () => setEdit(true));
  els.exportBtn.addEventListener("click", exportLayout);
  els.importBtn.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", onImportFile);
  els.resetBtn.addEventListener("click", onResetClick);
  els.flags.addEventListener("pointerdown", onFlagPointerDown);
  els.view.addEventListener("pointerdown", onViewPointerDown);
  els.view.addEventListener("pointerup", onViewPointerUp);
  els.view.addEventListener("pointercancel", () => {
    pointerDown = null;
  });
  els.stage.addEventListener("contextmenu", (event) => event.preventDefault());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) startLoop();
  });
}

function restoreFilter() {
  try {
    const stored = localStorage.getItem(FILTER_KEY);
    if (stored === "10" || stored === "25" || stored === "50" || stored === "all") {
      state.filter = stored;
      els.filter.value = stored;
    }
  } catch {
    /* ignore */
  }
}

function initViewer() {
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: els.view,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
  } catch (error) {
    console.error(error);
    fail(UI.webglError);
    throw error;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 10000);
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0xf7f8fb, 0x9aa3ad, 0.62);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.set(0.35, 0.65, 1);
  camera.add(key);

  const fill = new THREE.DirectionalLight(0xd5e2f2, 0.45);
  fill.position.set(-0.9, 0.15, -0.35);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.28);
  rim.position.set(-0.2, 0.9, -0.6);
  scene.add(rim);

  controls = new OrbitControls(camera, els.view);
  controls.enableDamping = !reduceMotion;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.85;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.75;
  controls.screenSpacePanning = true;
  controls.addEventListener("start", () => {
    cameraMovedByUser = true;
  });
  raycaster = new THREE.Raycaster();
}

function loadModel(url) {
  const loader = new OBJLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (group) => {
        let meshes = 0;
        group.traverse((obj) => {
          if (!obj.isMesh) return;
          meshes += 1;
          obj.material = new THREE.MeshStandardMaterial({
            color: 0xb7bcc2,
            metalness: 0.06,
            roughness: 0.58,
            side: THREE.FrontSide,
          });
        });
        if (!meshes) {
          fail(UI.emptyModel);
          reject(new Error("no mesh"));
          return;
        }
        scene.add(group);
        resolve(group);
      },
      (event) => {
        if (event.lengthComputable) {
          const pct = Math.round((event.loaded / event.total) * 100);
          els.loadingText.textContent = `${UI.loading} ${pct} %`;
        }
      },
      (error) => {
        console.error(error);
        fail(UI.modelError);
        reject(error);
      },
    );
  });
}

function resizeRenderer() {
  const width = els.stage.clientWidth;
  const height = els.stage.clientHeight;
  if (!width || !height || !renderer) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
}

function measureFlagBand() {
  let maxHeight = 0;
  for (const element of els.flags.querySelectorAll(".flag")) {
    maxHeight = Math.max(maxHeight, element.offsetHeight);
  }
  return maxHeight ? maxHeight + 12 : null;
}

function frameModel(object, preferredBand) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = 0.5 * Math.hypot(size.x, size.y, size.z);
  camera.near = Math.max(0.1, radius / 300);
  camera.far = radius * 40;
  controls.target.copy(center);

  const stageW = Math.max(1, els.stage.clientWidth);
  const stageH = Math.max(1, els.stage.clientHeight);
  const minModel = Math.min(120, stageH * 0.32);
  let band = preferredBand ?? reservedBand(stageH);
  if (stageH - band * 2 < minModel) band = Math.max(36, (stageH - minModel) / 2);
  const minX = stageW * 0.03;
  const maxX = stageW * 0.97;
  const minY = band;
  const maxY = Math.max(band + 40, stageH - band);
  const dir = new THREE.Vector3(0.5, 0.42, 1).normalize();

  let lo = radius * 0.35;
  let hi = radius * 10;
  let best = hi;
  for (let i = 0; i < 20; i += 1) {
    const dist = (lo + hi) / 2;
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const span = projectBox(box, stageW, stageH);
    const fits = span && span.minX >= minX && span.maxX <= maxX && span.minY >= minY && span.maxY <= maxY;
    if (fits) {
      best = dist;
      hi = dist;
    } else {
      lo = dist;
    }
  }
  camera.position.copy(center).addScaledVector(dir, best);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  controls.minDistance = radius * 0.12;
  controls.maxDistance = radius * 8;
  controls.update();
}

function reservedBand(stageH) {
  if (stageH < 360) return Math.max(64, stageH * 0.24);
  return Math.min(176, Math.max(96, stageH * 0.28));
}

function projectBox(box, stageW, stageH) {
  const corners = [
    [box.min.x, box.min.y, box.min.z],
    [box.min.x, box.min.y, box.max.z],
    [box.min.x, box.max.y, box.min.z],
    [box.min.x, box.max.y, box.max.z],
    [box.max.x, box.min.y, box.min.z],
    [box.max.x, box.min.y, box.max.z],
    [box.max.x, box.max.y, box.min.z],
    [box.max.x, box.max.y, box.max.z],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corner of corners) {
    const projected = projectToStage({ x: corner[0], y: corner[1], z: corner[2] }, stageW, stageH);
    if (!projected) return null;
    minX = Math.min(minX, projected.x);
    minY = Math.min(minY, projected.y);
    maxX = Math.max(maxX, projected.x);
    maxY = Math.max(maxY, projected.y);
  }
  return { minX, minY, maxX, maxY };
}

function projectToStage(anchor, stageW = els.stage.clientWidth, stageH = els.stage.clientHeight) {
  if (!anchor) return null;
  scratch.set(anchor.x, anchor.y, anchor.z);
  scratch.applyMatrix4(camera.matrixWorldInverse);
  if (scratch.z >= 0) return null;
  scratch.applyMatrix4(camera.projectionMatrix);
  return {
    x: (scratch.x * 0.5 + 0.5) * stageW,
    y: (-scratch.y * 0.5 + 0.5) * stageH,
  };
}

function reveal() {
  renderer.render(scene, camera);
  updateLeaders();
  requestAnimationFrame(() => {
    updateLeaders();
    els.loading.hidden = true;
    document.body.dataset.ready = "true";
  });
}

function startLoop() {
  if (loopOn || document.hidden || !renderer) return;
  loopOn = true;
  requestAnimationFrame(tick);
}

function tick() {
  if (document.hidden) {
    loopOn = false;
    return;
  }
  requestAnimationFrame(tick);
  controls.update();
  renderer.render(scene, camera);
  updateLeaders();
}

function normalizeData(raw) {
  if (!raw || !Array.isArray(raw.characteristics)) {
    throw new Error("measurements schema");
  }
  const characteristics = raw.characteristics.filter(validCharacteristic).map((characteristic) => ({
    ...characteristic,
    unit: characteristic.unit || "mm",
    measurements: characteristic.measurements
      .map((sample) => ({
        pieceId: String(sample.pieceId ?? ""),
        value: Number(sample.value),
        timestamp: sample.timestamp ? String(sample.timestamp) : undefined,
      }))
      .filter((sample) => Number.isFinite(sample.value)),
  }));
  return {
    schemaVersion: raw.schemaVersion ?? 1,
    source: raw.source ?? "example",
    part: raw.part ?? { id: "part", name: "Bauteil" },
    characteristics,
  };
}

function validCharacteristic(characteristic) {
  return (
    characteristic &&
    typeof characteristic.id === "string" &&
    Array.isArray(characteristic.measurements) &&
    [characteristic.nominal, characteristic.usl, characteristic.lsl].every(isFiniteNumber)
  );
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function initPlacements() {
  const saved = readSaved();
  state.placements = {};
  for (const characteristic of state.data.characteristics) {
    const fromSave = sanitizePlacement(saved?.placements?.[characteristic.id]);
    const fromBake = sanitizePlacement(state.baked?.placements?.[characteristic.id]);
    const fallback = sanitizePlacement({ anchor: characteristic.defaultAnchor });
    const flag =
      (fromSave?.flag?.pinned ? fromSave.flag : null) ||
      (fromBake?.flag?.pinned ? fromBake.flag : null) ||
      null;
    const anchor = fromSave?.anchor || fromBake?.anchor || fallback?.anchor || null;
    state.placements[characteristic.id] = { flag, anchor };
  }
}

function sanitizePlacement(placement) {
  if (!placement || typeof placement !== "object") return null;
  const clean = {};
  const flag = placement.flag;
  if (flag && isFiniteNumber(flag.x) && isFiniteNumber(flag.y)) {
    clean.flag = {
      x: clamp(flag.x, -0.5, 1.5),
      y: clamp(flag.y, -0.5, 1.5),
      pinned: flag.pinned !== false,
    };
  }
  const anchor = placement.anchor;
  if (anchor && isFiniteNumber(anchor.x) && isFiniteNumber(anchor.y) && isFiniteNumber(anchor.z)) {
    clean.anchor = { x: anchor.x, y: anchor.y, z: anchor.z };
  }
  return clean.flag || clean.anchor ? clean : null;
}

function readSaved() {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.placements !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLocal() {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(currentLayout()));
  } catch {
    /* private mode or full storage */
  }
}

function currentLayout() {
  const placements = {};
  for (const characteristic of state.data.characteristics) {
    const placement = state.placements[characteristic.id] ?? {};
    const entry = {};
    if (placement.flag) {
      entry.flag = {
        x: round(placement.flag.x, 4),
        y: round(placement.flag.y, 4),
        pinned: Boolean(placement.flag.pinned),
      };
    }
    if (placement.anchor) {
      entry.anchor = {
        x: round(placement.anchor.x, 3),
        y: round(placement.anchor.y, 3),
        z: round(placement.anchor.z, 3),
      };
    }
    placements[characteristic.id] = entry;
  }
  return {
    schemaVersion: 1,
    space: "obj",
    part: state.data.part?.id ?? "part",
    placements,
  };
}

function windowOf(measurements) {
  if (state.filter === "all") return measurements;
  const count = Number(state.filter);
  if (!Number.isFinite(count) || count <= 0) return measurements;
  return measurements.slice(-count);
}

function isOutOfTolerance(value, characteristic) {
  return value > characteristic.usl || value < characteristic.lsl;
}

function renderFlags() {
  els.flags.replaceChildren();
  for (const characteristic of state.data.characteristics) {
    const article = document.createElement("article");
    article.className = "flag";
    article.dataset.id = characteristic.id;
    const built = flagMarkup(characteristic);
    article.classList.toggle("is-oot", built.outOfTolerance);
    article.innerHTML = built.html;
    els.flags.append(article);
  }
  markSelection();
}

function refreshFlagContents() {
  for (const characteristic of state.data.characteristics) {
    const article = els.flags.querySelector(`[data-id="${CSS.escape(characteristic.id)}"]`);
    if (!article) continue;
    const built = flagMarkup(characteristic);
    article.classList.toggle("is-oot", built.outOfTolerance);
    article.innerHTML = built.html;
  }
  markSelection();
}

function flagMarkup(characteristic) {
  const samples = windowOf(characteristic.measurements);
  const last = samples[samples.length - 1];
  const lastOut = last ? isOutOfTolerance(last.value, characteristic) : false;

  if (!samples.length) {
    return {
      outOfTolerance: false,
      html: `<h2 class="flag-name">${escapeHtml(characteristic.name)}</h2><p class="flag-meta">${UI.noValues}</p>`,
    };
  }

  const mean = samples.reduce((sum, sample) => sum + sample.value, 0) / samples.length;
  const outCount = samples.filter((sample) => isOutOfTolerance(sample.value, characteristic)).length;
  const status = outCount === 0 ? UI.inTol : `${outCount} ${UI.outTol}`;
  const unit = escapeHtml(characteristic.unit);

  return {
    outOfTolerance: lastOut,
    html: `
    <h2 class="flag-name">${escapeHtml(characteristic.name)}</h2>
    <div class="flag-ist">
      <span class="k">Ist</span>
      <span class="v ${lastOut ? "oot" : "ok"}" title="${escapeHtml(last.pieceId)}">${fmt.format(last.value)}</span>
      <span class="u">${unit}</span>
    </div>
    <p class="flag-limits">
      <span>Nenn ${fmt.format(characteristic.nominal)}</span>
      <span class="limit">USL ${fmt.format(characteristic.usl)}</span>
      <span class="limit">LSL ${fmt.format(characteristic.lsl)}</span>
    </p>
    ${sparkline(characteristic, samples)}
    <p class="legend" aria-hidden="true">
      <span class="series"><i></i>Ist</span>
      <span class="nominal"><i></i>Nenn</span>
      <span class="mean"><i></i>Mittel</span>
      <span class="limit"><i></i>USL/LSL</span>
    </p>
    <p class="flag-meta">n = ${samples.length} · Mittel ${fmt.format(mean)} · ${status}</p>
  `,
  };
}

function sparkline(characteristic, samples) {
  const values = samples.map((sample) => sample.value);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let min = Math.min(characteristic.lsl, characteristic.usl, characteristic.nominal, mean, ...values);
  let max = Math.max(characteristic.lsl, characteristic.usl, characteristic.nominal, mean, ...values);
  const pad = (max - min) * 0.16 || Math.abs(characteristic.nominal) * 0.01 || 0.001;
  min -= pad;
  max += pad;
  const width = 200;
  const height = 52;
  const padL = 2;
  const padR = 2;
  const padT = 4;
  const padB = 4;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const xAt = (index) =>
    padL + (values.length === 1 ? innerW / 2 : (index / (values.length - 1)) * innerW);
  const yAt = (value) => padT + (1 - (value - min) / (max - min)) * innerH;
  const outCount = values.filter((value) => isOutOfTolerance(value, characteristic)).length;
  const radius = values.length > 40 ? 1.5 : values.length > 20 ? 2.05 : 2.5;

  const bandTop = Math.min(yAt(characteristic.usl), yAt(characteristic.lsl));
  const bandHeight = Math.abs(yAt(characteristic.usl) - yAt(characteristic.lsl));
  const span = max - min || 1;
  const nearLimit = (value) =>
    Math.abs(value - characteristic.usl) <= span * 0.012 || Math.abs(value - characteristic.lsl) <= span * 0.012;
  const horizontal = (value, className) =>
    `<line class="${className}" x1="${padL}" x2="${width - padR}" y1="${yAt(value).toFixed(2)}" y2="${yAt(value).toFixed(2)}" />`;
  const nominalLine = nearLimit(characteristic.nominal) ? "" : horizontal(characteristic.nominal, "nominal");
  const points = values
    .map((value, index) => {
      const out = isOutOfTolerance(value, characteristic);
      const title = `${samples[index].pieceId}: ${fmt.format(value)} ${characteristic.unit}`;
      return `<circle class="pt${out ? " oot" : ""}" cx="${xAt(index).toFixed(2)}" cy="${yAt(value).toFixed(2)}" r="${out ? radius + 1 : radius}"><title>${escapeHtml(title)}</title></circle>`;
    })
    .join("");
  const series =
    values.length > 1
      ? `<polyline class="series" points="${values
          .map((value, index) => `${xAt(index).toFixed(2)},${yAt(value).toFixed(2)}`)
          .join(" ")}" />`
      : "";
  const label = `${characteristic.name}: ${values.length} Istwerte, ${outCount} außer Toleranz`;

  return `
    <svg class="spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}" data-n="${values.length}" data-oot="${outCount}">
      <rect class="band" x="${padL}" y="${bandTop.toFixed(2)}" width="${innerW}" height="${Math.max(bandHeight, 0).toFixed(2)}"></rect>
      ${horizontal(characteristic.usl, "limit")}
      ${horizontal(characteristic.lsl, "limit")}
      ${nominalLine}
      ${horizontal(mean, "mean")}
      ${series}
      ${points}
    </svg>
  `;
}

function autoPlace() {
  const stageW = els.stage.clientWidth;
  const stageH = els.stage.clientHeight;
  if (stageW < 40 || stageH < 40) return;
  const pending = [];
  state.data.characteristics.forEach((characteristic, index) => {
    const placement = state.placements[characteristic.id];
    if (placement?.flag?.pinned) return;
    const element = els.flags.querySelector(`[data-id="${CSS.escape(characteristic.id)}"]`);
    if (!element) return;
    camera.updateMatrixWorld();
    const projected = placement?.anchor ? projectToStage(placement.anchor, stageW, stageH) : null;
    pending.push({
      id: characteristic.id,
      width: element.offsetWidth || 200,
      height: element.offsetHeight || 140,
      px: projected ? projected.x : stageW * ((index + 0.5) / state.data.characteristics.length),
      py: projected ? projected.y : stageH / 2,
    });
  });
  if (!pending.length) return;

  const mid = stageH / 2;
  let top = pending.filter((item) => item.py < mid).sort((a, b) => a.px - b.px);
  let bottom = pending.filter((item) => item.py >= mid).sort((a, b) => a.px - b.px);
  if (!top.length || !bottom.length) {
    const sorted = [...pending].sort((a, b) => a.px - b.px);
    const half = Math.ceil(sorted.length / 2);
    top = sorted.slice(0, half);
    bottom = sorted.slice(half);
  }
  placeRow(top, "top", stageW, stageH);
  placeRow(bottom, "bottom", stageW, stageH);
}

function placeRow(items, side, stageW, stageH) {
  if (!items.length) return;
  const margin = 8;
  const maxHeight = Math.max(...items.map((item) => item.height));
  const y = side === "top" ? margin : Math.max(margin, stageH - margin - maxHeight);
  const slot = (stageW - margin * 2) / items.length;
  items.forEach((item, index) => {
    const x = margin + slot * index + Math.max(0, (slot - item.width) / 2);
    state.placements[item.id].flag = {
      x: x / stageW,
      y: y / stageH,
      pinned: false,
    };
  });
}

function applyAllPositions() {
  const stageW = els.stage.clientWidth;
  const stageH = els.stage.clientHeight;
  if (!stageW || !stageH) return;
  for (const characteristic of state.data.characteristics) {
    const element = els.flags.querySelector(`[data-id="${CSS.escape(characteristic.id)}"]`);
    const flag = state.placements[characteristic.id]?.flag;
    if (!element || !flag) continue;
    const maxX = Math.max(0, stageW - element.offsetWidth);
    const maxY = Math.max(0, stageH - 24);
    const x = clamp(flag.x * stageW, 0, maxX);
    const y = clamp(flag.y * stageH, 0, maxY);
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  }
}

function syncLeaderNodes() {
  for (const characteristic of state.data.characteristics) {
    if (leaderNodes.has(characteristic.id)) continue;
    const group = document.createElementNS(SVG_NS, "g");
    group.dataset.id = characteristic.id;
    const line = document.createElementNS(SVG_NS, "line");
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("r", "4.5");
    group.append(line, dot);
    els.leaders.append(group);
    leaderNodes.set(characteristic.id, { group, line, dot });
  }
}

function updateLeaders() {
  if (!camera || !state.data) return;
  camera.updateMatrixWorld();
  const stageRect = els.stage.getBoundingClientRect();
  const stageW = stageRect.width;
  const stageH = stageRect.height;
  for (const characteristic of state.data.characteristics) {
    const nodes = leaderNodes.get(characteristic.id);
    if (!nodes) continue;
    const placement = state.placements[characteristic.id];
    const element = els.flags.querySelector(`[data-id="${CSS.escape(characteristic.id)}"]`);
    const projected = placement?.anchor ? projectToStage(placement.anchor, stageW, stageH) : null;
    if (!projected || !element) {
      nodes.group.classList.add("is-hidden");
      continue;
    }
    const rect = element.getBoundingClientRect();
    const flagRect = {
      left: rect.left - stageRect.left,
      top: rect.top - stageRect.top,
      width: rect.width,
      height: rect.height,
    };
    if (flagRect.width < 2) {
      nodes.group.classList.add("is-hidden");
      continue;
    }
    const end = borderPoint(flagRect, projected);
    nodes.group.classList.remove("is-hidden");
    nodes.group.classList.toggle("is-selected", state.edit && state.selectedId === characteristic.id);
    nodes.line.setAttribute("x1", projected.x.toFixed(2));
    nodes.line.setAttribute("y1", projected.y.toFixed(2));
    nodes.line.setAttribute("x2", end.x.toFixed(2));
    nodes.line.setAttribute("y2", end.y.toFixed(2));
    nodes.dot.setAttribute("cx", projected.x.toFixed(2));
    nodes.dot.setAttribute("cy", projected.y.toFixed(2));
  }
}

function borderPoint(rect, target) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scaleX = dx !== 0 ? rect.width / 2 / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? rect.height / 2 / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function onFlagPointerDown(event) {
  if (!state.edit || event.button !== 0) return;
  const article = event.target.closest(".flag");
  if (!article) return;
  event.preventDefault();
  event.stopPropagation();
  state.selectedId = article.dataset.id;
  markSelection();
  updateHint();
  updateLeaders();

  const startRect = article.getBoundingClientRect();
  const offsetX = event.clientX - startRect.left;
  const offsetY = event.clientY - startRect.top;
  article.setPointerCapture(event.pointerId);

  const move = (ev) => {
    const stageRect = els.stage.getBoundingClientRect();
    const maxX = Math.max(0, stageRect.width - article.offsetWidth);
    const maxY = Math.max(0, stageRect.height - 24);
    const x = clamp(ev.clientX - stageRect.left - offsetX, 0, maxX);
    const y = clamp(ev.clientY - stageRect.top - offsetY, 0, maxY);
    article.style.left = `${x}px`;
    article.style.top = `${y}px`;
    const placement = state.placements[article.dataset.id];
    placement.flag = {
      x: x / stageRect.width,
      y: y / stageRect.height,
      pinned: true,
    };
  };
  const up = () => {
    article.removeEventListener("pointermove", move);
    article.removeEventListener("pointerup", up);
    article.removeEventListener("pointercancel", up);
    pinAll();
    saveLocal();
  };
  article.addEventListener("pointermove", move);
  article.addEventListener("pointerup", up);
  article.addEventListener("pointercancel", up);
}

function onViewPointerDown(event) {
  if (event.button !== 0) return;
  pointerDown = { x: event.clientX, y: event.clientY };
}

function onViewPointerUp(event) {
  if (!pointerDown || event.button !== 0) {
    pointerDown = null;
    return;
  }
  const dx = event.clientX - pointerDown.x;
  const dy = event.clientY - pointerDown.y;
  pointerDown = null;
  if (!state.edit || dx * dx + dy * dy > 36) return;
  if (!state.selectedId) {
    toast(UI.pickFirst);
    return;
  }
  const hit = pickSurface(event);
  if (!hit) {
    toast(UI.pickMiss);
    return;
  }
  state.placements[state.selectedId].anchor = hit;
  saveLocal();
  updateLeaders();
  toast(UI.anchorSet);
}

function pickSurface(event) {
  const rect = els.view.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  camera.updateMatrixWorld();
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObject(state.model, true);
  if (!hits.length) return null;
  const point = hits[0].point;
  return { x: point.x, y: point.y, z: point.z };
}

function pinAll() {
  for (const characteristic of state.data.characteristics) {
    const flag = state.placements[characteristic.id]?.flag;
    if (flag) flag.pinned = true;
  }
}

function setEdit(on) {
  state.edit = on;
  if (!on) state.selectedId = null;
  document.body.classList.toggle("is-editing", on);
  els.modeView.setAttribute("aria-pressed", String(!on));
  els.modeEdit.setAttribute("aria-pressed", String(on));
  markSelection();
  updateHint();
  updateLeaders();
}

function markSelection() {
  for (const article of els.flags.querySelectorAll(".flag")) {
    const selected = state.edit && article.dataset.id === state.selectedId;
    article.classList.toggle("is-selected", selected);
  }
}

function updateHint() {
  if (!state.edit) {
    els.hint.hidden = true;
    return;
  }
  const characteristic = state.data.characteristics.find((item) => item.id === state.selectedId);
  const which = characteristic ? `Ausgewählt: ${characteristic.name}. ` : "";
  els.hint.hidden = false;
  els.hint.textContent = which + UI.hintIdle;
}

function exportLayout() {
  const payload = currentLayout();
  for (const entry of Object.values(payload.placements)) {
    if (entry.flag) entry.flag.pinned = true;
  }
  const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = "merkmale-layout.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast(UI.exported);
}

async function onImportFile() {
  const file = els.importFile.files?.[0];
  els.importFile.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    applyImported(parsed);
    toast(UI.imported);
  } catch (error) {
    console.error(error);
    toast(UI.importInvalid);
  }
}

function applyImported(raw) {
  if (!raw || typeof raw !== "object" || !raw.placements || typeof raw.placements !== "object") {
    throw new Error("invalid layout");
  }
  let applied = 0;
  for (const characteristic of state.data.characteristics) {
    const clean = sanitizePlacement(raw.placements[characteristic.id]);
    if (!clean) continue;
    const current = state.placements[characteristic.id];
    if (clean.anchor) current.anchor = clean.anchor;
    if (clean.flag) current.flag = { ...clean.flag, pinned: clean.flag.pinned !== false };
    applied += 1;
  }
  if (!applied) throw new Error("no matching characteristics");
  saveLocal();
  refreshFlagContents();
  autoPlace();
  applyAllPositions();
  updateLeaders();
}

function onResetClick() {
  if (els.resetBtn.dataset.armed !== "true") {
    els.resetBtn.dataset.armed = "true";
    els.resetBtn.textContent = "Sicher?";
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      els.resetBtn.dataset.armed = "false";
      els.resetBtn.textContent = "Zurücksetzen";
    }, 3500);
    return;
  }
  clearTimeout(resetTimer);
  els.resetBtn.dataset.armed = "false";
  els.resetBtn.textContent = "Zurücksetzen";
  try {
    localStorage.removeItem(LAYOUT_KEY);
  } catch {
    /* ignore */
  }
  state.selectedId = null;
  initPlacements();
  refreshFlagContents();
  autoPlace();
  applyAllPositions();
  markSelection();
  updateLeaders();
  toast(UI.reset);
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2400);
}

function fail(message) {
  els.loading.hidden = false;
  els.loadingText.textContent = message;
  const spinner = els.loading.querySelector(".spinner");
  if (spinner) spinner.hidden = true;
  document.body.dataset.ready = "error";
  document.body.dataset.error = message;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
