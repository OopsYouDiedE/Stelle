import "dotenv/config";
import { stelle } from "./stelle/instance.js";

console.log("[Stelle] Core subject activated.");

await import("./cursors/discord/app.js");

console.log(
  `[Stelle] Discord window activated. Registered windows: ${
    (await stelle.snapshot()).windows.registeredCursorIds.join(", ") || "none"
  }`
);
