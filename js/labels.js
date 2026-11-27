export function controlLabel(control) {
  const objectName = String(control?.objectName || "").trim();
  const name = String(control?.name || control?.controlName || "").trim();
  const id = String(control?.id || "");
  const bare = !name || name === id || /^[0-9a-f]{8}-[0-9a-f-]{8,}$/i.test(name) || /^[0-9a-f]{16,}$/i.test(name);
  if (objectName && name && !bare) {
    if (name === objectName || name.startsWith(`${objectName} / `)) return name;
    return `${objectName} / ${name}`;
  }
  const given = String(control?.label || "").trim();
  if (given && !/^[0-9a-f-]{16,}$/i.test(given)) return given;
  const short = id.replace(/-/g, "").slice(0, 8) || "?";
  return `unbenannt (${short})`;
}
