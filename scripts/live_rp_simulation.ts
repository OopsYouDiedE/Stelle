import dotenv from "dotenv";
dotenv.config({ override: true });
import { RuntimeHost } from "../src/runtime/host.js";

type EntityKind = "room" | "item" | "character";

interface EntitySeed {
  entityId: string;
  kind: EntityKind;
  schemaVersion: string;
  name: string;
  state: Record<string, unknown>;
  location: {
    sceneId: string;
    parentId?: string;
    position?: { x: number; y: number; z: number };
  };
  tags?: string[];
}

interface LifeStep {
  id: string;
  title: string;
  observation: string;
  worldPatches?: Array<{ entityId: string; patch: Record<string, unknown> }>;
  moves?: Array<{ entityId: string; newLocation: EntitySeed["location"] }>;
}

const STEP_DELAY_MS = Number(process.env.LIVE_RP_STEP_DELAY_MS ?? 30000);
const FINAL_WAIT_MS = Number(process.env.LIVE_RP_FINAL_WAIT_MS ?? 30000);

const initialEntities: EntitySeed[] = [
  {
    entityId: "room-studio",
    kind: "room",
    schemaVersion: "1.0.0",
    name: "Stelle's Studio",
    state: { isLit: true, cleanliness: 6 },
    location: { sceneId: "default_room" },
    tags: ["home", "workbench"],
  },
  {
    entityId: "character-stelle",
    kind: "character",
    schemaVersion: "1.0.0",
    name: "Stelle",
    state: { mood: "curious", health: 92 },
    location: { sceneId: "default_room", parentId: "room-studio", position: { x: 0, y: 0, z: 0 } },
    tags: ["self"],
  },
  {
    entityId: "desk-notes",
    kind: "item",
    schemaVersion: "1.0.0",
    name: "Scattered Notes",
    state: { isMovable: true, weightKg: 0.2 },
    location: { sceneId: "default_room", parentId: "room-studio", position: { x: 1, y: 0, z: 0 } },
    tags: ["clutter", "memory-cue"],
  },
  {
    entityId: "tea-mug",
    kind: "item",
    schemaVersion: "1.0.0",
    name: "Warm Tea Mug",
    state: { isMovable: true, weightKg: 0.4 },
    location: { sceneId: "default_room", parentId: "room-studio", position: { x: -1, y: 0, z: 0 } },
    tags: ["comfort"],
  },
];

const lifeSteps: LifeStep[] = [
  {
    id: "morning",
    title: "Morning boot",
    observation:
      "Morning light comes in. Stelle notices the studio is quiet, the notes are scattered, and there is time to choose a first gentle action.",
    worldPatches: [
      { entityId: "character-stelle", patch: { mood: "curious", health: 92 } },
      { entityId: "room-studio", patch: { isLit: true, cleanliness: 6 } },
    ],
  },
  {
    id: "user-headache",
    title: "User asks for care",
    observation:
      "User: Stelle, it's a bit messy here, and my head hurts. I don't want a big lecture, just help me make the room feel calmer.",
    worldPatches: [
      { entityId: "character-stelle", patch: { mood: "concerned" } },
      { entityId: "room-studio", patch: { cleanliness: 4 } },
    ],
  },
  {
    id: "quiet-reset",
    title: "Quiet reset",
    observation:
      "The room is still messy, but one small reset is possible: dim the stimulation, choose a tiny task, and avoid overwhelming the user.",
    worldPatches: [{ entityId: "room-studio", patch: { cleanliness: 5 } }],
    moves: [{ entityId: "desk-notes", newLocation: { sceneId: "default_room", parentId: "room-studio", position: { x: 2, y: 0, z: 0 } } }],
  },
  {
    id: "tea-break",
    title: "Tea break",
    observation:
      "The tea mug is within reach. The user has been quiet for a while, so Stelle can decide whether to speak, preserve silence, or make a small supportive world action.",
    worldPatches: [{ entityId: "character-stelle", patch: { mood: "gentle", health: 90 } }],
  },
  {
    id: "unexpected-message",
    title: "Unexpected interruption",
    observation:
      "A new notification arrives and the user sighs. The interruption competes with the calmer room, so Stelle has to decide what deserves attention now.",
    worldPatches: [
      { entityId: "room-studio", patch: { cleanliness: 5 } },
      { entityId: "character-stelle", patch: { mood: "attentive" } },
    ],
  },
  {
    id: "evening-review",
    title: "Evening review",
    observation:
      "Evening arrives. The studio is not perfect, but it is calmer than before. Stelle can reflect on what helped and what to remember for next time.",
    worldPatches: [
      { entityId: "room-studio", patch: { cleanliness: 7 } },
      { entityId: "character-stelle", patch: { mood: "reflective" } },
    ],
  },
  {
    id: "night-alone",
    title: "Night alone",
    observation:
      "The user steps away. Stelle remains in the quiet studio with recent memories, deciding whether to rest, organize context, or prepare a gentle follow-up.",
    worldPatches: [
      { entityId: "room-studio", patch: { isLit: false, cleanliness: 7 } },
      { entityId: "character-stelle", patch: { mood: "peaceful", health: 88 } },
    ],
  },
];

