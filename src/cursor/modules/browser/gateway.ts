import type { BrowserObservation } from "./types.js";

export class BrowserGateway {
  private latest?: BrowserObservation;

  receive(observation: BrowserObservation): BrowserObservation {
    this.latest = observation;
    return observation;
  }

  snapshot(): BrowserObservation | undefined {
    return this.latest;
  }
}
