import type { WorldSnapshot } from "../../capabilities/world_state/schema.js";

/**
 * 世界状态视图 (World State View)
 */
export class WorldStateView {
  public render(snapshot: WorldSnapshot): string {
    const lines: string[] = [];
    lines.push(`World Snapshot: v${snapshot.version}`);
    lines.push(`Scenes: ${snapshot.scenes.join(", ")}`);
    lines.push(`Entities: ${Object.keys(snapshot.entities).length}`);
    
    for (const id in snapshot.entities) {
      const entity = snapshot.entities[id];
      lines.push(`  - [${entity.kind}] ${entity.name} (${id})`);
      lines.push(`    Location: scene=${entity.location.sceneId}, parent=${entity.location.parentId || "none"}`);
      lines.push(`    State: ${JSON.stringify(entity.state)}`);
    }

    return lines.join("\n");
  }
}
