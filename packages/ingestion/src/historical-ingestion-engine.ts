import type { Env } from "@edgar-eye/shared";
import { SecFilingClient } from "./sec-filing-client.js";

export const DEFAULT_BACKFILL_LIMIT = 50;
export const MAX_BACKFILL_LIMIT = 200;

export interface BackfillOptions {
  ticker: string;
  limit?: number;
  since?: string;
  until?: string;
}

export interface BackfillProgress {
  processed: number;
  total: number;
  ingested: number;
  skipped: number;
}

export interface BackfillResult {
  ingested: number;
  skipped: number;
}

export class HistoricalIngestionEngine {
  private readonly client: SecFilingClient;

  constructor(
    env: Env,
    client?: SecFilingClient,
  ) {
    this.client =
      client ??
      new SecFilingClient(env, { logPrefix: "[HistoricalIngestion]" });
  }

  async backfill(
    options: BackfillOptions,
    onProgress?: (progress: BackfillProgress) => void,
  ): Promise<BackfillResult> {
    const ticker = options.ticker.trim().toUpperCase();
    const limit = clampLimit(options.limit);

    const cik = await this.client.lookupCik(ticker);
    if (!cik) {
      throw new Error(`Unknown ticker: ${ticker}`);
    }

    const candidates = await this.client.collect8KFilings(cik, {
      since: options.since,
      until: options.until,
      limit,
    });

    const total = candidates.length;
    let processed = 0;
    let ingested = 0;
    let skipped = 0;

    const reportProgress = () => {
      onProgress?.({ processed, total, ingested, skipped });
    };

    reportProgress();

    for (const filing of candidates) {
      const existing = await this.client.findExistingAccession(
        filing.accessionNumber,
      );
      if (existing) {
        processed += 1;
        skipped += 1;
        reportProgress();
        continue;
      }

      const rawText = await this.client.fetchFilingText(cik, filing);
      if (!rawText) {
        processed += 1;
        skipped += 1;
        reportProgress();
        continue;
      }

      const submissionType =
        this.client.extractSubmissionType(rawText) ?? filing.form;
      if (submissionType !== "8-K") {
        processed += 1;
        skipped += 1;
        reportProgress();
        continue;
      }

      const document = await this.client.persistFiling({
        ticker,
        filing,
        rawText,
        submissionType,
      });

      processed += 1;
      if (document) {
        ingested += 1;
      } else {
        skipped += 1;
      }
      reportProgress();
    }

    return { ingested, skipped };
  }
}

function clampLimit(limit?: number): number {
  if (limit === undefined) {
    return DEFAULT_BACKFILL_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_BACKFILL_LIMIT);
}
