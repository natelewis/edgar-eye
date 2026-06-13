import type { DocumentLog } from "@edgar-eye/database";
import type { LlmAnalysisResult, WsEvent } from "@edgar-eye/shared";
import type { IAnalysisService, AnalysisInput } from "@edgar-eye/llm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BacktestIngestion,
  BacktestRunOptions,
} from "./backtest-runner.js";
import type { EventBroadcaster } from "./event-broadcaster.js";

interface StoredRun {
  id: string;
  name: string;
  initialEquity: number;
  finalEquity: number | null;
  completedAt: Date | null;
  parameters: Record<string, unknown> | null;
}

interface StoredTrade {
  backtestRunId: string;
  ticker: string;
}

const store = vi.hoisted(() => {
  const runs = new Map<string, StoredRun>();
  const trades: StoredTrade[] = [];
  return { runs, trades };
});

const mockBroker = vi.hoisted(() => ({
  getAccountSnapshot: vi.fn(async () => ({
    equity: 100_000,
    buyingPower: 100_000,
    cash: 100_000,
    portfolioValue: 100_000,
  })),
  setSimulatedTime: vi.fn(),
  executeOptionsOrder: vi.fn(async () => ({
    success: true,
    filledPrice: 9.3,
    filledQuantity: 1,
    status: "EXECUTED" as const,
    totalPremiumPaid: 930,
    legs: [
      {
        symbol: "AAPL260117C00150000",
        side: "BUY" as const,
        quantity: 1,
        entryPrice: 4.8,
      },
      {
        symbol: "AAPL260117P00150000",
        side: "BUY" as const,
        quantity: 1,
        entryPrice: 4.5,
      },
    ],
  })),
  closePositionGroup: vi.fn(async () => ({
    success: true,
    netExitValue: 1000,
    exitCondition: "TAKE_PROFIT" as const,
  })),
  getOptionsDataService: vi.fn(() => ({})),
}));

const mockTriageEvaluate = vi.hoisted(() =>
  vi.fn(async () => ({
    kind: "trade" as const,
    result: {
      positionGroup: {
        positionGroupId: "group-1",
        underlying: "AAPL",
        strategy: "STRADDLE" as const,
        legs: [
          {
            symbol: "AAPL260117C00150000",
            side: "BUY" as const,
            quantity: 1,
            entryPrice: 4.8,
          },
          {
            symbol: "AAPL260117P00150000",
            side: "BUY" as const,
            quantity: 1,
            entryPrice: 4.5,
          },
        ],
        totalPremiumPaid: 930,
        openedAt: new Date().toISOString(),
      },
      orderRequest: {
        underlying: "AAPL",
        strategy: "STRADDLE" as const,
        legs: [],
        quantity: 1,
      },
      estimatedPremium: 930,
    },
  })),
);

vi.mock("@edgar-eye/broker", () => ({
  MockBrokerService: vi.fn(function MockBrokerService() {
    return mockBroker;
  }),
  TriageService: vi.fn(function TriageService() {
    return { evaluate: mockTriageEvaluate };
  }),
  ExitSimulator: vi.fn(function ExitSimulator() {
    return {
      simulate: vi.fn(async () => ({
        exitAt: new Date("2026-01-15T15:30:00-05:00"),
        exitCondition: "TAKE_PROFIT" as const,
        netExitValue: 1000,
        pnl: 70,
        exitPrices: new Map(),
      })),
    };
  }),
  RiskManager: vi.fn(function RiskManager() {
    return {
      recordEquity: vi.fn(),
      interceptOrder: vi.fn(() => ({ allowed: true })),
    };
  }),
  AlpacaOptionsDataService: vi.fn(function AlpacaOptionsDataService() {
    return {};
  }),
  normalizeToNextMarketSession: vi.fn((date: Date) => date),
}));

vi.mock("@edgar-eye/database", () => ({
  prisma: {
    backtestRun: {
      create: vi.fn(async ({ data }: { data: Partial<StoredRun> }) => {
        const id = `run-${store.runs.size + 1}`;
        const run: StoredRun = {
          id,
          name: data.name ?? "",
          initialEquity: data.initialEquity ?? 0,
          finalEquity: null,
          completedAt: null,
          parameters: (data.parameters as Record<string, unknown>) ?? null,
        };
        store.runs.set(id, run);
        return run;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<StoredRun>;
        }) => {
          const run = store.runs.get(where.id);
          if (run) {
            Object.assign(run, data);
          }
          return run;
        },
      ),
    },
    backtestTrade: {
      create: vi.fn(async ({ data }: { data: StoredTrade }) => {
        store.trades.push(data);
        return data;
      }),
      count: vi.fn(async ({ where }: { where: { backtestRunId: string } }) => {
        return store.trades.filter(
          (t) => t.backtestRunId === where.backtestRunId,
        ).length;
      }),
    },
  },
  TradeSide: { BUY: "BUY", SELL: "SELL" },
}));

const { BacktestRunner } = await import("./backtest-runner.js");
const { loadEnv } = await import("@edgar-eye/shared");

const env = loadEnv({
  DATABASE_URL: "postgresql://localhost:5433/test",
  TRADING_MODE: "PAPER",
});

