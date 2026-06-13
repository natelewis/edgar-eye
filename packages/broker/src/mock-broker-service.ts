import type { ExitCondition } from "@edgar-eye/shared";
import { AlpacaMarketDataService } from "./alpaca-market-data.js";
import { AlpacaOptionsDataService } from "./alpaca-options-data.js";
import {
  getSharedHistoricalDataCache,
  type HistoricalDataCache,
} from "./historical-data-cache.js";
import {
  computeNetBidValue,
  computePremiumPaid,
} from "./options-chain.service.js";
import type {
  AccountSnapshot,
  ClosePositionResult,
  IBrokerService,
  OpenPositionGroup,
  OptionLeg,
  OptionQuote,
  OptionsOrderRequest,
  OrderRequest,
  OrderResult,
  Position,
} from "./types.js";

const CONTRACT_MULTIPLIER = 100;

export class MockBrokerService implements IBrokerService {
  private equity: number;
  private cash: number;
  private positions = new Map<string, Position>();
  private simulatedTime: Date | null = null;
  private readonly slippageBps: number;
  private readonly marketData: AlpacaMarketDataService;
  private readonly optionsData: AlpacaOptionsDataService | null;

  constructor(options: {
    initialEquity: number;
    slippageBps?: number;
    dataCredentials?: { apiKey: string; secretKey: string; baseUrl: string };
    tradingBaseUrl?: string;
    historicalCache?: HistoricalDataCache;
    cacheDir?: string;
  }) {
    this.equity = options.initialEquity;
    this.cash = options.initialEquity;
    this.slippageBps = options.slippageBps ?? 10;
    const historicalCache =
      options.historicalCache ??
      getSharedHistoricalDataCache(options.cacheDir);
    this.marketData = new AlpacaMarketDataService({
      apiKey: options.dataCredentials?.apiKey ?? "",
      secretKey: options.dataCredentials?.secretKey ?? "",
      baseUrl:
        options.dataCredentials?.baseUrl ?? "https://data.alpaca.markets",
      historicalCache,
    });
    this.optionsData =
      options.dataCredentials?.apiKey && options.dataCredentials.secretKey
        ? new AlpacaOptionsDataService({
            apiKey: options.dataCredentials.apiKey,
            secretKey: options.dataCredentials.secretKey,
            dataBaseUrl: options.dataCredentials.baseUrl,
            tradingBaseUrl: options.tradingBaseUrl,
            historicalCache,
          })
        : null;
  }

  async getBuyingPower(): Promise<number> {
    return this.cash;
  }

  async getAccountSnapshot(): Promise<AccountSnapshot> {
    this.recalculateEquity();
    return {
      equity: this.equity,
      buyingPower: this.cash,
      cash: this.cash,
      portfolioValue: this.equity,
    };
  }

  async getPositions(): Promise<Position[]> {
    return [...this.positions.values()];
  }

  async executeOrder(order: OrderRequest): Promise<OrderResult> {
    if (!this.simulatedTime) {
      return {
        success: false,
        status: "REJECTED",
        rejectionReason:
          "Mock broker: simulated time must be set before executing backtest orders",
      };
    }

    const basePrice = await this.marketData.getLastTradePrice(
      order.ticker,
      this.simulatedTime,
    );

    if (basePrice === null) {
      return {
        success: false,
        status: "REJECTED",
        rejectionReason: `Mock broker: no historical trade price found for ${order.ticker} at ${this.simulatedTime.toISOString()}`,
      };
    }

    const slippageMultiplier =
      order.side === "BUY"
        ? 1 + this.slippageBps / 10_000
        : 1 - this.slippageBps / 10_000;
    const fillPrice = basePrice * slippageMultiplier;
    const quantity = order.notional
      ? order.notional / fillPrice
      : order.quantity;
    const notional = fillPrice * quantity;

    if (order.side === "BUY" && notional > this.cash) {
      return {
        success: false,
        status: "REJECTED",
        rejectionReason: `Mock broker: insufficient cash ($${this.cash.toFixed(2)} < $${notional.toFixed(2)})`,
      };
    }

    if (order.side === "SELL") {
      const existing = this.positions.get(order.ticker);
      if (!existing || existing.quantity < quantity) {
        return {
          success: false,
          status: "REJECTED",
          rejectionReason: `Mock broker: insufficient shares of ${order.ticker}`,
        };
      }
    }

    if (order.side === "BUY") {
      this.cash -= notional;
      this.upsertPosition(order.ticker, quantity, fillPrice);
    } else {
      this.cash += notional;
      this.reducePosition(order.ticker, quantity, fillPrice);
    }

    this.recalculateEquity();

    return {
      success: true,
      orderId: `mock-${Date.now()}`,
      filledPrice: fillPrice,
      filledQuantity: quantity,
      status: "EXECUTED",
    };
  }

