import * as THREE from "three";
import { TumbleControls } from "./tumble-controls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { createDataSource } from "./data-source.js";
import {
  add,
  scale,
  normalize,
  basisFromNormal,
  circleFromThreePoints,
  circleFromCenterAndEdge,
  rectangleFromThreePoints,
  sampleCircle,
  GEOMETRY_PALETTE,
} from "./geometry.js";
import { DEFAULT_TEMPLATE, normalizeTemplate, renderFlag } from "./label-template.js";
import { fitType, formatFit } from "./fit.js";
import { buildMesh } from "./mesh-select.js";

// Anchors and geometries are stored in the original OBJ coordinate system.
// The mesh is not moved, so a raycast hit can be saved as-is.
// data/layout.json is the published view. localStorage is a draft on this
// machine only and is written when the user finishes preparation.

const SETUP_KEY = "milkyway-setup-v2";
const LEGACY_KEY = "milkyway-merkmale-layout-v1";
const FILTER_KEY = "milkyway-merkmale-filter-v1";
const SVG_NS = "http://www.w3.org/2000/svg";

const UI = {
  loading: "Modell wird geladen …",
  modelError: "Das Modell konnte nicht geladen werden.",
  dataError: "Die Daten konnten nicht geladen werden.",
  webglError: "WebGL ist in diesem Browser nicht verfügbar.",
  emptyModel: "Das Modell enthält keine Flächen.",
  hint: "Fähnchen ziehen. Punkt oder Geometrie mit der gewählten Art setzen. Linksklick wählt, Rechts dreht, Mitte zoomt.",
  pickFirst: "Zuerst ein Fähnchen auswählen.",
  pickMiss: "Kein Treffer auf der Oberfläche.",
  anchorSet: "Fußpunkt gesetzt.",
  geoMade: "Geometrie erzeugt.",
  geoBad: "Diese Punkte ergeben keine Geometrie.",
  finished: "Einrichtung auf diesem Rechner gespeichert (Lokaler Entwurf).",
  discarded: "Ungespeicherte Änderungen verworfen.",
  exported: "Einrichtung exportiert. Für alle: Datei als data/layout.json veröffentlichen.",
  imported: "Einrichtung importiert (nur dieser Rechner).",
  importInvalid: "Die Datei enthält keine gültige Einrichtung.",
  reset: "Lokaler Entwurf gelöscht. Veröffentlichte Ansicht geladen.",
  liveDown: "Live-Daten kurz nicht erreichbar. Letzte Werte bleiben.",
  assigned: "Merkmal zugeordnet.",
};

const els = {
  partName: document.getElementById("part-name"),
  templateBadge: document.getElementById("template-badge"),
  dataBadge: document.getElementById("data-badge"),
  setupBadge: document.getElementById("setup-badge"),
  filterCount: document.getElementById("filter-count"),
  filterFrom: document.getElementById("filter-from"),
  filterTo: document.getElementById("filter-to"),
  filterQuick: document.querySelector(".filter-quick"),
  viewLock: document.getElementById("view-lock"),
  reconnect: document.getElementById("reconnect"),
  prepare: document.getElementById("prepare"),
  finish: document.getElementById("finish"),
  discard: document.getElementById("discard"),
  exportBtn: document.getElementById("export"),
  importBtn: document.getElementById("import"),
  importFile: document.getElementById("import-file"),
  resetBtn: document.getElementById("reset"),
  editor: document.getElementById("editor"),
  stage: document.getElementById("stage"),
  view: document.getElementById("view"),
  leaders: document.getElementById("leaders"),
  flags: document.getElementById("flags"),
  hint: document.getElementById("hint"),
  toast: document.getElementById("toast"),
  loading: document.getElementById("loading"),
  loadingText: document.getElementById("loading-text"),
  tool: document.getElementById("tool"),
  charSelect: document.getElementById("char-select"),
  charList: document.getElementById("char-list"),
  geoPanel: document.getElementById("geo-panel"),
  geoColor: document.getElementById("geo-color"),
  geoWidth: document.getElementById("geo-width"),
  geoOpacity: document.getElementById("geo-opacity"),
  geoAttach: document.getElementById("geo-attach"),
  geoDelete: document.getElementById("geo-delete"),
  snap: document.getElementById("snap"),
  pickStatus: document.getElementById("pick-status"),
  fitPreview: document.getElementById("fit-preview"),
  fitSummary: document.getElementById("fit-summary"),
  fitOk: document.getElementById("fit-ok"),
  fitMore: document.getElementById("fit-more"),
  fitUndo: document.getElementById("fit-undo"),
  fitCancel: document.getElementById("fit-cancel"),
  templateForm: document.getElementById("template-form"),
  refreshSeconds: document.getElementById("refresh-seconds"),
};

const state = {
  data: null,
  dataMode: "example",
  published: null,
  saved: null,
  setup: null,
  usingDraft: false,
  edit: false,
  selectedId: null,
  selectedGeometryId: null,
  tool: "point",
  snap: true,
  picks: [],
  extraArmed: false,
  preview: null,
  draftPoints: [],
  filterCount: 25,
  filterFrom: "",
  filterTo: "",
  viewLocked: true,
  reconnect: false,
  layoutTemplateId: "",
  model: null,
  warnedLive: false,
};

const PICK_MIN = { Linie: 2, Kreis: 3, Ebene: 4, Kugel: 4, Zylinder: 4, Kegel: 4, Langloch: 4 };
const PICK_EXTRA = new Set(["Ebene", "Kreis", "Kugel"]);
const PICK_HINT = {
  Linie: ["Anfang", "Ende"],
  Kreis: ["auf dem Kreis", "auf dem Kreis", "auf dem Kreis"],
  Ebene: ["auf der Ebene", "auf der Ebene", "auf der Ebene", "auf der Ebene"],
  Zylinder: ["auf dem Kreis", "auf dem Kreis", "auf dem Kreis", "in der Tiefe"],
  Kegel: ["auf dem Kreis", "auf dem Kreis", "auf dem Kreis", "in der Tiefe"],
  Kugel: ["auf der Kugel", "auf der Kugel", "auf der Kugel", "auf der Kugel"],
  Langloch: ["am runden Ende", "am runden Ende", "am runden Ende", "am anderen Ende"],
};
const numberTextures = new Map();
const geometryGroups = new Map();
let pickRoot;
const scratch = new THREE.Vector3();
const pointerNdc = new THREE.Vector2();
let renderer;
let scene;
let camera;
let controls;
let raycaster;
let geometryRoot;
let toastTimer = 0;
let loopOn = false;
let pointerDown = null;
let handleDrag = null;
let discardTimer = 0;
let resetTimer = 0;
let cameraIsSaved = false;
let source;
const chartTip = document.createElement("div");
chartTip.id = "chart-tip";
chartTip.hidden = true;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

main().catch((error) => {
  console.error(error);
  if (document.body.dataset.ready !== "error") fail(UI.dataError);
});

async function main() {
  bindUi();
  restoreFilter();
  initViewer();

  const params = new URLSearchParams(location.search);
  const layoutUrl = new URL("../data/layout.json", import.meta.url);
  const exampleUrl = new URL("../data/example-measurements.json", import.meta.url);
  const liveUrl = new URL("../data/live-measurements.json", import.meta.url);
  const modelUrl = await chooseModelUrl();

  const [layout, model] = await Promise.all([
    fetch(layoutUrl)
      .then((response) => (response.ok ? response.json() : { placements: {} }))
      .catch(() => ({ placements: {} })),
    loadModel(modelUrl),
  ]);

  state.published = normalizeSetup(layout);
  const draft = readDraft();
  state.usingDraft = Boolean(draft);
  state.saved = clone(draft || state.published);
  state.setup = clone(state.saved);
  state.model = model;
  indexLoadedModel(model);
  if (params.has("probe")) window.__probe = probeApi();
  cameraIsSaved = Boolean(state.setup.camera);
  syncChrome();
  resizeRenderer();
  if (state.setup.camera) applyCamera(state.setup.camera);
  else frameModel(model, null);
  rebuildGeometries();

  source = createDataSource({
    exampleUrl: exampleUrl.href,
    liveUrl: () => {
      const url = new URL(liveUrl.href);
      url.searchParams.set("top", state.filterCount === "all" ? "5000" : String(state.filterCount || 25));
      if (state.filterFrom) url.searchParams.set("from", state.filterFrom);
      if (state.filterTo) url.searchParams.set("to", state.filterTo);
      return url.href;
    },
    intervalSeconds: () => {
      const fromQuery = Number(params.get("refresh"));
      if (Number.isFinite(fromQuery) && fromQuery >= 5) return fromQuery;
      return state.setup?.refreshSeconds || state.data?.refreshSeconds || 60;
    },
    onData: acceptData,
    onStatus: (status) => {
      if (!status.ok && status.mode === "live" && !state.warnedLive) {
        state.warnedLive = true;
        toast(UI.liveDown);
      }
      if (status.ok) state.warnedLive = false;
    },
  });
  await source.start();

  const observer = new ResizeObserver(() => {
    resizeRenderer();
    if (!cameraIsSaved && !state.userMovedCamera && state.model) frameModel(state.model, measureFlagBand());
    autoPlace();
    applyAllPositions();
    updateLeaders();
  });
  observer.observe(els.stage);
  reveal();
  startLoop();

  if (params.has("debug")) {
    window.__merkmale = {
      state,
      currentSetup,
      projectToStage,
      acceptData,
    };
  }
}

