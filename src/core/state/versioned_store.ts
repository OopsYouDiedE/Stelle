/**
 * 版本化存储键 (Versioned Store Key)
 */
export interface VersionedStoreKey {
  namespace: "world" | "memory" | "trace" | "config" | "system";
  partitionId: string; // 如 worldId, agentId, cycleId
  objectId: string;    // 如 "snapshot", "entries", "decision"
}

/**
 * 版本化条目 (Versioned Entry)
 */
export interface VersionedEntry<T = any> {
  key: VersionedStoreKey;
  version: number;
  data: T;
  ts: string;
}

/**
 * 版本化存储 (Versioned Store)
 * 提供按命名空间和分区隔离的版本化数据存储。
 */
export class VersionedStore {
  private storage = new Map<string, VersionedEntry[]>();

  /**
   * 写入数据并递增版本
   */
  public write<T>(key: VersionedStoreKey, data: T): VersionedEntry<T> {
    const storageKey = this.serializeKey(key);
    const history = this.storage.get(storageKey) || [];
    const lastVersion = history.length > 0 ? history[history.length - 1].version : 0;
    
    const entry: VersionedEntry<T> = {
      key,
      version: lastVersion + 1,
      data,
      ts: new Date().toISOString(),
    };

    history.push(entry);
    this.storage.set(storageKey, history);
    return entry;
  }

  /**
   * 读取最新版本
   */
  public readLatest<T>(key: VersionedStoreKey): VersionedEntry<T> | undefined {
    const storageKey = this.serializeKey(key);
    const history = this.storage.get(storageKey);
    if (!history || history.length === 0) return undefined;
    return history[history.length - 1];
  }

  /**
   * 读取指定版本
   */
  public readVersion<T>(key: VersionedStoreKey, version: number): VersionedEntry<T> | undefined {
    const storageKey = this.serializeKey(key);
    const history = this.storage.get(storageKey);
    if (!history) return undefined;
    return history.find((h) => h.version === version);
  }

  /**
   * 获取当前最高版本号
   */
  public getLatestVersion(key: VersionedStoreKey): number {
    const storageKey = this.serializeKey(key);
    const history = this.storage.get(storageKey);
    return history && history.length > 0 ? history[history.length - 1].version : 0;
  }

  private serializeKey(key: VersionedStoreKey): string {
    return `${key.namespace}/${key.partitionId}/${key.objectId}`;
  }
}
