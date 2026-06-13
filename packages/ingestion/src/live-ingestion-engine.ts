import { prisma } from "@edgar-eye/database";
import type { Env, IngestedDocument } from "@edgar-eye/shared";
import {
  AccessionPredictor,
  buildIndexUrl,
} from "./accession-predictor.js";
import {
  SecFilingClient,
  sleep,
  type SecSubmissionFiling,
} from "./sec-filing-client.js";

export interface LiveFiling {
  document: IngestedDocument;
  rawText: string;
  cleanedText: string;
}

interface TickerMapping {
  ticker: string;
  cik: string;
}

export class LiveIngestionEngine {
  private readonly client: SecFilingClient;
  private readonly predictor = new AccessionPredictor();
  private readonly seenAccessions = new Set<string>();
  private readonly tickerMappings = new Map<string, TickerMapping>();
  private running = false;

  constructor(private readonly env: Env) {
    this.client = new SecFilingClient(env, { logPrefix: "[LiveIngestion]" });
  }

  async start(
    tickers: string[],
    onFiling: (filing: LiveFiling) => Promise<void>,
  ): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;

    await this.seedTickerMappings(tickers);
    await this.seedKnownAccessions();

    while (this.running) {
      try {
        await this.pollTickers(onFiling);
        await this.pollPredictedAccessions(onFiling);
      } catch (error) {
        console.error("[LiveIngestion] Poll cycle error:", error);
      }

      await sleep(this.env.SEC_POLL_INTERVAL_MS);
    }
  }

  stop(): void {
    this.running = false;
  }

  private async pollTickers(
    onFiling: (filing: LiveFiling) => Promise<void>,
  ): Promise<void> {
    for (const mapping of this.tickerMappings.values()) {
      const submissions = await this.client.fetchSubmissions(mapping.cik);
      if (!submissions) {
        continue;
      }

      const filings = this.client.parseSubmissionResponse(submissions);
      for (const filing of filings) {
        if (filing.form !== "8-K") {
          continue;
        }
        this.predictor.registerKnown(mapping.cik, filing.accessionNumber);

        if (!this.isRecentFiling(filing.filingDate)) {
          this.seenAccessions.add(filing.accessionNumber);
          continue;
        }

        await this.processFiling(mapping, filing, onFiling);
      }
    }
  }

  private async pollPredictedAccessions(
    onFiling: (filing: LiveFiling) => Promise<void>,
  ): Promise<void> {
    for (const mapping of this.tickerMappings.values()) {
      const candidates = this.predictor.predictNext(mapping.cik, 5);
      for (const candidate of candidates) {
        if (this.seenAccessions.has(candidate.accessionNumber)) {
          continue;
        }

        const indexUrl = buildIndexUrl(mapping.cik, candidate.accessionNumber);
        const exists = await this.client.headExists(indexUrl);

        if (!exists) {
          continue;
        }

        const filing: SecSubmissionFiling = {
          accessionNumber: candidate.accessionNumber,
          form: "8-K",
          primaryDocument: `${candidate.accessionNumber}.txt`,
          filingDate: new Date().toISOString().slice(0, 10),
        };

        await this.processFiling(mapping, filing, onFiling, true);
      }
    }
  }

  private async processFiling(
    mapping: TickerMapping,
    filing: SecSubmissionFiling,
    onFiling: (filing: LiveFiling) => Promise<void>,
    fromPrediction = false,
  ): Promise<void> {
    if (this.seenAccessions.has(filing.accessionNumber) && !fromPrediction) {
      return;
    }

    const existing = await this.client.findExistingAccession(
      filing.accessionNumber,
    );
    if (existing) {
      this.seenAccessions.add(filing.accessionNumber);
      this.predictor.confirm(mapping.cik, filing.accessionNumber);
      return;
    }

    if (!fromPrediction && !this.isRecentFiling(filing.filingDate)) {
      return;
    }

    const rawText = await this.client.fetchFilingText(mapping.cik, filing);
    if (!rawText) {
      return;
    }

    // Predicted accessions have a fabricated form; the document header is the
    // authoritative source. Skip anything that is not an actual 8-K so we never
    // generate trading signals from 10-Qs, Form 4s, etc.
    const submissionType =
      this.client.extractSubmissionType(rawText) ?? filing.form;
    if (submissionType !== "8-K") {
      this.seenAccessions.add(filing.accessionNumber);
      this.predictor.confirm(mapping.cik, filing.accessionNumber);
      return;
    }

    const document = await this.client.persistFiling({
      ticker: mapping.ticker,
      filing,
      rawText,
      submissionType,
    });
    if (!document) {
      this.seenAccessions.add(filing.accessionNumber);
      this.predictor.confirm(mapping.cik, filing.accessionNumber);
      return;
    }

    this.seenAccessions.add(filing.accessionNumber);
    this.predictor.confirm(mapping.cik, filing.accessionNumber);

    await onFiling({
      document: {
        id: document.id,
        source: document.source,
        ticker: document.ticker,
        title: document.title,
        accessionNumber: document.accessionNumber ?? undefined,
        filedAt: document.filedAt?.toISOString(),
        cleanedTextPreview: document.cleanedText.slice(0, 280),
      },
      rawText,
      cleanedText: document.cleanedText,
    });
  }

  private async seedTickerMappings(tickers: string[]): Promise<void> {
    for (const ticker of tickers) {
      const cik = await this.client.lookupCik(ticker);
      if (cik) {
        this.tickerMappings.set(ticker, { ticker, cik });
      }
    }
  }

  private async seedKnownAccessions(): Promise<void> {
    const recent = await prisma.documentLog.findMany({
      where: { accessionNumber: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    for (const doc of recent) {
      if (doc.accessionNumber) {
        this.seenAccessions.add(doc.accessionNumber);
      }
    }
  }

  private isRecentFiling(filingDate: string): boolean {
    const filed = new Date(filingDate);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return filed.getTime() >= cutoff;
  }
}
