import type {
  MinecraftEnvironmentFrame,
  MinecraftStrategyContext,
  MinecraftStrategyDecision,
} from "./types.js";

export interface MinecraftStrategyCode {
  id: string;
  description: string;
  decide(
    frame: MinecraftEnvironmentFrame,
    context: MinecraftStrategyContext
  ): Promise<MinecraftStrategyDecision> | MinecraftStrategyDecision;
}

function inventoryCount(frame: MinecraftEnvironmentFrame, itemName: string): number {
  return frame.observation.inventory
    .filter((item) => item.name === itemName)
    .reduce((total, item) => total + item.count, 0);
}

function hasItem(frame: MinecraftEnvironmentFrame, itemName: string): boolean {
  return inventoryCount(frame, itemName) > 0;
}

function nearbyBlockCount(frame: MinecraftEnvironmentFrame, blockName: string): number {
  return frame.observation.nearbyBlocks.filter((block) => block.name === blockName).length;
}

function coordinateHint(context: MinecraftStrategyContext): { x: number; y: number; z: number } | null {
  const text = context.notes.join("\n");
  const match = text.match(/coordinateHint=\((-?\d+),(-?\d+),(-?\d+)\)/);
  if (!match) return null;
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    z: Number(match[3]),
  };
}

const idleObserveStrategy: MinecraftStrategyCode = {
  id: "idle_observe",
  description: "Read one environment frame and stop.",
  decide(frame, _context) {
    return {
      type: "complete",
      summary: frame.summary,
    };
  },
};

const woodenPickaxeStrategy: MinecraftStrategyCode = {
  id: "wooden_pickaxe",
  description: "Collect wood, craft a wooden pickaxe, and equip it.",
  decide(frame, context) {
    if (!frame.observation.connected || !frame.observation.spawned) {
      return {
        type: "fail",
        reason: "Minecraft Cursor is not connected and spawned.",
      };
    }

    if (hasItem(frame, "wooden_pickaxe")) {
      return {
        type: "complete",
        summary: "Wooden pickaxe is present in inventory.",
      };
    }

    if (context.lastActionResult && !context.lastActionResult.ok) {
      return {
        type: "fail",
        reason: `wooden_pickaxe strategy stopped after failed action: ${context.lastActionResult.summary}`,
      };
    }

    const logs = inventoryCount(frame, "oak_log");
    const planks = inventoryCount(frame, "oak_planks");
    const sticks = inventoryCount(frame, "stick");
    const table = inventoryCount(frame, "crafting_table");
    const enoughInputs = logs >= 3 || planks + logs * 4 >= 9 || (planks >= 3 && sticks >= 2 && table >= 1);

    if (!enoughInputs) {
      return {
        type: "continue",
        action: {
          type: "collect_blocks",
          input: {
            block: "oak_log",
            count: Math.max(1, 3 - logs),
            range: 128,
          },
        },
        expectation: "Collect enough oak logs to craft planks, sticks, a crafting table, and a wooden pickaxe.",
        waitMs: 1000,
      };
    }

    return {
      type: "continue",
      action: {
        type: "prepare_wooden_pickaxe",
      },
      expectation: "Craft and equip a wooden pickaxe from current inventory.",
      waitMs: 1000,
    };
  },
};

