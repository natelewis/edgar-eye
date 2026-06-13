import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Env } from "@edgar-eye/shared";
import { RiskManager } from "./risk-manager.js";
import type { IBrokerService, OpenPositionGroup } from "./types.js";

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

const sampleGroup: OpenPositionGroup = {
  positionGroupId: "group-1",
  underlying: "AAPL",
  strategy: "STRADDLE",
  legs: [
    { symbol: "AAPL260117C00150000", side: "BUY", quantity: 1, entryPrice: 4.8 },
    { symbol: "AAPL260117P00150000", side: "BUY", quantity: 1, entryPrice: 4.5 },
  ],
  totalPremiumPaid: 930,
  openedAt: new Date().toISOString(),
};

describe("RiskManager position monitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes position on take profit", async () => {
    const closed: Array<{ condition: string; netExitValue: number }> = [];
    const broker: IBrokerService = {
      getBuyingPower: async () => 10_000,
      getAccountSnapshot: async () => ({
        equity: 10_000,
        buyingPower: 10_000,
        cash: 10_000,
        portfolioValue: 10_000,
      }),
      getPositions: async () => [],
      executeOrder: async () => ({ success: true, status: "EXECUTED" }),
      executeOptionsOrder: async () => ({ success: true, status: "EXECUTED" }),
      getOptionQuotes: async () => [
        { symbol: sampleGroup.legs[0].symbol, bid: 6.5, ask: 6.7 },
        { symbol: sampleGroup.legs[1].symbol, bid: 6.0, ask: 6.2 },
      ],
      closePositionGroup: async (_group, exitCondition) => ({
        success: true,
        netExitValue: 1250,
        exitCondition,
      }),
    };

    const manager = new RiskManager(
      makeEnv(),
      () => new Date("2026-06-12T15:00:00-04:00"),
    );
    manager.registerOpenPosition(sampleGroup);
    manager.startPositionMonitor({
      broker,
      now: () => new Date("2026-06-12T15:00:00-04:00"),
      onClose: {
        onPositionClosed: async (_group, exitCondition, netExitValue) => {
          closed.push({ condition: exitCondition, netExitValue });
        },
      },
    });

    await manager.evaluateOpenPositions();

    expect(closed).toHaveLength(1);
    expect(closed[0].condition).toBe("TAKE_PROFIT");
    expect(manager.getOpenPositions()).toHaveLength(0);
    manager.stopPositionMonitor();
  });

  it("closes all positions at 15:55 time-stop", async () => {
    const closed: string[] = [];
    const broker: IBrokerService = {
      getBuyingPower: async () => 10_000,
      getAccountSnapshot: async () => ({
        equity: 10_000,
        buyingPower: 10_000,
        cash: 10_000,
        portfolioValue: 10_000,
      }),
      getPositions: async () => [],
      executeOrder: async () => ({ success: true, status: "EXECUTED" }),
      executeOptionsOrder: async () => ({ success: true, status: "EXECUTED" }),
      getOptionQuotes: async () => [
        { symbol: sampleGroup.legs[0].symbol, bid: 4.8, ask: 5.0 },
        { symbol: sampleGroup.legs[1].symbol, bid: 4.5, ask: 4.7 },
      ],
      closePositionGroup: async (_group, exitCondition) => ({
        success: true,
        netExitValue: 930,
        exitCondition,
      }),
    };

    const manager = new RiskManager(
      makeEnv(),
      () => new Date("2026-06-12T15:55:00-04:00"),
    );
    manager.registerOpenPosition(sampleGroup);
    manager.startPositionMonitor({
      broker,
      now: () => new Date("2026-06-12T15:55:00-04:00"),
      onClose: {
        onPositionClosed: async (_group, exitCondition) => {
          closed.push(exitCondition);
        },
      },
    });

    await manager.evaluateOpenPositions();

    expect(closed).toEqual(["TIME_STOP"]);
    manager.stopPositionMonitor();
  });
});
