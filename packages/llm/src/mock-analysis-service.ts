import type {
  CatalystType,
  LlmAnalysisResult,
  TradeDirection,
} from "@edgar-eye/shared";
import type { AnalysisInput, IAnalysisService } from "./analysis-service.js";

interface KeywordRule {
  keywords: string[];
  catalystType: CatalystType;
  direction: TradeDirection;
  magnitudeBoost: number;
}

const BULLISH_RULES: KeywordRule[] = [
  {
    keywords: ["merger", "acquisition", "acquire"],
    catalystType: "DIRECTIONAL",
    direction: "BULLISH",
    magnitudeBoost: 25,
  },
  {
    keywords: ["record revenue", "beat expectations", "raised guidance"],
    catalystType: "DIRECTIONAL",
    direction: "BULLISH",
    magnitudeBoost: 20,
  },
  {
    keywords: ["new contract", "major contract", "partnership"],
    catalystType: "DIRECTIONAL",
    direction: "BULLISH",
    magnitudeBoost: 15,
  },
  {
    keywords: ["buyback", "repurchase", "dividend increase"],
    catalystType: "DIRECTIONAL",
    direction: "BULLISH",
    magnitudeBoost: 10,
  },
];

const BEARISH_RULES: KeywordRule[] = [
  {
    keywords: ["bankruptcy", "chapter 11", "going concern"],
    catalystType: "DIRECTIONAL",
    direction: "BEARISH",
    magnitudeBoost: 30,
  },
  {
    keywords: ["resignation", "resigned", "departure", "steps down"],
    catalystType: "DIRECTIONAL",
    direction: "BEARISH",
    magnitudeBoost: 15,
  },
  {
    keywords: ["restatement", "missed expectations", "lowered guidance"],
    catalystType: "DIRECTIONAL",
    direction: "BEARISH",
    magnitudeBoost: 20,
  },
  {
    keywords: ["default", "delisting", "layoffs"],
    catalystType: "DIRECTIONAL",
    direction: "BEARISH",
    magnitudeBoost: 15,
  },
];

const VOLATILITY_RULES: KeywordRule[] = [
  {
    keywords: ["investigation", "lawsuit", "subpoena", "sec inquiry"],
    catalystType: "VOLATILITY",
    direction: "NEUTRAL",
    magnitudeBoost: 25,
  },
];

/// Deterministic, network-free analysis used for backtests and tests. Applies
/// simple keyword heuristics so that backtests produce repeatable signals
/// without depending on a running LLM.
export class MockAnalysisService implements IAnalysisService {
  async analyzeFiling(input: AnalysisInput): Promise<LlmAnalysisResult> {
    const start = Date.now();
    const haystack = `${input.title}\n${input.cleanedText}`.toLowerCase();

    let bullish = 0;
    let bearish = 0;
    let volatility = 0;
    const matched: string[] = [];

    for (const rule of BULLISH_RULES) {
      if (rule.keywords.some((k) => haystack.includes(k))) {
        bullish += rule.magnitudeBoost;
        matched.push(...rule.keywords.filter((k) => haystack.includes(k)));
      }
    }

    for (const rule of BEARISH_RULES) {
      if (rule.keywords.some((k) => haystack.includes(k))) {
        bearish += rule.magnitudeBoost;
        matched.push(...rule.keywords.filter((k) => haystack.includes(k)));
      }
    }

    for (const rule of VOLATILITY_RULES) {
      if (rule.keywords.some((k) => haystack.includes(k))) {
        volatility += rule.magnitudeBoost;
        matched.push(...rule.keywords.filter((k) => haystack.includes(k)));
      }
    }

    let catalystType: CatalystType = "NONE";
    let direction: TradeDirection = "NEUTRAL";
    let magnitudeScore = 30;
    let reasoning: string;

    if (volatility >= bullish && volatility >= bearish && volatility > 0) {
      catalystType = "VOLATILITY";
      direction = "NEUTRAL";
      magnitudeScore = clampMagnitude(70 + volatility);
      reasoning = `Mock analysis detected volatility catalyst (${matched.join(", ")}).`;
    } else if (bullish > bearish && bullish > 0) {
      catalystType = "DIRECTIONAL";
      direction = "BULLISH";
      magnitudeScore = clampMagnitude(65 + bullish);
      reasoning = `Mock analysis detected bullish directional catalyst (${matched.join(", ")}).`;
    } else if (bearish > bullish && bearish > 0) {
      catalystType = "DIRECTIONAL";
      direction = "BEARISH";
      magnitudeScore = clampMagnitude(65 + bearish);
      reasoning = `Mock analysis detected bearish directional catalyst (${matched.join(", ")}).`;
    } else {
      catalystType = "NONE";
      direction = "NEUTRAL";
      magnitudeScore = 25;
      reasoning = matched.length
        ? `Mock analysis found mixed signals (${matched.join(", ")}); no trade.`
        : "Mock analysis found no material structural change; no trade.";
    }

    return {
      catalystType,
      direction,
      magnitudeScore,
      reasoning,
      tokenCount: Math.min(haystack.length, 12_000),
      latencyMs: Date.now() - start,
    };
  }
}

function clampMagnitude(value: number): number {
  return Math.max(0, Math.min(99, Number(value.toFixed(0))));
}
