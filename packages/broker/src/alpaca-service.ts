import type { ExitCondition } from "@edgar-eye/shared";
import { AlpacaOptionsDataService } from "./alpaca-options-data.js";
import {
  getSharedHistoricalDataCache,
  type HistoricalDataCache,
} from "./historical-data-cache.js";
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
  OrderStatus,
  Position,
} from "./types.js";
import { computePremiumPaid } from "./options-chain.service.js";

const DEFAULT_DATA_BASE_URL = "https://data.alpaca.markets";
const CONTRACT_MULTIPLIER = 100;

const FILLED_STATUSES = new Set(["filled", "partially_filled"]);
const PENDING_STATUSES = new Set([
  "new",
  "accepted",
  "pending_new",
  "accepted_for_bidding",
  "pending_replace",
  "replaced",
  "calculated",
]);
const TERMINAL_FAILED_STATUSES = new Set([
  "canceled",
  "expired",
  "done_for_day",
  "stopped",
  "suspended",
]);

interface AlpacaAccountResponse {
  equity: string;
  buying_power: string;
  cash: string;
  portfolio_value: string;
}

interface AlpacaPositionResponse {
  symbol: string;
  qty: string;
  market_value: string;
  avg_entry_price: string;
  unrealized_pl: string;
  asset_class?: string;
}

interface AlpacaOrderResponse {
  id: string;
  status: string;
  filled_avg_price: string | null;
  filled_qty: string | null;
}

interface AlpacaOptionLeg {
  symbol: string;
  side: string;
  ratio_qty: string;
  position_intent: string;
}

export class AlpacaService implements IBrokerService {
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly dataBaseUrl: string;
  private readonly optionsData: AlpacaOptionsDataService;

  constructor(credentials: {
    apiKey: string;
    secretKey: string;
    baseUrl: string;
    dataBaseUrl?: string;
    historicalCache?: HistoricalDataCache;
    cacheDir?: string;
  }) {
    this.apiKey = credentials.apiKey;
    this.secretKey = credentials.secretKey;
    this.baseUrl = credentials.baseUrl.replace(/\/$/, "");
    this.dataBaseUrl = (
      credentials.dataBaseUrl ?? DEFAULT_DATA_BASE_URL
    ).replace(/\/$/, "");
    const historicalCache =
      credentials.historicalCache ??
      getSharedHistoricalDataCache(credentials.cacheDir);
    this.optionsData = new AlpacaOptionsDataService({
      apiKey: this.apiKey,
      secretKey: this.secretKey,
      dataBaseUrl: this.dataBaseUrl,
      tradingBaseUrl: this.baseUrl,
      historicalCache,
    });
  }

  static fromEnv(
    env: { TRADING_MODE: string; HISTORICAL_DATA_CACHE_DIR?: string },
    credentials: {
      apiKey: string;
      secretKey: string;
      baseUrl: string;
      dataBaseUrl?: string;
    },
  ): AlpacaService {
    if (!credentials.apiKey || !credentials.secretKey) {
      throw new Error(
        `Alpaca API credentials missing for ${env.TRADING_MODE} mode`,
      );
    }
    return new AlpacaService({
      ...credentials,
      cacheDir: env.HISTORICAL_DATA_CACHE_DIR,
    });
  }

  async getBuyingPower(): Promise<number> {
    const account = await this.fetchAccount();
    return parseFloat(account.buying_power);
  }

  async getAccountSnapshot(): Promise<AccountSnapshot> {
    const account = await this.fetchAccount();
    return {
      equity: parseFloat(account.equity),
      buyingPower: parseFloat(account.buying_power),
      cash: parseFloat(account.cash),
      portfolioValue: parseFloat(account.portfolio_value),
    };
  }

  async getPositions(): Promise<Position[]> {
    const response = await this.request("/v2/positions");
    if (!response.ok) {
      throw new Error(`Alpaca positions error: ${response.status}`);
    }

    const positions = (await response.json()) as AlpacaPositionResponse[];
    return positions.map((p) => ({
      ticker: p.symbol,
      quantity: parseFloat(p.qty),
      marketValue: parseFloat(p.market_value),
      avgEntryPrice: parseFloat(p.avg_entry_price),
      unrealizedPl: parseFloat(p.unrealized_pl),
      assetClass: p.asset_class === "us_option" ? "option" : "equity",
    }));
  }

