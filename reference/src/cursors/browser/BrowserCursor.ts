import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CursorActivation, CursorReport } from "../base.js";
import type {
  BrowserAction,
  BrowserActionRecord,
  BrowserActionResult,
  BrowserButtonInfo,
  BrowserClickAction,
  BrowserContext,
  BrowserCursor,
  BrowserEvent,
  BrowserExpectation,
  BrowserExpectedCondition,
  BrowserHumanWaitAction,
  BrowserInputInfo,
  BrowserInteractiveObservation,
  BrowserKeyboardPressAction,
  BrowserKeyboardTypeAction,
  BrowserLinkInfo,
  BrowserMouseClickAction,
  BrowserObservation,
  BrowserReport,
  BrowserRunRequest,
  BrowserRunResult,
  BrowserScreenshotResult,
  BrowserSnapshot,
  BrowserTypeAction,
  BrowserWaitPolicy,
  BrowserWaitState,
} from "./types.js";
import type { BrowserRuntime } from "./runtime.js";
import { judgeBrowserRun } from "./judge.js";

export interface BrowserCursorOptions {
  id?: string;
  cwd?: string;
  runtime: BrowserRuntime;
  uploadAttachment?: (
    filePath: string,
    caption?: string
  ) => Promise<string | void> | string | void;
}

function now(): number {
  return Date.now();
}

function safeFileName(input: string): string {
  return input.replace(/[<>:"/\\|?*]+/g, "_");
}

function summarizeAction(action: BrowserAction): string {
  switch (action.type) {
    case "open":
      return `Open ${action.input.url}`;
    case "click":
      return `Click ${action.input.selector ?? action.input.text ?? "target"}`;
    case "type":
      return `Type into ${action.input.selector ?? action.input.placeholder ?? "input"}`;
    case "mouse_click":
      return `Mouse click at ${action.input.x},${action.input.y}`;
    case "keyboard_type":
      return "Keyboard type text";
    case "keyboard_press":
      return `Keyboard press ${action.input.key}`;
    case "human_wait":
      return `Wait for human: ${action.input?.reason ?? "manual browser operation"}`;
    case "back":
      return "Go back";
    case "refresh":
      return "Refresh page";
    case "inspect_page":
      return "Inspect current page";
    case "inspect_interactive":
      return "Inspect interactive elements";
    case "screenshot":
      return "Capture screenshot";
    default:
      return "Browser action";
  }
}

async function waitForPageSettle(page: any, timeoutMs = 10000): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => {});
}

async function waitForNetworkIdle(page: any, timeoutMs = 5000): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
}

async function clickByVisibleText(
  page: any,
  text: string,
  timeoutMs: number
): Promise<string> {
  const escaped = text.replace(/"/g, '\\"');
  const candidates = [
    `button:has-text("${escaped}")`,
    `a:has-text("${escaped}")`,
    `input[type="button"][value="${escaped}"]`,
    `input[type="submit"][value="${escaped}"]`,
    `text="${escaped}"`,
  ];

  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    await locator.click({ timeout: timeoutMs });
    return selector;
  }

  throw new Error(`No clickable element found with text "${text}"`);
}

