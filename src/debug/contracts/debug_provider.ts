export type DebugCommandRisk = "read" | "safe_write" | "runtime_control" | "external_effect";

export interface DebugPanelDefinition<TData = unknown> {
  id: string;
  title: string;
  kind: "json" | "table" | "text" | "event_stream" | "custom";
  getData?(): Promise<TData> | TData;
  metadata?: Record<string, unknown>;
}

export interface DebugCommandDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  title: string;
  risk: DebugCommandRisk;
  run(input: TInput): Promise<TOutput> | TOutput;
  metadata?: Record<string, unknown>;
}

export interface DebugProvider {
  id: string;
  title: string;
  ownerPackageId: string;
  panels?: DebugPanelDefinition[];
  commands?: DebugCommandDefinition[];
  getSnapshot?(): Promise<unknown> | unknown;
}
