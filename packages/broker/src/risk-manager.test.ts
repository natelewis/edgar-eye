import { describe, expect, it } from "vitest";
import { mapOrderStatus } from "./alpaca-service.js";
import { RiskManager } from "./risk-manager.js";
import type { RiskCheckContext } from "./types.js";
import type { Env } from "@edgar-eye/shared";

function makeEnv(overrides: Partial<Env> = {}): Env {
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
    ...overrides,
  };
}

function baseContext(
  overrides: Partial<RiskCheckContext> = {},
): RiskCheckContext {
  return {
    order: { ticker: "AAPL", side: "BUY", quantity: 1 },
    buyingPower: 10_000,
    orderNotional: 1_000,
    currentEquity: 10_000,
    ...overrides,
  };
}

describe("RiskManager", () => {
  it("blocks orders when position size exceeds limit", () => {
    const manager = new RiskManager(makeEnv());
    manager.recordEquity(10_000);

    const result = manager.evaluate(
      baseContext({ orderNotional: 3_000, buyingPower: 10_000 }),
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Position size");
  });

  it("blocks orders after consecutive LLM failures", () => {
    const manager = new RiskManager(
      makeEnv({ MAX_CONSECUTIVE_LLM_FAILURES: 2 }),
    );
    manager.recordLlmFailure();
    manager.recordLlmFailure();

    const result = manager.evaluate(baseContext());
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("LLM failures");
  });

  it("blocks orders when daily drawdown exceeds limit", () => {
    const manager = new RiskManager(makeEnv({ MAX_DAILY_DRAWDOWN_PCT: 5 }));
    manager.resetDailyBaseline(10_000);

    const result = manager.evaluate(
      baseContext({ currentEquity: 9_400, buyingPower: 9_400 }),
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("daily drawdown");
  });

  it("tracks a new high-water mark within the same trading day", () => {
    const manager = new RiskManager(makeEnv());
    manager.resetDailyBaseline(10_000);
    manager.recordEquity(10_500);

    expect(manager.getDailyHighWaterEquity()).toBe(10_500);
  });

  it("allows orders within configured limits", () => {
    const manager = new RiskManager(makeEnv());
    manager.resetDailyBaseline(10_000);

    expect(manager.evaluate(baseContext())).toEqual({ allowed: true });
  });
});

describe("mapOrderStatus", () => {
  it("maps filled Alpaca statuses to EXECUTED", () => {
    expect(mapOrderStatus("filled", 10)).toBe("EXECUTED");
    expect(mapOrderStatus("partially_filled", 5)).toBe("EXECUTED");
  });

  it("maps working Alpaca statuses to PENDING", () => {
    expect(mapOrderStatus("accepted", 0)).toBe("PENDING");
    expect(mapOrderStatus("new", 0)).toBe("PENDING");
  });

  it("maps rejected and terminal statuses correctly", () => {
    expect(mapOrderStatus("rejected", 0)).toBe("REJECTED");
    expect(mapOrderStatus("canceled", 0)).toBe("FAILED");
  });
});
