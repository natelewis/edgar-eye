export type {
  CatalystType,
  TradeDirection,
  StrategyType,
  ExitCondition,
  TradeStatus,
  PositionSnapshot,
} from "@edgar-eye/shared";

export interface StatusState {
  systemStatus: "idle" | "ingesting" | "analyzing" | "trading" | "error";
  tradingMode: "PAPER" | "LIVE";
  accountEquity: number;
  buyingPower: number;
  lastLlmLatencyMs?: number;
  consecutiveLlmFailures: number;
}

export interface ActivityItem {
  id: string;
  kind: "document" | "analysis";
  ticker: string;
  title: string;
  catalystType?: import("@edgar-eye/shared").CatalystType;
  direction?: import("@edgar-eye/shared").TradeDirection;
  magnitudeScore?: number;
  reasoning?: string;
  latencyMs?: number;
  timestamp: string;
}

export interface TradeItem {
  ticker: string;
  side: "BUY" | "SELL";
  quantity: number;
  price?: number;
  status: import("@edgar-eye/shared").TradeStatus;
  blockReason?: string;
  mode: "PAPER" | "LIVE";
  strategy?: import("@edgar-eye/shared").StrategyType;
  totalPremiumPaid?: number;
  positionGroupId?: string;
  timestamp: string;
}

export type PositionItem = import("@edgar-eye/shared").PositionSnapshot;

export interface BacktestProgress {
  runId: string;
  processed: number;
  total: number;
  equity: number;
  llmFailures?: number;
}

export interface BacktestResult {
  runId: string;
  name: string;
  initialEquity: number;
  finalEquity: number;
  tradeCount: number;
  documentsProcessed: number;
  llmFailures: number;
}

export interface BacktestFailure {
  runId: string;
  reason: string;
}

export interface BackfillProgress {
  backfillId: string;
  ticker: string;
  processed: number;
  total: number;
  ingested: number;
  skipped: number;
}

export interface BackfillResult {
  backfillId: string;
  ticker: string;
  ingested: number;
  skipped: number;
}

export interface BackfillFailure {
  backfillId: string;
  ticker: string;
  reason: string;
}

export interface BacktestRunParameters {
  ticker?: string | null;
  limit?: number | null;
  status?: "running" | "completed" | "failed";
  reason?: string;
  documentsProcessed?: number;
  llmFailures?: number;
  tradeCount?: number;
}

export interface BacktestRunRecord {
  id: string;
  name: string;
  startedAt: string;
  completedAt: string | null;
  initialEquity: number;
  finalEquity: number | null;
  parameters?: BacktestRunParameters | null;
  trades: BacktestTradeRecord[];
}

export interface BacktestTradeRecord {
  id: string;
  ticker: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  simulatedAt: string;
  catalystType: import("@edgar-eye/shared").CatalystType;
  direction: import("@edgar-eye/shared").TradeDirection;
  magnitudeScore: number;
  reasoning: string;
  strategy: import("@edgar-eye/shared").StrategyType;
  totalPremiumPaid: number;
  exitAt?: string | null;
  exitCondition?: import("@edgar-eye/shared").ExitCondition | null;
  netExitValue?: number | null;
  pnl?: number | null;
}