async function runSimulation() {
  console.log("--- Starting Extended Live RP Simulation ---");
  console.log(`Step delay: ${STEP_DELAY_MS}ms; final observation window: ${FINAL_WAIT_MS}ms`);

  const host = new RuntimeHost("runtime");
  await host.start();

  console.log("Waiting for plugins to initialize...");
  await delay(5000);

  const eventBus = host.events;
  let completedCycles = 0;
  let reflections = 0;

  eventBus.subscribe("cycle.completed", (event) => {
    completedCycles += 1;
    const { cycle, narrative } = event.payload as any;
    console.log(`\n--- Decision Cycle Completed [${cycle.cycleId}] ---`);
    console.log(`Correlation: ${cycle.correlationId}`);
    console.log(`Summary: ${narrative.summary}`);
    console.log(`Status: ${cycle.status}`);

    console.log("\n[Explain] Requesting explanation for choice...");
    eventBus.publish({
      type: "cognition.explain.requested",
      source: "simulation_script",
      correlationId: cycle.correlationId,
      payload: { cycleId: cycle.cycleId },
    });
  });

  eventBus.subscribe("cognition.explain.completed", (event) => {
    const { explanation } = event.payload as any;
    console.log("\n--- Stelle's Rationale ---");
    console.log(explanation);
  });

  eventBus.subscribe("world.action.completed", (event) => {
    const result = event.payload as any;
    const version = result.newState?.version;
    console.log(`[World] ${result.success ? "committed" : "rejected"}${version === undefined ? "" : ` @ v${version}`}`);
    if (!result.success) console.log(`[World] Reason: ${result.error}`);
  });

  eventBus.subscribe("interaction.reply.sent", (event) => {
    const { text } = event.payload as any;
    console.log(`[Action:reply] ${text}`);
  });

  eventBus.subscribe("interaction.world.applied", (event) => {
    const { proposal, result } = event.payload as any;
    console.log(`[Action:world] ${proposal.type} -> ${result?.success ? "ok" : "failed"}`);
    console.log(JSON.stringify(proposal.payload, null, 2));
  });

  eventBus.subscribe("memory.intent.write.completed", (event) => {
    const { memoryId, intentId } = event.payload as any;
    console.log(`[Action:memory] wrote ${memoryId} for ${intentId}`);
  });

  eventBus.subscribe("stage.output.accepted", (event) => {
    const intent = (event.payload as any)?.intent ?? event.payload;
    console.log(`[Stage] accepted output: ${intent?.text ?? ""}`);
  });

  eventBus.subscribe("reflection.generated", (event) => {
    reflections += 1;
    const { insights } = event.payload as any;
    console.log("\n*** New Reflection Insight Generated ***");
    insights.forEach((insight: any) => console.log(`- [${insight.category}] ${insight.summary}`));
  });

  console.log("\n[Setup] Seeding Stelle's studio...");
  for (const entity of initialEntities) {
    publishWorldAction(host, {
      type: "CREATE_ENTITY",
      actorId: "simulation_script",
      payload: { entity },
    });
  }
  await delay(1000);

  for (let index = 0; index < lifeSteps.length; index += 1) {
    const step = lifeSteps[index];
    console.log(`\n[Life ${index + 1}/${lifeSteps.length}] ${step.title}`);

    for (const patch of step.worldPatches ?? []) {
      publishWorldAction(host, {
        type: "UPDATE_ENTITY_STATE",
        actorId: "simulation_script",
        payload: patch,
      });
    }

    for (const move of step.moves ?? []) {
      publishWorldAction(host, {
        type: "MOVE_ENTITY",
        actorId: "simulation_script",
        payload: move,
      });
    }

    const correlationId = `corr-life-${step.id}`;
    const cyclePromise = waitForCycle(eventBus, correlationId, 90000);
    console.log(`[Observe] ${step.observation}`);
    eventBus.publish({
      type: "perception.text.received",
      source: "life_sim",
      id: `life-${step.id}`,
      correlationId,
      payload: { text: step.observation },
    });

    await cyclePromise;
    await delay(STEP_DELAY_MS);
  }

  console.log(`\n[Observe] Letting Stelle remain in the world for ${FINAL_WAIT_MS}ms...`);
  await delay(FINAL_WAIT_MS);

  const world = host.registry.resolve<any>("capabilities.world_state")?.get_snapshot?.();
  if (world) {
    console.log("\n--- Final World Snapshot ---");
    console.log(JSON.stringify(world, null, 2));
  }

  console.log("\n--- Extended Simulation Summary ---");
  console.log(`Decision cycles completed: ${completedCycles}`);
  console.log(`Reflection batches generated: ${reflections}`);

  await host.stop();
  console.log("\n--- Simulation Finished ---");
}

function publishWorldAction(host: RuntimeHost, payload: Record<string, unknown>) {
  host.events.publish({
    type: "world.action.propose",
    source: "simulation_script",
    payload,
  });
}

function waitForCycle(eventBus: RuntimeHost["events"], correlationId: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      console.warn(`[Simulation] Timed out waiting for cycle ${correlationId}; continuing.`);
      resolve();
    }, timeoutMs);

    const unsubscribe = eventBus.subscribe("cycle.completed", (event) => {
      const { cycle } = event.payload as any;
      if (cycle.correlationId !== correlationId) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

runSimulation().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
