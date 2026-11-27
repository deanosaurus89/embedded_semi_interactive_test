import { controlLabel } from "./labels.js";

const LARGE_BYTES = 50 * 1024 * 1024;
const HUGE_BYTES = 300 * 1024 * 1024;

const els = {
  root: document.getElementById("wizard"),
  error: document.getElementById("wizard-error"),
  settingsPanel: document.getElementById("wizard-settings-panel"),
  settingsBtn: document.getElementById("wizard-settings"),
  server: document.getElementById("settings-server"),
  token: document.getElementById("settings-token"),
  poll: document.getElementById("settings-poll"),
  save: document.getElementById("settings-save"),
  q: document.getElementById("project-q"),
  ws: document.getElementById("project-ws"),
  search: document.getElementById("project-search"),
  more: document.getElementById("project-more"),
  projects: document.getElementById("project-results"),
  choiceTitle: document.getElementById("choice-title"),
  templates: document.getElementById("template-results"),
  showPieces: document.getElementById("show-pieces"),
  pieceSearch: document.getElementById("piece-search"),
  pieceQ: document.getElementById("piece-q"),
  pieceGo: document.getElementById("piece-go"),
  pieces: document.getElementById("piece-results"),
  models: document.getElementById("model-results"),
  modelsNext: document.getElementById("models-next"),
  small: document.getElementById("small-labels"),
  smallWrap: document.getElementById("small-wrap"),
  cap: document.getElementById("control-cap"),
  controlQ: document.getElementById("control-q"),
  controls: document.getElementById("control-results"),
  apply: document.getElementById("controls-apply"),
  back: document.getElementById("wizard-back"),
  title: document.querySelector("#wizard .wizard-head h2"),
};

const picked = {
  project: null,
  template: null,
  piece: null,
  models: [],
  controls: [],
  skip: 0,
  total: 0,
};

let onApply = () => {};
let onPreview = () => {};
let onStepChange = () => {};
let previewToken = 0;
let loadedToast = 0;

export function labelCap(small) {
  return small ? 20 : 10;
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export function startWizard({ apply, previewModels, onStep }) {
  onApply = apply;
  onPreview = previewModels || (() => {});
  onStepChange = onStep || (() => {});
  els.root.hidden = false;
  showPanel("search");
  document.addEventListener("wizard-go", (event) => {
    if (!event.detail) return;
    showPanel(event.detail);
  });
  els.settingsBtn.addEventListener("click", () => {
    els.settingsPanel.hidden = !els.settingsPanel.hidden;
    if (!els.settingsPanel.hidden) loadSettings().catch((error) => fail(error));
  });
  els.save.addEventListener("click", () => saveSettings().catch((error) => fail(error)));
  els.search.addEventListener("click", () => {
    picked.skip = 0;
    searchProjects().catch((error) => fail(error));
  });
  els.more.addEventListener("click", () => {
    picked.skip += 20;
    searchProjects().catch((error) => fail(error));
  });
  els.q.addEventListener("keydown", (event) => {
    if (event.key === "Enter") els.search.click();
  });
  els.showPieces.addEventListener("click", () => {
    els.pieceSearch.hidden = false;
    loadPieces().catch((error) => fail(error));
  });
  els.pieceGo.addEventListener("click", () => loadPieces().catch((error) => fail(error)));
  els.modelsNext.addEventListener("click", () => openControls().catch((error) => fail(error)));
  if (els.back) {
    els.back.addEventListener("click", () => {
      const order = ["search", "choice", "models", "controls"];
      const current = order.find((name) => els.root.querySelector(`[data-panel="${name}"]`) && !els.root.querySelector(`[data-panel="${name}"]`).hidden) || "search";
      const index = Math.max(0, order.indexOf(current) - 1);
      showPanel(order[index]);
    });
  }
  if (els.controlQ) {
    els.controlQ.addEventListener("input", () => {
      const query = els.controlQ.value.trim().toLowerCase();
      for (const item of els.controls.querySelectorAll("li")) {
        item.hidden = query ? !item.textContent.toLowerCase().includes(query) : false;
      }
    });
  }
  els.small.addEventListener("change", () => {
    const keep = new Set([...els.controls.querySelectorAll("input:checked")].map((box) => box.dataset.id));
    renderControls(picked.controls);
    const cap = labelCap(els.small.checked);
    let count = 0;
    for (const box of els.controls.querySelectorAll("input")) {
      if (!keep.has(box.dataset.id) || count >= cap) continue;
      box.checked = true;
      count += 1;
    }
    updateCap();
  });
  els.apply.addEventListener("click", () => finish().catch((error) => fail(error)));
  loadSettings().catch(() => {});
}

function showPanel(name) {
  els.root.hidden = false;
  const titles = {
    search: "Projekt suchen",
    choice: "Teilevorlage wählen",
    models: "Referenzobjekt wählen",
    controls: "Merkmale auswählen",
  };
  if (els.title && titles[name]) els.title.textContent = titles[name];
  if (name !== "models") {
    const toast = document.getElementById("toast");
    if (toast) toast.hidden = true;
  }
  for (const panel of els.root.querySelectorAll("[data-panel]")) {
    panel.hidden = panel.dataset.panel !== name;
  }
  if (els.modelsNext) els.modelsNext.hidden = name !== "models";
  if (els.apply) els.apply.hidden = name !== "controls";
  if (els.smallWrap) els.smallWrap.hidden = name !== "controls";
  if (els.back) els.back.hidden = name === "search";
  onStepChange(name);
}

function fail(error) {
  els.error.hidden = false;
  els.error.textContent = error?.message || String(error);
}

function clearError() {
  els.error.hidden = true;
  els.error.textContent = "";
}

async function api(path, options) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) throw new Error(body?.error || `Anfrage fehlgeschlagen (${response.status})`);
  return body;
}