  async executeOrder(order: OrderRequest): Promise<OrderResult> {
    try {
      const buyingPower = await this.getBuyingPower();
      const estimatedNotional =
        order.notional ??
        order.quantity * (await this.estimatePrice(order.ticker));

      if (estimatedNotional > buyingPower) {
        return {
          success: false,
          status: "REJECTED",
          rejectionReason: `Insufficient buying power: need $${estimatedNotional.toFixed(2)}, have $${buyingPower.toFixed(2)}`,
        };
      }

      const body: Record<string, string> = {
        symbol: order.ticker,
        side: order.side.toLowerCase(),
        type: "market",
        time_in_force: "day",
      };

      if (order.notional) {
        body.notional = order.notional.toFixed(2);
      } else {
        body.qty = order.quantity.toString();
      }

      const response = await this.request("/v2/orders", {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          status: "REJECTED",
          rejectionReason: this.parseAlpacaError(errorBody, response.status),
        };
      }

      const submitted = (await response.json()) as AlpacaOrderResponse;
      const settled = await this.waitForFill(submitted);
      return this.toOrderResult(settled);
    } catch (error) {
      return {
        success: false,
        status: "FAILED",
        rejectionReason:
          error instanceof Error ? error.message : "Unknown Alpaca error",
      };
    }
  }

  async executeOptionsOrder(order: OptionsOrderRequest): Promise<OrderResult> {
    try {
      const buyingPower = await this.getBuyingPower();
      const estimatedPremium = computePremiumPaid(order.legs);

      if (estimatedPremium > buyingPower) {
        return {
          success: false,
          status: "REJECTED",
          rejectionReason: `Insufficient buying power for options: need $${estimatedPremium.toFixed(2)}, have $${buyingPower.toFixed(2)}`,
        };
      }

      const isMultiLeg = order.legs.length > 1;
      const body: Record<string, unknown> = {
        type: "market",
        time_in_force: "day",
        qty: order.quantity.toString(),
      };

      if (isMultiLeg) {
        body.order_class = "mleg";
        body.legs = order.legs.map(
          (leg): AlpacaOptionLeg => ({
            symbol: leg.symbol,
            side: leg.side.toLowerCase(),
            ratio_qty: leg.quantity.toString(),
            position_intent: "buy_to_open",
          }),
        );
      } else {
        const leg = order.legs[0];
        if (!leg) {
          return {
            success: false,
            status: "REJECTED",
            rejectionReason: "Options order requires at least one leg",
          };
        }
        body.symbol = leg.symbol;
        body.side = leg.side.toLowerCase();
        body.position_intent = "buy_to_open";
      }

      const response = await this.request("/v2/orders", {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          status: "REJECTED",
          rejectionReason: this.parseAlpacaError(errorBody, response.status),
        };
      }

      const submitted = (await response.json()) as AlpacaOrderResponse;
      const settled = await this.waitForFill(submitted);
      const result = this.toOrderResult(settled);
      const filledLegs = await this.resolveFilledLegs(order.legs);

      return {
        ...result,
        totalPremiumPaid: computePremiumPaid(filledLegs),
        legs: filledLegs,
      };
    } catch (error) {
      return {
        success: false,
        status: "FAILED",
        rejectionReason:
          error instanceof Error ? error.message : "Unknown Alpaca options error",
      };
    }
  }

