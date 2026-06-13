import type {
  ExitCondition,
  StrategyType,
} from "@edgar-eye/shared";

export type OrderSide = "BUY" | "SELL";

export interface OrderRequest {
  ticker: string;
  side: OrderSide;
  quantity: number;
  notional?: number;
}

export type OrderStatus = "EXECUTED" | "PENDING" | "REJECTED" | "FAILED";

export interface OrderResult {
  success: boolean;
  orderId?: string;
  filledPrice?: number;
  filledQuantity?: number;
  status: OrderStatus;
  rejectionReason?: string;
  totalPremiumPaid?: number;
  legs?: OptionLeg[];
}

export interface AccountSnapshot {
  equity: number;
  buyingPower: number;
  cash: number;
  portfolioValue: number;
}

export interface Position {
  ticker: string;
  quantity: number;
  marketValue: number;
  avgEntryPrice: number;
  unrealizedPl: number;
  assetClass?: "equity" | "option";
}

export interface OptionLeg {
  symbol: string;
  side: OrderSide;
  quantity: number;
  entryPrice?: number;
}

export interface OptionsOrderRequest {
  underlying: string;
  strategy: StrategyType;
  legs: OptionLeg[];
  quantity: number;
}

export interface OpenPositionGroup {
  positionGroupId: string;
  underlying: string;
  strategy: StrategyType;
  legs: OptionLeg[];
  totalPremiumPaid: number;
  openedAt: string;
  tradeLogId?: string;
}

export interface OptionQuote {
  symbol: string;
  bid: number;
  ask: number;
}

export interface ClosePositionResult {
  success: boolean;
  netExitValue: number;
  exitCondition: ExitCondition;
  rejectionReason?: string;
}

export interface RiskCheckContext {
  order: OrderRequest;
  buyingPower: number;
  orderNotional: number;
  currentEquity: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface IBrokerService {
  getBuyingPower(): Promise<number>;
  getAccountSnapshot(): Promise<AccountSnapshot>;
  getPositions(): Promise<Position[]>;
  executeOrder(order: OrderRequest): Promise<OrderResult>;
  executeOptionsOrder(order: OptionsOrderRequest): Promise<OrderResult>;
  closePositionGroup(
    group: OpenPositionGroup,
    exitCondition: ExitCondition,
    exitPrices?: Map<string, number>,
  ): Promise<ClosePositionResult>;
  getOptionQuotes(symbols: string[]): Promise<OptionQuote[]>;
}

export interface OptionChainContract {
  symbol: string;
  type: "call" | "put";
  strike: number;
  expirationDate: string;
  bid: number;
  ask: number;
}

export interface OptionMinuteBar {
  symbol: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
}
