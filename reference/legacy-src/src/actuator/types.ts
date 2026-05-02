// === Actuator Types ===
export type ActuatorAction = "accept" | "queue" | "interrupt" | "drop" | "reject";

export interface ActuatorPolicyDecision {
  action: ActuatorAction;
  reason: string;
}
