export type CatalystType = "DIRECTIONAL" | "VOLATILITY" | "NONE";
export type TradeDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type StrategyType = "ATM_CALL" | "ATM_PUT" | "STRADDLE" | "STRANGLE";
export type ExitCondition = "TAKE_PROFIT" | "STOP_LOSS" | "TIME_STOP";

export interface LlmAnalysisResult {
  catalystType: CatalystType;
  direction: TradeDirection;
  magnitudeScore: number;
  reasoning: string;
  tokenCount?: number;
  latencyMs: number;
}

export interface IngestedDocument {
  id: string;
  source: string;
  ticker: string;
  title: string;
  accessionNumber?: string;
  filedAt?: string;
  cleanedTextPreview: string;
}

export interface AnalysisEvent {
  type: "analysis";
  documentId: string;
  ticker: string;
  title: string;
  catalystType: CatalystType;
  direction: TradeDirection;
  magnitudeScore: number;
  reasoning: string;
  latencyMs: number;
  timestamp: string;
}

export interface DocumentEvent {
  type: "document";
  document: IngestedDocument;
  timestamp: string;
}

export type TradeStatus =
  | "EXECUTED"
  | "PENDING"
  | "BLOCKED"
  | "REJECTED"
  | "FAILED";

export interface OptionLegSnapshot {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  entryPrice?: number;
}

export interface TradeEvent {
  type: "trade";
  ticker: string;
  side: "BUY" | "SELL";
  quantity: number;
  price?: number;
  status: TradeStatus;
  blockReason?: string;
  mode: "PAPER" | "LIVE";
  strategy?: StrategyType;
  legs?: OptionLegSnapshot[];
  totalPremiumPaid?: number;
  positionGroupId?: string;
  timestamp: string;
}

export interface PositionClosedEvent {
  type: "position_closed";
  positionGroupId: string;
  underlying: string;
  strategy: StrategyType;
  exitCondition: ExitCondition;
  netExitValue: number;
  totalPremiumPaid: number;
  timestamp: string;
}

export interface StatusEvent {
  type: "status";
  systemStatus: "idle" | "ingesting" | "analyzing" | "trading" | "error";
  tradingMode: "PAPER" | "LIVE";
  accountEquity: number;
  buyingPower: number;
  lastLlmLatencyMs?: number;
  consecutiveLlmFailures: number;
  timestamp: string;
}

export interface PositionSnapshot {
  ticker: string;
  quantity: number;
  marketValue: number;
  avgEntryPrice: number;
  unrealizedPl: number;
  assetClass?: "equity" | "option";
}

export interface PositionsEvent {
  type: "positions";
  positions: PositionSnapshot[];
  timestamp: string;
}

export interface BacktestProgressEvent {
  type: "backtest_progress";
  runId: string;
  processed: number;
  total: number;
  equity: number;
  llmFailures?: number;
  timestamp: string;
}

export interface BacktestCompleteEvent {
  type: "backtest_complete";
  runId: string;
  name: string;
  initialEquity: number;
  finalEquity: number;
  tradeCount: number;
  documentsProcessed: number;
  llmFailures: number;
  timestamp: string;
}

export interface BacktestFailedEvent {
  type: "backtest_failed";
  runId: string;
  reason: string;
  timestamp: string;
}

export interface BackfillProgressEvent {
  type: "backfill_progress";
  backfillId: string;
  ticker: string;
  processed: number;
  total: number;
  ingested: number;
  skipped: number;
  timestamp: string;
}

export interface BackfillCompleteEvent {
  type: "backfill_complete";
  backfillId: string;
  ticker: string;
  ingested: number;
  skipped: number;
  timestamp: string;
}

export interface BackfillFailedEvent {
  type: "backfill_failed";
  backfillId: string;
  ticker: string;
  reason: string;
  timestamp: string;
}

export type WsEvent =
  | DocumentEvent
  | AnalysisEvent
  | TradeEvent
  | PositionClosedEvent
  | StatusEvent
  | PositionsEvent
  | BacktestProgressEvent
  | BacktestCompleteEvent
  | BacktestFailedEvent
  | BackfillProgressEvent
  | BackfillCompleteEvent
  | BackfillFailedEvent;
