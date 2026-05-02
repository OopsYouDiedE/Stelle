import type { DebugCommandDefinition } from "../contracts/debug_provider.js";

export interface DebugAuditEntry {
  timestamp: number;
  providerId: string;
  commandId: string;
  risk: DebugCommandDefinition["risk"];
  requester: "local" | "remote";
  allowed: boolean;
  reason: string;
}

export class DebugSecurityPolicy {
  private auditLog: DebugAuditEntry[] = [];

  constructor(
    private config: {
      allowRemote: boolean;
      localOnly: boolean;
      trustedTokens: string[];
      operatorMode?: boolean;
      allowExternalEffect?: boolean;
      allowedRemoteRuntimeCommands?: string[];
    },
  ) {}

  canAccess(token?: string, isLocal?: boolean): boolean {
    if (this.config.localOnly && !isLocal) return false;
    if (isLocal) return true;
    if (!this.config.allowRemote) return false;
    return !!token && this.config.trustedTokens.includes(token);
  }

  canRunCommand(risk: DebugCommandDefinition["risk"], isLocal?: boolean, commandId?: string): boolean {
    if (isLocal) return true;
    if (risk === "read" || risk === "safe_write") return true;
    if (risk === "runtime_control") {
      return this.config.allowedRemoteRuntimeCommands?.includes(commandId ?? "") ?? false;
    }
    if (risk === "external_effect") {
      return Boolean(this.config.operatorMode && this.config.allowExternalEffect);
    }
    return false;
  }

  recordCommand(input: Omit<DebugAuditEntry, "timestamp">): void {
    this.auditLog.push({ ...input, timestamp: Date.now() });
    if (this.auditLog.length > 500) this.auditLog.shift();
  }

  getAuditLog(): DebugAuditEntry[] {
    return [...this.auditLog];
  }
}
