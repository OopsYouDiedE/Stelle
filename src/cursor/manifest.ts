import type { StartMode } from "../core/application.js";
import type { CursorContext, StelleCursor } from "./types.js";

// === Types ===
export type CursorRuntimeRequirement = "discord" | "live" | "browser" | "desktop_input" | "android";

// === Interfaces ===
export interface CursorModuleDefinition {
  id: string;
  kind: string;
  displayName: string;
  enabledInModes: StartMode[];
  requires?: CursorRuntimeRequirement[];
  create(context: CursorContext): StelleCursor;
}