  async closePositionGroup(
    group: OpenPositionGroup,
    exitCondition: ExitCondition,
    _exitPrices?: Map<string, number>,
  ): Promise<ClosePositionResult> {
    let netExitValue = 0;
    const quotes = await this.getOptionQuotes(
      group.legs.map((leg) => leg.symbol),
    );
    const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));

    for (const leg of group.legs) {
      const response = await this.request("/v2/orders", {
        method: "POST",
        body: JSON.stringify({
          symbol: leg.symbol,
          side: "sell",
          type: "market",
          time_in_force: "day",
          qty: leg.quantity.toString(),
          position_intent: "sell_to_close",
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          netExitValue,
          exitCondition,
          rejectionReason: this.parseAlpacaError(errorBody, response.status),
        };
      }

      const submitted = (await response.json()) as AlpacaOrderResponse;
      await this.waitForFill(submitted);
      const quote = quoteMap.get(leg.symbol);
      netExitValue +=
        (quote?.bid ?? leg.entryPrice ?? 0) *
        CONTRACT_MULTIPLIER *
        leg.quantity;
    }

    return { success: true, netExitValue, exitCondition };
  }

  async getOptionQuotes(symbols: string[]): Promise<OptionQuote[]> {
    const quotes = await this.optionsData.getOptionQuotes(symbols);
    return symbols.map((symbol) => {
      const quote = quotes.get(symbol);
      return {
        symbol,
        bid: quote?.bid ?? 0,
        ask: quote?.ask ?? 0,
      };
    });
  }

  getOptionsDataService(): AlpacaOptionsDataService {
    return this.optionsData;
  }

  private async resolveFilledLegs(legs: OptionLeg[]): Promise<OptionLeg[]> {
    const quotes = await this.getOptionQuotes(legs.map((l) => l.symbol));
    const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));

    return legs.map((leg) => ({
      ...leg,
      entryPrice: quoteMap.get(leg.symbol)?.ask ?? leg.entryPrice ?? 0,
    }));
  }

  private async waitForFill(
    order: AlpacaOrderResponse,
    attempts = 5,
    delayMs = 400,
  ): Promise<AlpacaOrderResponse> {
    let current = order;

    for (let i = 0; i < attempts; i++) {
      if (
        FILLED_STATUSES.has(current.status) ||
        current.status === "rejected" ||
        TERMINAL_FAILED_STATUSES.has(current.status)
      ) {
        return current;
      }

      await sleep(delayMs);

      const response = await this.request(`/v2/orders/${current.id}`);
      if (!response.ok) {
        return current;
      }
      current = (await response.json()) as AlpacaOrderResponse;
    }

    return current;
  }

  private toOrderResult(order: AlpacaOrderResponse): OrderResult {
    const filledQty = order.filled_qty ? parseFloat(order.filled_qty) : 0;
    const filledPrice = order.filled_avg_price
      ? parseFloat(order.filled_avg_price)
      : undefined;
    const status = mapOrderStatus(order.status, filledQty);

    return {
      success: status === "EXECUTED" || status === "PENDING",
      orderId: order.id,
      filledPrice,
      filledQuantity: filledQty,
      status,
      rejectionReason:
        status === "REJECTED" || status === "FAILED"
          ? `Alpaca order ${order.id} ended in state "${order.status}"`
          : undefined,
    };
  }

  private async fetchAccount(): Promise<AlpacaAccountResponse> {
    const response = await this.request("/v2/account");
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Alpaca account error (${response.status}): ${body}`);
    }
    return response.json() as Promise<AlpacaAccountResponse>;
  }

  private async estimatePrice(ticker: string): Promise<number> {
    const price = await this.optionsData.getUnderlyingPrice(ticker);
    if (price === null || price <= 0) {
      throw new Error(`Alpaca returned no valid price for ${ticker}`);
    }
    return price;
  }

  private parseAlpacaError(body: string, status: number): string {
    try {
      const parsed = JSON.parse(body) as { message?: string };
      return parsed.message ?? `Alpaca rejected order (${status})`;
    } catch {
      return `Alpaca rejected order (${status}): ${body.slice(0, 200)}`;
    }
  }

  private request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "APCA-API-KEY-ID": this.apiKey,
        "APCA-API-SECRET-KEY": this.secretKey,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  }
}

export function mapOrderStatus(
  alpacaStatus: string,
  filledQty: number,
): OrderStatus {
  if (FILLED_STATUSES.has(alpacaStatus)) {
    return filledQty > 0 ? "EXECUTED" : "PENDING";
  }
  if (alpacaStatus === "rejected") {
    return "REJECTED";
  }
  if (TERMINAL_FAILED_STATUSES.has(alpacaStatus)) {
    return "FAILED";
  }
  if (PENDING_STATUSES.has(alpacaStatus)) {
    return "PENDING";
  }
  return "PENDING";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
