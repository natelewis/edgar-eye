import {
  prisma,
  TradeSide,
  TradeStatus,
  TradingMode,
} from "@edgar-eye/database";
import {
  AlpacaOptionsDataService,
  AlpacaService,
  MockBrokerService,
  RiskManager,
  TriageService,
  type IBrokerService,
  type OpenPositionGroup,
} from "@edgar-eye/broker";
import { LLMService, MockAnalysisService } from "@edgar-eye/llm";
import { LiveIngestionEngine, type LiveFiling } from "@edgar-eye/ingestion";
import {
  getAlpacaCredentials,
  loadEnv,
  parseWatchTickers,
  type Env,
  type ExitCondition,
  type LlmAnalysisResult,
  type StatusEvent,
  type StrategyType,
} from "@edgar-eye/shared";
import { BacktestRunner } from "./backtest-runner.js";
import { BackfillRunner } from "./backfill-runner.js";
import { toTradeStatus } from "./trade-status.js";
import type { WsHub } from "./ws-hub.js";

export class TradingPipeline {
  private readonly env: Env;
  private readonly broker: IBrokerService;
  private readonly riskManager: RiskManager;
  private readonly triageService: TriageService;
  private readonly optionsData: AlpacaOptionsDataService;
  private readonly llm: LLMService;
  private readonly ingestion: LiveIngestionEngine;
  private readonly backtestRunner: BacktestRunner;
  private readonly backfillRunner: BackfillRunner;
  private systemStatus: StatusEvent["systemStatus"] = "idle";
  private orderQueue: Promise<void> = Promise.resolve();

  constructor(private readonly wsHub: WsHub) {
    this.env = loadEnv();
    this.broker = createBroker(this.env);
    this.riskManager = new RiskManager(this.env);
    this.triageService = new TriageService();
    this.optionsData = createOptionsData(this.env);
    this.llm = new LLMService(this.env);
    this.ingestion = new LiveIngestionEngine(this.env);
    this.backtestRunner = new BacktestRunner({
      env: this.env,
      analysis: new MockAnalysisService(),
      broadcaster: this.wsHub,
    });
    this.backfillRunner = new BackfillRunner({
      env: this.env,
      broadcaster: this.wsHub,
    });
  }

  getEnv(): Env {
    return this.env;
  }

  async start(): Promise<void> {
    await this.publishStatus();

    if (this.broker instanceof AlpacaService) {
      this.riskManager.startPositionMonitor({
        broker: this.broker,
      onClose: {
        onPositionClosed: async (
          group: OpenPositionGroup,
          exitCondition: ExitCondition,
          netExitValue: number,
        ) => {
          await this.handlePositionClosed(group, exitCondition, netExitValue);
        },
      },
      });
    }

    const tickers = parseWatchTickers(this.env.SEC_WATCH_TICKERS);
    if (tickers.length === 0) {
      console.warn(
        "[Pipeline] No SEC_WATCH_TICKERS configured — live ingestion idle",
      );
      return;
    }

    void this.ingestion.start(tickers, (filing) => this.handleFiling(filing));
  }

  stop(): void {
    this.ingestion.stop();
    this.riskManager.stopPositionMonitor();
  }

  getBacktestRunner(): BacktestRunner {
    return this.backtestRunner;
  }

  getBackfillRunner(): BackfillRunner {
    return this.backfillRunner;
  }

  private async handleFiling(filing: LiveFiling): Promise<void> {
    this.setStatus("ingesting");

    this.wsHub.broadcast({
      type: "document",
      document: filing.document,
      timestamp: new Date().toISOString(),
    });

    await this.analyzeAndTrade(filing);
    await this.publishStatus();
    this.setStatus("idle");
  }

