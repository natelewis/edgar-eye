import type { ExitCondition } from "@edgar-eye/shared";
import {
  getMarketOpenOnDay,
  getTimeStopOnDay,
  normalizeToNextMarketSession,
} from "./market-hours.js";
import type { AlpacaOptionsDataService } from "./alpaca-options-data.js";
import type { OptionLeg, OptionMinuteBar } from "./types.js";

const CONTRACT_MULTIPLIER = 100;
const TP_MULTIPLIER = 1.3;
const SL_MULTIPLIER = 0.85;

export interface ExitSimulationResult {
  exitAt: Date;
  exitCondition: ExitCondition;
  netExitValue: number;
  pnl: number;
  exitPrices: Map<string, number>;
}

export class ExitSimulator {
  constructor(private readonly optionsData: AlpacaOptionsDataService) {}

  async simulate(
    legs: OptionLeg[],
    entryAt: Date,
    totalPremiumPaid: number,
  ): Promise<ExitSimulationResult> {
    const sessionEntry = normalizeToNextMarketSession(entryAt);
    const symbols = legs.map((leg) => leg.symbol);
    const endOfDay = getTimeStopOnDay(sessionEntry);
    const marketOpen = getMarketOpenOnDay(sessionEntry);
    const marketClose = new Date(endOfDay.getTime() + 5 * 60_000);

    const bars = await this.optionsData.getMinuteBars(
      symbols,
      marketOpen,
      marketClose,
    );

    if (bars.length === 0) {
      return buildFallbackTimeStop(
        legs,
        endOfDay,
        totalPremiumPaid,
      );
    }

    const buckets = alignBarsByTimestamp(bars, sessionEntry);
    const timeStopMs = endOfDay.getTime();

    if (buckets.length === 0) {
      return buildFallbackTimeStop(legs, endOfDay, totalPremiumPaid);
    }

    for (const bucket of buckets) {
      const netClose = computeNetValue(legs, bucket.closes);
      const netHigh = computeNetValue(legs, bucket.highs);
      const netLow = computeNetValue(legs, bucket.lows);

      if (netHigh >= totalPremiumPaid * TP_MULTIPLIER) {
        return buildResult(
          bucket.timestamp,
          "TAKE_PROFIT",
          netClose,
          totalPremiumPaid,
          bucket.closes,
        );
      }

      if (netLow <= totalPremiumPaid * SL_MULTIPLIER) {
        return buildResult(
          bucket.timestamp,
          "STOP_LOSS",
          netClose,
          totalPremiumPaid,
          bucket.closes,
        );
      }

      if (bucket.timestamp.getTime() >= timeStopMs) {
        return buildResult(
          bucket.timestamp,
          "TIME_STOP",
          netClose,
          totalPremiumPaid,
          bucket.closes,
        );
      }
    }

    const last = buckets[buckets.length - 1];
    if (!last) {
      return buildFallbackTimeStop(legs, endOfDay, totalPremiumPaid);
    }

    return buildResult(
      last.timestamp,
      "TIME_STOP",
      computeNetValue(legs, last.closes),
      totalPremiumPaid,
      last.closes,
    );
  }
}

interface MinuteBucket {
  timestamp: Date;
  closes: Map<string, number>;
  highs: Map<string, number>;
  lows: Map<string, number>;
}

function alignBarsByTimestamp(
  bars: OptionMinuteBar[],
  entryAt: Date,
): MinuteBucket[] {
  const byTimestamp = new Map<number, MinuteBucket>();

  for (const bar of bars) {
    if (bar.timestamp < entryAt) {
      continue;
    }

    const key = bar.timestamp.getTime();
    const bucket = byTimestamp.get(key) ?? {
      timestamp: bar.timestamp,
      closes: new Map<string, number>(),
      highs: new Map<string, number>(),
      lows: new Map<string, number>(),
    };

    bucket.closes.set(bar.symbol, bar.close);
    bucket.highs.set(bar.symbol, bar.high);
    bucket.lows.set(bar.symbol, bar.low);
    byTimestamp.set(key, bucket);
  }

  return [...byTimestamp.values()].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
}

function computeNetValue(
  legs: OptionLeg[],
  prices: Map<string, number>,
): number {
  return legs.reduce((sum, leg) => {
    const price = prices.get(leg.symbol) ?? leg.entryPrice ?? 0;
    return sum + price * CONTRACT_MULTIPLIER * leg.quantity;
  }, 0);
}

function buildResult(
  exitAt: Date,
  exitCondition: ExitCondition,
  netExitValue: number,
  totalPremiumPaid: number,
  prices: Map<string, number>,
): ExitSimulationResult {
  const exitPrices = new Map<string, number>();
  for (const [symbol, price] of prices) {
    exitPrices.set(symbol, price * 0.98);
  }

  const adjustedNet = netExitValue > 0 ? netExitValue * 0.98 : totalPremiumPaid * 0.98;

  return {
    exitAt,
    exitCondition,
    netExitValue: adjustedNet,
    pnl: adjustedNet - totalPremiumPaid,
    exitPrices,
  };
}

function buildFallbackTimeStop(
  legs: OptionLeg[],
  exitAt: Date,
  totalPremiumPaid: number,
): ExitSimulationResult {
  const exitPrices = new Map<string, number>();
  for (const leg of legs) {
    exitPrices.set(leg.symbol, (leg.entryPrice ?? 0) * 0.98);
  }

  const netExitValue = totalPremiumPaid * 0.98;

  return {
    exitAt,
    exitCondition: "TIME_STOP",
    netExitValue,
    pnl: netExitValue - totalPremiumPaid,
    exitPrices,
  };
}
