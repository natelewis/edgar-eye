import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type HistoricalCacheNamespace =
  | "stock-last-trade"
  | "options-contracts"
  | "options-minute-bars";

export function stockLastTradeKey(
  ticker: string,
  normalizedEndIso: string,
): string {
  return `${ticker}|${normalizedEndIso}`;
}

export function optionsContractsKey(
  underlying: string,
  minExpiration: string,
  maxExpiration: string,
  historical: boolean,
): string {
  return `${underlying}|${minExpiration}|${maxExpiration}|${historical ? "historical" : "live"}`;
}

export function optionsMinuteBarsKey(
  symbols: string[],
  startIso: string,
  endIso: string,
): string {
  return `${[...symbols].sort().join(",")}|${startIso}|${endIso}`;
}

interface CacheEnvelope<T> {
  value: T;
}

let sharedCache: HistoricalDataCache | undefined;

export function createHistoricalDataCache(options?: {
  cacheDir?: string;
  enabled?: boolean;
}): HistoricalDataCache {
  return new HistoricalDataCache(options);
}

export function getSharedHistoricalDataCache(cacheDir?: string): HistoricalDataCache {
  if (!sharedCache) {
    sharedCache = new HistoricalDataCache({ cacheDir });
  }
  return sharedCache;
}

export function resetSharedHistoricalDataCacheForTests(): void {
  sharedCache = undefined;
}

export class HistoricalDataCache {
  private readonly memory = new Map<string, unknown>();
  private readonly cacheDir: string;
  private readonly enabled: boolean;

  constructor(options?: { cacheDir?: string; enabled?: boolean }) {
    this.cacheDir =
      options?.cacheDir ??
      path.join(process.cwd(), ".cache", "historical-data");
    this.enabled = options?.enabled ?? true;
  }

  async get<T>(
    namespace: HistoricalCacheNamespace,
    key: string,
  ): Promise<T | undefined> {
    if (!this.enabled) {
      return undefined;
    }

    const memoryKey = this.memoryKey(namespace, key);
    const cached = this.memory.get(memoryKey);
    if (cached !== undefined) {
      return cached as T;
    }

    const filePath = this.filePath(namespace, key);
    try {
      const raw = await readFile(filePath, "utf8");
      const envelope = JSON.parse(raw) as CacheEnvelope<T>;
      this.memory.set(memoryKey, envelope.value);
      return envelope.value;
    } catch {
      return undefined;
    }
  }

  async set<T>(
    namespace: HistoricalCacheNamespace,
    key: string,
    value: T,
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const memoryKey = this.memoryKey(namespace, key);
    this.memory.set(memoryKey, value);

    const filePath = this.filePath(namespace, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    const envelope: CacheEnvelope<T> = { value };
    await writeFile(filePath, JSON.stringify(envelope), "utf8");
  }

  private memoryKey(namespace: HistoricalCacheNamespace, key: string): string {
    return `${namespace}:${key}`;
  }

  private filePath(namespace: HistoricalCacheNamespace, key: string): string {
    const hash = createHash("sha256").update(key).digest("hex");
    return path.join(this.cacheDir, namespace, `${hash}.json`);
  }
}

export function serializeMinuteBars(
  bars: Array<{
    symbol: string;
    timestamp: Date;
    open: number;
    high: number;
    low: number;
    close: number;
  }>,
): Array<{
  symbol: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}> {
  return bars.map((bar) => ({
    ...bar,
    timestamp: bar.timestamp.toISOString(),
  }));
}

export function reviveMinuteBars(
  bars: Array<{
    symbol: string;
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
  }>,
): Array<{
  symbol: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
}> {
  return bars.map((bar) => ({
    ...bar,
    timestamp: new Date(bar.timestamp),
  }));
}
