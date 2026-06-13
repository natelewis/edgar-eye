import { prisma, type DocumentLog } from "@edgar-eye/database";
import type { Env } from "@edgar-eye/shared";
import { buildFilingUrl } from "./accession-predictor.js";
import { stripHtml } from "./html-stripper.js";
import { RateLimiter } from "./rate-limiter.js";

export interface SecSubmissionFiling {
  accessionNumber: string;
  form: string;
  primaryDocument: string;
  filingDate: string;
  reportDate?: string;
}

interface SecSubmissionBatch {
  accessionNumber: string[];
  form: string[];
  primaryDocument: string[];
  filingDate: string[];
  reportDate?: string[];
}

interface SecSubmissionsFileEntry {
  name: string;
  filingCount: number;
  filingFrom: string;
  filingTo: string;
}

export interface SecSubmissionsResponse {
  cik: string;
  name: string;
  tickers?: string[];
  filings: {
    recent: SecSubmissionBatch;
    files?: SecSubmissionsFileEntry[];
  };
}

export interface Collect8KFilingsOptions {
  since?: string;
  until?: string;
  limit?: number;
}

export class SecFilingClient {
  private readonly userAgent: string;
  private readonly rateLimiter: RateLimiter;
  private readonly logPrefix: string;

  constructor(
    env: Env,
    options?: { logPrefix?: string; requestsPerSecond?: number },
  ) {
    this.userAgent = env.SEC_USER_AGENT;
    this.rateLimiter = new RateLimiter(options?.requestsPerSecond ?? 9);
    this.logPrefix = options?.logPrefix ?? "[SecFilingClient]";
  }

  async lookupCik(ticker: string): Promise<string | null> {
    const url = "https://www.sec.gov/files/company_tickers.json";
    const response = await this.secFetch(url);

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as Record<
      string,
      { cik_str: number; ticker: string }
    >;

    const match = Object.values(data).find(
      (entry) => entry.ticker.toUpperCase() === ticker.toUpperCase(),
    );

    return match ? String(match.cik_str).padStart(10, "0") : null;
  }

  async fetchSubmissions(cik: string): Promise<SecSubmissionsResponse | null> {
    const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
    const response = await this.secFetch(url);

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as SecSubmissionsResponse;
  }

  parseSubmissionBatch(batch: SecSubmissionBatch): SecSubmissionFiling[] {
    const filings: SecSubmissionFiling[] = [];

    for (let i = 0; i < batch.accessionNumber.length; i++) {
      const accessionNumber = batch.accessionNumber[i];
      if (!accessionNumber) {
        continue;
      }

      filings.push({
        accessionNumber,
        form: batch.form[i] ?? "UNKNOWN",
        primaryDocument: batch.primaryDocument[i] ?? "",
        filingDate: batch.filingDate[i] ?? new Date().toISOString().slice(0, 10),
        reportDate: batch.reportDate?.[i],
      });
    }

    return filings;
  }

  /// Main CIK submissions JSON nests batches under `filings.recent`; paginated
  /// archive files (e.g. CIK0001318605-submissions-001.json) expose the arrays
  /// at the root instead.
  extractSubmissionBatch(data: unknown): SecSubmissionBatch | null {
    if (typeof data !== "object" || data === null) {
      return null;
    }

    const record = data as Record<string, unknown>;

    if (typeof record.filings === "object" && record.filings !== null) {
      const recent = (record.filings as { recent?: SecSubmissionBatch }).recent;
      if (recent?.accessionNumber) {
        return recent;
      }
    }

    if (Array.isArray(record.accessionNumber)) {
      return record as unknown as SecSubmissionBatch;
    }

    return null;
  }

  parseSubmissionResponse(data: unknown): SecSubmissionFiling[] {
    const batch = this.extractSubmissionBatch(data);
    if (!batch) {
      return [];
    }
    return this.parseSubmissionBatch(batch);
  }

  async fetchPaginatedSubmissionFile(
    name: string,
  ): Promise<SecSubmissionFiling[]> {
    const url = `https://data.sec.gov/submissions/${name}`;
    const response = await this.secFetch(url);

    if (!response.ok) {
      return [];
    }

    const data: unknown = await response.json();
    return this.parseSubmissionResponse(data);
  }