function acceptData(data, info) {
  state.data = data;
  state.dataMode = info.mode;
  const templateId = info.mode === "live" ? data.part?.template?.id || "" : "";
  const templateChanged = info.mode === "live" && templateId !== state.layoutTemplateId;
  if (info.mode === "live" && (info.initial || info.switched || templateChanged)) {
    state.layoutTemplateId = templateId;
    const draft = readDraft();
    const base = emptySetup();
    base.labelTemplate = clone(state.published?.labelTemplate || base.labelTemplate);
    base.refreshSeconds = state.published?.refreshSeconds || base.refreshSeconds;
    base.camera = draft?.camera || null;
    state.saved = clone(draft || base);
    state.setup = clone(state.saved);
    adoptLivePlacements();
    state.usingDraft = Boolean(draft);
    cameraIsSaved = Boolean(state.setup.camera);
    document.body.dataset.ready = document.body.dataset.ready || "pending";
    renderFlags();
    if (!cameraIsSaved && state.model) frameModel(state.model, measureFlagBand());
    autoPlace();
    applyAllPositions();
    rebuildGeometries();
  } else if (info.initial) {
    ensurePlacementsForData();
    renderFlags();
    if (!cameraIsSaved && state.model) frameModel(state.model, measureFlagBand());
    autoPlace();
    applyAllPositions();
    rebuildGeometries();
    document.body.dataset.ready = document.body.dataset.ready || "pending";
  } else if (info.mode === "live") {
    adoptLivePlacements();
    refreshFlagContents();
  } else {
    refreshFlagContents();
  }
  syncChrome();
  syncEditor();
  updateLeaders();
}

function adoptLivePlacements() {
  const ids = new Set((state.data?.characteristics || []).map((item) => item.id));
  const kept = {};
  for (const [key, placement] of Object.entries(state.setup?.placements || {})) {
    if (ids.has(key)) kept[key] = placement;
  }
  state.setup.placements = kept;
  state.setup.controlMap = {};
  for (const characteristic of state.data?.characteristics || []) {
    if (!state.setup.placements[characteristic.id]) {
      state.setup.placements[characteristic.id] = { flag: null, anchor: null };
    }
  }
}

function bindUi() {
  els.filterCount.addEventListener("change", () => applyFilter({ count: els.filterCount.value }));
  els.filterFrom.addEventListener("change", () => applyFilter({ from: els.filterFrom.value }));
  els.filterTo.addEventListener("change", () => applyFilter({ to: els.filterTo.value }));
  els.filterQuick.addEventListener("click", (event) => {
    const count = event.target.closest("[data-count]")?.dataset.count;
    if (!count) return;
    applyFilter({ count });
  });
  els.viewLock.addEventListener("click", () => {
    state.viewLocked = !state.viewLocked;
    syncViewLock();
  });
  els.reconnect.addEventListener("click", () => {
    if (!state.selectedId) {
      toast(UI.pickFirst);
      return;
    }
    state.reconnect = true;
    toast("Klicken Sie den neuen Fusspunkt oder eine Geometrie.");
  });
  els.prepare.addEventListener("click", () => beginEdit());
  els.finish.addEventListener("click", () => finishEdit());
  els.discard.addEventListener("click", () => discardEdit());
  els.exportBtn.addEventListener("click", exportSetup);
  els.importBtn.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", onImportFile);
  els.resetBtn.addEventListener("click", onResetClick);
  els.tool.addEventListener("change", () => {
    state.tool = els.tool.value;
    state.draftPoints = [];
    resetPicks();
    updatePickStatus();
    updateHint();
  });
  els.snap.addEventListener("change", () => {
    state.snap = els.snap.checked;
  });
  els.charSelect.addEventListener("change", () => {
    state.selectedId = els.charSelect.value || null;
    markSelection();
    updateHint();
    updateLeaders();
  });
  els.charList.addEventListener("click", (event) => {
    const row = event.target.closest("[data-char]");
    if (!row || !state.selectedId) return;
    state.setup.controlMap[state.selectedId] = row.dataset.char;
    refreshFlagContents();
    syncEditor();
    toast(UI.assigned);
  });
  els.geoColor.addEventListener("input", () => updateSelectedGeometry({ color: els.geoColor.value }));
  els.geoWidth.addEventListener("input", () => updateSelectedGeometry({ lineWidth: Number(els.geoWidth.value) }));
  els.geoOpacity.addEventListener("input", () => updateSelectedGeometry({ opacity: Number(els.geoOpacity.value) }));
  els.geoAttach.addEventListener("change", () => updateSelectedGeometry({ attach: els.geoAttach.value }));
  els.geoDelete.addEventListener("click", deleteSelectedGeometry);
  els.fitOk.addEventListener("click", confirmPreview);
  els.fitMore.addEventListener("click", () => {
    if (!state.preview) return;
    state.extraArmed = true;
    updatePickStatus();
    toast("Nächster Klick setzt einen weiteren Punkt.");
  });
  els.fitUndo.addEventListener("click", undoPick);
  els.fitCancel.addEventListener("click", resetPicks);
  els.flags.addEventListener("pointermove", onChartHover);
  els.flags.addEventListener("pointerleave", hideChartTip);
  document.body.append(chartTip);
  els.templateForm.addEventListener("change", readTemplateForm);
  els.templateForm.addEventListener("input", readTemplateForm);
  els.refreshSeconds.addEventListener("change", () => {
    const value = Number(els.refreshSeconds.value);
    if (Number.isFinite(value)) state.setup.refreshSeconds = Math.max(5, Math.min(3600, value));
    source?.restart();
  });
  els.flags.addEventListener("pointerdown", onFlagPointerDown);
  els.leaders.addEventListener("pointerdown", onHandlePointerDown);
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
    if (!stored) return;
    if (stored === "10" || stored === "25" || stored === "50" || stored === "all") {
      applyFilter({ count: stored }, false);
      return;
    }
    const parsed = JSON.parse(stored);
    applyFilter({
      count: parsed.count ?? 25,
      from: parsed.from || "",
      to: parsed.to || "",
    }, false);
  } catch {
    /* ignore */
  }
}

function applyFilter(patch, persist = true) {
  if (patch.count != null) {
    state.filterCount = patch.count === "all" ? "all" : Math.max(1, Math.min(5000, Number(patch.count) || 25));
  }
  if (patch.from != null) state.filterFrom = patch.from;
  if (patch.to != null) state.filterTo = patch.to;
  if (els.filterCount) els.filterCount.value = state.filterCount === "all" ? "" : String(state.filterCount);
  if (els.filterFrom) els.filterFrom.value = state.filterFrom;
  if (els.filterTo) els.filterTo.value = state.filterTo;
  for (const button of els.filterQuick?.querySelectorAll("[data-count]") || []) {
    button.classList.toggle("is-on", button.dataset.count === String(state.filterCount));
  }
  if (persist) {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify({
        count: state.filterCount,
        from: state.filterFrom,
        to: state.filterTo,
      }));
    } catch {
      /* ignore */
    }
  }
  refreshFlagContents();
  source?.refresh?.();
}

function syncViewLock() {
  if (controls) controls.enabled = !state.viewLocked;
  if (!els.viewLock) return;
  els.viewLock.classList.toggle("is-locked", state.viewLocked);
  els.viewLock.setAttribute("aria-pressed", String(state.viewLocked));
  els.viewLock.textContent = state.viewLocked ? "Ansicht entsperren" : "Ansicht sperren";
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
  scene.add(new THREE.HemisphereLight(0xf7f8fb, 0x9aa3ad, 0.62));
  const key = new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.set(0.35, 0.65, 1);
  camera.add(key);
  const fill = new THREE.DirectionalLight(0xd5e2f2, 0.45);
  fill.position.set(-0.9, 0.15, -0.35);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.28);
  rim.position.set(-0.2, 0.9, -0.6);
  scene.add(rim);
  geometryRoot = new THREE.Group();
  scene.add(geometryRoot);
  pickRoot = new THREE.Group();
  pickRoot.renderOrder = 20;
  scene.add(pickRoot);
  controls = new TumbleControls(camera, els.view);
  controls.addEventListener("start", () => {
    state.userMovedCamera = true;
  });
  controls.addEventListener("click", (event) => pickFromPointer(event));
  syncViewLock();
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
          els.loadingText.textContent = `${UI.loading} ${Math.round((event.loaded / event.total) * 100)} %`;
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
  for (const element of els.flags.querySelectorAll(".flag")) maxHeight = Math.max(maxHeight, element.offsetHeight);
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
  let band = preferredBand ?? (stageH < 360 ? Math.max(64, stageH * 0.24) : Math.min(176, Math.max(96, stageH * 0.28)));
  if (stageH - band * 2 < minModel) band = Math.max(36, (stageH - minModel) / 2);
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
    const fits = span && span.minX >= stageW * 0.03 && span.maxX <= stageW * 0.97 && span.minY >= band && span.maxY <= Math.max(band + 40, stageH - band);
    if (fits) {
      best = dist;
      hi = dist;
    } else lo = dist;
  }
  camera.position.copy(center).addScaledVector(dir, best);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  controls.minDistance = radius * 0.12;
  controls.maxDistance = radius * 8;
  controls.update();
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
  if (!anchor || !camera) return null;
  scratch.set(anchor.x, anchor.y, anchor.z);
  scratch.applyMatrix4(camera.matrixWorldInverse);
  const behind = scratch.z >= -1e-4;
  const vx = scratch.x;
  const vy = scratch.y;
  if (behind) {
    const len = Math.hypot(vx, vy) || 1;
    const reach = Math.max(stageW, stageH);
    return { x: stageW / 2 + (vx / len) * reach, y: stageH / 2 - (vy / len) * reach, behind: true };
  }
  scratch.applyMatrix4(camera.projectionMatrix);
  return { x: (scratch.x * 0.5 + 0.5) * stageW, y: (-scratch.y * 0.5 + 0.5) * stageH, behind: false };
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

