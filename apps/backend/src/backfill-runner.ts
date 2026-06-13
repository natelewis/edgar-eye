import { randomUUID } from "node:crypto";
import {
  HistoricalIngestionEngine,
  type BackfillProgress,
} from "@edgar-eye/ingestion";
import type { Env } from "@edgar-eye/shared";
import type { EventBroadcaster } from "./event-broadcaster.js";

export interface BackfillRunOptions {
  ticker: string;
  limit?: number;
  since?: string;
  until?: string;
}

export interface BackfillRunnerDeps {
  env: Env;
  broadcaster: EventBroadcaster;
  engine?: HistoricalIngestionEngine;
}

export class BackfillRunner {
  private running = false;
  private readonly env: Env;
  private readonly broadcaster: EventBroadcaster;
  private readonly engine: HistoricalIngestionEngine;

  constructor(deps: BackfillRunnerDeps) {
    this.env = deps.env;
    this.broadcaster = deps.broadcaster;
    this.engine = deps.engine ?? new HistoricalIngestionEngine(this.env);
  }

  isRunning(): boolean {
    return this.running;
  }

  /// Starts a backfill. The returned `backfillId` is available immediately;
  /// `completion` resolves when all candidate filings have been processed.
  run(
    options: BackfillRunOptions,
  ): { backfillId: string; completion: Promise<void> } {
    if (this.running) {
      throw new Error("A backfill is already running");
    }

    this.running = true;
    const backfillId = randomUUID();
    const ticker = options.ticker.trim().toUpperCase();

    const completion = this.execute(backfillId, ticker, options).finally(() => {
      this.running = false;
    });

    return { backfillId, completion };
  }

  private async execute(
    backfillId: string,
    ticker: string,
    options: BackfillRunOptions,
  ): Promise<void> {
    try {
      const result = await this.engine.backfill(
        {
          ticker,
          limit: options.limit,
          since: options.since,
          until: options.until,
        },
        (progress: BackfillProgress) => {
          this.broadcaster.broadcast({
            type: "backfill_progress",
            backfillId,
            ticker,
            processed: progress.processed,
            total: progress.total,
            ingested: progress.ingested,
            skipped: progress.skipped,
            timestamp: new Date().toISOString(),
          });
        },
      );

      this.broadcaster.broadcast({
        type: "backfill_complete",
        backfillId,
        ticker,
        ingested: result.ingested,
        skipped: result.skipped,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Backfill failed unexpectedly";
      this.broadcaster.broadcast({
        type: "backfill_failed",
        backfillId,
        ticker,
        reason,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