  async collect8KFilings(
    cik: string,
    options: Collect8KFilingsOptions = {},
  ): Promise<SecSubmissionFiling[]> {
    const submissions = await this.fetchSubmissions(cik);
    if (!submissions) {
      return [];
    }

    const allFilings: SecSubmissionFiling[] = this.parseSubmissionResponse(
      submissions,
    );

    for (const file of submissions.filings?.files ?? []) {
      const batchFilings = await this.fetchPaginatedSubmissionFile(file.name);
      allFilings.push(...batchFilings);
    }

    const sinceMs = options.since ? Date.parse(options.since) : null;
    const untilMs = options.until ? Date.parse(options.until) : null;

    const eightKs = allFilings
      .filter((filing) => filing.form === "8-K")
      .filter((filing) => {
        const filedMs = Date.parse(filing.filingDate);
        if (Number.isNaN(filedMs)) {
          return false;
        }
        if (sinceMs !== null && !Number.isNaN(sinceMs) && filedMs < sinceMs) {
          return false;
        }
        if (untilMs !== null && !Number.isNaN(untilMs) && filedMs > untilMs) {
          return false;
        }
        return true;
      })
      .sort(
        (a, b) => Date.parse(b.filingDate) - Date.parse(a.filingDate),
      );

    if (options.limit !== undefined) {
      return eightKs.slice(0, options.limit);
    }

    return eightKs;
  }

  async fetchFilingText(
    cik: string,
    filing: SecSubmissionFiling,
  ): Promise<string | null> {
    const url = buildFilingUrl(cik, filing.accessionNumber);
    const response = await this.secFetch(url);

    if (!response.ok) {
      return null;
    }

    return response.text();
  }

  async headExists(url: string): Promise<boolean> {
    const response = await this.secFetch(url, { method: "HEAD" });
    return response.ok;
  }

  extractSubmissionType(rawText: string): string | null {
    const match = rawText.match(/CONFORMED SUBMISSION TYPE:\s*(\S+)/i);
    return match?.[1]?.toUpperCase() ?? null;
  }

  async findExistingAccession(
    accessionNumber: string,
  ): Promise<DocumentLog | null> {
    return prisma.documentLog.findFirst({
      where: { accessionNumber },
    });
  }

  async persistFiling(params: {
    ticker: string;
    filing: SecSubmissionFiling;
    rawText: string;
    submissionType: string;
  }): Promise<DocumentLog | null> {
    const cleanedText = stripHtml(params.rawText);
    if (cleanedText.length < 100) {
      return null;
    }

    const title = `${params.ticker} ${params.submissionType} ${params.filing.filingDate}`;

    try {
      return await prisma.documentLog.create({
        data: {
          source: "SEC_8K",
          ticker: params.ticker,
          title,
          rawText: params.rawText,
          cleanedText,
          accessionNumber: params.filing.accessionNumber,
          filedAt: new Date(params.filing.filingDate),
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return null;
      }
      throw error;
    }
  }

  schedule<T>(task: () => Promise<T>): Promise<T> {
    return this.rateLimiter.schedule(task);
  }

  /// Centralized SEC fetch: rate-limited, sends the required User-Agent, and
  /// honors HTTP 429 Retry-After backoff instead of treating throttling as a
  /// missing resource.
  secFetch(url: string, init?: RequestInit): Promise<Response> {
    return this.rateLimiter.schedule(async () => {
      const doFetch = () =>
        fetch(url, {
          ...init,
          headers: { "User-Agent": this.userAgent, ...init?.headers },
        });

      const response = await doFetch();
      if (response.status !== 429) {
        return response;
      }

      const backoffMs = parseRetryAfter(response.headers.get("retry-after"));
      console.warn(
        `${this.logPrefix} SEC throttled (429), backing off ${backoffMs}ms: ${url}`,
      );
      await sleep(backoffMs);
      return doFetch();
    });
  }
}

export function parseRetryAfter(header: string | null): number {
  if (!header) {
    return 1000;
  }

  const seconds = Number(header);
  if (!Number.isNaN(seconds)) {
    return Math.max(seconds * 1000, 1000);
  }

  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    return Math.max(dateMs - Date.now(), 1000);
  }

  return 1000;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
