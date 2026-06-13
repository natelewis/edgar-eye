import { AlpacaMarketDataService } from "./alpaca-market-data.js";
import { isHistoricalCacheEligible } from "./historical-cache-eligibility.js";
import {
  getSharedHistoricalDataCache,
  optionsContractsKey,
  optionsMinuteBarsKey,
  reviveMinuteBars,
  serializeMinuteBars,
  type HistoricalDataCache,
} from "./historical-data-cache.js";
import type { OptionChainContract, OptionMinuteBar } from "./types.js";

const DEFAULT_DATA_BASE_URL = "https://data.alpaca.markets";
const OPTIONS_DATA_START = new Date("2024-02-01T00:00:00Z");

interface OptionSnapshotQuote {
  bp?: number;
  ap?: number;
}

interface OptionSnapshotEntry {
  latestQuote?: OptionSnapshotQuote;
}

interface OptionChainResponse {
  snapshots?: Record<string, OptionSnapshotEntry>;
}

interface OptionBarsResponse {
  bars?: Record<string, Array<{
    t: string;
    o: number;
    h: number;
    l: number;
    c: number;
  }>>;
  next_page_token?: string | null;
}

interface ContractsResponse {
  option_contracts?: Array<{
    symbol: string;
    type: string;
    strike_price: string;
    expiration_date: string;
  }>;
  next_page_token?: string | null;
}

type RawContract = {
  symbol: string;
  type: string;
  strike_price: string;
  expiration_date: string;
};

export class AlpacaOptionsDataService {
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly dataBaseUrl: string;
  private readonly tradingBaseUrl: string;
  private readonly stockData: AlpacaMarketDataService;
  private readonly historicalCache: HistoricalDataCache;

  constructor(options: {
    apiKey: string;
    secretKey: string;
    dataBaseUrl?: string;
    tradingBaseUrl?: string;
    historicalCache?: HistoricalDataCache;
    cacheDir?: string;
  }) {
    this.apiKey = options.apiKey;
    this.secretKey = options.secretKey;
    this.dataBaseUrl = (options.dataBaseUrl ?? DEFAULT_DATA_BASE_URL).replace(
      /\/$/,
      "",
    );
    this.tradingBaseUrl = (
      options.tradingBaseUrl ?? "https://paper-api.alpaca.markets"
    ).replace(/\/$/, "");
    this.historicalCache =
      options.historicalCache ??
      getSharedHistoricalDataCache(options.cacheDir);
    this.stockData = new AlpacaMarketDataService({
      apiKey: this.apiKey,
      secretKey: this.secretKey,
      baseUrl: this.dataBaseUrl,
      historicalCache: this.historicalCache,
    });
  }

  async getUnderlyingPrice(ticker: string, asOf?: Date): Promise<number | null> {
    if (asOf) {
      return this.stockData.getLastTradePrice(ticker, asOf);
    }

    const response = await fetch(
      `${this.dataBaseUrl}/v2/stocks/${ticker}/trades/latest`,
      { headers: this.headers() },
    );
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { trade?: { p?: number } };
    return data.trade?.p ?? null;
  }

  async getOptionChain(
    underlying: string,
    asOf?: Date,
  ): Promise<OptionChainContract[]> {
    const refDate = asOf ?? new Date();
    const refDateStr = refDate.toISOString().slice(0, 10);
    const maxExpiry = addDays(refDateStr, 45);
    const historical = asOf != null;

    const contracts = await this.fetchContracts(
      underlying,
      refDateStr,
      maxExpiry,
      historical,
    );
    if (contracts.length === 0) {
      return [];
    }

    const symbols = contracts.map((c) => c.symbol);
    const spot = await this.getUnderlyingPrice(underlying, asOf);
    const quotes = asOf
      ? await this.getHistoricalQuoteProxy(symbols, asOf, spot)
      : await this.fetchSnapshots(symbols);

    return contracts
      .map((contract) => {
        const quote = quotes.get(contract.symbol);
        const strike = parseFloat(contract.strike_price);
        const estimatedAsk =
          spot != null ? estimateOptionAsk(strike, spot, contract.type) : 0;

        return {
          symbol: contract.symbol,
          type: contract.type === "call" ? ("call" as const) : ("put" as const),
          strike,
          expirationDate: contract.expiration_date,
          bid: quote?.bid ?? estimatedAsk * 0.98,
          ask: quote?.ask ?? estimatedAsk,
        };
      })
      .filter((c) => c.ask > 0 || c.bid > 0);
  }

  async getOptionQuotes(
    symbols: string[],
    asOf?: Date,
  ): Promise<Map<string, { bid: number; ask: number }>> {
    if (asOf) {
      return this.getHistoricalQuoteProxy(symbols, asOf);
    }
    return this.fetchSnapshots(symbols);
  }

  async getMinuteBars(
    symbols: string[],
    start: Date,
    end: Date,
  ): Promise<OptionMinuteBar[]> {
    if (symbols.length === 0 || end < OPTIONS_DATA_START) {
      return [];
    }

    const effectiveStart =
      start < OPTIONS_DATA_START ? OPTIONS_DATA_START : start;
    const cacheable = isHistoricalCacheEligible(end);
    const cacheKey = optionsMinuteBarsKey(
      symbols,
      effectiveStart.toISOString(),
      end.toISOString(),
    );

    if (cacheable) {
      const cached = await this.historicalCache.get<
        ReturnType<typeof serializeMinuteBars>
      >("options-minute-bars", cacheKey);
      if (cached !== undefined) {
        return reviveMinuteBars(cached);
      }
    }

    const bars = await this.fetchMinuteBarsFromApi(
      symbols,
      effectiveStart,
      end,
    );

    if (cacheable) {
      await this.historicalCache.set(
        "options-minute-bars",
        cacheKey,
        serializeMinuteBars(bars),
      );
    }

    return bars;
  }

