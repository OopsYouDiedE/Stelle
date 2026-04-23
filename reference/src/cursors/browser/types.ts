import type { CursorActivation, CursorHost, CursorReport } from "../base.js";

export interface BrowserCursor extends CursorHost {
  kind: "browser";

  run(input: BrowserRunRequest): Promise<BrowserRunResult>;
  snapshot(): Promise<BrowserSnapshot>;
  captureCurrentFrame(reason?: string): Promise<BrowserScreenshotResult>;
}

export interface BrowserContext {
  currentUrl: string | null;
  currentTitle: string | null;

  activeTask: BrowserRunRequest | null;
  waitState: BrowserWaitState | null;

  lastObservation: BrowserObservation | BrowserInteractiveObservation | null;
  lastAction: BrowserActionRecord | null;
  lastScreenshot: BrowserScreenshotResult | null;

  recentActivations: CursorActivation[];
  recentEvents: BrowserEvent[];
  recentReports: BrowserReport[];

  lastActivatedAt: number | null;
  lastObservedAt: number | null;
  lastActionAt: number | null;
}

export interface BrowserObservation {
  url: string;
  title: string;
  textPreview: string;
  timestamp: number;
}

export interface BrowserInteractiveObservation {
  url: string;
  title: string;
  textPreview?: string;
  links: BrowserLinkInfo[];
  buttons: BrowserButtonInfo[];
  inputs: BrowserInputInfo[];
  timestamp: number;
}

export interface BrowserLinkInfo {
  text: string;
  href: string;
}

export interface BrowserButtonInfo {
  text: string;
}

export interface BrowserInputInfo {
  name: string;
  type: string;
  placeholder: string;
  ariaLabel: string;
}

export interface BrowserScreenshotResult {
  path: string;
  url: string;
  uploaded?: boolean;
  uploadMessage?: string | null;
  timestamp: number;
}

export interface BrowserOpenAction {
  url: string;
}

export interface BrowserClickAction {
  selector?: string;
  text?: string;
  timeoutMs?: number;
}

export interface BrowserTypeAction {
  text: string;
  selector?: string;
  placeholder?: string;
  pressEnter?: boolean;
  timeoutMs?: number;
}

export interface BrowserMouseClickAction {
  x: number;
  y: number;
  button?: "left" | "right" | "middle";
  clickCount?: number;
}

export interface BrowserKeyboardTypeAction {
  text: string;
  delayMs?: number;
}

export interface BrowserKeyboardPressAction {
  key: string;
}

export interface BrowserHumanWaitAction {
  reason?: string;
  timeoutMs?: number;
}

export interface BrowserActionResult {
  ok: boolean;
  actionType: string;
  url: string | null;
  title: string | null;
  summary: string;
  timestamp: number;
}

export type BrowserAction =
  | { type: "open"; input: BrowserOpenAction }
  | { type: "click"; input: BrowserClickAction }
  | { type: "type"; input: BrowserTypeAction }
  | { type: "mouse_click"; input: BrowserMouseClickAction }
  | { type: "keyboard_type"; input: BrowserKeyboardTypeAction }
  | { type: "keyboard_press"; input: BrowserKeyboardPressAction }
  | { type: "human_wait"; input?: BrowserHumanWaitAction }
  | { type: "back" }
  | { type: "refresh" }
  | { type: "inspect_page" }
  | { type: "inspect_interactive"; input?: { maxItems?: number } }
  | {
      type: "screenshot";
      input?: { reason?: string; fileName?: string; fullPage?: boolean };
    };

export type BrowserWaitPolicy =
  | { type: "none" }
  | { type: "fixed_delay"; delayMs: number }
  | { type: "navigation"; timeoutMs: number }
  | { type: "network_idle"; timeoutMs: number }
  | { type: "dom_change"; timeoutMs: number }
  | { type: "element_appear"; timeoutMs: number; selector?: string; text?: string }
  | { type: "element_disappear"; timeoutMs: number; selector?: string; text?: string };