function emptySetup() {
  return {
    schemaVersion: 2,
    space: "obj",
    refreshSeconds: 60,
    camera: null,
    labelTemplate: { ...DEFAULT_TEMPLATE },
    geometries: [],
    controlMap: {},
    placements: {},
  };
}

function normalizeSetup(raw) {
  const setup = emptySetup();
  if (!raw || typeof raw !== "object") return setup;
  const refresh = Number(raw.refreshSeconds);
  if (Number.isFinite(refresh)) setup.refreshSeconds = Math.max(5, Math.min(3600, refresh));
  setup.labelTemplate = normalizeTemplate(raw.labelTemplate);
  setup.camera = normalizeCamera(raw.camera);
  setup.geometries = Array.isArray(raw.geometries) ? raw.geometries.map(normalizeGeometry).filter(Boolean) : [];
  setup.controlMap = {};
  if (raw.controlMap && typeof raw.controlMap === "object") {
    for (const [key, value] of Object.entries(raw.controlMap)) {
      if (typeof value === "string" && value) setup.controlMap[key] = value;
    }
  }
  const sourcePlacements = raw.placements && typeof raw.placements === "object" ? raw.placements : {};
  for (const [key, value] of Object.entries(sourcePlacements)) {
    const placement = normalizePlacement(value);
    if (placement) setup.placements[key] = placement;
  }
  return setup;
}

function normalizeCamera(cameraValue) {
  if (!cameraValue) return null;
  const position = asVec3(cameraValue.position);
  const target = asVec3(cameraValue.target);
  if (!position || !target) return null;
  const fov = Number(cameraValue.fov);
  const up = asVec3(cameraValue.up);
  return { position, target, up, fov: Number.isFinite(fov) ? fov : 32 };
}

function asVec3(value) {
  if (Array.isArray(value) && value.length >= 3 && value.every(isFiniteNumber)) {
    return { x: value[0], y: value[1], z: value[2] };
  }
  if (value && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z)) {
    return { x: value.x, y: value.y, z: value.z };
  }
  return null;
}

function normalizePlacement(value) {
  if (!value || typeof value !== "object") return null;
  const placement = {};
  if (value.flag && isFiniteNumber(value.flag.x) && isFiniteNumber(value.flag.y)) {
    placement.flag = {
      x: clamp(value.flag.x, -0.5, 1.5),
      y: clamp(value.flag.y, -0.5, 1.5),
      pinned: value.flag.pinned !== false,
    };
  }
  placement.anchor = normalizeAnchor(value.anchor);
  if (!placement.flag && !placement.anchor) return null;
  return placement;
}

function normalizeAnchor(anchor) {
  if (!anchor || typeof anchor !== "object") return null;
  if ((anchor.kind === "geometry" || anchor.geometryId) && typeof (anchor.geometryId) === "string") {
    return {
      kind: "geometry",
      geometryId: anchor.geometryId,
      attach: anchor.attach === "nearest" ? "nearest" : "center",
    };
  }
  const point = asVec3(anchor.point || anchor);
  if (!point) return null;
  return { kind: "point", point };
}

function normalizeGeometry(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null;
  const points = Array.isArray(raw.points) ? raw.points.map(asVec3).filter(Boolean) : [];
  const geometry = {
    id: raw.id,
    type: ["rect", "circle", "plane", "line", "slot", "cylinder", "cone", "sphere"].includes(raw.type) ? raw.type : "circle",
    mode: raw.mode || (raw.type === "rect" ? "rect" : "3"),
    fitType: raw.fitType || "",
    summary: raw.summary || "",
    diameter: isFiniteNumber(raw.diameter) ? raw.diameter : null,
    length: isFiniteNumber(raw.length) ? raw.length : null,
    width: isFiniteNumber(raw.width) ? raw.width : null,
    halfAngle: isFiniteNumber(raw.halfAngle) ? raw.halfAngle : null,
    drawRadius: isFiniteNumber(raw.drawRadius) ? raw.drawRadius : null,
    direction: asVec3(raw.direction),
    apex: asVec3(raw.apex),
    color: typeof raw.color === "string" ? raw.color : GEOMETRY_PALETTE[0],
    lineWidth: clamp(Number(raw.lineWidth) || 2, 1, 8),
    opacity: clamp(Number(raw.opacity) || 0.85, 0.15, 1),
    attach: raw.attach === "nearest" ? "nearest" : "center",
    points,
    normal: asVec3(raw.normal),
    center: asVec3(raw.center),
    radius: isFiniteNumber(raw.radius) ? raw.radius : null,
    corners: Array.isArray(raw.corners) ? raw.corners.map(asVec3).filter(Boolean) : null,
  };
  if (geometry.mode === "fit" && geometry.center) return geometry;
  recomputeGeometry(geometry);
  if ((geometry.type === "circle" || geometry.mode === "fit") && !geometry.center) return null;
  if (geometry.type === "rect" && !geometry.corners) return null;
  return geometry;
}

function layoutStorageKey() {
  const templateId = state.dataMode === "live" ? state.data?.part?.template?.id : "";
  return templateId ? `${SETUP_KEY}:${templateId}` : SETUP_KEY;
}

function readDraft() {
  try {
    const modern = localStorage.getItem(layoutStorageKey());
    if (modern) return normalizeSetup(JSON.parse(modern));
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) return normalizeSetup(JSON.parse(legacy));
  } catch {
    /* ignore broken storage */
  }
  return null;
}

function writeDraft(setup) {
  localStorage.setItem(layoutStorageKey(), JSON.stringify(serializeSetup(setup)));
}

function serializeSetup(setup) {
  return {
    schemaVersion: 2,
    space: "obj",
    description: "Veroeffentlichte Ansicht, wenn diese Datei data/layout.json ist. Ein Lokaler Entwurf im Browser gilt nur auf diesem Rechner.",
    refreshSeconds: setup.refreshSeconds,
    camera: setup.camera
      ? {
          position: roundVec(setup.camera.position),
          target: roundVec(setup.camera.target),
          fov: setup.camera.fov,
        }
      : null,
    labelTemplate: { ...setup.labelTemplate },
    controlMap: { ...setup.controlMap },
    geometries: setup.geometries.map(serializeGeometry),
    placements: Object.fromEntries(
      Object.entries(setup.placements).map(([key, placement]) => [key, serializePlacement(placement)]),
    ),
  };
}

function serializeGeometry(geometry) {
  return {
    id: geometry.id,
    type: geometry.type,
    mode: geometry.mode,
    color: geometry.color,
    lineWidth: geometry.lineWidth,
    opacity: geometry.opacity,
    attach: geometry.attach,
    points: (geometry.points || []).map(roundVec),
    normal: geometry.normal ? roundVec(geometry.normal) : null,
    center: geometry.center ? roundVec(geometry.center) : null,
    radius: geometry.radius == null ? null : round(geometry.radius, 4),
    diameter: geometry.diameter == null ? null : round(geometry.diameter, 4),
    length: geometry.length == null ? null : round(geometry.length, 4),
    width: geometry.width == null ? null : round(geometry.width, 4),
    halfAngle: geometry.halfAngle == null ? null : round(geometry.halfAngle, 5),
    fitType: geometry.fitType || "",
    summary: geometry.summary || "",
    drawRadius: geometry.drawRadius == null ? null : round(geometry.drawRadius, 3),
    direction: geometry.direction ? roundVec(geometry.direction) : null,
    apex: geometry.apex ? roundVec(geometry.apex) : null,
    corners: geometry.corners ? geometry.corners.map(roundVec) : null,
  };
}

function serializePlacement(placement) {
  const entry = {};
  if (placement.flag) {
    entry.flag = { x: round(placement.flag.x, 4), y: round(placement.flag.y, 4), pinned: Boolean(placement.flag.pinned) };
  }
  if (placement.anchor?.kind === "geometry") {
    entry.anchor = {
      kind: "geometry",
      geometryId: placement.anchor.geometryId,
      attach: placement.anchor.attach || "center",
    };
  } else if (placement.anchor?.point) {
    entry.anchor = { kind: "point", point: roundVec(placement.anchor.point) };
  }
  return entry;
}

function currentSetup() {
  return serializeSetup(state.setup);
}

function captureCamera() {
  return {
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    up: { x: camera.up.x, y: camera.up.y, z: camera.up.z },
    fov: camera.fov,
  };
}

function applyCamera(saved) {
  const position = asVec3(saved.position);
  const target = asVec3(saved.target);
  if (!position || !target) return;
  camera.position.set(position.x, position.y, position.z);
  controls.target.set(target.x, target.y, target.z);
  const up = asVec3(saved.up);
  if (up) camera.up.set(up.x, up.y, up.z);
  camera.fov = saved.fov || 32;
  camera.updateProjectionMatrix();
  controls.update();
  camera.updateMatrixWorld(true);
}

function beginEdit() {
  state.edit = true;
  state.setup = clone(state.saved);
  document.body.classList.add("is-editing");
  state.viewLocked = false;
  syncViewLock();
  els.editor.hidden = false;
  updatePickStatus();
  syncChrome();
  syncEditor();
  resizeRenderer();
  updateHint();
  updateLeaders();
  markSelection();
}

function finishEdit() {
  state.setup.camera = captureCamera();
  cameraIsSaved = true;
  try {
    writeDraft(state.setup);
  } catch {
    toast("Der Entwurf konnte nicht lokal gespeichert werden.");
    return;
  }
  state.saved = clone(state.setup);
  state.usingDraft = true;
  state.edit = false;
  state.draftPoints = [];
  document.body.classList.remove("is-editing");
  els.editor.hidden = true;
  state.viewLocked = true;
  state.reconnect = false;
  syncViewLock();
  resetPicks();
  syncChrome();
  updateHint();
  updateLeaders();
  toast(UI.finished);
}

