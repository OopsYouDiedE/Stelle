import type { CursorContext } from "../../types.js";
import type { DeviceActionDecision, DeviceActionIntent } from "../../../device/action_types.js";

export class BrowserExecutor {
  constructor(private readonly context: CursorContext) {}

  async execute(intent: DeviceActionIntent): Promise<DeviceActionDecision> {
    if (!this.context.deviceAction) {
      return { status: "rejected", reason: "DeviceActionArbiter is not configured.", intent };
    }
    return this.context.deviceAction.propose(intent);
  }
}