async function resolveInputLocator(
  page: any,
  selector: string | undefined,
  placeholder: string | undefined
): Promise<any> {
  if (selector) {
    return page.locator(selector).first();
  }

  if (placeholder) {
    const escaped = placeholder.replace(/"/g, '\\"');
    const candidates = [
      `input[placeholder="${escaped}"]`,
      `textarea[placeholder="${escaped}"]`,
      `[aria-label="${escaped}"]`,
    ];

    for (const candidate of candidates) {
      const locator = page.locator(candidate).first();
      const count = await locator.count().catch(() => 0);
      if (count) return locator;
    }

    throw new Error(`No input found with placeholder or aria-label "${placeholder}"`);
  }

  return page.locator('input:not([type="hidden"]), textarea, [contenteditable="true"]').first();
}

export class PlaywrightBrowserCursor implements BrowserCursor {
  readonly id: string;
  readonly kind = "browser" as const;

  private status: BrowserSnapshot["status"] = "idle";
  private cwd: string;
  private readonly runtime: BrowserRuntime;
  private uploadAttachment?: BrowserCursorOptions["uploadAttachment"];
  private screenshotQueue: Promise<unknown> = Promise.resolve();
  private readonly context: BrowserContext = {
    currentUrl: null,
    currentTitle: null,
    activeTask: null,
    waitState: null,
    lastObservation: null,
    lastAction: null,
    lastScreenshot: null,
    recentActivations: [],
    recentEvents: [],
    recentReports: [],
    lastActivatedAt: null,
    lastObservedAt: null,
    lastActionAt: null,
  };

  constructor(options: BrowserCursorOptions) {
    this.id = options.id ?? "browser-main";
    this.cwd = options.cwd ?? process.cwd();
    this.runtime = options.runtime;
    this.uploadAttachment = options.uploadAttachment;
  }

  configureRuntime(options: {
    cwd?: string;
    uploadAttachment?: BrowserCursorOptions["uploadAttachment"];
  }): void {
    if (options.cwd) {
      this.cwd = options.cwd;
    }
    if (options.uploadAttachment !== undefined) {
      this.uploadAttachment = options.uploadAttachment;
    }
  }

  async activate(input: CursorActivation): Promise<void> {
    this.context.recentActivations.push(input);
    this.context.lastActivatedAt = input.timestamp;
    this.pushEvent({
      type: "activated",
      summary: `${input.type}: ${input.reason}`,
      timestamp: input.timestamp,
    });
  }

  async tick(): Promise<CursorReport[]> {
    await this.runtime.ensureReady();
    const reports: BrowserReport[] = [];
    const page = await this.runtime.getPage();
    const currentUrl = page.url();
    const currentTitle = await page.title().catch(() => "");

    if (
      currentUrl !== this.context.currentUrl ||
      currentTitle !== this.context.currentTitle
    ) {
      this.context.currentUrl = currentUrl;
      this.context.currentTitle = currentTitle;
      const report: BrowserReport = {
        cursorId: this.id,
        type: "observation",
        summary: `Browser state changed to ${currentTitle || currentUrl}`,
        payload: {
          url: currentUrl,
          title: currentTitle,
        },
        timestamp: now(),
      };
      this.pushReport(report);
      this.pushEvent({
        type: "observation_changed",
        summary: report.summary,
        timestamp: report.timestamp,
      });
      reports.push(report);
    }

    if (this.context.waitState) {
      const waitOutcome = await this.resolveWaitState(this.context.waitState);
      if (waitOutcome.completed) {
        this.context.waitState = null;
        this.status = "idle";
        const report: BrowserReport = {
          cursorId: this.id,
          type: "status",
          summary: waitOutcome.summary,
          payload: waitOutcome.payload,
          timestamp: now(),
        };
        this.pushReport(report);
        this.pushEvent({
          type: "wait_completed",
          summary: waitOutcome.summary,
          timestamp: report.timestamp,
        });
        reports.push(report);
      }
    }

    return reports;
  }

  async run(input: BrowserRunRequest): Promise<BrowserRunResult> {
    await this.runtime.ensureReady();
    this.status = "active";
    this.context.activeTask = input;

    const reports: BrowserReport[] = [];
    const startedAt = now();
    const judge = judgeBrowserRun({
      request: input,
      context: {
        currentUrl: this.context.currentUrl,
        currentTitle: this.context.currentTitle,
        waitState: this.context.waitState,
        lastObservation: this.context.lastObservation,
        lastAction: this.context.lastAction,
      },
    });
    const judgeReport: BrowserReport = {
      cursorId: this.id,
      type: "status",
      summary: `Browser judge: ${judge.reason}`,
      payload: {
        executable: judge.executable,
        actionType: judge.actionPlan.type,
      },
      timestamp: startedAt,
    };
    reports.push(judgeReport);
    this.pushReport(judgeReport);

    if (!judge.executable) {
      this.status = "idle";
      this.context.activeTask = null;
      return {
        requestId: input.id,
        ok: false,
        actionExecuted: false,
        waitApplied: false,
        waitCompleted: false,
        expectationChecked: false,
        summary: `Browser judge rejected request: ${judge.reason}`,
        judge,
        reports,
      };
    }

    this.pushEvent({
      type: "action_started",
      actionType: judge.actionPlan.type,
      summary: summarizeAction(judge.actionPlan),
      timestamp: startedAt,
    });

    let actionExecuted = false;
    let waitApplied = false;
    let waitCompleted = false;
    let expectationChecked = false;
    let expectationMet: boolean | undefined;
    let actionResult: BrowserActionResult | undefined;
    let observation: BrowserObservation | BrowserInteractiveObservation | undefined;
    let screenshot: BrowserScreenshotResult | undefined;
    let previousObservation = this.context.lastObservation;

    try {
      if (judge.preObservation === "interactive") {
        await this.observeInteractive();
        previousObservation = this.context.lastObservation;
      } else if (judge.preObservation === "page") {
        await this.observePage();
        previousObservation = this.context.lastObservation;
      }

      const execution = await this.executeAction(judge.actionPlan);
      actionExecuted = true;
      actionResult = execution.actionResult;
      observation = execution.observation;
      screenshot = execution.screenshot;

      if (judge.waitPlan && judge.waitPlan.type !== "none") {
        waitApplied = true;
        this.context.waitState = this.createWaitState(
          input.id,
          judge.waitPlan,
          judge.expectationPlan
        );
        this.status = "waiting";
        this.pushEvent({
          type: "wait_started",
          summary: `Waiting with policy ${judge.waitPlan.type}`,
          timestamp: now(),
        });
        const waitOutcome = await this.waitByPolicy(judge.waitPlan);
        waitCompleted = waitOutcome.completed;
        this.context.waitState = null;
        this.status = "active";
        reports.push({
          cursorId: this.id,
          type: "status",
          summary: waitOutcome.summary,
          payload: waitOutcome.payload,
          timestamp: now(),
        });
      }

      const postObservation = await this.observePage();
      observation = postObservation;

      screenshot =
        judge.actionPlan.type === "screenshot"
          ? screenshot
          : await this.updateCurrentFrame(
              `Current frame after ${judge.actionPlan.type}`
            ).catch(() => screenshot);

      if (judge.expectationPlan) {
        expectationChecked = true;
        expectationMet = await this.checkExpectation(
          judge.expectationPlan,
          postObservation,
          previousObservation
        );
        this.pushEvent({
          type: expectationMet ? "expectation_met" : "expectation_missed",
          summary: expectationMet
            ? `Expectation met: ${judge.expectationPlan.summary}`
            : `Expectation missed: ${judge.expectationPlan.summary}`,
          timestamp: now(),
        });
      }

      const summary = this.buildRunSummary({
        action: judge.actionPlan,
        actionResult,
        waitApplied,
        waitCompleted,
        expectationChecked,
        expectationMet,
      });

      const report: BrowserReport = {
        cursorId: this.id,
        type: "task_result",
        summary,
        payload: {
          requestId: input.id,
          action: judge.actionPlan.type,
          url: this.context.currentUrl,
          title: this.context.currentTitle,
          expectationMet,
        },
        timestamp: now(),
      };
      reports.push(report);
      this.pushReport(report);
      this.pushEvent({
        type: "action_finished",
        actionType: judge.actionPlan.type,
        summary,
        timestamp: report.timestamp,
      });

      return {
        requestId: input.id,
        ok: expectationChecked ? expectationMet !== false : true,
        actionExecuted,
        waitApplied,
        waitCompleted: waitApplied ? waitCompleted : true,
        expectationChecked,
        expectationMet,
        summary,
        judge,
        actionResult,
        observation,
        screenshot,
        reports,
      };
    } catch (error) {
      this.status = "error";
      const summary = `Browser run failed: ${(error as Error).message}`;
      const report: BrowserReport = {
        cursorId: this.id,
        type: "error",
        summary,
        payload: {
          requestId: input.id,
          action: judge.actionPlan.type,
        },
        timestamp: now(),
      };
      reports.push(report);
      this.pushReport(report);
      this.pushEvent({
        type: "error",
        summary,
        timestamp: report.timestamp,
      });
      screenshot = await this.updateCurrentFrame(
        `Current frame after browser error: ${judge.actionPlan.type}`
      ).catch(() => screenshot);
      return {
        requestId: input.id,
        ok: false,
        actionExecuted,
        waitApplied,
        waitCompleted,
        expectationChecked,
        expectationMet,
        summary,
        judge,
        actionResult,
        observation,
        screenshot,
        reports,
      };
    } finally {
      this.context.activeTask = null;
      this.context.waitState = null;
      if (this.status !== "error") {
        this.status = "idle";
      }
    }
  }

  async snapshot(): Promise<BrowserSnapshot> {
    const page = await this.runtime.getPage();
    const url = page?.url?.() ?? this.context.currentUrl;
    const title =
      (await page?.title?.().catch(() => this.context.currentTitle)) ??
      this.context.currentTitle;

    return {
      cursorId: this.id,
      kind: "browser",
      status: this.status,
      summary: title ? `${title} (${url ?? "no-url"})` : url ?? "Browser not ready",
      url,
      title,
      activeRequestId: this.context.activeTask?.id ?? null,
      waitState: this.context.waitState,
      lastObservedAt: this.context.lastObservedAt,
      lastActionAt: this.context.lastActionAt,
      lastScreenshot: this.context.lastScreenshot,
    };
  }

  async captureCurrentFrame(reason = "Browser Cursor current frame"): Promise<BrowserScreenshotResult> {
    return this.updateCurrentFrame(reason);
  }

  private async executeAction(action: BrowserAction): Promise<{
    actionResult?: BrowserActionResult;
    observation?: BrowserObservation | BrowserInteractiveObservation;
    screenshot?: BrowserScreenshotResult;
  }> {
    switch (action.type) {
      case "open":
        return { actionResult: await this.open(action.input) };
      case "click":
        return { actionResult: await this.click(action.input) };
      case "type":
        return { actionResult: await this.type(action.input) };
      case "mouse_click":
        return { actionResult: await this.mouseClick(action.input) };
      case "keyboard_type":
        return { actionResult: await this.keyboardType(action.input) };
      case "keyboard_press":
        return { actionResult: await this.keyboardPress(action.input) };
      case "human_wait":
        return { actionResult: await this.humanWait(action.input) };
      case "back":
        return { actionResult: await this.back() };
      case "refresh":
        return { actionResult: await this.refresh() };
      case "inspect_page":
        return { observation: await this.observePage() };
      case "inspect_interactive":
        return {
          observation: await this.observeInteractive(action.input?.maxItems ?? 12),
        };
      case "screenshot":
        return {
          screenshot: await this.captureScreenshot(
            action.input?.reason,
            action.input?.fileName,
            action.input?.fullPage ?? true
          ),
        };
      default:
        throw new Error(`Unsupported browser action ${(action as BrowserAction).type}`);
    }
  }

  private async open(input: { url: string }): Promise<BrowserActionResult> {
    const page = await this.runtime.getPage();
    await page.goto(input.url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await waitForNetworkIdle(page, 10000);
    return this.finalizeAction("open", `Opened ${input.url}`);
  }

  private async click(input: BrowserClickAction): Promise<BrowserActionResult> {
    if (!input.selector && !input.text) {
      throw new Error('browser click requires either "selector" or "text"');
    }

    const page = await this.runtime.getPage();
    const context = await this.runtime.getContext();
    const popupPromise = context
      .waitForEvent("page", { timeout: input.timeoutMs ?? 10000 })
      .catch(() => null);
    if (input.selector) {
      await page.locator(input.selector).first().click({
        timeout: input.timeoutMs ?? 10000,
      });
    } else if (input.text) {
      await clickByVisibleText(page, input.text, input.timeoutMs ?? 10000);
    }
    const popup = await popupPromise;
    const activePage = popup ?? page;
    if (popup) {
      await this.runtime.setPage(popup);
    }
    await waitForPageSettle(activePage, 10000);
    await waitForNetworkIdle(activePage, 5000);
    return this.finalizeAction(
      "click",
      `Clicked ${input.selector ?? input.text ?? "target"}${popup ? " and switched to new page" : ""}`
    );
  }

  private async type(input: BrowserTypeAction): Promise<BrowserActionResult> {
    const page = await this.runtime.getPage();
    const locator = await resolveInputLocator(page, input.selector, input.placeholder);
    await locator.click({ timeout: input.timeoutMs ?? 10000 });
    await locator.fill(input.text, { timeout: input.timeoutMs ?? 10000 });
    if (input.pressEnter) {
      await locator.press("Enter", { timeout: input.timeoutMs ?? 10000 }).catch(
        async () => {
          await page.keyboard.press("Enter");
        }
      );
      await waitForPageSettle(page, 10000);
      await waitForNetworkIdle(page, 5000);
    }
    return this.finalizeAction(
      "type",
      `Typed into ${input.selector ?? input.placeholder ?? "input"}`
    );
  }

  private async mouseClick(input: BrowserMouseClickAction): Promise<BrowserActionResult> {
    const page = await this.runtime.getPage();
    await page.mouse.click(input.x, input.y, {
      button: input.button ?? "left",
      clickCount: input.clickCount ?? 1,
    });
    await waitForPageSettle(page, 30000);
    await waitForNetworkIdle(page, 30000);
    return this.finalizeAction(
      "mouse_click",
      `Mouse clicked ${input.x},${input.y}`
    );
  }

  private async keyboardType(input: BrowserKeyboardTypeAction): Promise<BrowserActionResult> {
    const page = await this.runtime.getPage();
    await page.keyboard.type(input.text, { delay: input.delayMs ?? 20 });
    return this.finalizeAction("keyboard_type", "Keyboard typed text");
  }

  private async keyboardPress(input: BrowserKeyboardPressAction): Promise<BrowserActionResult> {
    const page = await this.runtime.getPage();
    await page.keyboard.press(input.key);
    await waitForPageSettle(page, 30000);
    await waitForNetworkIdle(page, 30000);
    return this.finalizeAction("keyboard_press", `Keyboard pressed ${input.key}`);
  }

  private async humanWait(input?: BrowserHumanWaitAction): Promise<BrowserActionResult> {
    const page = await this.runtime.getPage();
    const timeoutMs = Math.min(Math.max(input?.timeoutMs ?? 45000, 30000), 60000);
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    await waitForPageSettle(page, 30000);
    await waitForNetworkIdle(page, 30000);
    return this.finalizeAction(
      "human_wait",
      `Waited ${timeoutMs}ms for human operation${input?.reason ? `: ${input.reason}` : ""}`
    );
  }

  private async back(): Promise<BrowserActionResult> {
    const page = await this.runtime.getPage();
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 });
    await waitForNetworkIdle(page, 5000);
    return this.finalizeAction("back", "Went back");
  }

  private async refresh(): Promise<BrowserActionResult> {
    const page = await this.runtime.getPage();
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await waitForNetworkIdle(page, 5000);
    return this.finalizeAction("refresh", "Refreshed current page");
  }

  private async observePage(): Promise<BrowserObservation> {
    const page = await this.runtime.getPage();
    const observation = (await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      textPreview: (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 4000),
    }))) as BrowserObservation;

    observation.timestamp = now();
    this.context.currentUrl = observation.url;
    this.context.currentTitle = observation.title;
    this.context.lastObservation = observation;
    this.context.lastObservedAt = observation.timestamp;
    return observation;
  }

  private async observeInteractive(
    maxItems = 12
  ): Promise<BrowserInteractiveObservation> {
    const page = await this.runtime.getPage();
    const observation = (await page.evaluate((limit: number) => {
      const norm = (value: string | null | undefined) =>
        (value ?? "").replace(/\s+/g, " ").trim();

      const links = Array.from(document.querySelectorAll("a"))
        .map((node) => ({
          text: norm(node.textContent),
          href: (node as HTMLAnchorElement).href || "",
        }))
        .filter((item) => item.text || item.href)
        .slice(0, limit);

      const buttons = Array.from(
        document.querySelectorAll("button, input[type='button'], input[type='submit']")
      )
        .map((node) => {
          const input = node as HTMLInputElement;
          return {
            text:
              norm(node.textContent) ||
              norm(input.value) ||
              norm(node.getAttribute("aria-label")),
          };
        })
        .filter((item) => item.text)
        .slice(0, limit);

      const inputs = Array.from(document.querySelectorAll("input, textarea, select"))
        .map((node) => ({
          name: norm(node.getAttribute("name")),
          type: norm(node.getAttribute("type")) || node.tagName.toLowerCase(),
          placeholder: norm(node.getAttribute("placeholder")),
          ariaLabel: norm(node.getAttribute("aria-label")),
        }))
        .slice(0, limit);

      return {
        url: location.href,
        title: document.title,
        textPreview: (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 4000),
        links,
        buttons,
        inputs,
      };
    }, maxItems)) as Omit<BrowserInteractiveObservation, "timestamp">;

    const fullObservation: BrowserInteractiveObservation = {
      ...observation,
      links: observation.links as BrowserLinkInfo[],
      buttons: observation.buttons as BrowserButtonInfo[],
      inputs: observation.inputs as BrowserInputInfo[],
      timestamp: now(),
    };
    this.context.currentUrl = fullObservation.url;
    this.context.currentTitle = fullObservation.title;
    this.context.lastObservation = fullObservation;
    this.context.lastObservedAt = fullObservation.timestamp;
    return fullObservation;
  }

  private async captureScreenshot(
    reason?: string,
    fileName?: string,
    fullPage = true
  ): Promise<BrowserScreenshotResult> {
    const run = this.screenshotQueue
      .catch(() => undefined)
      .then(() => this.captureScreenshotNow(reason, fileName, fullPage));
    this.screenshotQueue = run.catch(() => undefined);
    return run;
  }

  private async captureScreenshotNow(
    reason?: string,
    fileName?: string,
    fullPage = true
  ): Promise<BrowserScreenshotResult> {
    const page = await this.runtime.getPage();
    const dir = await this.runtime.ensureScreenshotDir(this.cwd);
    const safeName = safeFileName(
      fileName?.trim() || `browser-${Date.now()}.png`
    );
    const outputPath = path.join(
      dir,
      safeName.endsWith(".png") ? safeName : `${safeName}.png`
    );
    const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
    const image = await page.screenshot({
      fullPage,
      type: "png",
    });
    await writeFile(tempPath, image);
    await rename(tempPath, outputPath);
    const uploadMessage = this.uploadAttachment
      ? ((await this.uploadAttachment(
          outputPath,
          reason ? `Browser screenshot: ${reason}` : `Browser screenshot from ${page.url()}`
        )) as string | void)
      : undefined;
    const result = {
      path: outputPath,
      url: page.url(),
      uploaded: !!uploadMessage,
      uploadMessage: uploadMessage ?? null,
      timestamp: now(),
    };
    this.context.lastScreenshot = result;
    return result;
  }

  private async updateCurrentFrame(reason: string): Promise<BrowserScreenshotResult> {
    // This is the Browser Cursor's internal visual state. It is captured from
    // the Playwright page, not from an external desktop/window screenshot.
    return this.captureScreenshot(reason, "browser-current.png", false);
  }

  private createWaitState(
    requestId: string,
    policy: BrowserWaitPolicy,
    expectation?: BrowserExpectation
  ): BrowserWaitState {
    const startedAt = now();
    const timeoutMs =
      "timeoutMs" in policy
        ? policy.timeoutMs
        : "delayMs" in policy
          ? policy.delayMs
          : null;
    return {
      requestId,
      policy,
      expectation,
      startedAt,
      expiresAt: timeoutMs ? startedAt + timeoutMs : null,
    };
  }

  private async waitByPolicy(policy: BrowserWaitPolicy): Promise<{
    completed: boolean;
    summary: string;
    payload?: Record<string, unknown>;
  }> {
    const page = await this.runtime.getPage();
    const before = await this.observePage();

    switch (policy.type) {
      case "none":
        return { completed: true, summary: "No wait applied." };
      case "fixed_delay":
        await new Promise((resolve) => setTimeout(resolve, policy.delayMs));
        return {
          completed: true,
          summary: `Waited ${policy.delayMs}ms`,
          payload: { delayMs: policy.delayMs },
        };
      case "navigation":
        await waitForPageSettle(page, policy.timeoutMs);
        return {
          completed: true,
          summary: `Waited for navigation up to ${policy.timeoutMs}ms`,
        };
      case "network_idle":
        await waitForNetworkIdle(page, policy.timeoutMs);
        return {
          completed: true,
          summary: `Waited for network idle up to ${policy.timeoutMs}ms`,
        };
      case "dom_change": {
        const started = now();
        while (now() - started < policy.timeoutMs) {
          const current = await this.observePage();
          if (current.textPreview !== before.textPreview) {
            return {
              completed: true,
              summary: "Detected DOM/content change",
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return {
          completed: false,
          summary: `Timed out waiting for DOM change after ${policy.timeoutMs}ms`,
        };
      }
      case "element_appear":
        await this.waitForElement(policy.selector, policy.text, true, policy.timeoutMs);
        return {
          completed: true,
          summary: "Expected element appeared",
        };
      case "element_disappear":
        await this.waitForElement(policy.selector, policy.text, false, policy.timeoutMs);
        return {
          completed: true,
          summary: "Expected element disappeared",
        };
      default:
        return { completed: false, summary: "Unsupported wait policy" };
    }
  }

  private async waitForElement(
    selector: string | undefined,
    text: string | undefined,
    visible: boolean,
    timeoutMs: number
  ): Promise<void> {
    const page = await this.runtime.getPage();
    if (selector) {
      if (visible) {
        await page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
      } else {
        await page.locator(selector).first().waitFor({ state: "hidden", timeout: timeoutMs });
      }
      return;
    }

    if (text) {
      const locator = page.locator(`text="${text.replace(/"/g, '\\"')}"`).first();
      if (visible) {
        await locator.waitFor({ state: "visible", timeout: timeoutMs });
      } else {
        await locator.waitFor({ state: "hidden", timeout: timeoutMs });
      }
      return;
    }

    throw new Error("Element wait policy requires selector or text");
  }

  private async checkExpectation(
    expectation: BrowserExpectation,
    current: BrowserObservation | BrowserInteractiveObservation,
    previous: BrowserObservation | BrowserInteractiveObservation | null
  ): Promise<boolean> {
    const mode = expectation.mode ?? "one_of";
    const results = await Promise.all(
      expectation.conditions.map((condition) =>
        this.checkExpectedCondition(condition, current, previous)
      )
    );

    return mode === "all_of" ? results.every(Boolean) : results.some(Boolean);
  }

  private async checkExpectedCondition(
    condition: BrowserExpectedCondition,
    current: BrowserObservation | BrowserInteractiveObservation,
    previous: BrowserObservation | BrowserInteractiveObservation | null
  ): Promise<boolean> {
    switch (condition.type) {
      case "url_changed":
        return !!previous && current.url !== previous.url;
      case "title_changed":
        return !!previous && current.title !== previous.title;
      case "text_present":
        return Boolean(current.textPreview?.includes(condition.text));
      case "content_changed":
        return !!previous && current.textPreview !== undefined && previous.textPreview !== undefined
          ? current.textPreview !== previous.textPreview
          : false;
      case "element_visible":
        return this.isElementVisible(condition.selector, condition.text);
      case "element_hidden":
        return !(await this.isElementVisible(condition.selector, condition.text));
      default:
        return false;
    }
  }

  private async isElementVisible(
    selector: string | undefined,
    text: string | undefined
  ): Promise<boolean> {
    const page = await this.runtime.getPage();
    if (selector) {
      return await page
        .locator(selector)
        .first()
        .isVisible()
        .catch(() => false);
    }
    if (text) {
      return await page
        .locator(`text="${text.replace(/"/g, '\\"')}"`)
        .first()
        .isVisible()
        .catch(() => false);
    }
    return false;
  }

  private async resolveWaitState(waitState: BrowserWaitState): Promise<{
    completed: boolean;
    summary: string;
    payload?: Record<string, unknown>;
  }> {
    if (waitState.expiresAt && now() > waitState.expiresAt) {
      return {
        completed: true,
        summary: `Wait state for ${waitState.requestId} expired`,
      };
    }

    return {
      completed: false,
      summary: `Still waiting for ${waitState.requestId}`,
    };
  }

  private buildRunSummary(input: {
    action: BrowserAction;
    actionResult?: BrowserActionResult;
    waitApplied: boolean;
    waitCompleted: boolean;
    expectationChecked: boolean;
    expectationMet?: boolean;
  }): string {
    const parts = [input.actionResult?.summary ?? summarizeAction(input.action)];
    if (input.waitApplied) {
      parts.push(input.waitCompleted ? "wait completed" : "wait not completed");
    }
    if (input.expectationChecked) {
      parts.push(
        input.expectationMet ? "expectation met" : "expectation missed"
      );
    }
    return parts.join("; ");
  }

  private finalizeAction(
    actionType: BrowserAction["type"],
    summary: string
  ): BrowserActionResult {
    const timestamp = now();
    this.context.lastActionAt = timestamp;
    this.context.lastAction = {
      actionType,
      summary,
      timestamp,
    } satisfies BrowserActionRecord;
    return {
      ok: true,
      actionType,
      url: this.context.currentUrl,
      title: this.context.currentTitle,
      summary,
      timestamp,
    };
  }

  private pushEvent(event: BrowserEvent): void {
    this.context.recentEvents.push(event);
    if (this.context.recentEvents.length > 50) {
      this.context.recentEvents.shift();
    }
  }

  private pushReport(report: BrowserReport): void {
    this.context.recentReports.push(report);
    if (this.context.recentReports.length > 50) {
      this.context.recentReports.shift();
    }
  }
}