function discardEdit() {
  if (els.discard.dataset.armed !== "true") {
    els.discard.dataset.armed = "true";
    els.discard.textContent = "Sicher?";
    clearTimeout(discardTimer);
    discardTimer = setTimeout(() => {
      els.discard.dataset.armed = "false";
      els.discard.textContent = "Verwerfen";
    }, 3500);
    return;
  }
  clearTimeout(discardTimer);
  els.discard.dataset.armed = "false";
  els.discard.textContent = "Verwerfen";
  state.setup = clone(state.saved);
  state.edit = false;
  state.draftPoints = [];
  state.selectedGeometryId = null;
  cameraIsSaved = Boolean(state.setup.camera);
  if (state.setup.camera) applyCamera(state.setup.camera);
  document.body.classList.remove("is-editing");
  els.editor.hidden = true;
  state.viewLocked = true;
  state.reconnect = false;
  syncViewLock();
  resetPicks();
  rebuildGeometries();
  renderFlags();
  autoPlace();
  applyAllPositions();
  syncChrome();
  updateHint();
  toast(UI.discarded);
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
    localStorage.removeItem(SETUP_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
  state.usingDraft = false;
  state.saved = clone(state.published);
  state.setup = clone(state.saved);
  state.edit = false;
  state.draftPoints = [];
  state.selectedGeometryId = null;
  cameraIsSaved = Boolean(state.setup.camera);
  document.body.classList.remove("is-editing");
  els.editor.hidden = true;
  state.viewLocked = true;
  state.reconnect = false;
  syncViewLock();
  resetPicks();
  if (state.setup.camera) applyCamera(state.setup.camera);
  else if (state.model) frameModel(state.model, measureFlagBand());
  rebuildGeometries();
  renderFlags();
  autoPlace();
  applyAllPositions();
  syncChrome();
  toast(UI.reset);
}

function exportSetup() {
  const payload = serializeSetup(state.edit ? state.setup : state.saved);
  if (state.edit) payload.camera = roundCamera(captureCamera());
  const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = "merkmale-einrichtung.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast(UI.exported);
}

function roundCamera(cameraValue) {
  return {
    position: roundVec(cameraValue.position),
    target: roundVec(cameraValue.target),
    fov: cameraValue.fov,
  };
}

async function onImportFile() {
  const file = els.importFile.files?.[0];
  els.importFile.value = "";
  if (!file) return;
  try {
    const parsed = normalizeSetup(JSON.parse(await file.text()));
    if (!Object.keys(parsed.placements).length && !parsed.geometries.length && !parsed.camera) {
      throw new Error("empty");
    }
    state.setup = parsed;
    state.saved = clone(parsed);
    state.usingDraft = true;
    cameraIsSaved = Boolean(parsed.camera);
    writeDraft(parsed);
    if (parsed.camera) applyCamera(parsed.camera);
    rebuildGeometries();
    renderFlags();
    autoPlace();
    applyAllPositions();
    syncChrome();
    syncEditor();
    source?.restart();
    toast(UI.imported);
  } catch (error) {
    console.error(error);
    toast(UI.importInvalid);
  }
}

function ensurePlacementsForData() {
  if (!state.data || Object.keys(state.setup.placements).length) return;
  for (const characteristic of state.data.characteristics) {
    if (state.setup.placements[characteristic.id]) continue;
    const point = asVec3(characteristic.defaultAnchor);
    state.setup.placements[characteristic.id] = {
      flag: null,
      anchor: point ? { kind: "point", point } : null,
    };
  }
}

function characteristicFor(key) {
  if (!state.data) return null;
  const mapped = state.setup.controlMap?.[key];
  const id = mapped || key;
  return state.data.characteristics.find((item) => item.id === id) || null;
}

function windowOf(measurements) {
  if (!measurements) return [];
  const from = state.filterFrom || "";
  const to = state.filterTo || "";
  const filtered = measurements.filter((sample) => {
    const day = String(sample.timestamp || sample.creationDateUser || "").slice(0, 10);
    if (!day) return !from && !to;
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
  if (state.filterCount === "all") return filtered;
  const count = Number(state.filterCount);
  if (!Number.isFinite(count) || count <= 0) return filtered;
  return filtered.slice(-count);
}

function renderFlags() {
  els.flags.replaceChildren();
  for (const key of Object.keys(state.setup.placements)) {
    els.flags.append(makeFlag(key));
  }
  markSelection();
}

function refreshFlagContents() {
  if (!state.setup) return;
  for (const key of Object.keys(state.setup.placements)) {
    let article = els.flags.querySelector(`[data-id="${CSS.escape(key)}"]`);
    if (!article) {
      article = makeFlag(key);
      els.flags.append(article);
    } else {
      fillFlag(article, key);
    }
  }
  markSelection();
  applyAllPositions();
}

function makeFlag(key) {
  const article = document.createElement("article");
  article.className = "flag";
  article.dataset.id = key;
  fillFlag(article, key);
  return article;
}

function fillFlag(article, key) {
  const characteristic = characteristicFor(key);
  const template = state.setup.labelTemplate;
  article.dataset.size = template.size;
  if (!characteristic) {
    article.classList.remove("is-oot");
    article.dataset.n = "0";
    article.innerHTML = `<h2 class="flag-name">${escapeHtml(key)}</h2><p class="flag-meta">Keine Istwerte. Im Vorbereiten einem Merkmal zuordnen.</p>`;
    markAnchor(article, key);
    return;
  }
  const built = renderFlag(characteristic, windowOf(characteristic.measurements), template);
  article.classList.toggle("is-oot", built.outOfTolerance);
  article.dataset.n = String(built.count);
  article.dataset.oot = String(built.outCount);
  article.innerHTML = built.html;
  markAnchor(article, key);
}

function markAnchor(article, key) {
  article.classList.toggle("is-unassigned", Boolean(state.edit) && !anchorWorld(key));
}

function autoPlace() {
  const stageW = els.stage.clientWidth;
  const stageH = els.stage.clientHeight;
  if (stageW < 40 || stageH < 40 || !state.setup) return;
  const pending = [];
  Object.keys(state.setup.placements).forEach((key, index) => {
    const placement = state.setup.placements[key];
    if (placement.flag?.pinned) return;
    const element = els.flags.querySelector(`[data-id="${CSS.escape(key)}"]`);
    if (!element) return;
    const world = anchorWorld(key);
    const projected = world ? projectToStage(world, stageW, stageH) : null;
    pending.push({
      key,
      width: element.offsetWidth || 200,
      height: element.offsetHeight || 140,
      px: projected ? projected.x : stageW * ((index + 0.5) / Math.max(1, Object.keys(state.setup.placements).length)),
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
    state.setup.placements[item.key].flag = { x: x / stageW, y: y / stageH, pinned: false };
  });
}

function applyAllPositions() {
  const stageW = els.stage.clientWidth;
  const stageH = els.stage.clientHeight;
  if (!stageW || !stageH || !state.setup) return;
  for (const [key, placement] of Object.entries(state.setup.placements)) {
    const element = els.flags.querySelector(`[data-id="${CSS.escape(key)}"]`);
    if (!element || !placement.flag) continue;
    const maxX = Math.max(0, stageW - element.offsetWidth);
    const maxY = Math.max(0, stageH - 24);
    element.style.left = `${clamp(placement.flag.x * stageW, 0, maxX)}px`;
    element.style.top = `${clamp(placement.flag.y * stageH, 0, maxY)}px`;
  }
}

function anchorWorld(key) {
  const anchor = state.setup.placements[key]?.anchor;
  if (!anchor) return null;
  if (anchor.kind === "geometry") {
    const geometry = state.setup.geometries.find((item) => item.id === anchor.geometryId);
    if (!geometry) return null;
    const attach = anchor.attach || geometry.attach || "center";
    if (geometry.center && geometry.normal && geometry.radius && attach === "nearest") {
      return nearestOnCircle(geometry, key) || geometry.center;
    }
    if (geometry.center) return geometry.center;
    if (geometry.start) return geometry.start;
    if (geometry.corners?.length) {
      const sum = geometry.corners.reduce((acc, point) => add(acc, point), { x: 0, y: 0, z: 0 });
      return scale(sum, 1 / geometry.corners.length);
    }
    return null;
  }
  return anchor.point || null;
}

function nearestOnCircle(geometry, key) {
  const samples = sampleCircle(geometry.center, geometry.normal, geometry.radius, 64);
  const element = els.flags.querySelector(`[data-id="${CSS.escape(key)}"]`);
  if (!element) return geometry.center;
  const stageRect = els.stage.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const target = { x: rect.left - stageRect.left + rect.width / 2, y: rect.top - stageRect.top + rect.height / 2 };
  let best = null;
  let bestDist = Infinity;
  for (const point of samples) {
    const projected = projectToStage(point);
    if (!projected) continue;
    const dist = (projected.x - target.x) ** 2 + (projected.y - target.y) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = point;
    }
  }
  return best;
}

function updateLeaders() {
  if (!camera || !state.setup) return;
  camera.updateMatrixWorld();
  const stageRect = els.stage.getBoundingClientRect();
  els.leaders.replaceChildren();
  for (const key of Object.keys(state.setup.placements)) {
    const world = anchorWorld(key);
    const element = els.flags.querySelector(`[data-id="${CSS.escape(key)}"]`);
    const projected = world ? projectToStage(world, stageRect.width, stageRect.height) : null;
    if (!projected || !element) continue;
    const rect = element.getBoundingClientRect();
    const flagRect = {
      left: rect.left - stageRect.left,
      top: rect.top - stageRect.top,
      width: rect.width,
      height: rect.height,
    };
    if (flagRect.width < 2) continue;
    const end = borderPoint(flagRect, projected);
    const group = document.createElementNS(SVG_NS, "g");
    const selected = state.edit && state.selectedId === key;
    if (selected) group.classList.add("is-selected");
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", projected.x.toFixed(2));
    line.setAttribute("y1", projected.y.toFixed(2));
    line.setAttribute("x2", end.x.toFixed(2));
    line.setAttribute("y2", end.y.toFixed(2));
    const anchor = state.setup.placements[key].anchor;
    const geometry = anchor?.kind === "geometry" ? state.setup.geometries.find((item) => item.id === anchor.geometryId) : null;
    if (geometry) line.setAttribute("stroke", geometry.color);
    group.append(line);
    if (anchor?.kind !== "geometry") {
      group.append(makeHandle(projected.x, projected.y, { kind: "anchor", id: key, index: "0" }, geometry?.color || "#1b2330"));
    }
    els.leaders.append(group);
  }
  if (!state.edit) return;
  for (const geometry of state.setup.geometries) {
    (geometry.points || []).forEach((point, index) => {
      const projected = projectToStage(point, stageRect.width, stageRect.height);
      if (!projected) return;
      els.leaders.append(makeHandle(projected.x, projected.y, { kind: "geopoint", id: geometry.id, index: String(index) }, geometry.color));
    });
  }
  for (const [index, draft] of state.draftPoints.entries()) {
    const projected = projectToStage(draft.point, stageRect.width, stageRect.height);
    if (!projected) continue;
    els.leaders.append(makeHandle(projected.x, projected.y, { kind: "draft", id: "draft", index: String(index) }, "#f0b429"));
  }
}

function makeHandle(x, y, data, color) {
  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("class", "handle");
  dot.setAttribute("cx", x.toFixed(2));
  dot.setAttribute("cy", y.toFixed(2));
  dot.setAttribute("r", "7");
  dot.setAttribute("fill", "#fff");
  dot.setAttribute("stroke", color);
  dot.dataset.kind = data.kind;
  dot.dataset.id = data.id;
  dot.dataset.index = data.index;
  return dot;
}

function borderPoint(rect, target) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scaleX = dx !== 0 ? rect.width / 2 / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? rect.height / 2 / Math.abs(dy) : Infinity;
  const factor = Math.min(scaleX, scaleY);
  return { x: cx + dx * factor, y: cy + dy * factor };
}

function onFlagPointerDown(event) {
  if (!state.edit || event.button !== 0) return;
  const article = event.target.closest(".flag");
  if (!article) return;
  event.preventDefault();
  event.stopPropagation();
  state.selectedId = article.dataset.id;
  state.selectedGeometryId = state.setup.placements[state.selectedId]?.anchor?.geometryId || null;
  markSelection();
  syncEditor();
  updateHint();
  const startRect = article.getBoundingClientRect();
  const offsetX = event.clientX - startRect.left;
  const offsetY = event.clientY - startRect.top;
  article.setPointerCapture(event.pointerId);
  const move = (ev) => {
    const stageRect = els.stage.getBoundingClientRect();
    const x = clamp(ev.clientX - stageRect.left - offsetX, 0, Math.max(0, stageRect.width - article.offsetWidth));
    const y = clamp(ev.clientY - stageRect.top - offsetY, 0, Math.max(0, stageRect.height - 24));
    article.style.left = `${x}px`;
    article.style.top = `${y}px`;
    state.setup.placements[article.dataset.id].flag = { x: x / stageRect.width, y: y / stageRect.height, pinned: true };
  };
  const up = () => {
    article.removeEventListener("pointermove", move);
    article.removeEventListener("pointerup", up);
    article.removeEventListener("pointercancel", up);
  };
  article.addEventListener("pointermove", move);
  article.addEventListener("pointerup", up);
  article.addEventListener("pointercancel", up);
}

function onHandlePointerDown(event) {
  const handle = event.target.closest?.(".handle");
  if (!state.edit || !handle || event.button !== 0 || handle.dataset.kind === "draft") return;
  event.preventDefault();
  event.stopPropagation();
  controls.enabled = false;
  handleDrag = { kind: handle.dataset.kind, id: handle.dataset.id, index: Number(handle.dataset.index) };
  if (handleDrag.kind === "anchor") state.selectedId = handleDrag.id;
  if (handleDrag.kind === "geopoint") state.selectedGeometryId = handleDrag.id;
  markSelection();
  syncEditor();
  const move = (ev) => {
    const hit = pickSurface(ev);
    if (!hit) return;
    if (handleDrag.kind === "anchor") {
      const placement = state.setup.placements[handleDrag.id];
      if (placement) placement.anchor = { kind: "point", point: hit.point };
    } else {
      const geometry = state.setup.geometries.find((item) => item.id === handleDrag.id);
      if (!geometry || !geometry.points[handleDrag.index]) return;
      geometry.points[handleDrag.index] = hit.point;
      if (geometry.mode === "center" && handleDrag.index === 0) geometry.normal = hit.normal;
      recomputeGeometry(geometry);
      rebuildGeometries();
    }
    updateLeaders();
  };
  const up = () => {
    controls.enabled = !state.viewLocked;
    handleDrag = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
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
  if (!state.edit || !state.viewLocked || dx * dx + dy * dy > 16) return;
  pickFromPointer(event);
}

function pickFromPointer(event) {
  if (!state.edit) return;
  const hit = pickSurface(event);
  const geometryId = geometryAt(event);
  if (!hit && !geometryId) {
    toast(UI.pickMiss);
    return;
  }
  onSurfaceClick(Object.assign(hit || { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, faceIndex: 0 }, { geometryId }));
}

function geometryAt(event) {
  if (!geometryRoot) return null;
  const rect = els.view.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObject(geometryRoot, true);
  let obj = hits[0]?.object;
  while (obj && !obj.userData.geometryId) obj = obj.parent;
  return obj?.userData.geometryId || null;
}

function minimumFor(tool) {
  return PICK_MIN[tool] || 0;
}

function updatePickStatus() {
  const need = minimumFor(state.tool);
  if (!need) {
    els.pickStatus.textContent = "Ein Klick setzt den Fußpunkt.";
    return;
  }
  const have = state.picks.length;
  if (state.extraArmed) {
    els.pickStatus.textContent = `${state.tool}: weiterer Punkt, bisher ${have}.`;
    return;
  }
  if (have < need) {
    const hint = PICK_HINT[state.tool]?.[have];
    els.pickStatus.textContent = hint
      ? `${state.tool}: Punkt ${have + 1} von ${need} = ${hint}`
      : `${state.tool}: Punkt ${have + 1} von ${need}`;
    return;
  }
  els.pickStatus.textContent = `${state.tool}: Punkt ${have} von ${need}`;
}

function showPickControls() {
  const active = state.tool !== "point" && state.picks.length > 0;
  els.fitPreview.hidden = !active;
  els.fitOk.hidden = !state.preview;
  els.fitMore.hidden = !(state.preview && PICK_EXTRA.has(state.tool));
  if (!state.preview) els.fitSummary.textContent = els.pickStatus.textContent;
}

function resetPicks() {
  state.picks = [];
  state.extraArmed = false;
  state.preview = null;
  if (els.fitPreview) els.fitPreview.hidden = true;
  updatePickMarkers();
  updatePickStatus();
  rebuildGeometries();
}

function undoPick() {
  if (!state.picks.length) return;
  state.picks.pop();
  state.extraArmed = false;
  updatePickMarkers();
  updatePickStatus();
  if (state.picks.length >= minimumFor(state.tool)) runPickFit();
  else {
    state.preview = null;
    rebuildGeometries();
    showPickControls();
  }
}

function numberTexture(n) {
  const cached = numberTextures.get(n);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1d4ed8";
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 64px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n), 64, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  numberTextures.set(n, texture);
  return texture;
}

function updatePickMarkers() {
  if (!pickRoot) return;
  while (pickRoot.children.length) {
    const child = pickRoot.children[0];
    child.material.dispose();
    pickRoot.remove(child);
  }
  state.picks.forEach((pick, index) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: numberTexture(index + 1),
      depthTest: false,
      depthWrite: false,
    }));
    sprite.position.set(pick.point[0], pick.point[1], pick.point[2]);
    sprite.scale.set(14, 14, 1);
    sprite.renderOrder = 20;
    pickRoot.add(sprite);
  });
}

