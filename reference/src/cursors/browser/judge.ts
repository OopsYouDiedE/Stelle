import type {
  BrowserAction,
  BrowserExpectation,
  BrowserJudgeInput,
  BrowserJudgeResult,
  BrowserWaitPolicy,
} from "./types.js";

function defaultWaitPlan(action: BrowserAction): BrowserWaitPolicy | undefined {
  switch (action.type) {
    case "open":
      return { type: "network_idle", timeoutMs: 30000 };
    case "click":
    case "mouse_click":
      return { type: "dom_change", timeoutMs: 30000 };
    case "type":
      return action.input.pressEnter
        ? { type: "network_idle", timeoutMs: 30000 }
        : { type: "dom_change", timeoutMs: 30000 };
    case "keyboard_press":
      return { type: "network_idle", timeoutMs: 30000 };
    case "keyboard_type":
      return { type: "dom_change", timeoutMs: 30000 };
    case "human_wait":
      return { type: "none" };
    case "back":
    case "refresh":
      return { type: "navigation", timeoutMs: 30000 };
    default:
      return undefined;
  }
}

function defaultExpectation(action: BrowserAction): BrowserExpectation | undefined {
  switch (action.type) {
    case "open":
      return {
        summary: "Opening a page should usually change URL or content",
        mode: "one_of",
        conditions: [{ type: "url_changed" }, { type: "content_changed" }],
        onMiss: "report",
      };
    case "click":
      return {
        summary: "Clicking should usually change content or URL",
        mode: "one_of",
        conditions: [{ type: "content_changed" }, { type: "url_changed" }],
        onMiss: "reinspect",
      };
    case "type":
      return action.input.pressEnter
        ? {
            summary: "Submitting input should change content or URL",
            mode: "one_of",
            conditions: [{ type: "content_changed" }, { type: "url_changed" }],
            onMiss: "reinspect",
          }
        : undefined;
    case "back":
      return {
        summary: "Going back should usually change URL or content",
        mode: "one_of",
        conditions: [{ type: "url_changed" }, { type: "content_changed" }],
        onMiss: "report",
      };
    case "refresh":
      return {
        summary: "Refreshing should reload page content or title",
        mode: "one_of",
        conditions: [{ type: "content_changed" }, { type: "title_changed" }],
        onMiss: "report",
      };
    default:
      return undefined;
  }
}

export function judgeBrowserRun(input: BrowserJudgeInput): BrowserJudgeResult {
  const { request, context } = input;
  const actionPlan = request.action;
  const waitPlan = request.wait ?? defaultWaitPlan(actionPlan);
  const expectationPlan = request.expect ?? defaultExpectation(actionPlan);

  switch (actionPlan.type) {
    case "click":
      if (!actionPlan.input.selector && !actionPlan.input.text) {
        return {
          executable: false,
          reason: "Browser click requires either selector or text.",
          actionPlan,
          waitPlan,
          expectationPlan,
        };
      }
      return {
        executable: true,
        reason: context.lastObservation
          ? "Using current browser context to click target."
          : "No recent observation found, inspect interactive elements before clicking.",
        actionPlan,
        waitPlan,
        expectationPlan,
        preObservation: context.lastObservation ? undefined : "interactive",
      };
    case "mouse_click":
      if (!Number.isFinite(actionPlan.input.x) || !Number.isFinite(actionPlan.input.y)) {
        return {
          executable: false,
          reason: "Mouse click requires finite x and y coordinates.",
          actionPlan,
          waitPlan,
          expectationPlan,
        };
      }
      return {
        executable: true,
        reason: "Mouse click can execute against the current visible browser page.",
        actionPlan,
        waitPlan,
        expectationPlan,
        preObservation: "page",
      };
    case "keyboard_type":
    case "keyboard_press":
      return {
        executable: true,
        reason: "Keyboard action can execute against the focused browser page.",
        actionPlan,
        waitPlan,
        expectationPlan,
        preObservation: "page",
      };
    case "human_wait":
      return {
        executable: true,
        reason: "Human handoff wait can execute against the visible browser session.",
        actionPlan,
        waitPlan,
        expectationPlan,
        preObservation: "page",
      };
    case "type":
      if (!actionPlan.input.selector && !actionPlan.input.placeholder) {
        return {
          executable: false,
          reason: "Browser type requires selector or placeholder for stable targeting.",
          actionPlan,
          waitPlan,
          expectationPlan,
        };
      }
      return {
        executable: true,
        reason: context.lastObservation
          ? "Typing into a known input target."
          : "No recent observation found, inspect interactive elements before typing.",
        actionPlan,
        waitPlan,
        expectationPlan,
        preObservation: context.lastObservation ? undefined : "interactive",
      };
    case "inspect_interactive":
      return {
        executable: true,
        reason: "Interactive inspection is always safe.",
        actionPlan,
      };
    case "inspect_page":
      return {
        executable: true,
        reason: "Page inspection is always safe.",
        actionPlan,
      };
    case "screenshot":
      return {
        executable: true,
        reason: "Screenshot can execute directly against current page state.",
        actionPlan,
      };
    case "open":
    case "back":
    case "refresh":
      return {
        executable: true,
        reason: "Navigation action can execute directly.",
        actionPlan,
        waitPlan,
        expectationPlan,
        preObservation: "page",
      };
    default:
      return {
        executable: true,
        reason: "Browser action judged executable.",
        actionPlan,
        waitPlan,
        expectationPlan,
      };
  }
}