  private async analyzeAndTrade(filing: LiveFiling): Promise<void> {
    this.setStatus("analyzing");

    let analysis;
    try {
      analysis = await this.llm.analyzeFiling({
        ticker: filing.document.ticker,
        title: filing.document.title,
        cleanedText: filing.cleanedText,
      });
      this.riskManager.recordLlmSuccess();
    } catch (error) {
      this.riskManager.recordLlmFailure();
      console.error("[Pipeline] LLM analysis failed:", error);
      return;
    }

    const report = await prisma.analysisReport.create({
      data: {
        documentLogId: filing.document.id,
        catalystType: analysis.catalystType,
        direction: analysis.direction,
        magnitudeScore: analysis.magnitudeScore,
        reasoning: analysis.reasoning,
        tokenCount: analysis.tokenCount,
        latencyMs: analysis.latencyMs,
      },
    });

    this.wsHub.broadcast({
      type: "analysis",
      documentId: filing.document.id,
      ticker: filing.document.ticker,
      title: filing.document.title,
      catalystType: analysis.catalystType,
      direction: analysis.direction,
      magnitudeScore: analysis.magnitudeScore,
      reasoning: analysis.reasoning,
      latencyMs: analysis.latencyMs,
      timestamp: new Date().toISOString(),
    });

    await this.executeTriage({
      analysisReportId: report.id,
      ticker: filing.document.ticker,
      analysis,
    });
  }