function capturePick(hit) {
  const face = state.meshIndex?.faces[hit.faceIndex];
  if (state.snap && face) {
    const target = [hit.point.x, hit.point.y, hit.point.z];
    let best = face.i0;
    let bestDistance = Infinity;
    for (const id of [face.i0, face.i1, face.i2]) {
      const point = state.meshIndex.vertices[id];
      const distance = Math.hypot(point[0] - target[0], point[1] - target[1], point[2] - target[2]);
      if (distance < bestDistance) {
        best = id;
        bestDistance = distance;
      }
    }
    return {
      id: best,
      point: state.meshIndex.vertices[best].slice(),
      normal: state.meshIndex.vertexNormals[best].slice(),
    };
  }
  return {
    id: null,
    point: [hit.point.x, hit.point.y, hit.point.z],
    normal: [hit.normal.x, hit.normal.y, hit.normal.z],
  };
}

function runPickFit() {
  const points = state.picks.map((pick) => pick.point);
  const normals = state.picks.map((pick) => pick.normal);
  try {
    const fit = fitType(state.tool, points, normals, false);
    state.preview = geometryFromFit(fit, points);
    els.fitSummary.textContent = `${formatFit(fit)} · ${fit.n} Punkte`;
  } catch (error) {
    state.preview = null;
    els.fitSummary.textContent = error.message || UI.geoBad;
  }
  showPickControls();
  updatePickStatus();
  rebuildGeometries();
}

