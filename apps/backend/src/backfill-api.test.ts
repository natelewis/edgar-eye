import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { loadEnv } from "@edgar-eye/shared";
import {
  createApp,
  type BackfillService,
  type BacktestApp,
  type BacktestService,
} from "./app.js";

vi.mock("@edgar-eye/database", () => ({
  prisma: {
    tradeLog: { findMany: vi.fn(async () => []) },
    analysisReport: { findMany: vi.fn(async () => []) },
    documentLog: { findMany: vi.fn(async () => []) },
  },
}));

const env = loadEnv({
  DATABASE_URL: "postgresql://localhost:5433/test",
  TRADING_MODE: "PAPER",
  API_SECRET_KEY: "",
});

function buildApp(
  backtestOverrides: Partial<BacktestService> = {},
  backfillOverrides: Partial<BackfillService> = {},
) {
  const runner: BacktestService = {
    isRunning: () => false,
    countDocuments: async () => 5,
    run: async () => ({ runId: "run-1", completion: Promise.resolve() }),
    listRuns: async () => [],
    getRun: async () => null,
    ...backtestOverrides,
  };

  const backfillRunner: BackfillService = {
    isRunning: () => false,
    run: () => ({ backfillId: "backfill-1", completion: Promise.resolve() }),
    ...backfillOverrides,
  };

  const pipeline: BacktestApp = {
    getBacktestRunner: () => runner,
    getBackfillRunner: () => backfillRunner,
  };

  return createApp(pipeline, env);
}

describe("backfill API", () => {
  it("returns 202 with a backfillId when accepted", async () => {
    const app = buildApp();
    const response = await request(app)
      .post("/api/ingestion/backfill")
      .send({ ticker: "TSLA", limit: 25 });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      accepted: true,
      backfillId: "backfill-1",
    });
  });

  it("rejects a missing ticker with 400", async () => {
    const app = buildApp();
    const response = await request(app)
      .post("/api/ingestion/backfill")
      .send({ limit: 25 });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/ticker is required/i);
  });

  it("rejects a non-positive limit with 400", async () => {
    const app = buildApp();
    const response = await request(app)
      .post("/api/ingestion/backfill")
      .send({ ticker: "TSLA", limit: 0 });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/limit must be a positive number/i);
  });

  it("returns 409 when a backfill is already running", async () => {
    const app = buildApp({}, { isRunning: () => true });
    const response = await request(app)
      .post("/api/ingestion/backfill")
      .send({ ticker: "TSLA" });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/already running/i);
  });
});
