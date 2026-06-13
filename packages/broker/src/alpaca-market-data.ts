import { isHistoricalCacheEligible } from "./historical-cache-eligibility.js";
import {
  getSharedHistoricalDataCache,
  stockLastTradeKey,
  type HistoricalDataCache,
} from "./historical-data-cache.js";

interface AlpacaTrade {
  t: string;
  p: number;
  u?: string;
}

interface AlpacaTradesResponse {
  trades: Record<string, AlpacaTrade[]>;
}

const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function isDateOnlyUtc(timestamp: Date): boolean {
  return (
    timestamp.getUTCHours() === 0 &&
    timestamp.getUTCMinutes() === 0 &&
    timestamp.getUTCSeconds() === 0 &&
    timestamp.getUTCMilliseconds() === 0
  );
}

function easternTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const dateStr = `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00`;

  for (const offset of ["-04:00", "-05:00"]) {
    const candidate = new Date(`${dateStr}${offset}`);
    const etHour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        hour12: false,
      }).format(candidate),
    );

    if (etHour === hour) {
      return candidate;
    }
  }

  throw new Error(`Could not resolve US Eastern time for ${dateStr}`);
}

export function normalizeAsOfEnd(asOf: Date): Date {
  if (!isDateOnlyUtc(asOf)) {
    return asOf;
  }

  return easternTimeToUtc(
    asOf.getUTCFullYear(),
    asOf.getUTCMonth() + 1,
    asOf.getUTCDate(),
    16,
    0,
  );
}

function isInvalidTrade(trade: AlpacaTrade): boolean {
  return trade.u === "canceled" || trade.u === "incorrect";
}

export class AlpacaMarketDataService {
  private readonly historicalCache: HistoricalDataCache;

  constructor(
    private readonly options: {
      apiKey: string;
      secretKey: string;
      baseUrl: string;
      historicalCache?: HistoricalDataCache;
      cacheDir?: string;
    },
  ) {
    this.historicalCache =
      options.historicalCache ??
      getSharedHistoricalDataCache(options.cacheDir);
  }

  async getLastTradePrice(ticker: string, asOf: Date): Promise<number | null> {
    if (!this.options.apiKey || !this.options.secretKey) {
      return null;
    }

    const normalizedEnd = normalizeAsOfEnd(asOf);
    const cacheKey = stockLastTradeKey(ticker, normalizedEnd.toISOString());
    const cacheable = isHistoricalCacheEligible(normalizedEnd);

    if (cacheable) {
      const cached = await this.historicalCache.get<number | null>(
        "stock-last-trade",
        cacheKey,
      );
      if (cached !== undefined) {
        return cached;
      }
    }

    const start = new Date(normalizedEnd.getTime() - LOOKBACK_MS);
    const asofDate = `${normalizedEnd.getUTCFullYear()}-${pad2(normalizedEnd.getUTCMonth() + 1)}-${pad2(normalizedEnd.getUTCDate())}`;

    const url = new URL(`${this.options.baseUrl}/v2/stocks/trades`);
    url.searchParams.set("symbols", ticker);
    url.searchParams.set("start", start.toISOString());
    url.searchParams.set("end", normalizedEnd.toISOString());
    url.searchParams.set("sort", "desc");
    url.searchParams.set("limit", "1");
    url.searchParams.set("asof", asofDate);

    let price: number | null = null;

    try {
      const response = await fetch(url, {
        headers: {
          "APCA-API-KEY-ID": this.options.apiKey,
          "APCA-API-SECRET-KEY": this.options.secretKey,
        },
      });

      if (!response.ok) {
        price = null;
      } else {
        const data = (await response.json()) as AlpacaTradesResponse;
        const trades = data.trades[ticker] ?? [];
        const trade = trades.find((entry) => !isInvalidTrade(entry));
        price = trade?.p ?? null;
      }
    } catch {
      price = null;
    }

    if (cacheable) {
      await this.historicalCache.set("stock-last-trade", cacheKey, price);
    }

    return price;
  }
}
