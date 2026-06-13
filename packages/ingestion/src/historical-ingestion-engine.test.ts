import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentLog } from "@edgar-eye/database";
import { loadEnv } from "@edgar-eye/shared";
import { SecFilingClient, type SecSubmissionFiling } from "./sec-filing-client.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    documentLog: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@edgar-eye/database", () => ({
  prisma: prismaMock,
}));

const env = loadEnv({
  DATABASE_URL: "postgresql://localhost:5433/test",
  TRADING_MODE: "PAPER",
});

function makeFiling(
  accessionNumber: string,
  filingDate: string,
): SecSubmissionFiling {
  return {
    accessionNumber,
    form: "8-K",
    primaryDocument: `${accessionNumber}.txt`,
    filingDate,
  };
}

function makeDocument(accessionNumber: string): DocumentLog {
  return {
    id: `doc-${accessionNumber}`,
    source: "SEC_8K",
    ticker: "TSLA",
    title: `TSLA 8-K ${accessionNumber}`,
    rawText: "raw",
    cleanedText: "x".repeat(120),
    accessionNumber,
    filedAt: new Date("2024-06-01"),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("HistoricalIngestionEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ingests new 8-K filings and skips existing ones", async () => {
    const { HistoricalIngestionEngine } = await import(
      "./historical-ingestion-engine.js"
    );

    const filings = [
      makeFiling("0001104659-24-000001", "2024-06-10"),
      makeFiling("0001104659-24-000002", "2024-05-01"),
    ];

    const client = {
      lookupCik: vi.fn(async () => "0001318605"),
      collect8KFilings: vi.fn(async () => filings),
      findExistingAccession: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeDocument(filings[1]!.accessionNumber)),
      fetchFilingText: vi.fn(async () =>
        "CONFORMED SUBMISSION TYPE: 8-K\n".concat("x".repeat(120)),
      ),
      extractSubmissionType: vi.fn(() => "8-K"),
      persistFiling: vi.fn(async () => makeDocument(filings[0]!.accessionNumber)),
    } as unknown as SecFilingClient;

    const progressReports: Array<{
      processed: number;
      total: number;
      ingested: number;
      skipped: number;
    }> = [];

    const engine = new HistoricalIngestionEngine(env, client);
    const result = await engine.backfill(
      { ticker: "TSLA", limit: 2 },
      (progress) => progressReports.push(progress),
    );

    expect(result).toEqual({ ingested: 1, skipped: 1 });
    expect(client.collect8KFilings).toHaveBeenCalledWith("0001318605", {
      since: undefined,
      until: undefined,
      limit: 2,
    });
    expect(client.persistFiling).toHaveBeenCalledTimes(1);
    expect(progressReports.at(-1)).toMatchObject({
      processed: 2,
      total: 2,
      ingested: 1,
      skipped: 1,
    });
  });

  it("throws when the ticker cannot be resolved", async () => {
    const { HistoricalIngestionEngine } = await import(
      "./historical-ingestion-engine.js"
    );

    const client = {
      lookupCik: vi.fn(async () => null),
    } as unknown as SecFilingClient;

    const engine = new HistoricalIngestionEngine(env, client);

    await expect(
      engine.backfill({ ticker: "UNKNOWN" }),
    ).rejects.toThrow(/unknown ticker/i);
  });
});

describe("SecFilingClient.collect8KFilings", () => {
  it("filters by form, date range, and limit", async () => {
    const client = new SecFilingClient(env, { logPrefix: "[Test]" });

    vi.spyOn(client, "fetchSubmissions").mockResolvedValue({
      cik: "0001318605",
      name: "TESLA INC",
      filings: {
        recent: {
          accessionNumber: [
            "0001104659-24-000001",
            "0001104659-24-000002",
            "0001104659-24-000003",
          ],
          form: ["8-K", "10-Q", "8-K"],
          primaryDocument: ["a.txt", "b.txt", "c.txt"],
          filingDate: ["2024-06-10", "2024-06-09", "2024-01-01"],
        },
        files: [],
      },
    });

    const filings = await client.collect8KFilings("0001318605", {
      since: "2024-02-01",
      until: "2024-12-31",
      limit: 1,
    });

    expect(filings).toHaveLength(1);
    expect(filings[0]?.accessionNumber).toBe("0001104659-24-000001");
  });

  it("parses paginated submission files with root-level arrays", async () => {
    const client = new SecFilingClient(env, { logPrefix: "[Test]" });

    vi.spyOn(client, "secFetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          accessionNumber: ["0001104659-23-000001"],
          form: ["8-K"],
          primaryDocument: ["d.txt"],
          filingDate: ["2023-06-01"],
        }),
        { status: 200 },
      ),
    );

    const filings = await client.fetchPaginatedSubmissionFile(
      "CIK0001318605-submissions-001.json",
    );

    expect(filings).toHaveLength(1);
    expect(filings[0]?.form).toBe("8-K");
  });
});
