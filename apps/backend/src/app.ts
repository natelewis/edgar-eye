import cors from "cors";
import express, { type Express } from "express";
import { prisma } from "@edgar-eye/database";
import type { Env } from "@edgar-eye/shared";
import { createApiAuthMiddleware } from "./auth.js";
import type { BacktestRunOptions } from "./backtest-runner.js";
import type { BackfillRunOptions } from "./backfill-runner.js";

export interface BacktestService {
  isRunning(): boolean;
  countDocuments(ticker?: string): Promise<number>;
  run(
    options: BacktestRunOptions,
  ): Promise<{ runId: string; completion: Promise<void> }>;
  listRuns(): Promise<unknown[]>;
  getRun(id: string): Promise<unknown>;
}

export interface BackfillService {
  isRunning(): boolean;
  run(options: BackfillRunOptions): {
    backfillId: string;
    completion: Promise<void>;
  };
}

export interface BacktestApp {
  getBacktestRunner(): BacktestService;
  getBackfillRunner(): BackfillService;
}

export function createApp(pipeline: BacktestApp, env: Env): Express {
  const app = express();

  app.use(cors({ origin: env.FRONTEND_URL }));
  app.use(express.json());
  app.use(createApiAuthMiddleware(env));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, tradingMode: env.TRADING_MODE });
  });

  app.get("/api/trades", async (_req, res) => {
    const trades = await prisma.tradeLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(trades);
  });

  app.get("/api/analyses", async (_req, res) => {
    const analyses = await prisma.analysisReport.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { documentLog: true },
    });
    res.json(analyses);
  });

  app.get("/api/documents", async (_req, res) => {
    const documents = await prisma.documentLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(documents);
  });

  app.get("/api/backtests/documents/count", async (req, res) => {
    const ticker =
      typeof req.query.ticker === "string" && req.query.ticker.length > 0
        ? req.query.ticker
        : undefined;
    const count = await pipeline.getBacktestRunner().countDocuments(ticker);
    res.json({ count, ticker: ticker ?? null });
  });

  app.get("/api/backtests", async (_req, res) => {
    const runs = await pipeline.getBacktestRunner().listRuns();
    res.json(runs);
  });

  app.get("/api/backtests/:id", async (req, res) => {
    const run = await pipeline.getBacktestRunner().getRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Backtest run not found" });
      return;
    }
    res.json(run);
  });

  app.post("/api/backtests", async (req, res) => {
    const { name, initialEquity, ticker, limit } = req.body as {
      name?: string;
      initialEquity?: number;
      ticker?: string;
      limit?: number;
    };

    if (!name || typeof initialEquity !== "number" || initialEquity <= 0) {
      res.status(400).json({
        error: "name and a positive initialEquity are required",
      });
      return;
    }

    const runner = pipeline.getBacktestRunner();

    if (runner.isRunning()) {
      res.status(409).json({ error: "Backtest already running" });
      return;
    }

    const available = await runner.countDocuments(ticker);
    if (available === 0) {
      res.status(400).json({
        error: ticker
          ? `No historical documents ingested for ${ticker}`
          : "No historical documents have been ingested yet",
      });
      return;
    }

    const run = await runner.run({ name, initialEquity, ticker, limit });

    res.status(202).json({ accepted: true, runId: run.runId });
  });

  app.post("/api/ingestion/backfill", async (req, res) => {
    const { ticker, limit, since, until } = req.body as {
      ticker?: string;
      limit?: number;
      since?: string;
      until?: string;
    };

    if (!ticker || typeof ticker !== "string" || ticker.trim().length === 0) {
      res.status(400).json({ error: "ticker is required" });
      return;
    }

    if (limit !== undefined && (typeof limit !== "number" || limit <= 0)) {
      res.status(400).json({ error: "limit must be a positive number" });
      return;
    }

    const runner = pipeline.getBackfillRunner();

    if (runner.isRunning()) {
      res.status(409).json({ error: "Backfill already running" });
      return;
    }

    const { backfillId, completion } = runner.run({
      ticker,
      limit,
      since,
      until,
    });
    void completion;

    res.status(202).json({ accepted: true, backfillId });
  });

  return app;
}