function onSurfaceClick(hit) {
  if (state.reconnect && state.selectedId) {
    const placement = state.setup.placements[state.selectedId] || (state.setup.placements[state.selectedId] = {});
    const geometryId = hit.geometryId;
    if (geometryId) {
      placement.anchor = { kind: "geometry", geometryId, attach: "center" };
    } else {
      const picked = capturePick(hit);
      placement.anchor = { kind: "point", point: { x: picked.point[0], y: picked.point[1], z: picked.point[2] } };
    }
    state.reconnect = false;
    refreshFlagContents();
    updateLeaders();
    toast(UI.anchorSet);
    return;
  }
  if (state.tool === "point") {
    if (!state.selectedId) {
      toast(UI.pickFirst);
      return;
    }
    const picked = capturePick(hit);
    const placement = state.setup.placements[state.selectedId] || (state.setup.placements[state.selectedId] = {});
    placement.anchor = { kind: "point", point: { x: picked.point[0], y: picked.point[1], z: picked.point[2] } };
    toast(UI.anchorSet);
    updateLeaders();
    return;
  }
  if (!state.selectedId) {
    toast(UI.pickFirst);
    return;
  }
  if (!state.meshIndex) {
    toast("Netz ist noch nicht vorbereitet.");
    return;
  }
  const need = minimumFor(state.tool);
  if (!need) return;
  if (state.preview && !state.extraArmed) {
    toast("Uebernehmen, weiteren Punkt oder Abbrechen.");
    return;
  }
  const picked = capturePick(hit);
  if (picked.id != null && state.picks.some((item) => item.id === picked.id)) {
    toast("Dieser Knoten ist schon gewählt.");
    return;
  }
  state.picks.push(picked);
  state.extraArmed = false;
  updatePickMarkers();
  updatePickStatus();
  if (state.picks.length >= need) runPickFit();
  else {
    state.preview = null;
    rebuildGeometries();
    showPickControls();
  }
}

function confirmPreview() {
  if (!state.preview || !state.selectedId) return;
  const placement = state.setup.placements[state.selectedId] || (state.setup.placements[state.selectedId] = {});
  const previous = placement.anchor?.kind === "geometry"
    ? state.setup.geometries.find((item) => item.id === placement.anchor.geometryId)
    : null;
  if (previous && !window.confirm("Die vorhandene Geometrie dieses Pruefmerkmals ersetzen?")) return;
  if (previous) state.setup.geometries = state.setup.geometries.filter((item) => item.id !== previous.id);
  state.setup.geometries.push(state.preview);
  placement.anchor = { kind: "geometry", geometryId: state.preview.id, attach: "center" };
  state.selectedGeometryId = state.preview.id;
  resetPicks();
  syncEditor();
  toast(UI.geoMade);
}

function geometryFromFit(fit, points = []) {
  const vec = (v) => (v ? { x: v[0], y: v[1], z: v[2] } : null);
  let drawRadius = fit.radius || fit.length || 20;
  if (fit.center && points.length) {
    let max = 0;
    for (const point of points) {
      const d = Math.hypot(point[0] - fit.center[0], point[1] - fit.center[1], point[2] - fit.center[2]);
      if (d > max) max = d;
    }
    if (max > drawRadius) drawRadius = max;
  }
  const typeMap = { Kreis: "circle", Ebene: "plane", Linie: "line", Langloch: "slot", Zylinder: "cylinder", Kegel: "cone", Kugel: "sphere" };
  return {
    id: `geo-${Date.now().toString(36)}`,
    type: typeMap[fit.type] || "circle",
    mode: "fit",
    fitType: fit.type,
    color: nextColor(),
    lineWidth: 2.5,
    opacity: 0.85,
    attach: "center",
    points: [],
    center: vec(fit.center),
    normal: vec(fit.normal),
    direction: vec(fit.direction),
    apex: vec(fit.apex),
    start: vec(fit.start),
    radius: fit.radius ?? null,
    endRadius: fit.endRadius ?? null,
    diameter: fit.diameter ?? null,
    length: fit.length ?? null,
    width: fit.width ?? null,
    halfAngle: fit.halfAngle ?? null,
    summary: formatFit(fit),
    form: fit.form,
    drawRadius,
  };
}

