import { describe, expect, it } from "vitest";
import { ExitSimulator } from "./exit-simulator.js";
import type { AlpacaOptionsDataService } from "./alpaca-options-data.js";
import type { OptionLeg } from "./types.js";

const legs: OptionLeg[] = [
  { symbol: "AAPL260117C00150000", side: "BUY", quantity: 1, entryPrice: 4.8 },
  { symbol: "AAPL260117P00150000", side: "BUY", quantity: 1, entryPrice: 4.5 },
];

function makeOptionsData(
  bars: Array<{
    symbol: string;
    timestamp: Date;
    open: number;
    high: number;
    low: number;
    close: number;
  }>,
): AlpacaOptionsDataService {
  return {
    getMinuteBars: async () =>
      bars.map((bar) => ({
        symbol: bar.symbol,
        timestamp: bar.timestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
  } as unknown as AlpacaOptionsDataService;
}

describe("ExitSimulator", () => {
  it("exits on take profit when net high reaches +30%", async () => {
    const entryAt = new Date("2026-01-15T15:00:00-05:00");
    const minute = new Date("2026-01-15T15:05:00-05:00");
    const simulator = new ExitSimulator(
      makeOptionsData([
        {
          symbol: legs[0].symbol,
          timestamp: minute,
          open: 6,
          high: 6.2,
          low: 5.8,
          close: 6.1,
        },
        {
          symbol: legs[1].symbol,
          timestamp: minute,
          open: 6,
          high: 6.2,
          low: 5.8,
          close: 6.1,
        },
      ]),
    );

    const result = await simulator.simulate(legs, entryAt, 930);
    expect(result?.exitCondition).toBe("TAKE_PROFIT");
    expect(result?.pnl).toBeGreaterThan(0);
  });

  it("exits on stop loss when net low reaches -15%", async () => {
    const entryAt = new Date("2026-01-15T15:00:00-05:00");
    const minute = new Date("2026-01-15T15:05:00-05:00");
    const simulator = new ExitSimulator(
      makeOptionsData([
        {
          symbol: legs[0].symbol,
          timestamp: minute,
          open: 3.5,
          high: 3.6,
          low: 3.4,
          close: 3.5,
        },
        {
          symbol: legs[1].symbol,
          timestamp: minute,
          open: 3.5,
          high: 3.6,
          low: 3.4,
          close: 3.5,
        },
      ]),
    );

    const result = await simulator.simulate(legs, entryAt, 930);
    expect(result?.exitCondition).toBe("STOP_LOSS");
    expect(result?.pnl).toBeLessThan(0);
  });

  it("falls back to time-stop when no historical bars are available", async () => {
    const simulator = new ExitSimulator(makeOptionsData([]));
    const result = await simulator.simulate(
      legs,
      new Date("2026-01-15T15:00:00-05:00"),
      930,
    );
    expect(result.exitCondition).toBe("TIME_STOP");
    expect(result.pnl).toBeLessThan(0);
  });
});