const woodenShelterStrategy: MinecraftStrategyCode = {
  id: "wooden_shelter",
  description: "Prepare oak planks and build a tiny wooden shelter.",
  decide(frame, context) {
    if (!frame.observation.connected || !frame.observation.spawned) {
      return {
        type: "fail",
        reason: "Minecraft Cursor is not connected and spawned.",
      };
    }

    if (context.lastActionResult && !context.lastActionResult.ok) {
      return {
        type: "fail",
        reason: `wooden_shelter strategy stopped after failed action: ${context.lastActionResult.summary}`,
      };
    }

    if (inventoryCount(frame, "oak_planks") >= 9) {
      return {
        type: "continue",
        action: {
          type: "build_wooden_house",
          input: {
            width: 3,
            depth: 3,
            height: 2,
          },
        },
        expectation: "Use available oak planks to place a small shelter footprint.",
        waitMs: 1000,
      };
    }

    if (inventoryCount(frame, "oak_log") > 0) {
      return {
        type: "continue",
        action: {
          type: "craft_recipe",
          input: {
            item: "oak_planks",
            count: Math.min(12, inventoryCount(frame, "oak_log") * 4),
          },
        },
        expectation: "Convert oak logs into planks before building.",
        waitMs: 1000,
      };
    }

    return {
      type: "continue",
      action: {
        type: "collect_blocks",
        input: {
          block: "oak_log",
          count: 3,
          range: 128,
        },
      },
      expectation: "Collect logs for a small wooden shelter.",
      waitMs: 1000,
    };
  },
};

const ironProspectingStrategy: MinecraftStrategyCode = {
  id: "iron_prospect",
  description: "Look around and keep prospecting until nearby iron ore can be collected.",
  decide(frame, context) {
    if (!frame.observation.connected || !frame.observation.spawned) {
      return {
        type: "fail",
        reason: "Minecraft Cursor is not connected and spawned.",
      };
    }

    if (inventoryCount(frame, "raw_iron") >= 3 || inventoryCount(frame, "iron_ore") >= 3) {
      return {
        type: "complete",
        summary: "Collected enough iron material.",
      };
    }

    if (nearbyBlockCount(frame, "iron_ore") > 0 || nearbyBlockCount(frame, "deepslate_iron_ore") > 0) {
      return {
        type: "continue",
        action: {
          type: "collect_blocks",
          input: {
            block: nearbyBlockCount(frame, "iron_ore") > 0 ? "iron_ore" : "deepslate_iron_ore",
            count: 3,
            range: 128,
          },
        },
        expectation: "Collect visible iron ore after locating it nearby.",
        waitMs: 1000,
      };
    }

    if (context.lastActionResult && !context.lastActionResult.ok) {
      context.notes.push(`Previous prospecting action failed: ${context.lastActionResult.summary}`);
    }

    const pos = frame.observation.position;
    if (!pos) {
      return {
        type: "wait",
        reason: "Waiting for a stable Minecraft position before prospecting.",
        waitMs: 1000,
      };
    }

    const hint = coordinateHint(context);
    if (hint && context.stepCount < 2) {
      return {
        type: "continue",
        action: {
          type: "goto",
          input: {
            x: hint.x,
            y: hint.y,
            z: hint.z,
            range: 4,
          },
        },
        expectation: "Move to the user-provided exposed iron location and observe there.",
        waitMs: 1500,
      };
    }

    const offsets = [
      { x: 16, z: 0 },
      { x: 0, z: 16 },
      { x: -16, z: 0 },
      { x: 0, z: -16 },
      { x: 24, z: 24 },
      { x: -24, z: 24 },
    ];
    const offset = offsets[context.stepCount % offsets.length];

    return {
      type: "continue",
      action: {
        type: "goto",
        input: {
          x: Math.floor(pos.x + offset.x),
          y: Math.floor(pos.y),
          z: Math.floor(pos.z + offset.z),
          range: 2,
        },
      },
      expectation: "Move to a nearby prospecting point and observe again for iron ore.",
      waitMs: 1500,
    };
  },
};

export const minecraftStrategyRegistry = new Map<string, MinecraftStrategyCode>(
  [
    idleObserveStrategy,
    woodenPickaxeStrategy,
    woodenShelterStrategy,
    ironProspectingStrategy,
  ].map((strategy) => [
    strategy.id,
    strategy,
  ])
);

export function getMinecraftStrategy(strategyId: string): MinecraftStrategyCode | null {
  return minecraftStrategyRegistry.get(strategyId) ?? null;
}
