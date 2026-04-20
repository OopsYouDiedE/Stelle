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
      return { type: "network_idle", timeoutMs: 10000 };
    case "click":
      return { type: "dom_change", timeoutMs: 5000 };
    case "type":
      return action.input.pressEnter
        ? { type: "network_idle", timeoutMs: 8000 }
        : { type: "dom_change", timeoutMs: 3000 };
    case "back":
    case "refresh":
      return { type: "navigation", timeoutMs: 8000 };
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