function probeApi() {
  return {
    get ready() {
      return Boolean(state.meshIndex && state.data);
    },
    leaders() {
      return els.leaders.querySelectorAll("line").length;
    },
    placementCount() {
      return Object.keys(state.setup?.placements || {}).length;
    },
    locked() {
      return state.viewLocked;
    },
    camera() {
      return [camera.position.x, camera.position.y, camera.position.z];
    },
    shapes() {
      const kinds = [];
      geometryRoot?.traverse((obj) => {
        if (obj.userData?.kind) kinds.push(obj.userData.kind);
      });
      return kinds;
    },
    addSlot() {
      state.setup.geometries.push({
        id: "slot-demo",
        type: "slot",
        mode: "fit",
        color: "#d0121a",
        lineWidth: 2.5,
        opacity: 0.9,
        attach: "center",
        center: { x: 315, y: 90, z: 40 },
        normal: { x: 0, y: 1, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        radius: 18,
        length: 70,
        width: 36,
      });
      const key = "rundheit-lager";
      state.setup.placements[key].anchor = { kind: "geometry", geometryId: "slot-demo", attach: "center" };
      rebuildGeometries();
      refreshFlagContents();
      updateLeaders();
    },
    clearAnchor(key) {
      if (state.setup.placements[key]) state.setup.placements[key].anchor = null;
      refreshFlagContents();
      updateLeaders();
    },
    get preview() {
      return state.preview && {
        type: state.preview.fitType,
        diameter: state.preview.diameter,
        length: state.preview.length,
        form: state.preview.form,
        summary: state.preview.summary,
      };
    },
    summary() {
      return els.fitSummary.textContent;
    },
    get picks() {
      return state.picks.length;
    },
    status() {
      return els.pickStatus.textContent;
    },
    project(point) {
      const vector = new THREE.Vector3(point[0], point[1], point[2]);
      vector.project(camera);
      const rect = els.view.getBoundingClientRect();
      return {
        x: (vector.x * 0.5 + 0.5) * rect.width + rect.left,
        y: (-vector.y * 0.5 + 0.5) * rect.height + rect.top,
        behind: vector.z < -1 || vector.z > 1,
      };
    },
    hit(clientX, clientY) {
      return pickSurface({ clientX, clientY });
    },
    view() {
      return {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      };
    },
    look(eye, target) {
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      camera.position.set(eye[0], eye[1], eye[2]);
      controls.target.set(target[0], target[1], target[2]);
      camera.near = 0.5;
      camera.far = 8000;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      controls.update();
      controls.enableDamping = damping;
    },
    gridPlane(count = 4) {
      const rect = els.view.getBoundingClientRect();
      const mesh = state.meshIndex;
      const buckets = new Map();
      for (let y = rect.top + 24; y < rect.bottom - 16; y += 42) {
        for (let x = rect.left + 16; x < rect.right - 16; x += 42) {
          const hit = this.hit(x, y);
          const face = hit && mesh.faces[hit.faceIndex];
          if (!face) continue;
          let best = face.i0;
          let bestDistance = Infinity;
          for (const id of [face.i0, face.i1, face.i2]) {
            const point = mesh.vertices[id];
            const distance = Math.hypot(point[0] - hit.point.x, point[1] - hit.point.y, point[2] - hit.point.z);
            if (distance < bestDistance) {
              best = id;
              bestDistance = distance;
            }
          }
          const point = mesh.vertices[best];
          const screen = this.visible(point);
          if (!screen) continue;
          const normal = mesh.vertexNormals[best];
          const key = `${Math.round(normal[0] * 2)},${Math.round(normal[1] * 2)},${Math.round(normal[2] * 2)}`;
          const list = buckets.get(key) || [];
          if (list.some((item) => Math.hypot(item.point[0] - point[0], item.point[1] - point[1], item.point[2] - point[2]) < 3)) continue;
          list.push({ point, screen });
          buckets.set(key, list);
        }
      }
      const lists = [...buckets.values()].sort((a, b) => b.length - a.length);
      for (const list of lists) {
        if (list.length >= count) return list.slice(0, count).map((item) => item.screen);
      }
      return [];
    },
    visible(point) {
      const screen = this.project(point);
      if (screen.behind) return null;
      const top = document.elementFromPoint(screen.x, screen.y);
      if (!top || top.id !== "view") return null;
      const hit = this.hit(screen.x, screen.y);
      if (!hit) return null;
      const dx = hit.point.x - point[0];
      const dy = hit.point.y - point[1];
      const dz = hit.point.z - point[2];
      if (dx * dx + dy * dy + dz * dz > 0.16) return null;
      return { x: screen.x, y: screen.y };
    },
  };
}

function indexLoadedModel(group) {
  let found = null;
  group.traverse((obj) => {
    if (found || !obj.isMesh) return;
    const position = obj.geometry.attributes.position.array;
    const index = obj.geometry.index ? obj.geometry.index.array : null;
    found = buildMesh(position, index);
  });
  state.meshIndex = found;
}

async function chooseModelUrl() {
  const demo = new URL("../models/milkyway.obj", import.meta.url).href;
  const host = location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return demo;
  try {
    const live = new URL("../models/live.obj", import.meta.url);
    const response = await fetch(live.href, { method: "HEAD", cache: "no-store" });
    if (response.ok) return live.href;
  } catch {
    /* example model */
  }
  return demo;
}

function geometryFromDraft() {
  const points = state.draftPoints.map((hit) => hit.point);
  const color = nextColor();
  const base = {
    id: `geo-${Date.now().toString(36)}-${state.setup.geometries.length}`,
    color,
    lineWidth: 2.5,
    opacity: 0.9,
    attach: "center",
    points,
  };
  if (state.tool === "circle3") {
    const circle = circleFromThreePoints(points[0], points[1], points[2]);
    if (!circle) return null;
    return { ...base, type: "circle", mode: "3", ...circle };
  }
  if (state.tool === "circle2") {
    const circle = circleFromCenterAndEdge(points[0], points[1], state.draftPoints[0].normal);
    if (!circle) return null;
    return { ...base, type: "circle", mode: "center", normal: circle.normal, ...circle };
  }
  const rect = rectangleFromThreePoints(points[0], points[1], points[2]);
  if (!rect) return null;
  return { ...base, type: "rect", mode: "rect", normal: rect.normal, corners: rect.corners };
}

function nextColor() {
  const used = new Set(state.setup.geometries.map((geometry) => geometry.color));
  return GEOMETRY_PALETTE.find((color) => !used.has(color)) || GEOMETRY_PALETTE[state.setup.geometries.length % GEOMETRY_PALETTE.length];
}

function recomputeGeometry(geometry) {
  if (geometry.type === "circle" && geometry.mode === "center" && geometry.points.length >= 2) {
    const circle = circleFromCenterAndEdge(geometry.points[0], geometry.points[1], geometry.normal || { x: 0, y: 1, z: 0 });
    if (!circle) return;
    geometry.center = circle.center;
    geometry.normal = circle.normal;
    geometry.radius = circle.radius;
    return;
  }
  if (geometry.type === "circle" && geometry.points.length >= 3) {
    const circle = circleFromThreePoints(geometry.points[0], geometry.points[1], geometry.points[2]);
    if (!circle) return;
    geometry.center = circle.center;
    geometry.normal = circle.normal;
    geometry.radius = circle.radius;
    return;
  }
  if (geometry.type === "rect" && geometry.points.length >= 3) {
    const rect = rectangleFromThreePoints(geometry.points[0], geometry.points[1], geometry.points[2]);
    if (!rect) return;
    geometry.corners = rect.corners;
    geometry.normal = rect.normal;
  }
}

function rebuildGeometries() {
  if (!geometryRoot) return;
  for (const group of geometryGroups.values()) geometryRoot.remove(group);
  geometryGroups.clear();
  const drawn = [...(state.setup?.geometries || [])];
  if (state.preview) drawn.push(state.preview);
  for (const geometry of drawn) {
    const group = new THREE.Group();
    group.renderOrder = 2;
    group.userData.geometryId = geometry.id;
    group.userData.kind = geometry.type === "slot" ? "stadium" : geometry.type;
    group.traverse((obj) => {
      obj.userData.geometryId = geometry.id;
    });
    const lift = geometry.normal ? scale(normalize(geometry.normal) || geometry.normal, 0.4) : { x: 0, y: 0, z: 0 };
    if (geometry.type === "circle" && geometry.center && geometry.radius) {
      group.add(circleMesh(add(geometry.center, lift), geometry.normal, geometry.radius, geometry));
    }
    if ((geometry.type === "cylinder" || geometry.type === "cone") && geometry.center && geometry.radius && geometry.normal) {
      const axis = normalize(geometry.normal);
      const start = geometry.start
        ? add(geometry.start, lift)
        : add(add(geometry.center, lift), scale(axis, -((geometry.length || 0) / 2)));
      const end = add(start, scale(axis, geometry.length || 0));
      group.add(circleMesh(start, axis, geometry.radius, geometry));
      if (geometry.length) {
        group.add(circleMesh(end, axis, geometry.endRadius ?? geometry.radius, geometry));
        group.add(segmentMesh(start, end, axis, geometry));
      }
    }
    if (geometry.type === "slot" && geometry.center && geometry.radius && geometry.normal && geometry.direction) {
      group.add(stadiumMesh(add(geometry.center, lift), geometry.direction, geometry.normal, geometry.radius, geometry.length || geometry.radius * 2, geometry));
    }
    if (geometry.type === "sphere" && geometry.center && geometry.radius) {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(geometry.radius, 32, 16),
        new THREE.MeshBasicMaterial({ color: geometry.color, transparent: true, opacity: geometry.opacity * 0.25, depthWrite: false }),
      );
      sphere.position.set(geometry.center.x, geometry.center.y, geometry.center.z);
      group.add(sphere);
    }
    if (geometry.type === "plane" && geometry.center && geometry.normal) {
      const radius = Math.max(geometry.drawRadius || geometry.radius || 20, 4);
      group.add(circleMesh(add(geometry.center, lift), geometry.normal, radius, geometry));
    }
    if (geometry.type === "line" && geometry.center && geometry.direction && geometry.length) {
      const dir = normalize(geometry.direction);
      const start = add(geometry.center, scale(dir, -geometry.length / 2));
      const end = add(geometry.center, scale(dir, geometry.length / 2));
      group.add(segmentMesh(add(start, lift), add(end, lift), geometry.normal, geometry));
    }
    if (geometry.type === "rect" && geometry.corners?.length === 4) {
      group.add(rectMesh(geometry.corners.map((point) => add(point, lift)), geometry));
    }
    geometryRoot.add(group);
    geometryGroups.set(geometry.id, group);
  }
}

function stadiumMesh(center, direction, normal, radius, length, geometry) {
  const dir = normalize(direction);
  const n = normalize(normal);
  const side = dir && n ? normalize(cross(n, dir)) : null;
  const group = new THREE.Group();
  if (!dir || !side) return group;
  const span = Math.max(length - 2 * radius, 0);
  const c1 = add(center, scale(dir, -span / 2));
  const c2 = add(center, scale(dir, span / 2));
  const steps = 18;
  const loop = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = Math.PI / 2 + (Math.PI * i) / steps;
    loop.push(add(c1, add(scale(dir, Math.cos(angle) * radius), scale(side, Math.sin(angle) * radius))));
  }
  for (let i = 0; i <= steps; i += 1) {
    const angle = -Math.PI / 2 + (Math.PI * i) / steps;
    loop.push(add(c2, add(scale(dir, Math.cos(angle) * radius), scale(side, Math.sin(angle) * radius))));
  }
  const positions = [];
  const indices = [];
  const thickness = Math.max(0.45, geometry.lineWidth * 0.55);
  for (let i = 0; i < loop.length; i += 1) {
    const current = loop[i];
    const next = loop[(i + 1) % loop.length];
    const edge = normalize({ x: next.x - current.x, y: next.y - current.y, z: next.z - current.z });
    if (!edge) continue;
    const outward = normalize(cross(n, edge)) || side;
    const innerA = add(current, scale(outward, -thickness / 2));
    const outerA = add(current, scale(outward, thickness / 2));
    const innerB = add(next, scale(outward, -thickness / 2));
    const outerB = add(next, scale(outward, thickness / 2));
    const base = positions.length / 3;
    for (const point of [innerA, outerA, innerB, outerB]) positions.push(point.x, point.y, point.z);
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  group.add(meshFrom(positions, indices, geometry.color, geometry.opacity, true));
  const fill = [center.x, center.y, center.z];
  const fillIndex = [];
  loop.forEach((point, index) => {
    fill.push(point.x, point.y, point.z);
    if (index < loop.length - 1) fillIndex.push(0, index + 1, index + 2);
  });
  fillIndex.push(0, loop.length, 1);
  group.add(meshFrom(fill, fillIndex, geometry.color, geometry.opacity * 0.22, false));
  group.userData.kind = "stadium";
  return group;
}

function segmentMesh(start, end, normal, geometry) {
  const dir = normalize({ x: end.x - start.x, y: end.y - start.y, z: end.z - start.z });
  const group = new THREE.Group();
  if (!dir) return group;
  const n = normalize(normal) || { x: 0, y: 1, z: 0 };
  const side = normalize(cross(dir, n)) || { x: 1, y: 0, z: 0 };
  const offset = scale(side, Math.max(0.45, geometry.lineWidth * 0.45));
  const a = add(start, offset);
  const b = add(start, scale(offset, -1));
  const c = add(end, offset);
  const d = add(end, scale(offset, -1));
  group.add(meshFrom(
    [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z],
    [0, 1, 2, 1, 3, 2],
    geometry.color,
    geometry.opacity,
    true,
  ));
  return group;
}

function circleMesh(center, normal, radius, geometry) {
  const basis = basisFromNormal(normal);
  const group = new THREE.Group();
  if (!basis) return group;
  const segments = 96;
  const thickness = Math.max(0.45, geometry.lineWidth * 0.55);
  const positions = [];
  const indices = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    const dir = add(scale(basis.u, Math.cos(t)), scale(basis.v, Math.sin(t)));
    const inner = add(center, scale(dir, Math.max(0.05, radius - thickness / 2)));
    const outer = add(center, scale(dir, radius + thickness / 2));
    positions.push(inner.x, inner.y, inner.z, outer.x, outer.y, outer.z);
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  group.add(meshFrom(positions, indices, geometry.color, geometry.opacity, true));
  const fillPositions = [center.x, center.y, center.z];
  const fillIndices = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    const dir = add(scale(basis.u, Math.cos(t)), scale(basis.v, Math.sin(t)));
    const point = add(center, scale(dir, radius));
    fillPositions.push(point.x, point.y, point.z);
    if (i < segments) fillIndices.push(0, i + 1, i + 2);
  }
  group.add(meshFrom(fillPositions, fillIndices, geometry.color, geometry.opacity * 0.22, false));
  return group;
}

