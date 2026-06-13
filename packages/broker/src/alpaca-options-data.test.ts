import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlpacaOptionsDataService } from "./alpaca-options-data.js";
import {
  HistoricalDataCache,
  resetSharedHistoricalDataCacheForTests,
} from "./historical-data-cache.js";

const credentials = {
  apiKey: "test-key",
  secretKey: "test-secret",
  dataBaseUrl: "https://data.alpaca.markets",
  tradingBaseUrl: "https://paper-api.alpaca.markets",
};

function mockContractsResponse() {
  return {
    option_contracts: [
      {
        symbol: "TSLA240621C00180000",
        type: "call",
        strike_price: "180",
        expiration_date: "2024-06-21",
      },
    ],
    next_page_token: null,
  };
}

function mockBarsResponse() {
  return {
    bars: {
      TSLA240621C00180000: [
        {
          t: "2024-06-01T14:30:00Z",
          o: 5,
          h: 6,
          l: 4,
          c: 5.5,
        },
      ],
    },
    next_page_token: null,
  };
}

function mockTradesResponse(price: number) {
  return {
    trades: {
      TSLA: [{ t: "2024-06-01T20:00:00Z", p: price }],
    },
    next_page_token: null,
  };
}

describe("AlpacaOptionsDataService historical cache", () => {
  let cacheDir: string;

  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn());
    resetSharedHistoricalDataCacheForTests();
    cacheDir = await mkdtemp(path.join(os.tmpdir(), "options-data-cache-"));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T15:00:00.000Z"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetSharedHistoricalDataCacheForTests();
    await rm(cacheDir, { recursive: true, force: true });
  });

  function makeService(): AlpacaOptionsDataService {
    return new AlpacaOptionsDataService({
      ...credentials,
      historicalCache: new HistoricalDataCache({ cacheDir }),
    });
  }

  it("caches minute bars across service instances", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockBarsResponse()), { status: 200 }),
    );

    const symbols = ["TSLA240621C00180000"];
    const start = new Date("2024-06-01T14:00:00.000Z");
    const end = new Date("2024-06-01T16:00:00.000Z");

    await makeService().getMinuteBars(symbols, start, end);
    await new AlpacaOptionsDataService({
      ...credentials,
      historicalCache: new HistoricalDataCache({ cacheDir }),
    }).getMinuteBars(symbols, start, end);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("always fetches minute bars when end is yesterday", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify(mockBarsResponse()), { status: 200 }),
    );

    const symbols = ["TSLA240621C00180000"];
    const start = new Date("2026-06-12T14:00:00.000Z");
    const end = new Date("2026-06-12T16:00:00.000Z");
    const service = makeService();

    await service.getMinuteBars(symbols, start, end);
    await service.getMinuteBars(symbols, start, end);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches historical option chain contract fetches", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/v2/options/contracts")) {
        return new Response(JSON.stringify(mockContractsResponse()), {
          status: 200,
        });
      }
      if (url.includes("/v2/stocks/trades")) {
        return new Response(JSON.stringify(mockTradesResponse(180)), {
          status: 200,
        });
      }
      if (url.includes("/v1beta1/options/bars")) {
        return new Response(JSON.stringify(mockBarsResponse()), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const asOf = new Date("2024-06-01T00:00:00.000Z");
    const service = makeService();

    await service.getOptionChain("TSLA", asOf);
    const contractsCallsAfterFirst = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/v2/options/contracts"),
    ).length;

    await service.getOptionChain("TSLA", asOf);
    const contractsCallsAfterSecond = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/v2/options/contracts"),
    ).length;

    expect(contractsCallsAfterFirst).toBe(1);
    expect(contractsCallsAfterSecond).toBe(1);
  });

  it("does not write cache files for live option chains", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/v2/options/contracts")) {
        return new Response(JSON.stringify(mockContractsResponse()), {
          status: 200,
        });
      }
      if (url.includes("/v1beta1/options/snapshots")) {
        return new Response(
          JSON.stringify({
            snapshots: {
              TSLA240621C00180000: { latestQuote: { bp: 4.9, ap: 5.1 } },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v2/stocks/") && url.includes("/trades/latest")) {
        return new Response(JSON.stringify({ trade: { p: 180 } }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 404 });
    });

    await makeService().getOptionChain("TSLA");

    const namespaces = await readdir(cacheDir).catch(() => []);
    expect(namespaces).not.toContain("options-contracts");
  });
});
