import { controlLabel } from "../js/labels.js";

const named = controlLabel({ id: "ctl-1", objectName: "Langloch 1", name: "Mating Length 1" });
if (named !== "Langloch 1 / Mating Length 1") throw new Error(named);
const second = controlLabel({ id: "ctl-2", objectName: "Zylinder 4", name: "Position 1", type: "Position" });
if (second !== "Zylinder 4 / Position 1") throw new Error(second);
const bare = controlLabel({ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", objectName: "", name: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
if (!bare.startsWith("unbenannt (aaaaaaaa)")) throw new Error(bare);
console.log("labels ok");
