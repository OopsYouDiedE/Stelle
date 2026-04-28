import type { CursorDirectiveEnvelope, DirectivePlanningInput } from "./types.js";

export interface DirectivePlanner {
  plan(input: DirectivePlanningInput): CursorDirectiveEnvelope[];
}

export class DefaultDirectivePlanner implements DirectivePlanner {
  plan(_input: DirectivePlanningInput): CursorDirectiveEnvelope[] { return []; }
}