  private executeTriage(input: {
    analysisReportId: string;
    ticker: string;
    analysis: LlmAnalysisResult;
  }): Promise<void> {
    const run = this.orderQueue.then(() => this.runTriage(input));
    this.orderQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async runTriage(input: {
    analysisReportId: string;
    ticker: string;
    analysis: LlmAnalysisResult;
  }): Promise<void> {
    this.setStatus("trading");

    const outcome = await this.triageService.evaluate({
      analysis: input.analysis,
      underlying: input.ticker,
      broker: this.broker,
      riskManager: this.riskManager,
      optionsData: this.optionsData,
    });

    if (outcome.kind === "skip") {
      return;
    }

    if (outcome.kind === "blocked") {
      await this.logTrade({
        analysisReportId: input.analysisReportId,
        ticker: input.ticker,
        side: "BUY",
        quantity: 0,
        status: TradeStatus.BLOCKED,
        blockReason: outcome.reason,
        strategy: outcome.strategy,
        totalPremiumPaid: outcome.estimatedPremium,
      });
      return;
    }

    const { result } = outcome;
    const orderResult = await this.broker.executeOptionsOrder(
      result.orderRequest,
    );

    if (!orderResult.success) {
      await this.logTrade({
        analysisReportId: input.analysisReportId,
        ticker: input.ticker,
        side: "BUY",
        quantity: 0,
        status: toTradeStatus(orderResult.status),
        blockReason: orderResult.rejectionReason,
        strategy: result.positionGroup.strategy,
        legs: orderResult.legs ?? result.positionGroup.legs,
        totalPremiumPaid: result.estimatedPremium,
        positionGroupId: result.positionGroup.positionGroupId,
      });
      return;
    }

    const filledGroup: OpenPositionGroup = {
      ...result.positionGroup,
      legs: orderResult.legs ?? result.positionGroup.legs,
      totalPremiumPaid:
        orderResult.totalPremiumPaid ?? result.estimatedPremium,
    };

    const tradeLog = await this.logTrade({
      analysisReportId: input.analysisReportId,
      ticker: input.ticker,
      side: "BUY",
      quantity: orderResult.filledQuantity ?? 1,
      price: orderResult.filledPrice,
      status: toTradeStatus(orderResult.status),
      strategy: filledGroup.strategy,
      legs: filledGroup.legs,
      totalPremiumPaid: filledGroup.totalPremiumPaid,
      positionGroupId: filledGroup.positionGroupId,
      alpacaOrderId: orderResult.orderId,
    });

    filledGroup.tradeLogId = tradeLog.id;
    this.riskManager.registerOpenPosition(filledGroup);
  }

  private async handlePositionClosed(
    group: OpenPositionGroup,
    exitCondition: ExitCondition,
    netExitValue: number,
  ): Promise<void> {
    if (group.tradeLogId) {
      await prisma.tradeLog.update({
        where: { id: group.tradeLogId },
        data: {
          exitAt: new Date(),
          exitCondition,
          netExitValue,
        },
      });
    }

    this.wsHub.broadcast({
      type: "position_closed",
      positionGroupId: group.positionGroupId,
      underlying: group.underlying,
      strategy: group.strategy,
      exitCondition,
      netExitValue,
      totalPremiumPaid: group.totalPremiumPaid,
      timestamp: new Date().toISOString(),
    });

    await this.publishPositions();
  }

  private async logTrade(input: {
    analysisReportId: string;
    ticker: string;
    side: "BUY" | "SELL";
    quantity: number;
    price?: number;
    status: TradeStatus;
    blockReason?: string;
    alpacaOrderId?: string;
    strategy?: StrategyType;
    legs?: OpenPositionGroup["legs"];
    totalPremiumPaid?: number;
    positionGroupId?: string;
  }) {
    const record = await prisma.tradeLog.create({
      data: {
        analysisReportId: input.analysisReportId,
        ticker: input.ticker,
        side: input.side as TradeSide,
        quantity: input.quantity,
        price: input.price,
        mode: this.env.TRADING_MODE as TradingMode,
        status: input.status,
        blockReason: input.blockReason,
        alpacaOrderId: input.alpacaOrderId,
        strategy: input.strategy,
        legs: input.legs as object,
        totalPremiumPaid: input.totalPremiumPaid,
        positionGroupId: input.positionGroupId,
      },
    });

    this.wsHub.broadcast({
      type: "trade",
      ticker: input.ticker,
      side: input.side,
      quantity: input.quantity,
      price: input.price,
      status: input.status,
      blockReason: input.blockReason,
      mode: this.env.TRADING_MODE,
      strategy: input.strategy,
      legs: input.legs,
      totalPremiumPaid: input.totalPremiumPaid,
      positionGroupId: input.positionGroupId,
      timestamp: new Date().toISOString(),
    });

    await this.publishPositions();
    return record;
  }

  async publishStatus(lastLlmLatencyMs?: number): Promise<void> {
    try {
      const snapshot = await this.broker.getAccountSnapshot();
      this.riskManager.recordEquity(snapshot.equity);

      this.wsHub.broadcast({
        type: "status",
        systemStatus: this.systemStatus,
        tradingMode: this.env.TRADING_MODE,
        accountEquity: snapshot.equity,
        buyingPower: snapshot.buyingPower,
        lastLlmLatencyMs,
        consecutiveLlmFailures:
          this.riskManager.getConsecutiveLlmFailures(),
        timestamp: new Date().toISOString(),
      });

      await this.publishPositions();
    } catch (error) {
      console.error("[Pipeline] Status publish failed:", error);
      this.wsHub.broadcast({
        type: "status",
        systemStatus: "error",
        tradingMode: this.env.TRADING_MODE,
        accountEquity: 0,
        buyingPower: 0,
        consecutiveLlmFailures:
          this.riskManager.getConsecutiveLlmFailures(),
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async publishPositions(): Promise<void> {
    try {
      const positions = await this.broker.getPositions();
      this.wsHub.broadcast({
        type: "positions",
        positions: positions.map((p) => ({
          ticker: p.ticker,
          quantity: p.quantity,
          marketValue: p.marketValue,
          avgEntryPrice: p.avgEntryPrice,
          unrealizedPl: p.unrealizedPl,
          assetClass: p.assetClass,
        })),
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Positions unavailable — non-fatal.
    }
  }

  private setStatus(status: StatusEvent["systemStatus"]): void {
    this.systemStatus = status;
  }
}

function createBroker(env: Env): IBrokerService {
  const credentials = getAlpacaCredentials(env);
  if (credentials.apiKey && credentials.secretKey) {
    return AlpacaService.fromEnv(env, credentials);
  }

  if (env.TRADING_MODE === "LIVE") {
    throw new Error(
      "TRADING_MODE=LIVE requires ALPACA_LIVE_API_KEY and ALPACA_LIVE_SECRET_KEY to be set",
    );
  }

  console.warn(
    "[Pipeline] Alpaca credentials missing — using MockBrokerService",
  );
  return new MockBrokerService({
    initialEquity: 100_000,
    slippageBps: env.SLIPPAGE_BPS,
    dataCredentials: credentials.apiKey ? credentials : undefined,
    cacheDir: env.HISTORICAL_DATA_CACHE_DIR,
  });
}

function createOptionsData(env: Env): AlpacaOptionsDataService {
  const credentials = getAlpacaCredentials(env);
  return new AlpacaOptionsDataService({
    apiKey: credentials.apiKey ?? "",
    secretKey: credentials.secretKey ?? "",
    tradingBaseUrl: credentials.baseUrl,
    cacheDir: env.HISTORICAL_DATA_CACHE_DIR,
  });
}
