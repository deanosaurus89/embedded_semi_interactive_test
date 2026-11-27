const LARGE_BYTES = 50 * 1024 * 1024;

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
  cap: document.getElementById("control-cap"),
  controls: document.getElementById("control-results"),
  apply: document.getElementById("controls-apply"),
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

export function startWizard({ apply }) {
  onApply = apply;
  els.root.hidden = false;
  showPanel("search");
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
  for (const button of els.root.querySelectorAll("[data-wizard-step]")) {
    button.addEventListener("click", () => showPanel(button.dataset.wizardStep));
  }
  loadSettings().catch(() => {});
}

function showPanel(name) {
  for (const panel of els.root.querySelectorAll("[data-panel]")) {
    panel.hidden = panel.dataset.panel !== name;
  }
  for (const button of els.root.querySelectorAll("[data-wizard-step]")) {
    button.classList.toggle("is-current", button.dataset.wizardStep === name);
  }
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
    els.choiceTitle.textContent = `${project.name}: keine Teilevorlage, bitte ein Teil wählen.`;
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
    const label = document.createElement("label");
    label.className = "pick";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !duplicate && !large;
    box.dataset.hash = model.hash;
    box.dataset.name = model.name;
    const text = document.createElement("span");
    const notes = [formatBytes(model.sizeBytes)];
    if (duplicate) notes.push("gleiche Datei");
    if (large) notes.push("über 50 MB");
    text.innerHTML = `${escapeHtml(model.name)} <span class="${large ? "meta warn" : "meta"}">${escapeHtml(notes.filter(Boolean).join(" · "))}</span>`;
    label.append(box, text);
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
}

async function openControls() {
  clearError();
  const selected = selectedModels();
  if (!selected.length) throw new Error("Mindestens ein Referenzobjekt auswählen.");
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
    const text = document.createElement("span");
    const title = control.objectName ? `${control.objectName} / ${control.name}` : control.name || control.id;
    text.innerHTML = `${escapeHtml(title)} <span class="meta">${escapeHtml(control.type || "")}</span>`;
    label.append(box, text);
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
  els.cap.textContent = `${chosen} von ${cap}`;
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
  const models = selectedModels();
  const controls = selectedControls();
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
