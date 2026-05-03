import { RuntimeHost } from "../src/runtime/host.js";
import { StelleEventBus } from "../src/core/event/event_bus.js";

/**
 * 实时角色扮演模拟脚本 (Live RP Simulation)
 * 用于演示真实 LLM 驱动下的主观决策循环。
 */
async function runSimulation() {
  console.log("--- Starting Live RP Simulation ---");

  const host = new RuntimeHost("runtime");
  await host.start();

  const eventBus = host.events;

  // 1. 初始化世界状态 (确保实体存在)
  console.log("\n[Step 1] Initializing world state...");

  // 模拟一个合法的实体创建 (MVP 目前没有 CREATE_ENTITY，我们先初始化快照)
  // 或者我们直接更新，假设 WorldStateCapability 构造函数已经初始化了基础实体
  // 为了确保 room-001 存在，我们在 WorldStateCapability 已经默认有了 default_room，我们改用它

  eventBus.publish({
    type: "world.action.propose",
    source: "simulation_script",
    payload: {
      type: "UPDATE_ENTITY_STATE",
      actorId: "system",
      payload: { 
        entityId: "character-stelle", // 假设存在
        patch: { mood: "happy" }
      }
    }
  });

  // 2. 注入用户消息
  console.log("\n[Step 2] User: 'Stelle, it's a bit messy here, and my head hurts.'");
  eventBus.publish({
    type: "perception.text.received",
    source: "user_sim",
    id: "user-msg-001",
    correlationId: "corr-sim-001",
    payload: { text: "Stelle, it's a bit messy here, and my head hurts." }
  });

  // 3. 监控决策循环
  eventBus.subscribe("cycle.completed", (event) => {
    const { cycle, narrative } = event.payload as any;
    console.log(`\n--- Decision Cycle Completed [${cycle.cycleId}] ---`);
    console.log(`Summary: ${narrative.summary}`);
    console.log(`Status: ${cycle.status}`);

    // 4. 请求解释
    console.log(`\n[Step 3] Requesting explanation for choice...`);
    eventBus.publish({
      type: "cognition.explain.requested",
      source: "simulation_script",
      correlationId: cycle.correlationId,
      payload: { cycleId: cycle.cycleId }
    });
  });

  eventBus.subscribe("cognition.explain.completed", (event) => {
    const { explanation } = event.payload as any;
    console.log(`\n--- Stelle's Rationale ---`);
    console.log(explanation);
  });
...

  eventBus.subscribe("reflection.generated", (event) => {
    const { insights } = event.payload as any;
    console.log(`\n*** New Reflection Insight Generated ***`);
    insights.forEach((i: any) => console.log(`- [${i.category}] ${i.summary}`));
  });

  // 运行一段时间以观察模拟效果
  await new Promise(resolve => setTimeout(resolve, 60000));
  
  await host.stop();
  console.log("\n--- Simulation Finished ---");
}

runSimulation().catch(console.error);