async function loadSettings() {
  const settings = await api("/api/settings");
  els.server.value = settings.server || "";
  els.poll.value = String(settings.pollSeconds || 60);
  els.token.value = "";
  els.token.placeholder = settings.tokenSet ? "Token ist gespeichert" : "Personal Access Token";
}

async function saveSettings() {
  clearError();
  const payload = {
    server: els.server.value.trim(),
    pollSeconds: Number(els.poll.value) || 60,
  };
  if (els.token.value) payload.token = els.token.value;
  await api("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  els.token.value = "";
  await loadSettings();
  els.error.hidden = false;
  els.error.textContent = "Einstellungen gespeichert.";
}

async function searchProjects() {
  clearError();
  const params = new URLSearchParams();
  params.set("q", els.q.value.trim());
  params.set("workspace", els.ws.value.trim());
  params.set("top", "20");
  params.set("skip", String(picked.skip));
  const page = await api(`/api/projects?${params.toString()}`);
  picked.total = Number(page.total) || 0;
  if (picked.skip === 0) els.projects.replaceChildren();
  for (const project of page.items || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<span>${escapeHtml(project.name)}</span><span class="meta">${escapeHtml(project.workspaceName || "")}</span>`;
    button.addEventListener("click", () => chooseProject(project).catch((error) => fail(error)));
    const item = document.createElement("li");
    item.append(button);
    els.projects.append(item);
  }
  if (!page.items?.length) {
    const item = document.createElement("li");
    item.textContent = "Kein Projekt.";
    els.projects.append(item);
  }
  els.more.hidden = picked.skip + (page.items || []).length >= picked.total;
}

async function chooseProject(project) {
  clearError();
  picked.project = project;
  picked.template = null;
  picked.piece = null;
  els.choiceTitle.textContent = project.name;
  const templates = await api(`/api/projects/${encodeURIComponent(project.id)}/templates`);
  const list = Array.isArray(templates) ? templates : templates.items || [];
  els.templates.replaceChildren();
  els.pieces.replaceChildren();
  els.pieceSearch.hidden = list.length > 0;
  els.showPieces.hidden = list.length === 0;
  if (!list.length) {
    els.choiceTitle.textContent = `${project.name}: keine Teilevorlage. Es gelten später nur Teile dieses Projekts ohne Vorlage, deren Kontroll-UUIDs genau dem gewählten Teil entsprechen.`;
    showPanel("choice");
    await loadPieces();
    return;
  }
  for (const template of list) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<span>${escapeHtml(template.name)}</span><span class="meta">${Number(template.pieceCount) || 0} Teile</span>`;
    button.addEventListener("click", () => chooseTemplate(template).catch((error) => fail(error)));
    const item = document.createElement("li");
    item.append(button);
    els.templates.append(item);
  }
  showPanel("choice");
}

async function loadPieces() {
  clearError();
  if (picked.project) els.choiceTitle.textContent = `${picked.project.name}: Teile ohne Vorlage. Live-Daten nutzen nur Teile mit genau denselben Kontroll-UUIDs.`;
  els.pieceSearch.hidden = false;
  const params = new URLSearchParams();
  params.set("unlinked", "1");
  params.set("q", els.pieceQ.value.trim());
  params.set("top", "40");
  const page = await api(`/api/projects/${encodeURIComponent(picked.project.id)}/pieces?${params.toString()}`);
  const list = Array.isArray(page) ? page : page.items || [];
  els.pieces.replaceChildren();
  for (const piece of list) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = piece.name || piece.id;
    button.addEventListener("click", () => choosePiece(piece).catch((error) => fail(error)));
    const item = document.createElement("li");
    item.append(button);
    els.pieces.append(item);
  }
  if (!list.length) {
    const item = document.createElement("li");
    item.textContent = "Kein Teil ohne Vorlage.";
    els.pieces.append(item);
  }
  showPanel("choice");
}

