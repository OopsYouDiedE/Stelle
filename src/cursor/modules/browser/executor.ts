// === Imports ===
import type { CursorContext } from "../../types.js";
import { DeviceObservationExecutor } from "../device_observation_parts.js";

// === Executor Implementation ===
export class BrowserExecutor extends DeviceObservationExecutor {
  constructor(context: CursorContext) {
    super(context);
  }
}