  async executeOptionsOrder(order: OptionsOrderRequest): Promise<OrderResult> {
    if (!this.simulatedTime) {
      return {
        success: false,
        status: "REJECTED",
        rejectionReason:
          "Mock broker: simulated time must be set before executing options orders",
      };
    }

    const filledLegs: OptionLeg[] = [];
    let totalPremium = 0;

    for (const leg of order.legs) {
      const quote = await this.getLegQuote(leg.symbol);
      const ask = quote?.ask ?? leg.entryPrice ?? 0;
      if (ask <= 0) {
        return {
          success: false,
          status: "REJECTED",
          rejectionReason: `Mock broker: no ask price for ${leg.symbol}`,
        };
      }

      const fillPrice = ask * (1 + this.slippageBps / 10_000);
      const premium = fillPrice * CONTRACT_MULTIPLIER * leg.quantity;
      totalPremium += premium;
      filledLegs.push({
        ...leg,
        entryPrice: fillPrice,
      });
    }

    if (totalPremium > this.cash) {
      return {
        success: false,
        status: "REJECTED",
        rejectionReason: `Mock broker: insufficient cash for options ($${this.cash.toFixed(2)} < $${totalPremium.toFixed(2)})`,
      };
    }

    this.cash -= totalPremium;
    for (const leg of filledLegs) {
      this.upsertPosition(
        leg.symbol,
        leg.quantity,
        leg.entryPrice ?? 0,
        "option",
      );
    }
    this.recalculateEquity();

    return {
      success: true,
      orderId: `mock-opt-${Date.now()}`,
      filledPrice: totalPremium / CONTRACT_MULTIPLIER,
      filledQuantity: order.quantity,
      status: "EXECUTED",
      totalPremiumPaid: totalPremium,
      legs: filledLegs,
    };
  }

  async closePositionGroup(
    group: OpenPositionGroup,
    exitCondition: ExitCondition,
    exitPrices?: Map<string, number>,
  ): Promise<ClosePositionResult> {
    let netExitValue = 0;

    for (const leg of group.legs) {
      const existing = this.positions.get(leg.symbol);
      if (!existing) {
        continue;
      }

      let bid = exitPrices?.get(leg.symbol);
      if (bid === undefined) {
        const quote = await this.getLegQuote(leg.symbol);
        bid = (quote?.bid ?? leg.entryPrice ?? 0) * (1 - this.slippageBps / 10_000);
      }

      const proceeds = bid * CONTRACT_MULTIPLIER * leg.quantity;
      netExitValue += proceeds;
      this.cash += proceeds;
      this.positions.delete(leg.symbol);
    }

    this.recalculateEquity();
    return { success: true, netExitValue, exitCondition };
  }

  async getOptionQuotes(symbols: string[]): Promise<OptionQuote[]> {
    const quotes: OptionQuote[] = [];
    for (const symbol of symbols) {
      const quote = await this.getLegQuote(symbol);
      quotes.push({
        symbol,
        bid: quote?.bid ?? 0,
        ask: quote?.ask ?? 0,
      });
    }
    return quotes;
  }

  setSimulatedTime(timestamp: string): void {
    this.simulatedTime = new Date(timestamp);
  }

  getOptionsDataService(): AlpacaOptionsDataService | null {
    return this.optionsData;
  }

  private async getLegQuote(
    symbol: string,
  ): Promise<{ bid: number; ask: number } | null> {
    if (!this.simulatedTime || !this.optionsData) {
      return null;
    }

    const quotes = await this.optionsData.getOptionQuotes(
      [symbol],
      this.simulatedTime,
    );
    return quotes.get(symbol) ?? null;
  }

  private upsertPosition(
    ticker: string,
    quantity: number,
    fillPrice: number,
    assetClass: "equity" | "option" = "equity",
  ): void {
    const existing = this.positions.get(ticker);
    if (existing) {
      const totalQty = existing.quantity + quantity;
      const avgEntry =
        (existing.avgEntryPrice * existing.quantity + fillPrice * quantity) /
        totalQty;
      this.positions.set(ticker, {
        ticker,
        quantity: totalQty,
        avgEntryPrice: avgEntry,
        marketValue: totalQty * fillPrice * (assetClass === "option" ? CONTRACT_MULTIPLIER : 1),
        unrealizedPl: 0,
        assetClass,
      });
    } else {
      const multiplier = assetClass === "option" ? CONTRACT_MULTIPLIER : 1;
      this.positions.set(ticker, {
        ticker,
        quantity,
        avgEntryPrice: fillPrice,
        marketValue: quantity * fillPrice * multiplier,
        unrealizedPl: 0,
        assetClass,
      });
    }
  }

  private reducePosition(
    ticker: string,
    quantity: number,
    fillPrice: number,
  ): void {
    const existing = this.positions.get(ticker)!;
    const remaining = existing.quantity - quantity;
    if (remaining <= 0) {
      this.positions.delete(ticker);
    } else {
      this.positions.set(ticker, {
        ...existing,
        quantity: remaining,
        marketValue: remaining * fillPrice,
        unrealizedPl: (fillPrice - existing.avgEntryPrice) * remaining,
      });
    }
  }

  private recalculateEquity(): void {
    const positionValue = [...this.positions.values()].reduce(
      (sum, p) => sum + p.marketValue,
      0,
    );
    this.equity = this.cash + positionValue;
  }
}

export { computePremiumPaid, computeNetBidValue };