async function chooseTemplate(template) {
  picked.template = template;
  picked.piece = template.samplePieceId ? { id: template.samplePieceId, name: template.name } : null;
  if (!template.samplePieceId) throw new Error("Diese Vorlage hat kein Teil, daher kein Referenzobjekt.");
  await showModels(template.samplePieceId);
}

async function choosePiece(piece) {
  picked.template = null;
  picked.piece = piece;
  await showModels(piece.id);
}

async function showModels(pieceId) {
  clearError();
  const models = await api(`/api/pieces/${encodeURIComponent(pieceId)}/models`);
  picked.models = Array.isArray(models) ? models : models.items || [];
  const seen = new Map();
  els.models.replaceChildren();
  for (const model of picked.models) {
    const duplicate = seen.has(model.hash);
    seen.set(model.hash, true);
    const large = Number(model.sizeBytes) > LARGE_BYTES;
    const huge = Number(model.sizeBytes) > HUGE_BYTES;
    const label = document.createElement("label");
    label.className = "pick";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !duplicate && !large && !huge;
    box.dataset.hash = model.hash;
    box.dataset.name = model.name;
    box.dataset.size = String(Number(model.sizeBytes) || 0);
    box.addEventListener("change", () => {
      previewNow().catch((error) => fail(error));
    });
    const text = document.createElement("span");
    const notes = [formatBytes(model.sizeBytes)];
    if (duplicate) notes.push("gleiche Datei");
    if (huge) notes.push("über 300 MB, Bestätigung nötig");
    else if (large) notes.push("über 50 MB");
    text.innerHTML = `<span class="t">${escapeHtml(model.name)}</span> <span class="${large ? "meta warn" : "meta"}">${escapeHtml(notes.filter(Boolean).join(" · "))}</span>`;
    const status = document.createElement("span");
    status.className = "loaded-tag";
    status.hidden = true;
    label.append(box, text, status);
    const item = document.createElement("li");
    item.append(label);
    els.models.append(item);
  }
  if (!picked.models.length) {
    const item = document.createElement("li");
    item.textContent = "Keine Referenzobjekte.";
    els.models.append(item);
  }
  showPanel("models");
  previewNow().catch((error) => fail(error));
}

function markLoaded(models) {
  const hashes = new Set(models.map((model) => model.hash));
  for (const box of els.models.querySelectorAll("input")) {
    const tag = box.parentElement?.querySelector(".loaded-tag");
    if (!tag) continue;
    const on = box.checked && hashes.has(box.dataset.hash);
    tag.hidden = !on;
    tag.textContent = on ? "im 3D" : "";
  }
}

async function previewNow() {
  const token = ++previewToken;
  let models = selectedRecords();
  const huge = models.filter((model) => Number(model.sizeBytes) > HUGE_BYTES);
  if (huge.length && !confirmHuge(huge)) {
    for (const box of els.models.querySelectorAll("input:checked")) {
      if (Number(box.dataset.size) > HUGE_BYTES) box.checked = false;
    }
    models = selectedRecords();
  }
  markLoaded([]);
  await onPreview(models, (info) => {
    if (token !== previewToken) return;
    const bar = document.getElementById("load-progress");
    const label = document.getElementById("load-progress-label");
    const fill = document.querySelector("#load-progress-bar i") || document.getElementById("load-progress-bar");
    if (!bar) return;
    bar.hidden = false;
    const pct = info.total ? Math.min(100, Math.round((info.got / info.total) * 100)) : 0;
    if (label) label.textContent = info.total ? `${info.name}: ${pct}%` : `${info.name} wird geladen …`;
    if (fill && fill.tagName === "I") fill.style.width = info.total ? `${pct}%` : "40%";
  });
  if (token !== previewToken) return;
  const bar = document.getElementById("load-progress");
  if (bar) bar.hidden = true;
  markLoaded(models);
  if (models.length) {
    const toast = document.getElementById("toast");
    if (toast) {
      toast.hidden = false;
      toast.textContent = `${models[models.length - 1].name} geladen`;
      clearTimeout(loadedToast);
      loadedToast = setTimeout(() => { toast.hidden = true; }, 2200);
    }
  }
}

