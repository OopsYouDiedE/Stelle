import type { CursorContext, CursorSnapshot, StelleCursor } from "../../types.js";
import { BrowserExecutor } from "./executor.js";
import { BrowserGateway } from "./gateway.js";
import { BrowserObserver } from "./observer.js";
import { BrowserResponder } from "./responder.js";
import { BrowserRouter } from "./router.js";

export class BrowserCursor implements StelleCursor {
  readonly id = "browser";
  readonly kind = "device_browser";
  readonly displayName = "Browser Cursor";

  private status: CursorSnapshot["status"] = "idle";
  private summary = "Browser Cursor is observing.";
  private unsubscribes: (() => void)[] = [];

  private readonly gateway = new BrowserGateway();
  private readonly observer = new BrowserObserver();
  private readonly router: BrowserRouter;
  private readonly executor: BrowserExecutor;
  private readonly responder = new BrowserResponder();

  constructor(private readonly context: CursorContext) {
    this.router = new BrowserRouter(context, this.id);
    this.executor = new BrowserExecutor(context);
  }

  async initialize(): Promise<void> {
    this.unsubscribes.push(this.context.eventBus.subscribe("browser.observation.received", (event) => {
      void this.receiveObservation(event.payload).catch(e => console.error("[BrowserCursor] Observation failed:", e));
    }));
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
  }

  async receiveObservation(payload: Record<string, unknown>): Promise<{ accepted: boolean; reason: string }> {
    this.status = "active";
    try {
      const observation = this.gateway.receive(this.observer.normalize(payload));
      const decision = this.router.decide(observation);
      if (!decision.intent) {
        this.summary = decision.reason;
        return { accepted: true, reason: decision.reason };
      }

      this.status = "waiting";
      const result = await this.executor.execute(decision.intent);
      this.summary = this.responder.summarize(result);
      return { accepted: result.status === "completed" || result.status === "accepted", reason: result.reason };
    } finally {
      this.status = "idle";
    }
  }

  snapshot(): CursorSnapshot {
    return {
      id: this.id,
      kind: this.kind,
      status: this.status,
      summary: this.summary,
      state: {
        latest: this.gateway.snapshot(),
      },
    };
  }
}
