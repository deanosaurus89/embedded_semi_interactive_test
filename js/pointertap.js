export function tapSlop(pointerType) {
  return pointerType === "mouse" ? 8 : 24;
}
export function tapMaxMs(pointerType) {
  return pointerType === "mouse" ? 700 : 900;
}
export function isPickTap(o) {
  if (o.multi) return false;
  const wide = !!o.wide && o.pointerType !== "mouse";
  const slop = wide ? tapSlop("touch") : tapSlop("mouse");
  const max = wide ? tapMaxMs("touch") : tapMaxMs("mouse");
  if (!(o.dt >= 0) || o.dt > max) return false;
  return o.moved <= slop;
}
export function pickGesture(o) {
  if (o.dragged) return "ignore";
  return isPickTap(o) ? "pick" : "ignore";
}