function confirmHuge(models) {
  const huge = models.filter((model) => Number(model.sizeBytes) > HUGE_BYTES);
  if (!huge.length) return true;
  return window.confirm(`${huge.map((model) => model.name).join(", ")} ist größer als 300 MB. In dieser Vorbereitung trotzdem laden?`);
}

function selectedRecords() {
  const byHash = new Map(picked.models.map((model) => [model.hash, model]));
  return selectedModels().map((model) => ({ ...model, sizeBytes: Number(byHash.get(model.hash)?.sizeBytes) || 0 }));
}

async function openControls() {
  clearError();
  const selected = selectedRecords();
  if (!selected.length) throw new Error("Mindestens ein Referenzobjekt auswählen.");
  if (!confirmHuge(selected)) throw new Error("Großes Modell nicht bestätigt.");
  const params = new URLSearchParams();
  if (picked.template?.id) params.set("templateId", picked.template.id);
  else params.set("pieceId", picked.piece.id);
  const controls = await api(`/api/controls?${params.toString()}`);
  picked.controls = Array.isArray(controls) ? controls : controls.items || [];
  renderControls(picked.controls);
  showPanel("controls");
}

function renderControls(controls) {
  const cap = labelCap(els.small.checked);
  els.controls.replaceChildren();
  let count = 0;
  for (const control of controls) {
    const label = document.createElement("label");
    label.className = "pick";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.id = control.id;
    box.addEventListener("change", () => {
      const chosen = els.controls.querySelectorAll("input:checked").length;
      if (chosen > cap) {
        box.checked = false;
        fail(new Error(cap === 10 ? "Höchstens 10 Merkmale. Kleine Beschriftungen erlaubt 20." : "Höchstens 20 Merkmale."));
      }
      updateCap();
    });
    label.classList.add("ctr");
    const objectName = document.createElement("span");
    objectName.className = "t";
    objectName.textContent = control.objectName || "";
    const name = document.createElement("span");
    name.textContent = control.name || control.controlName || "";
    const type = document.createElement("span");
    type.className = "s";
    type.textContent = control.type || "";
    const full = document.createElement("span");
    full.className = "full";
    full.textContent = control.label || controlLabel(control);
    label.append(box, objectName, name, type, full);
    const item = document.createElement("li");
    item.append(label);
    els.controls.append(item);
    count += 1;
  }
  if (!count) {
    const item = document.createElement("li");
    item.textContent = "Keine Merkmale.";
    els.controls.append(item);
  }
  updateCap();
}

function updateCap() {
  const cap = labelCap(els.small.checked);
  const chosen = els.controls.querySelectorAll("input:checked").length;
  els.cap.textContent = `${chosen} / ${cap}`;
  els.cap.classList.toggle("full", chosen >= cap);
}

function selectedModels() {
  const out = [];
  const seen = new Set();
  for (const box of els.models.querySelectorAll("input:checked")) {
    if (seen.has(box.dataset.hash)) continue;
    seen.add(box.dataset.hash);
    out.push({ name: box.dataset.name, hash: box.dataset.hash });
  }
  return out;
}

function selectedControls() {
  const byId = new Map(picked.controls.map((control) => [control.id, control]));
  const out = [];
  for (const box of els.controls.querySelectorAll("input:checked")) {
    const control = byId.get(box.dataset.id);
    if (control) out.push(control);
  }
  return out;
}

async function finish() {
  clearError();
  const models = selectedRecords();
  const controls = selectedControls();
  if (!confirmHuge(models)) throw new Error("Großes Modell nicht bestätigt.");
  const cap = labelCap(els.small.checked);
  if (!models.length) throw new Error("Mindestens ein Referenzobjekt auswählen.");
  if (!controls.length) throw new Error("Mindestens ein Merkmal auswählen.");
  if (controls.length > cap) throw new Error(`Höchstens ${cap} Merkmale.`);
  await onApply({
    project: picked.project,
    template: picked.template,
    piece: picked.piece,
    models,
    controls,
    smallLabels: els.small.checked,
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