function makeDoc(overrides: Partial<DocumentLog> = {}): DocumentLog {
  return {
    id: overrides.id ?? `doc-${Math.random()}`,
    source: "SEC",
    ticker: overrides.ticker ?? "AAPL",
    title: overrides.title ?? "Material Event",
    rawText: "",
    cleanedText: overrides.cleanedText ?? "filing body",
    accessionNumber: null,
    filedAt: overrides.filedAt ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as DocumentLog;
}

function fakeIngestion(documents: DocumentLog[]): BacktestIngestion {
  return {
    async countDocuments() {
      return documents.length;
    },
    async *streamDocuments() {
      for (const document of documents) {
        yield { document };
      }
    },
  };
}

function collector() {
  const events: WsEvent[] = [];
  const broadcaster: EventBroadcaster = {
    broadcast: (event) => events.push(event),
  };
  return { events, broadcaster };
}

const volatilitySignal: LlmAnalysisResult = {
  catalystType: "VOLATILITY",
  direction: "NEUTRAL",
  magnitudeScore: 90,
  reasoning: "volatility catalyst",
  latencyMs: 1,
};

const noTradeSignal: LlmAnalysisResult = {
  catalystType: "NONE",
  direction: "NEUTRAL",
  magnitudeScore: 25,
  reasoning: "no trade",
  latencyMs: 1,
};

function analysisReturning(result: LlmAnalysisResult): IAnalysisService {
  return {
    analyzeFiling: async (_input: AnalysisInput) => result,
  };
}

const baseOptions: BacktestRunOptions = {
  name: "Test Run",
  initialEquity: 100_000,
};

beforeEach(() => {
  store.runs.clear();
  store.trades.length = 0;
  mockBroker.setSimulatedTime.mockClear();
  mockBroker.executeOptionsOrder.mockClear();
  mockBroker.getAccountSnapshot.mockClear();
  mockTriageEvaluate.mockClear();
});

describe("BacktestRunner", () => {
  it("processes documents, creates trades, and broadcasts completion", async () => {
    const { events, broadcaster } = collector();
    const runner = new BacktestRunner({
      env,
      analysis: analysisReturning(volatilitySignal),
      broadcaster,
      ingestion: fakeIngestion([makeDoc(), makeDoc(), makeDoc()]),
    });

    const { runId, completion } = await runner.run(baseOptions);
    await completion;

    const complete = events.find((e) => e.type === "backtest_complete");
    expect(complete).toBeDefined();
    expect(complete).toMatchObject({
      runId,
      documentsProcessed: 3,
      llmFailures: 0,
    });
    expect(store.trades).toHaveLength(3);
    expect(mockBroker.setSimulatedTime).toHaveBeenCalled();
    expect(runner.isRunning()).toBe(false);
  });

  it("emits a progress event for every document even when analysis fails", async () => {
    const { events, broadcaster } = collector();
    const failing: IAnalysisService = {
      analyzeFiling: async () => {
        throw new Error("model not found");
      },
    };
    const runner = new BacktestRunner({
      env,
      analysis: failing,
      broadcaster,
      ingestion: fakeIngestion([makeDoc(), makeDoc()]),
    });

    await (await runner.run(baseOptions)).completion;

    const progressEvents = events.filter((e) => e.type === "backtest_progress");
    expect(progressEvents.length).toBeGreaterThanOrEqual(3);
    const complete = events.find((e) => e.type === "backtest_complete");
    expect(complete).toMatchObject({ llmFailures: 2 });
    expect(store.trades).toHaveLength(0);
  });

  it("fails fast and broadcasts backtest_failed when there are zero documents", async () => {
    const { events, broadcaster } = collector();
    const runner = new BacktestRunner({
      env,
      analysis: analysisReturning(volatilitySignal),
      broadcaster,
      ingestion: fakeIngestion([]),
    });

    await (await runner.run(baseOptions)).completion;

    expect(events.some((e) => e.type === "backtest_failed")).toBe(true);
    expect(events.some((e) => e.type === "backtest_complete")).toBe(false);
  });

  it("does not trade when triage skips but still completes", async () => {
    mockTriageEvaluate.mockResolvedValueOnce({ kind: "skip" });
    mockTriageEvaluate.mockResolvedValueOnce({ kind: "skip" });

    const { events, broadcaster } = collector();
    const runner = new BacktestRunner({
      env,
      analysis: analysisReturning(noTradeSignal),
      broadcaster,
      ingestion: fakeIngestion([makeDoc(), makeDoc()]),
    });

    await (await runner.run(baseOptions)).completion;

    expect(store.trades).toHaveLength(0);
    expect(events.some((e) => e.type === "backtest_complete")).toBe(true);
  });

  it("rejects a second concurrent run", async () => {
    const { broadcaster } = collector();
    const runner = new BacktestRunner({
      env,
      analysis: analysisReturning(volatilitySignal),
      broadcaster,
      ingestion: fakeIngestion([makeDoc()]),
    });

    const first = await runner.run(baseOptions);
    expect(runner.isRunning()).toBe(true);
    await expect(runner.run(baseOptions)).rejects.toThrow(/already running/);
    await first.completion;
  });
});
