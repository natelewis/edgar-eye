import { describe, expect, it, vi } from "vitest";
import { RiskManager } from "./risk-manager.js";
import { TriageService } from "./triage.service.js";
import type { AlpacaOptionsDataService } from "./alpaca-options-data.js";
import type { Env, LlmAnalysisResult } from "@edgar-eye/shared";
import type { IBrokerService } from "./types.js";

function makeEnv(): Env {
  return {
    DATABASE_URL: "postgresql://alpha:alpha@localhost:5433/alpha_trading",
    TRADING_MODE: "PAPER",
    ALPACA_PAPER_API_KEY: "",
    ALPACA_PAPER_SECRET_KEY: "",
    ALPACA_LIVE_API_KEY: "",
    ALPACA_LIVE_SECRET_KEY: "",
    ALPACA_API_BASE_URL: "https://paper-api.alpaca.markets",
    LLM_API_BASE_URL: "http://localhost:11434/v1",
    LLM_MODEL: "llama3.2",
    LLM_API_KEY: "ollama",
    SEC_USER_AGENT: "WhaleWatch_LocalBot admin@example.com",
    MAX_DAILY_DRAWDOWN_PCT: 5,
    MAX_POSITION_SIZE_PCT: 20,
    MAX_CONSECUTIVE_LLM_FAILURES: 3,
    NODE_ENV: "test",
    PORT: 3001,
    FRONTEND_URL: "http://localhost:5173",
    API_SECRET_KEY: "",
    SEC_POLL_INTERVAL_MS: 5000,
    SEC_WATCH_TICKERS: "",
    SLIPPAGE_BPS: 10,
  };
}

const chain = [
  {
    symbol: "AAPL260117C00150000",
    type: "call" as const,
    strike: 150,
    expirationDate: "2026-01-17",
    bid: 4.5,
    ask: 4.8,
  },
  {
    symbol: "AAPL260117P00150000",
    type: "put" as const,
    strike: 150,
    expirationDate: "2026-01-17",
    bid: 4.2,
    ask: 4.5,
  },
];

function makeBroker(): IBrokerService {
  return {
    getBuyingPower: async () => 50_000,
    getAccountSnapshot: async () => ({
      equity: 50_000,
      buyingPower: 50_000,
      cash: 50_000,
      portfolioValue: 50_000,
    }),
    getPositions: async () => [],
    executeOrder: async () => ({ success: true, status: "EXECUTED" }),
    executeOptionsOrder: async () => ({ success: true, status: "EXECUTED" }),
    closePositionGroup: async (_group, exitCondition) => ({
      success: true,
      netExitValue: 1000,
      exitCondition,
    }),
    getOptionQuotes: async () => [],
  };
}

function makeOptionsData(): AlpacaOptionsDataService {
  return {
    getUnderlyingPrice: vi.fn(async () => 150),
    getOptionChain: vi.fn(async () => chain),
  } as unknown as AlpacaOptionsDataService;
}

describe("TriageService", () => {
  const service = new TriageService();
  const broker = makeBroker();
  const optionsData = makeOptionsData();
  const riskManager = new RiskManager(makeEnv());

  it("routes ATM call for directional bullish signals", async () => {
    const analysis: LlmAnalysisResult = {
      catalystType: "DIRECTIONAL",
      direction: "BULLISH",
      magnitudeScore: 85,
      reasoning: "bullish",
      latencyMs: 1,
    };

    const outcome = await service.evaluate({
      analysis,
      underlying: "AAPL",
      broker,
      riskManager,
      optionsData,
    });

    expect(outcome.kind).toBe("trade");
    if (outcome.kind === "trade") {
      expect(outcome.result.orderRequest.strategy).toBe("ATM_CALL");
    }
  });

  it("skips when magnitude is below threshold", async () => {
    const outcome = await service.evaluate({
      analysis: {
        catalystType: "DIRECTIONAL",
        direction: "BULLISH",
        magnitudeScore: 70,
        reasoning: "weak",
        latencyMs: 1,
      },
      underlying: "AAPL",
      broker,
      riskManager,
      optionsData,
    });

    expect(outcome).toEqual({ kind: "skip" });
  });
});