export interface BrowserExpectation {
  summary: string;
  mode?: "one_of" | "all_of";
  conditions: BrowserExpectedCondition[];
  onMiss?: "report" | "reinspect" | "retry";
}

export type BrowserExpectedCondition =
  | { type: "url_changed" }
  | { type: "title_changed" }
  | { type: "text_present"; text: string }
  | { type: "element_visible"; selector?: string; text?: string }
  | { type: "element_hidden"; selector?: string; text?: string }
  | { type: "content_changed" };

export type BrowserTriggerSource =
  | { type: "main_loop"; id?: string }
  | { type: "agent_mention"; agentId?: string; note?: string }
  | { type: "task_completion"; taskId: string }
  | { type: "browser_event"; eventType: string };

export interface BrowserRunRequest {
  id: string;
  action: BrowserAction;
  wait?: BrowserWaitPolicy;
  expect?: BrowserExpectation;
  triggeredBy?: BrowserTriggerSource;
  note?: string;
  createdAt: number;
}

export interface BrowserJudgeInput {
  request: BrowserRunRequest;
  context: Pick<
    BrowserContext,
    "currentUrl" | "currentTitle" | "waitState" | "lastObservation" | "lastAction"
  >;
}

export interface BrowserJudgeResult {
  executable: boolean;
  reason: string;
  actionPlan: BrowserAction;
  waitPlan?: BrowserWaitPolicy;
  expectationPlan?: BrowserExpectation;
  preObservation?: "page" | "interactive";
}

export interface BrowserWaitState {
  requestId: string;
  policy: BrowserWaitPolicy;
  expectation?: BrowserExpectation;
  startedAt: number;
  expiresAt: number | null;
}

export type BrowserEvent =
  | { type: "activated"; summary: string; timestamp: number }
  | { type: "action_started"; actionType: string; summary: string; timestamp: number }
  | { type: "action_finished"; actionType: string; summary: string; timestamp: number }
  | { type: "wait_started"; summary: string; timestamp: number }
  | { type: "wait_completed"; summary: string; timestamp: number }
  | { type: "expectation_met"; summary: string; timestamp: number }
  | { type: "expectation_missed"; summary: string; timestamp: number }
  | { type: "observation_changed"; summary: string; timestamp: number }
  | { type: "error"; summary: string; timestamp: number };

export type BrowserReport =
  | ({ cursorId: string; type: "status"; summary: string; timestamp: number } & {
      payload?: Record<string, unknown>;
    })
  | ({ cursorId: string; type: "task_result"; summary: string; timestamp: number } & {
      payload?: Record<string, unknown>;
    })
  | ({ cursorId: string; type: "observation"; summary: string; timestamp: number } & {
      payload?: Record<string, unknown>;
    })
  | ({ cursorId: string; type: "error"; summary: string; timestamp: number } & {
      payload?: Record<string, unknown>;
    });

export interface BrowserRunResult {
  requestId: string;
  ok: boolean;
  actionExecuted: boolean;
  waitApplied: boolean;
  waitCompleted: boolean;
  expectationChecked: boolean;
  expectationMet?: boolean;
  summary: string;
  judge: BrowserJudgeResult;
  actionResult?: BrowserActionResult;
  observation?: BrowserObservation | BrowserInteractiveObservation;
  screenshot?: BrowserScreenshotResult;
  reports: BrowserReport[];
}

export interface BrowserSnapshot {
  cursorId: string;
  kind: "browser";
  status: "idle" | "active" | "waiting" | "error";
  summary: string;
  url: string | null;
  title: string | null;
  activeRequestId: string | null;
  waitState: BrowserWaitState | null;
  lastObservedAt: number | null;
  lastActionAt: number | null;
  lastScreenshot: BrowserScreenshotResult | null;
}

export interface BrowserActionRecord {
  actionType: BrowserAction["type"];
  summary: string;
  timestamp: number;
}

export type BrowserCursorReport = CursorReport;
