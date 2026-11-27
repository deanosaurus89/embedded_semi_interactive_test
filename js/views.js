const NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function viewNameOk(name) {
  return NAME.test(String(name || "").trim());
}

export function viewDocument(source) {
  const name = String(source?.name || "").trim();
  if (!viewNameOk(name)) throw new Error("Ansichtsname: Buchstaben, Ziffern, - und _.");
  return {
    schemaVersion: 2,
    name,
    title: source.title || name,
    projectId: source.projectId || "",
    projectName: source.projectName || "",
    templateId: source.templateId || null,
    templateName: source.templateName || "",
    pieceId: source.pieceId || null,
    models: (source.models || []).filter((model) => model?.hash).map((model) => ({
      name: model.name || model.hash,
      hash: String(model.hash),
      enabled: model.enabled !== false,
    })),
    labelSize: source.labelSize === "small" ? "small" : "normal",
    controls: (source.controls || []).filter((control) => control?.id).map((control) => ({
      id: String(control.id),
      objectName: control.objectName || "",
      name: control.name || "",
      nominal: numberOrNull(control.nominal),
      usl: numberOrNull(control.usl),
      lsl: numberOrNull(control.lsl),
      unit: control.unit || "mm",
      color: control.color || "",
      selected: control.selected !== false,
    })),
    placements: source.placements && typeof source.placements === "object" ? source.placements : {},
    geometries: Array.isArray(source.geometries) ? source.geometries : [],
    camera: source.camera || null,
    pollSeconds: Number(source.pollSeconds) > 0 ? Number(source.pollSeconds) : 60,
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
