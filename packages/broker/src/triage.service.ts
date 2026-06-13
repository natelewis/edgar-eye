import { randomUUID } from "node:crypto";
import type { LlmAnalysisResult, StrategyType } from "@edgar-eye/shared";
import { AlpacaOptionsDataService } from "./alpaca-options-data.js";
import { OptionsChainService } from "./options-chain.service.js";
import type { RiskManager } from "./risk-manager.js";
import type {
  IBrokerService,
  OpenPositionGroup,
  OptionsOrderRequest,
} from "./types.js";

export interface TriageResult {
  positionGroup: OpenPositionGroup;
  orderRequest: OptionsOrderRequest;
  estimatedPremium: number;
}

export type TriageOutcome =
  | { kind: "skip" }
  | {
      kind: "blocked";
      reason: string;
      estimatedPremium: number;
      strategy: StrategyType;
    }
  | { kind: "trade"; result: TriageResult };

export interface TriageEvaluateInput {
  analysis: LlmAnalysisResult;
  underlying: string;
  broker: IBrokerService;
  riskManager: RiskManager;
  optionsData: AlpacaOptionsDataService;
  asOf?: Date;
}

export class TriageService {
  private readonly chainService = new OptionsChainService();

  async evaluate(input: TriageEvaluateInput): Promise<TriageOutcome> {
    const { analysis, underlying, broker, riskManager, optionsData, asOf } =
      input;

    const spotPrice = await optionsData.getUnderlyingPrice(underlying, asOf);
    if (spotPrice === null || spotPrice <= 0) {
      return { kind: "skip" };
    }

    const chain = await optionsData.getOptionChain(underlying, asOf);
    if (chain.length === 0) {
      return { kind: "skip" };
    }

    const buyingPower = await broker.getBuyingPower();
    const selectionInput = {
      underlying,
      spotPrice,
      buyingPower,
      chain,
      asOf,
    };

    let selection = null;

    if (
      analysis.catalystType === "DIRECTIONAL" &&
      analysis.direction === "BULLISH" &&
      analysis.magnitudeScore >= 80
    ) {
      selection = this.chainService.selectAtmCall(selectionInput);
    } else if (
      analysis.catalystType === "DIRECTIONAL" &&
      analysis.direction === "BEARISH" &&
      analysis.magnitudeScore >= 80
    ) {
      selection = this.chainService.selectAtmPut(selectionInput);
    } else if (
      analysis.catalystType === "VOLATILITY" &&
      analysis.magnitudeScore >= 85
    ) {
      selection = this.chainService.selectVolatilityPlay(selectionInput);
    }

    if (!selection) {
      return { kind: "skip" };
    }

    const orderRequest = this.chainService.toOrderRequest(underlying, selection);
    const snapshot = await broker.getAccountSnapshot();
    riskManager.recordEquity(snapshot.equity);

    const riskResult = riskManager.interceptOrder({
      order: {
        ticker: underlying,
        side: "BUY",
        quantity: 1,
      },
      buyingPower,
      orderNotional: selection.estimatedPremium,
      currentEquity: snapshot.equity,
    });

    if (!riskResult.allowed) {
      return {
        kind: "blocked",
        reason: riskResult.reason ?? "Risk manager blocked order",
        estimatedPremium: selection.estimatedPremium,
        strategy: selection.strategy,
      };
    }

    const positionGroup: OpenPositionGroup = {
      positionGroupId: randomUUID(),
      underlying,
      strategy: selection.strategy,
      legs: selection.legs,
      totalPremiumPaid: selection.estimatedPremium,
      openedAt: new Date().toISOString(),
    };

    return {
      kind: "trade",
      result: {
        positionGroup,
        orderRequest,
        estimatedPremium: selection.estimatedPremium,
      },
    };
  }
}
