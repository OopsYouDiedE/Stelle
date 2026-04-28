import { truncateText } from "../../../utils/text.js";
import type { DeviceActionDecision } from "../../../device/action_types.js";

export class BrowserResponder {
  summarize(decision: DeviceActionDecision): string {
    return `Browser action ${decision.status}: ${truncateText(decision.reason, 80)}`;
  }
}
