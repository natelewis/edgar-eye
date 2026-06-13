import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { loadEnv } from "@edgar-eye/shared";
import { createApp, type BacktestApp, type BacktestService } from "./app.js";

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

function buildApp(overrides: Partial<BacktestService> = {}) {
  const runner: BacktestService = {
    isRunning: () => false,
    countDocuments: async () => 5,
    run: async () => ({ runId: "run-1", completion: Promise.resolve() }),
    listRuns: async () => [],
    getRun: async () => null,
    ...overrides,
  };
  const pipeline: BacktestApp = {
    getBacktestRunner: () => runner,
    getBackfillRunner: () => ({
      isRunning: () => false,
      run: () => ({ backfillId: "backfill-1", completion: Promise.resolve() }),
    }),
  };
  return createApp(pipeline, env);
}

describe("backtest API", () => {
  it("returns 202 with a runId when accepted", async () => {
    const app = buildApp();
    const response = await request(app)
      .post("/api/backtests")
      .send({ name: "Run", initialEquity: 100_000 });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ accepted: true, runId: "run-1" });
  });

  it("rejects a non-positive initialEquity with 400", async () => {
    const app = buildApp();
    const response = await request(app)
      .post("/api/backtests")
      .send({ name: "Run", initialEquity: 0 });

    expect(response.status).toBe(400);
  });

  it("returns 400 when no documents are available", async () => {
    const app = buildApp({ countDocuments: async () => 0 });
    const response = await request(app)
      .post("/api/backtests")
      .send({ name: "Run", initialEquity: 100_000 });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/no historical documents/i);
  });

  it("returns 409 when a backtest is already running", async () => {
    const app = buildApp({ isRunning: () => true });
    const response = await request(app)
      .post("/api/backtests")
      .send({ name: "Run", initialEquity: 100_000 });

    expect(response.status).toBe(409);
  });

  it("exposes the document count endpoint", async () => {
    const app = buildApp({ countDocuments: async () => 7 });
    const response = await request(app).get(
      "/api/backtests/documents/count?ticker=AAPL",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ count: 7, ticker: "AAPL" });
  });

  it("lists past runs", async () => {
    const app = buildApp({
      listRuns: async () => [{ id: "run-1", name: "Past", trades: [] }],
    });
    const response = await request(app).get("/api/backtests");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ id: "run-1" });
  });
});