  private async fetchMinuteBarsFromApi(
    symbols: string[],
    effectiveStart: Date,
    end: Date,
  ): Promise<OptionMinuteBar[]> {
    const bars: OptionMinuteBar[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(`${this.dataBaseUrl}/v1beta1/options/bars`);
      url.searchParams.set("symbols", symbols.join(","));
      url.searchParams.set("timeframe", "1Min");
      url.searchParams.set("start", effectiveStart.toISOString());
      url.searchParams.set("end", end.toISOString());
      url.searchParams.set("limit", "10000");
      url.searchParams.set("sort", "asc");
      if (pageToken) {
        url.searchParams.set("page_token", pageToken);
      }

      const response = await fetch(url, { headers: this.headers() });
      if (!response.ok) {
        break;
      }

      const data = (await response.json()) as OptionBarsResponse;
      for (const [symbol, symbolBars] of Object.entries(data.bars ?? {})) {
        for (const bar of symbolBars) {
          bars.push({
            symbol,
            timestamp: new Date(bar.t),
            open: bar.o,
            high: bar.h,
            low: bar.l,
            close: bar.c,
          });
        }
      }

      pageToken = data.next_page_token ?? undefined;
    } while (pageToken);

    return bars.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
  }

  private async fetchContracts(
    underlying: string,
    minExpiration: string,
    maxExpiration: string,
    historical: boolean,
  ): Promise<RawContract[]> {
    const refDate = new Date(`${minExpiration}T12:00:00Z`);
    const cacheable = historical && isHistoricalCacheEligible(refDate);
    const cacheKey = optionsContractsKey(
      underlying,
      minExpiration,
      maxExpiration,
      historical,
    );

    if (cacheable) {
      const cached = await this.historicalCache.get<RawContract[]>(
        "options-contracts",
        cacheKey,
      );
      if (cached !== undefined) {
        return cached;
      }
    }

    const results: RawContract[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(`${this.tradingBaseUrl}/v2/options/contracts`);
      url.searchParams.set("underlying_symbols", underlying);
      url.searchParams.set("expiration_date_gte", minExpiration);
      url.searchParams.set("expiration_date_lte", maxExpiration);
      url.searchParams.set("limit", "100");
      if (!historical) {
        url.searchParams.set("status", "active");
      }
      if (pageToken) {
        url.searchParams.set("page_token", pageToken);
      }

      const response = await fetch(url, { headers: this.headers() });
      if (!response.ok) {
        break;
      }

      const data = (await response.json()) as ContractsResponse;
      results.push(...(data.option_contracts ?? []));
      pageToken = data.next_page_token ?? undefined;
    } while (pageToken && results.length < 500);

    if (cacheable) {
      await this.historicalCache.set("options-contracts", cacheKey, results);
    }

    return results;
  }

  private async fetchSnapshots(
    symbols: string[],
  ): Promise<Map<string, { bid: number; ask: number }>> {
    const quotes = new Map<string, { bid: number; ask: number }>();
    if (symbols.length === 0) {
      return quotes;
    }

    const chunkSize = 100;
    for (let i = 0; i < symbols.length; i += chunkSize) {
      const chunk = symbols.slice(i, i + chunkSize);
      const url = new URL(`${this.dataBaseUrl}/v1beta1/options/snapshots`);
      url.searchParams.set("symbols", chunk.join(","));

      const response = await fetch(url, { headers: this.headers() });
      if (!response.ok) {
        continue;
      }

      const data = (await response.json()) as OptionChainResponse;
      for (const [symbol, snapshot] of Object.entries(data.snapshots ?? {})) {
        const bid = snapshot.latestQuote?.bp ?? 0;
        const ask = snapshot.latestQuote?.ap ?? 0;
        quotes.set(symbol, { bid, ask });
      }
    }

    return quotes;
  }

  private async getHistoricalQuoteProxy(
    symbols: string[],
    asOf: Date,
    spot?: number | null,
  ): Promise<Map<string, { bid: number; ask: number }>> {
    const start = new Date(asOf.getTime() - 30 * 60_000);
    const end = new Date(asOf.getTime() + 30 * 60_000);
    const bars = await this.getMinuteBars(symbols, start, end);
    const quotes = new Map<string, { bid: number; ask: number }>();

    for (const symbol of symbols) {
      const symbolBars = bars.filter((b) => b.symbol === symbol);
      const nearest = symbolBars
        .filter((b) => b.timestamp <= asOf)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];

      if (nearest) {
        const price = nearest.close;
        quotes.set(symbol, { bid: price * 0.98, ask: price * 1.02 });
        continue;
      }

      if (spot != null && spot > 0) {
        const estimated = spot * 0.025;
        quotes.set(symbol, { bid: estimated * 0.98, ask: estimated * 1.02 });
      }
    }

    return quotes;
  }

  private headers(): Record<string, string> {
    return {
      "APCA-API-KEY-ID": this.apiKey,
      "APCA-API-SECRET-KEY": this.secretKey,
    };
  }
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function estimateOptionAsk(
  strike: number,
  spot: number,
  type: string,
): number {
  const moneyness = Math.abs(strike - spot) / spot;
  const base = spot * 0.025;
  return base * (1 + moneyness * 2) * (type === "call" ? 1 : 0.95);
}
