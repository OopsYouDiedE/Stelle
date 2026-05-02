export interface DebugProvider {
  id: string;
  title: string;
  ownerPackageId: string;
  panels?: DebugPanelDefinition[];
  commands?: DebugCommandDefinition[];
  getSnapshot?(): Promise<unknown> | unknown;
}

export interface DebugPanelDefinition {
  id: string;
  title: string;
  kind: "json" | "table" | "log" | "timeline" | "custom";
  getData(): Promise<unknown> | unknown;
}

export interface DebugCommandDefinition {
  id: string;
  title: string;
  risk: "read" | "safe_write" | "runtime_control" | "external_effect";
  run(input: unknown): Promise<unknown> | unknown;
}
