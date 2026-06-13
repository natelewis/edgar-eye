import { describe, expect, it } from "vitest";
import {
  OptionsChainService,
  computePremiumPaid,
} from "./options-chain.service.js";
import type { OptionChainContract } from "./types.js";

const service = new OptionsChainService();

const chain: OptionChainContract[] = [
  {
    symbol: "AAPL260117C00150000",
    type: "call",
    strike: 150,
    expirationDate: "2026-01-17",
    bid: 4.5,
    ask: 4.8,
  },
  {
    symbol: "AAPL260117P00150000",
    type: "put",
    strike: 150,
    expirationDate: "2026-01-17",
    bid: 4.2,
    ask: 4.5,
  },
  {
    symbol: "AAPL260117C00157500",
    type: "call",
    strike: 157.5,
    expirationDate: "2026-01-17",
    bid: 2.1,
    ask: 2.3,
  },
  {
    symbol: "AAPL260117P00142500",
    type: "put",
    strike: 142.5,
    expirationDate: "2026-01-17",
    bid: 2.0,
    ask: 2.2,
  },
];

describe("OptionsChainService", () => {
  it("selects ATM call for directional bullish play", () => {
    const result = service.selectAtmCall({
      underlying: "AAPL",
      spotPrice: 150,
      buyingPower: 50_000,
      chain,
    });

    expect(result?.strategy).toBe("ATM_CALL");
    expect(result?.legs).toHaveLength(1);
    expect(result?.legs[0].symbol).toBe("AAPL260117C00150000");
    expect(result?.estimatedPremium).toBe(480);
  });

  it("selects ATM put for directional bearish play", () => {
    const result = service.selectAtmPut({
      underlying: "AAPL",
      spotPrice: 150,
      buyingPower: 50_000,
      chain,
    });

    expect(result?.strategy).toBe("ATM_PUT");
    expect(result?.legs[0].symbol).toBe("AAPL260117P00150000");
    expect(result?.estimatedPremium).toBe(450);
  });

  it("selects straddle when cost is below 10% of buying power", () => {
    const result = service.selectVolatilityPlay({
      underlying: "AAPL",
      spotPrice: 150,
      buyingPower: 50_000,
      chain,
    });

    expect(result?.strategy).toBe("STRADDLE");
    expect(result?.legs).toHaveLength(2);
    expect(result?.estimatedPremium).toBeCloseTo(930);
  });

  it("falls back to strangle when straddle exceeds 10% of buying power", () => {
    const result = service.selectVolatilityPlay({
      underlying: "AAPL",
      spotPrice: 150,
      buyingPower: 5_000,
      chain,
    });

    expect(result?.strategy).toBe("STRANGLE");
    expect(result?.legs.map((l) => l.symbol)).toEqual([
      "AAPL260117C00157500",
      "AAPL260117P00142500",
    ]);
    expect(result?.estimatedPremium).toBe(450);
  });
});

describe("computePremiumPaid", () => {
  it("sums ask prices across legs with contract multiplier", () => {
    const premium = computePremiumPaid([
      { symbol: "A", side: "BUY", quantity: 1, entryPrice: 4.8 },
      { symbol: "B", side: "BUY", quantity: 1, entryPrice: 4.5 },
    ]);

    expect(premium).toBe(930);
  });
});