function rectMesh(corners, geometry) {
  const group = new THREE.Group();
  const [a, b, c, d] = corners;
  const positions = [a, b, c, a, c, d].flatMap((point) => [point.x, point.y, point.z]);
  const indices = [0, 1, 2, 3, 4, 5];
  group.add(meshFrom(positions, indices, geometry.color, geometry.opacity * 0.28, false));
  const loop = [a, b, b, c, c, d, d, a];
  const linePositions = [];
  const lineIndices = [];
  const thickness = Math.max(0.35, geometry.lineWidth * 0.4);
  const normal = geometry.normal || { x: 0, y: 1, z: 0 };
  for (let i = 0; i < loop.length; i += 2) {
    const start = loop[i];
    const end = loop[i + 1];
    const dir = normalize({ x: end.x - start.x, y: end.y - start.y, z: end.z - start.z });
    if (!dir) continue;
    const side = scale(normalize(cross(dir, normal)) || { x: 1, y: 0, z: 0 }, thickness / 2);
    const base = linePositions.length / 3;
    for (const point of [add(start, side), add(start, scale(side, -1)), add(end, side), add(end, scale(side, -1))]) {
      linePositions.push(point.x, point.y, point.z);
    }
    lineIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  group.add(meshFrom(linePositions, lineIndices, geometry.color, geometry.opacity, true));
  return group;
}

function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function meshFrom(positions, indices, color, opacity, polygonOffset) {
  const buffer = new THREE.BufferGeometry();
  buffer.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  buffer.setIndex(indices);
  buffer.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: polygonOffset,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(buffer, material);
  mesh.renderOrder = 2;
  return mesh;
}

function updateSelectedGeometry(patch) {
  const geometry = state.setup.geometries.find((item) => item.id === state.selectedGeometryId);
  if (!geometry) return;
  Object.assign(geometry, patch);
  const anchor = state.setup.placements[state.selectedId]?.anchor;
  if (anchor?.geometryId === geometry.id && patch.attach) anchor.attach = patch.attach;
  rebuildGeometries();
  updateLeaders();
}

function deleteSelectedGeometry() {
  const id = state.selectedGeometryId;
  if (!id) return;
  state.setup.geometries = state.setup.geometries.filter((geometry) => geometry.id !== id);
  for (const placement of Object.values(state.setup.placements)) {
    if (placement.anchor?.geometryId === id) placement.anchor = null;
  }
  state.selectedGeometryId = null;
  rebuildGeometries();
  syncEditor();
  updateLeaders();
}

function pickSurface(event) {
  const rect = els.view.getBoundingClientRect();
  if (!rect.width || !rect.height || !state.model) return null;
  pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  camera.updateMatrixWorld();
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObject(state.model, true);
  if (!hits.length) return null;
  const hit = hits[0];
  let normal = { x: 0, y: 1, z: 0 };
  if (hit.face?.normal) {
    const world = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    normal = { x: world.x, y: world.y, z: world.z };
  }
  return {
    point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
    normal,
    faceIndex: hit.faceIndex ?? 0,
  };
}

function syncChrome() {
  const live = state.dataMode === "live";
  els.dataBadge.textContent = live ? "Live" : "Beispieldaten";
  els.dataBadge.classList.toggle("is-live", live);
  els.setupBadge.hidden = false;
  els.setupBadge.textContent = state.usingDraft ? "Lokaler Entwurf" : "Veröffentlichte Ansicht";
  els.setupBadge.classList.toggle("is-draft", state.usingDraft);
  els.setupBadge.classList.toggle("is-published", !state.usingDraft);
  els.setupBadge.title = state.usingDraft
    ? "Diese Ansicht liegt nur in diesem Browser. Export ersetzen und data/layout.json veroeffentlichen, damit alle sie sehen."
    : "Ansicht aus data/layout.json. Vorbereiten und Abschliessen speichert einen Entwurf nur auf diesem Rechner.";
  if (state.data?.part?.name) els.partName.textContent = state.data.part.name;
  const template = state.dataMode === "live" ? state.data?.part?.template : null;
  if (els.templateBadge) {
    els.templateBadge.hidden = !template?.name;
    els.templateBadge.textContent = template?.name ? `Vorlage: ${template.name}` : "";
  }
  els.prepare.hidden = state.edit;
  els.finish.hidden = !state.edit;
  els.discard.hidden = !state.edit;
  els.prepare.setAttribute("aria-pressed", String(state.edit));
  if (state.setup && document.activeElement !== els.refreshSeconds) {
    els.refreshSeconds.value = String(state.setup.refreshSeconds || 60);
  }
}

function syncEditor() {
  if (!state.edit || !state.data) return;
  const keys = Object.keys(state.setup.placements);
  const previous = state.selectedId;
  els.charSelect.replaceChildren();
  for (const key of keys) {
    const option = document.createElement("option");
    option.value = key;
    const characteristic = characteristicFor(key);
    option.textContent = characteristic?.name || key;
    els.charSelect.append(option);
  }
  if (previous && keys.includes(previous)) els.charSelect.value = previous;
  else state.selectedId = els.charSelect.value || null;
  els.charList.replaceChildren();
  for (const characteristic of state.data.characteristics) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.char = characteristic.id;
    const feature = state.data.features.find((item) => item.name === characteristic.objectName);
    button.textContent = feature?.type ? `${characteristic.name} (${feature.type})` : characteristic.name;
    els.charList.append(button);
  }
  const geometry = state.setup.geometries.find((item) => item.id === state.selectedGeometryId);
  els.geoPanel.hidden = !geometry;
  if (geometry) {
    els.geoColor.value = geometry.color;
    els.geoWidth.value = String(geometry.lineWidth);
    els.geoOpacity.value = String(geometry.opacity);
    els.geoAttach.value = geometry.attach || "center";
  }
  writeTemplateForm();
}

function writeTemplateForm() {
  const template = state.setup.labelTemplate;
  for (const input of els.templateForm.querySelectorAll("[data-key]")) {
    const key = input.dataset.key;
    if (input.type === "checkbox") input.checked = Boolean(template[key]);
    else if (document.activeElement !== input) input.value = String(template[key]);
  }
}

function readTemplateForm() {
  const template = { ...state.setup.labelTemplate };
  for (const input of els.templateForm.querySelectorAll("[data-key]")) {
    const key = input.dataset.key;
    if (input.type === "checkbox") template[key] = input.checked;
    else if (key === "decimals") template[key] = Number(input.value);
    else template[key] = input.value;
  }
  state.setup.labelTemplate = normalizeTemplate(template);
  refreshFlagContents();
  if (!cameraIsSaved) autoPlace();
  applyAllPositions();
}

function markSelection() {
  for (const article of els.flags.querySelectorAll(".flag")) {
    const selected = state.edit && article.dataset.id === state.selectedId;
    article.classList.toggle("is-selected", selected);
    article.classList.toggle("is-unassigned", Boolean(state.edit) && !anchorWorld(article.dataset.id));
  }
  if (els.reconnect) els.reconnect.hidden = !(state.edit && state.selectedId);
}

function updateHint() {
  els.hint.hidden = true;
}

function onChartHover(event) {
  const mark = event.target.closest?.(".pt, .bar");
  const article = event.target.closest?.(".flag");
  if (!mark || !article) {
    hideChartTip();
    return;
  }
  const characteristic = characteristicFor(article.dataset.id);
  const samples = characteristic ? windowOf(characteristic.measurements) : [];
  const sample = samples[Number(mark.dataset.i)];
  if (!characteristic || !sample) {
    hideChartTip();
    return;
  }
  chartTip.innerHTML = tooltipHtml(characteristic, sample);
  chartTip.hidden = false;
  const x = Math.min(event.clientX + 14, window.innerWidth - 300);
  const y = Math.min(event.clientY + 16, window.innerHeight - 180);
  chartTip.style.left = `${x}px`;
  chartTip.style.top = `${y}px`;
}

function hideChartTip() {
  chartTip.hidden = true;
}

function tooltipHtml(characteristic, sample) {
  const fmt = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const when = formatStamp(sample.timestamp);
  const created = formatStamp(sample.creationDateUser);
  const deviation = sample.value - characteristic.nominal;
  const outside = sample.value > characteristic.usl || sample.value < characteristic.lsl;
  const props = Object.entries(sample.userProperties || {})
    .map(([key, value]) => `<div>${escapeHtml(key)}: ${escapeHtml(value)}</div>`)
    .join("");
  return [
    `<div><strong>${escapeHtml(sample.pieceName || sample.pieceId || "Teil")}</strong></div>`,
    `<div>Istwert: ${fmt.format(sample.value)} ${escapeHtml(characteristic.unit)}</div>`,
    `<div>Abweichung: ${deviation >= 0 ? "+" : ""}${fmt.format(deviation)} ${escapeHtml(characteristic.unit)}</div>`,
    `<div>${outside ? "ausser Toleranz" : "in Toleranz"}</div>`,
    when ? `<div>Messzeit: ${escapeHtml(when)}</div>` : "",
    created ? `<div>Erstellt: ${escapeHtml(created)}</div>` : "",
    props,
  ].join("");
}

function formatStamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2800);
}

function fail(message) {
  els.loading.hidden = false;
  els.loadingText.textContent = message;
  const spinner = els.loading.querySelector(".spinner");
  if (spinner) spinner.hidden = true;
  document.body.dataset.ready = "error";
  document.body.dataset.error = message;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function roundVec(value) {
  return { x: round(value.x, 3), y: round(value.y, 3), z: round(value.z, 3) };
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
