export type CursorStatus =
  | "idle"
  | "active"
  | "busy"
  | "degraded"
  | "error"
  | "offline";

export type AuthorityClass = "cursor" | "stelle" | "user" | "system";
export type ToolCaller = "stelle" | "front_actor" | "cursor" | "user" | "system";
export type RiskLevel = "low" | "medium" | "high";

export interface ResourceReference {
  id: string;
  kind: "file" | "image" | "audio" | "video" | "summary" | "memory" | "state" | "web";
  uri?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface ContextStreamItem {
  id: string;
  type: "text" | "resource" | "event" | "summary" | "state";
  source: string;
  timestamp: number;
  content?: string;
  resourceRef?: ResourceReference;
  trust: "internal" | "cursor" | "external" | "unknown";
  metadata?: Record<string, unknown>;
}

export interface RuntimePrompt {
  cursorId: string;
  generatedAt: number;
  summary: string;
  rules: string[];
  toolNamespaces: string[];
}

export interface CursorIdentity {
  id: string;
  kind: string;
  displayName?: string;
  version?: string;
}

export interface CursorState {
  cursorId: string;
  status: CursorStatus;
  attached: boolean;
  summary: string;
  lastInputAt?: number;
  lastObservedAt?: number;
  lastReportAt?: number;
  lastErrorAt?: number;
}

export interface CursorObservation {
  cursorId: string;
  timestamp: number;
  stream: ContextStreamItem[];
  stateSummary: string;
}

export interface CursorToolNamespace {
  cursorId: string;
  namespaces: string[];
  tools: CursorToolRef[];
}

export interface CursorToolRef {
  name: string;
  namespace: string;
  authorityClass: "cursor";
  summary: string;
  authorityHint: string;
}

export interface CursorEscalationRule {
  id: string;
  summary: string;
  severity: "notice" | "warning" | "error";
}

export interface CursorPolicy {
  allowPassiveResponse: boolean;
  allowBackgroundTick: boolean;
  allowInitiativeWhenAttached: boolean;
  passiveResponseRisk: "none" | "low" | "medium";
  escalationRules: CursorEscalationRule[];
}

export interface CursorConfig {
  cursorId: string;
  version: string;
  behavior: Record<string, unknown>;
  runtime: Record<string, unknown>;
  permissions: Record<string, unknown>;
  updatedAt: number;
}

export interface CursorPendingItem {
  id: string;
  summary: string;
  priority: "low" | "normal" | "high";
  createdAt: number;
}

export interface CursorContextSnapshot {
  cursorId: string;
  kind: string;
  timestamp: number;
  stateSummary: string;
  recentStream: ContextStreamItem[];
  resourceRefs: ResourceReference[];
  pendingItems: CursorPendingItem[];
  safetyNotes?: string[];
}

export interface CursorReport {
  id: string;
  cursorId: string;
  type: string;
  severity: "debug" | "info" | "notice" | "warning" | "error";
  summary: string;
  payload?: Record<string, unknown>;
  needsAttention: boolean;
  timestamp: number;
}

export interface CursorAttachContext {
  reason: string;
  runtimePrompt: RuntimePrompt;
  transferredStream: ContextStreamItem[];
  previousSnapshot?: CursorContextSnapshot;
}

export interface CursorAttachResult {
  state: CursorState;
  observation: CursorObservation;
  tools: CursorToolNamespace;
}

export interface CursorHost {
  readonly identity: CursorIdentity;
  readonly policy: CursorPolicy;
  getState(): CursorState;
  getToolNamespace(): CursorToolNamespace;
  attach(context: CursorAttachContext): Promise<CursorAttachResult>;
  detach(reason: string): Promise<CursorContextSnapshot>;
  observe(): Promise<CursorObservation>;
  saveConfigAsync(): Promise<void>;
  updateConfig(patch: Partial<CursorConfig>, reason: string): Promise<CursorReport>;
  tick?(): Promise<CursorReport[]>;
  passiveRespond?(input: ContextStreamItem): Promise<CursorReport[]>;
}

export interface ToolIdentity {
  name: string;
  namespace: string;
  authorityClass: AuthorityClass;
  version?: string;
  displayName?: string;
}

export interface ToolDescription {
  summary: string;
  whenToUse: string;
  whenNotToUse?: string;
}

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolSideEffectProfile {
  externalVisible: boolean;
  writesFileSystem: boolean;
  networkAccess: boolean;
  startsProcess: boolean;
  changesConfig: boolean;
  consumesBudget: boolean;
  affectsUserState: boolean;
}

export interface ToolAuthorityRequirement {
  level:
    | "read"
    | "local_write"
    | "external_write"
    | "process_control"
    | "config_change"
    | "admin";
  scopes: string[];
  requiresUserConfirmation: boolean;
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
  detail?: Record<string, unknown>;
}

export interface ToolSideEffect {
  type: string;
  summary: string;
  visible: boolean;
  timestamp: number;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
  error?: ToolError;
  sideEffects?: ToolSideEffect[];
}

export interface RuntimeAuthority {
  caller: ToolCaller;
  allowedAuthorityClasses: AuthorityClass[];
  confirmed?: boolean;
}

export interface ToolAuditRecord {
  id: string;
  toolName: string;
  namespace: string;
  caller: ToolCaller;
  cursorId?: string;
  authorityLevel: string;
  inputSummary: string;
  resultSummary: string;
  sideEffects: ToolSideEffect[];
  startedAt: number;
  finishedAt: number;
  ok: boolean;
}

export interface AuditSink {
  record(record: ToolAuditRecord): void | Promise<void>;
}

export interface ToolExecutionContext {
  caller: ToolCaller;
  cursorId?: string;
  conversationId?: string;
  cwd?: string;
  authority: RuntimeAuthority;
  audit: AuditSink;
  signal?: AbortSignal;
}

export interface ToolDefinition<TInput extends Record<string, unknown> = Record<string, unknown>> {
  identity: ToolIdentity;
  description: ToolDescription;
  inputSchema: ToolInputSchema;
  sideEffects: ToolSideEffectProfile;
  authority: ToolAuthorityRequirement;
  validate?(input: Record<string, unknown>, context: ToolExecutionContext): ToolResult | void;
  execute(input: TInput, context: ToolExecutionContext): Promise<ToolResult> | ToolResult;
}

export interface CoreMindIdentity {
  id: string;
  name: "Stelle";
  version?: string;
}

export interface AttachmentState {
  currentCursorId: string;
  previousCursorId?: string;
  mode: "inner" | "attached" | "switching" | "detached";
  attachedAt: number;
  reason: string;
}

export interface CoreMindCursorView {
  cursorId: string;
  kind: string;
  status: string;
  summary: string;
  canAttach: boolean;
  needsAttention: boolean;
}

export interface CoreMindToolView {
  cursorTools: ToolIdentity[];
  stelleTools: ToolIdentity[];
}

export interface CoreGoal {
  id: string;
  summary: string;
  priority: "low" | "normal" | "high";
}

export interface PendingQuestion {
  id: string;
  question: string;
  createdAt: number;
}

export interface PrivacyMemoryRef {
  id: string;
  summary: string;
  visibility: "inner_only" | "current_cursor" | "approved_cursors";
}

export interface ContinuityState {
  recentCursorIds: string[];
  activeGoals: CoreGoal[];
  pendingQuestions: PendingQuestion[];
  recentSnapshots: CursorContextSnapshot[];
  privacyMemories: PrivacyMemoryRef[];
  selfSummary: string;
}

export interface DeliberationState {
  focus: string;
  intention?: string;
  confidence: number;
  risk: RiskLevel;
  nextAction?: CoreMindActionPlan;
}

export interface CoreMindActionPlan {
  type: "observe" | "switch_cursor" | "use_tool" | "wait" | "return_inner";
  summary: string;
  targetCursorId?: string;
  toolFullName?: string;
}

export interface CoreMindDecisionRecord {
  id: string;
  type: string;
  summary: string;
  cursorId: string;
  toolName?: string;
  authorityClass?: string;
  reason: string;
  risk: RiskLevel;
  timestamp: number;
}

export interface CoreMindConfig {
  coreMindId: string;
  version: string;
  defaultCursorId: string;
  behavior: Record<string, unknown>;
  continuity: Record<string, unknown>;
  toolPolicy: Record<string, unknown>;
  updatedAt: number;
}
