import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AlpacaMarketDataService,
  normalizeAsOfEnd,
} from "./alpaca-market-data.js";
import { AlpacaOptionsDataService } from "./alpaca-options-data.js";
import {
  HistoricalDataCache,
  resetSharedHistoricalDataCacheForTests,
} from "./historical-data-cache.js";
import { MockBrokerService } from "./mock-broker-service.js";

const credentials = {
  apiKey: "test-key",
  secretKey: "test-secret",
  baseUrl: "https://data.alpaca.markets",
};

function mockTradesResponse(price: number, ticker = "AAPL") {
  return {
    trades: {
      [ticker]: [
        {
          t: "2024-06-01T20:00:00Z",
          p: price,
          i: 1,
          x: "P",
          s: 100,
          c: ["@", "T"],
          z: "C",
        },
      ],
    },
    next_page_token: null,
  };
}

describe("normalizeAsOfEnd", () => {
  it("expands date-only UTC midnight to US market close on that calendar date", () => {
    const normalized = normalizeAsOfEnd(new Date("2024-06-01T00:00:00.000Z"));
    const etHour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        hour12: false,
      }).format(normalized),
    );

    expect(etHour).toBe(16);
    expect(normalized.getUTCDate()).toBe(1);
    expect(normalized.getUTCMonth()).toBe(5);
  });

  it("leaves timestamps with a time component unchanged", () => {
    const input = new Date("2024-06-01T14:30:00.000Z");
    expect(normalizeAsOfEnd(input).toISOString()).toBe(input.toISOString());
  });
});

describe("AlpacaMarketDataService", () => {
  let cacheDir: string;

  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn());
    resetSharedHistoricalDataCacheForTests();
    cacheDir = await mkdtemp(path.join(os.tmpdir(), "market-data-cache-"));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T15:00:00.000Z"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetSharedHistoricalDataCacheForTests();
    await rm(cacheDir, { recursive: true, force: true });
  });

  function makeService(): AlpacaMarketDataService {
    return new AlpacaMarketDataService({
      ...credentials,
      historicalCache: new HistoricalDataCache({ cacheDir }),
    });
  }

  it("requests the last trade at or before the normalized timestamp", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockTradesResponse(178.26)), { status: 200 }),
    );

    const service = makeService();
    const asOf = new Date("2024-06-01T00:00:00.000Z");
    const price = await service.getLastTradePrice("AAPL", asOf);

    expect(price).toBe(178.26);
    expect(fetchMock).toHaveBeenCalledOnce();

    const requestUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(requestUrl.pathname).toBe("/v2/stocks/trades");
    expect(requestUrl.searchParams.get("symbols")).toBe("AAPL");
    expect(requestUrl.searchParams.get("sort")).toBe("desc");
    expect(requestUrl.searchParams.get("limit")).toBe("1");
    expect(requestUrl.searchParams.get("asof")).toBe("2024-06-01");

    const end = new Date(requestUrl.searchParams.get("end")!);
    const etHour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        hour12: false,
      }).format(end),
    );
    expect(etHour).toBe(16);
  });

  it("returns null when the API response has no trades", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ trades: {}, next_page_token: null }), {
        status: 200,
      }),
    );

    const service = makeService();
    const price = await service.getLastTradePrice(
      "AAPL",
      new Date("2024-06-01T00:00:00.000Z"),
    );

    expect(price).toBeNull();
  });

  it("caches repeated lookups for the same ticker and timestamp", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockTradesResponse(200)), { status: 200 }),
    );

    const service = makeService();
    const asOf = new Date("2024-06-01T00:00:00.000Z");

    await service.getLastTradePrice("AAPL", asOf);
    await service.getLastTradePrice("AAPL", asOf);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("persists cache across service instances", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockTradesResponse(200)), { status: 200 }),
    );

    const asOf = new Date("2024-06-01T00:00:00.000Z");
    const cache = new HistoricalDataCache({ cacheDir });

    await new AlpacaMarketDataService({
      ...credentials,
      historicalCache: cache,
    }).getLastTradePrice("AAPL", asOf);

    await new AlpacaMarketDataService({
      ...credentials,
      historicalCache: new HistoricalDataCache({ cacheDir }),
    }).getLastTradePrice("AAPL", asOf);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not persist cache for yesterday timestamps", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockTradesResponse(200)), { status: 200 }),
    );

    const service = makeService();
    const yesterday = new Date("2026-06-12T14:30:00.000Z");

    await service.getLastTradePrice("AAPL", yesterday);
    await service.getLastTradePrice("AAPL", yesterday);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("MockBrokerService", () => {
  let cacheDir: string;

  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn());
    resetSharedHistoricalDataCacheForTests();
    cacheDir = await mkdtemp(path.join(os.tmpdir(), "mock-broker-cache-"));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    resetSharedHistoricalDataCacheForTests();
    await rm(cacheDir, { recursive: true, force: true });
  });

  function makeBroker(
    options: ConstructorParameters<typeof MockBrokerService>[0],
  ): MockBrokerService {
    return new MockBrokerService({
      ...options,
      historicalCache: new HistoricalDataCache({ cacheDir }),
    });
  }

  it("rejects orders when simulated time is not set", async () => {
    const broker = makeBroker({
      initialEquity: 100_000,
      slippageBps: 10,
      dataCredentials: credentials,
    });

    const result = await broker.executeOrder({
      ticker: "AAPL",
      side: "BUY",
      quantity: 0,
      notional: 1_000,
    });

    expect(result).toMatchObject({
      success: false,
      status: "REJECTED",
      rejectionReason: expect.stringContaining("simulated time must be set"),
    });
  });

  it("fills orders using the historical trade price plus slippage", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockTradesResponse(200)), { status: 200 }),
    );

    const broker = makeBroker({
      initialEquity: 100_000,
      slippageBps: 10,
      dataCredentials: credentials,
    });
    broker.setSimulatedTime("2024-06-01T00:00:00.000Z");

    const result = await broker.executeOrder({
      ticker: "AAPL",
      side: "BUY",
      quantity: 0,
      notional: 10_000,
    });

    expect(result.success).toBe(true);
    expect(result.filledPrice).toBeCloseTo(200 * 1.001, 5);
    expect(result.filledQuantity).toBeCloseTo(10_000 / (200 * 1.001), 5);
  });

  it("rejects orders when historical trade data is unavailable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ trades: {}, next_page_token: null }), {
        status: 200,
      }),
    );

    const broker = makeBroker({
      initialEquity: 100_000,
      dataCredentials: credentials,
    });
    broker.setSimulatedTime("2024-06-01T00:00:00.000Z");

    const result = await broker.executeOrder({
      ticker: "AAPL",
      side: "BUY",
      quantity: 0,
      notional: 1_000,
    });

    expect(result).toMatchObject({
      success: false,
      status: "REJECTED",
      rejectionReason: expect.stringContaining("no historical trade price found"),
    });
  });

  it("rejects orders when Alpaca credentials are missing", async () => {
    const broker = makeBroker({ initialEquity: 100_000 });
    broker.setSimulatedTime("2024-06-01T00:00:00.000Z");

    const result = await broker.executeOrder({
      ticker: "AAPL",
      side: "BUY",
      quantity: 0,
      notional: 1_000,
    });

    expect(result).toMatchObject({
      success: false,
      status: "REJECTED",
      rejectionReason: expect.stringContaining("no historical trade price found"),
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
