import type { ChatCluster, ProgramEventSample } from "./types.js";

export interface AnonymousCommunityMapState {
  totalSamples: number;
  heat: Array<{ label: string; count: number; intensity: number }>;
  participationTypes: Array<{ type: string; count: number }>;
  updatedAt: number;
}

export function buildAnonymousCommunityMap(input: {
  clusters: ChatCluster[];
  samples: ProgramEventSample[];
  now?: () => number;
}): AnonymousCommunityMapState {
  const maxCount = Math.max(1, ...input.clusters.map((cluster) => cluster.count));
  const participation = new Map<string, number>();
  for (const sample of input.samples) {
    const type = sample.priority === "high" ? "高优先互动" : sample.kind === "super_chat" ? "付费留言" : "普通讨论";
    participation.set(type, (participation.get(type) ?? 0) + 1);
  }
  return {
    totalSamples: input.samples.length,
    heat: input.clusters.map((cluster) => ({
      label: cluster.label,
      count: cluster.count,
      intensity: Math.round((cluster.count / maxCount) * 100),
    })),
    participationTypes: [...participation.entries()].map(([type, count]) => ({ type, count })),
    updatedAt: input.now?.() ?? Date.now(),
  };
}
