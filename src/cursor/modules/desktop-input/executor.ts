import type { CursorContext } from "../../types.js";
import { DeviceObservationExecutor } from "../device_observation_parts.js";

export class DesktopInputExecutor extends DeviceObservationExecutor {
  constructor(context: CursorContext) {
    super(context);
  }
}
