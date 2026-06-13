import type { StrategyType } from "@edgar-eye/shared";
import type {
  OptionChainContract,
  OptionLeg,
  OptionsOrderRequest,
} from "./types.js";

export interface ChainSelectionInput {
  underlying: string;
  spotPrice: number;
  buyingPower: number;
  chain: OptionChainContract[];
  asOf?: Date;
}

export interface ChainSelectionResult {
  strategy: StrategyType;
  legs: OptionLeg[];
  estimatedPremium: number;
}

const STRADDLE_BP_THRESHOLD = 0.1;
const OTM_PCT = 0.05;
const CONTRACT_MULTIPLIER = 100;

export class OptionsChainService {
  selectAtmCall(input: ChainSelectionInput): ChainSelectionResult | null {
    const pair = this.selectAtmPair(input.chain, input.spotPrice, input.asOf);
    if (!pair) {
      return null;
    }

    const premium = pair.call.ask * CONTRACT_MULTIPLIER;
    return {
      strategy: "ATM_CALL",
      legs: [
        {
          symbol: pair.call.symbol,
          side: "BUY",
          quantity: 1,
          entryPrice: pair.call.ask,
        },
      ],
      estimatedPremium: premium,
    };
  }

  selectAtmPut(input: ChainSelectionInput): ChainSelectionResult | null {
    const pair = this.selectAtmPair(input.chain, input.spotPrice, input.asOf);
    if (!pair) {
      return null;
    }

    const premium = pair.put.ask * CONTRACT_MULTIPLIER;
    return {
      strategy: "ATM_PUT",
      legs: [
        {
          symbol: pair.put.symbol,
          side: "BUY",
          quantity: 1,
          entryPrice: pair.put.ask,
        },
      ],
      estimatedPremium: premium,
    };
  }

  selectVolatilityPlay(input: ChainSelectionInput): ChainSelectionResult | null {
    const pair = this.selectAtmPair(input.chain, input.spotPrice, input.asOf);
    if (!pair) {
      return null;
    }

    const straddleCost =
      (pair.call.ask + pair.put.ask) * CONTRACT_MULTIPLIER;
    const threshold = input.buyingPower * STRADDLE_BP_THRESHOLD;

    if (straddleCost < threshold) {
      return {
        strategy: "STRADDLE",
        legs: [
          {
            symbol: pair.call.symbol,
            side: "BUY",
            quantity: 1,
            entryPrice: pair.call.ask,
          },
          {
            symbol: pair.put.symbol,
            side: "BUY",
            quantity: 1,
            entryPrice: pair.put.ask,
          },
        ],
        estimatedPremium: straddleCost,
      };
    }

    const callStrikeTarget = input.spotPrice * (1 + OTM_PCT);
    const putStrikeTarget = input.spotPrice * (1 - OTM_PCT);
    const expiry = pair.call.expirationDate;
    const expiryContracts = input.chain.filter(
      (c) => c.expirationDate === expiry,
    );
    const otmCall = this.findNearestStrike(
      expiryContracts.filter((c) => c.type === "call"),
      callStrikeTarget,
      "above",
    );
    const otmPut = this.findNearestStrike(
      expiryContracts.filter((c) => c.type === "put"),
      putStrikeTarget,
      "below",
    );

    if (!otmCall || !otmPut) {
      return null;
    }

    const strangleCost =
      (otmCall.ask + otmPut.ask) * CONTRACT_MULTIPLIER;
    return {
      strategy: "STRANGLE",
      legs: [
        {
          symbol: otmCall.symbol,
          side: "BUY",
          quantity: 1,
          entryPrice: otmCall.ask,
        },
        {
          symbol: otmPut.symbol,
          side: "BUY",
          quantity: 1,
          entryPrice: otmPut.ask,
        },
      ],
      estimatedPremium: strangleCost,
    };
  }

  toOrderRequest(
    underlying: string,
    selection: ChainSelectionResult,
  ): OptionsOrderRequest {
    return {
      underlying,
      strategy: selection.strategy,
      legs: selection.legs,
      quantity: 1,
    };
  }

  private selectAtmPair(
    chain: OptionChainContract[],
    spotPrice: number,
    asOf?: Date,
  ): { call: OptionChainContract; put: OptionChainContract } | null {
    if (chain.length === 0) {
      return null;
    }

    const nearestExpiry = this.findNearestExpiration(chain, asOf);
    const expiryContracts = chain.filter(
      (c) => c.expirationDate === nearestExpiry,
    );
    const calls = expiryContracts.filter((c) => c.type === "call");
    const puts = expiryContracts.filter((c) => c.type === "put");
    const atmCall = this.findNearestStrike(calls, spotPrice, "closest");
    const atmPut = this.findNearestStrike(puts, spotPrice, "closest");

    if (!atmCall || !atmPut) {
      return null;
    }

    return { call: atmCall, put: atmPut };
  }

  private findNearestExpiration(
    chain: OptionChainContract[],
    asOf?: Date,
  ): string {
    const ref = (asOf ?? new Date()).toISOString().slice(0, 10);
    const expirations = [...new Set(chain.map((c) => c.expirationDate))]
      .filter((d) => d >= ref)
      .sort();
    return expirations[0] ?? chain[0]?.expirationDate ?? "";
  }

  private findNearestStrike(
    contracts: OptionChainContract[],
    target: number,
    mode: "closest" | "above" | "below",
  ): OptionChainContract | null {
    if (contracts.length === 0) {
      return null;
    }

    const sorted = [...contracts].sort((a, b) => a.strike - b.strike);

    if (mode === "above") {
      return sorted.find((c) => c.strike >= target) ?? sorted.at(-1) ?? null;
    }

    if (mode === "below") {
      const below = sorted.filter((c) => c.strike <= target);
      return below.at(-1) ?? sorted[0] ?? null;
    }

    return sorted.reduce((best, current) => {
      const bestDiff = Math.abs(best.strike - target);
      const currentDiff = Math.abs(current.strike - target);
      return currentDiff < bestDiff ? current : best;
    });
  }
}

export function computePremiumPaid(legs: OptionLeg[]): number {
  return legs.reduce(
    (sum, leg) => sum + (leg.entryPrice ?? 0) * CONTRACT_MULTIPLIER * leg.quantity,
    0,
  );
}

export function computeNetBidValue(
  legs: OptionLeg[],
  quotes: Map<string, { bid: number }>,
): number {
  return legs.reduce((sum, leg) => {
    const bid = quotes.get(leg.symbol)?.bid ?? 0;
    return sum + bid * CONTRACT_MULTIPLIER * leg.quantity;
  }, 0);
}
