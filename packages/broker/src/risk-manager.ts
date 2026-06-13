import type { Env, ExitCondition } from "@edgar-eye/shared";
import { computeNetBidValue } from "./options-chain.service.js";
import { isMarketHoursET, isTimeStopMoment } from "./market-hours.js";
import type {
  IBrokerService,
  OpenPositionGroup,
  RiskCheckContext,
  RiskCheckResult,
} from "./types.js";

const TP_MULTIPLIER = 1.3;
const SL_MULTIPLIER = 0.85;
const MONITOR_INTERVAL_MS = 5_000;

export interface PositionCloseHandler {
  onPositionClosed(
    group: OpenPositionGroup,
    exitCondition: ExitCondition,
    netExitValue: number,
  ): Promise<void>;
}

export interface PositionMonitorDeps {
  broker: IBrokerService;
  onClose: PositionCloseHandler;
  now?: () => Date;
}

export class RiskManager {
  private dailyHighWaterEquity = 0;
  private consecutiveLlmFailures = 0;
  private lastTradingDay = "";
  private readonly maxDailyDrawdownPct: number;
  private readonly maxPositionSizePct: number;
  private readonly maxConsecutiveLlmFailures: number;
  private readonly openPositions = new Map<string, OpenPositionGroup>();
  private readonly closingInProgress = new Set<string>();
  private monitorInterval: ReturnType<typeof setInterval> | null = null;
  private monitorDeps: PositionMonitorDeps | null = null;
  private readonly now: () => Date;

  constructor(env: Env, now: () => Date = () => new Date()) {
    this.maxDailyDrawdownPct = env.MAX_DAILY_DRAWDOWN_PCT;
    this.maxPositionSizePct = env.MAX_POSITION_SIZE_PCT;
    this.maxConsecutiveLlmFailures = env.MAX_CONSECUTIVE_LLM_FAILURES;
    this.now = now;
  }

  recordEquity(equity: number): void {
    this.maybeResetDailyBaseline(equity);
    if (equity > this.dailyHighWaterEquity) {
      this.dailyHighWaterEquity = equity;
    }
  }

  resetDailyBaseline(equity: number): void {
    this.dailyHighWaterEquity = equity;
    this.lastTradingDay = getTradingDayKey(this.now());
  }

  recordLlmSuccess(): void {
    this.consecutiveLlmFailures = 0;
  }

  recordLlmFailure(): void {
    this.consecutiveLlmFailures += 1;
  }

  getConsecutiveLlmFailures(): number {
    return this.consecutiveLlmFailures;
  }

  getDailyHighWaterEquity(): number {
    return this.dailyHighWaterEquity;
  }

  registerOpenPosition(group: OpenPositionGroup): void {
    this.openPositions.set(group.positionGroupId, group);
  }

  unregisterPosition(positionGroupId: string): void {
    this.openPositions.delete(positionGroupId);
    this.closingInProgress.delete(positionGroupId);
  }

  getOpenPositions(): OpenPositionGroup[] {
    return [...this.openPositions.values()];
  }

  startPositionMonitor(deps: PositionMonitorDeps): void {
    this.monitorDeps = deps;
    if (this.monitorInterval) {
      return;
    }

    this.monitorInterval = setInterval(() => {
      void this.evaluateOpenPositions();
    }, MONITOR_INTERVAL_MS);
  }

  stopPositionMonitor(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    this.monitorDeps = null;
  }

  async evaluateOpenPositions(): Promise<void> {
    const deps = this.monitorDeps;
    if (!deps || this.openPositions.size === 0) {
      return;
    }

    const currentTime = deps.now?.() ?? this.now();
    if (!isMarketHoursET(currentTime)) {
      return;
    }

    if (isTimeStopMoment(currentTime)) {
      await this.closeAllPositions("TIME_STOP");
      return;
    }

    for (const group of this.openPositions.values()) {
      if (this.closingInProgress.has(group.positionGroupId)) {
        continue;
      }

      const quotes = await deps.broker.getOptionQuotes(
        group.legs.map((leg) => leg.symbol),
      );
      const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));
      const netBidValue = computeNetBidValue(group.legs, quoteMap);

      if (netBidValue >= group.totalPremiumPaid * TP_MULTIPLIER) {
        await this.closePosition(group, "TAKE_PROFIT", netBidValue);
      } else if (netBidValue <= group.totalPremiumPaid * SL_MULTIPLIER) {
        await this.closePosition(group, "STOP_LOSS", netBidValue);
      }
    }
  }

  evaluate(context: RiskCheckContext): RiskCheckResult {
    if (this.consecutiveLlmFailures >= this.maxConsecutiveLlmFailures) {
      return {
        allowed: false,
        reason: `Circuit breaker: ${this.consecutiveLlmFailures} consecutive LLM failures (max ${this.maxConsecutiveLlmFailures})`,
      };
    }

    if (this.dailyHighWaterEquity > 0) {
      const drawdownPct =
        ((this.dailyHighWaterEquity - context.currentEquity) /
          this.dailyHighWaterEquity) *
        100;

      if (drawdownPct > this.maxDailyDrawdownPct) {
        return {
          allowed: false,
          reason: `Circuit breaker: daily drawdown ${drawdownPct.toFixed(2)}% exceeds ${this.maxDailyDrawdownPct}% limit`,
        };
      }
    }

    if (context.buyingPower > 0) {
      const positionPct =
        (context.orderNotional / context.buyingPower) * 100;

      if (positionPct > this.maxPositionSizePct) {
        return {
          allowed: false,
          reason: `Position size ${positionPct.toFixed(2)}% of buying power exceeds ${this.maxPositionSizePct}% limit`,
        };
      }
    }

    return { allowed: true };
  }

  interceptOrder(context: RiskCheckContext): RiskCheckResult {
    return this.evaluate(context);
  }

  private async closeAllPositions(
    exitCondition: ExitCondition,
  ): Promise<void> {
    for (const group of [...this.openPositions.values()]) {
      const quotes = await this.monitorDeps?.broker.getOptionQuotes(
        group.legs.map((leg) => leg.symbol),
      );
      const quoteMap = new Map((quotes ?? []).map((q) => [q.symbol, q]));
      const netBidValue = computeNetBidValue(group.legs, quoteMap);
      await this.closePosition(group, exitCondition, netBidValue);
    }
  }

  private async closePosition(
    group: OpenPositionGroup,
    exitCondition: ExitCondition,
    netBidValue: number,
  ): Promise<void> {
    const deps = this.monitorDeps;
    if (!deps || this.closingInProgress.has(group.positionGroupId)) {
      return;
    }

    this.closingInProgress.add(group.positionGroupId);

    try {
      const result = await deps.broker.closePositionGroup(group, exitCondition);
      if (result.success) {
        this.unregisterPosition(group.positionGroupId);
        await deps.onClose.onPositionClosed(
          group,
          exitCondition,
          result.netExitValue || netBidValue,
        );
      }
    } finally {
      this.closingInProgress.delete(group.positionGroupId);
    }
  }

  private maybeResetDailyBaseline(equity: number): void {
    const tradingDay = getTradingDayKey(this.now());
    if (this.lastTradingDay === "") {
      this.lastTradingDay = tradingDay;
      this.dailyHighWaterEquity = equity;
      return;
    }

    if (tradingDay !== this.lastTradingDay) {
      this.resetDailyBaseline(equity);
    }
  }
}

function getTradingDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
