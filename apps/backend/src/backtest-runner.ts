import {
  prisma,
  TradeSide,
} from "@edgar-eye/database";
import {
  AlpacaOptionsDataService,
  ExitSimulator,
  MockBrokerService,
  RiskManager,
  TriageService,
  normalizeToNextMarketSession,
} from "@edgar-eye/broker";
import {
  BacktestIngestionEngine,
  type BacktestDocument,
} from "@edgar-eye/ingestion";
import type { IAnalysisService } from "@edgar-eye/llm";
import { getAlpacaCredentials, type Env } from "@edgar-eye/shared";
import type { EventBroadcaster } from "./event-broadcaster.js";

export interface BacktestRunOptions {
  name: string;
  initialEquity: number;
  ticker?: string;
  limit?: number;
}

export interface BacktestIngestion {
  countDocuments(ticker?: string): Promise<number>;
  streamDocuments(options?: {
    ticker?: string;
    limit?: number;
  }): AsyncGenerator<BacktestDocument>;
}

export interface BacktestRunnerDeps {
  env: Env;
  analysis: IAnalysisService;
  broadcaster: EventBroadcaster;
  ingestion?: BacktestIngestion;
}

export class BacktestRunner {
  private running = false;
  private readonly env: Env;
  private readonly analysis: IAnalysisService;
  private readonly broadcaster: EventBroadcaster;
  private readonly ingestion: BacktestIngestion;
  private readonly triageService = new TriageService();
  private readonly riskManager: RiskManager;

  constructor(deps: BacktestRunnerDeps) {
    this.env = deps.env;
    this.analysis = deps.analysis;
    this.broadcaster = deps.broadcaster;
    this.ingestion = deps.ingestion ?? new BacktestIngestionEngine();
    this.riskManager = new RiskManager(this.env);
  }

  isRunning(): boolean {
    return this.running;
  }

  async countDocuments(ticker?: string): Promise<number> {
    return this.ingestion.countDocuments(ticker);
  }

  async run(
    options: BacktestRunOptions,
  ): Promise<{ runId: string; completion: Promise<void> }> {
    if (this.running) {
      throw new Error("A backtest is already running");
    }

    this.running = true;

    let run;
    try {
      run = await prisma.backtestRun.create({
        data: {
          name: options.name,
          initialEquity: options.initialEquity,
          parameters: {
            ticker: options.ticker ?? null,
            limit: options.limit ?? null,
            status: "running",
          },
        },
      });
    } catch (error) {
      this.running = false;
      throw error;
    }

    const runId = run.id;
    const completion = this.execute(runId, options)
      .catch((error) => {
        console.error("[Backtest] Run failed:", error);
        this.broadcaster.broadcast({
          type: "backtest_failed",
          runId,
          reason:
            error instanceof Error ? error.message : "Unknown backtest error",
          timestamp: new Date().toISOString(),
        });
      })
      .finally(() => {
        this.running = false;
      });

    return { runId, completion };
  }

  private async execute(
    runId: string,
    options: BacktestRunOptions,
  ): Promise<void> {
    const credentials = getAlpacaCredentials(this.env);
    const broker = new MockBrokerService({
      initialEquity: options.initialEquity,
      slippageBps: this.env.SLIPPAGE_BPS,
      dataCredentials: credentials.apiKey
        ? {
            apiKey: credentials.apiKey,
            secretKey: credentials.secretKey,
            baseUrl: "https://data.alpaca.markets",
          }
        : undefined,
      tradingBaseUrl: credentials.baseUrl,
      cacheDir: this.env.HISTORICAL_DATA_CACHE_DIR,
    });

    const optionsData =
      broker.getOptionsDataService() ??
      new AlpacaOptionsDataService({
        apiKey: credentials.apiKey ?? "",
        secretKey: credentials.secretKey ?? "",
        tradingBaseUrl: credentials.baseUrl,
        cacheDir: this.env.HISTORICAL_DATA_CACHE_DIR,
      });

    const exitSimulator = new ExitSimulator(optionsData);

    const total = await this.ingestion.countDocuments(options.ticker);
    const effectiveTotal = options.limit
      ? Math.min(total, options.limit)
      : total;

    if (effectiveTotal === 0) {
      const reason = options.ticker
        ? `No historical documents found for ${options.ticker}`
        : "No historical documents have been ingested yet";

      await prisma.backtestRun.update({
        where: { id: runId },
        data: {
          completedAt: new Date(),
          finalEquity: options.initialEquity,
          parameters: {
            ticker: options.ticker ?? null,
            limit: options.limit ?? null,
            status: "failed",
            reason,
          },
        },
      });

      this.broadcaster.broadcast({
        type: "backtest_failed",
        runId,
        reason,
        timestamp: new Date().toISOString(),
      });

      return;
    }

    let processed = 0;
    let llmFailures = 0;

    this.broadcaster.broadcast({
      type: "backtest_progress",
      runId,
      processed: 0,
      total: effectiveTotal,
      equity: options.initialEquity,
      llmFailures: 0,
      timestamp: new Date().toISOString(),
    });

    for await (const { document } of this.ingestion.streamDocuments({
      ticker: options.ticker,
      limit: options.limit,
    })) {
      processed += 1;

      let analysis;
      try {
        analysis = await this.analysis.analyzeFiling({
          ticker: document.ticker,
          title: document.title,
          cleanedText: document.cleanedText,
        });
      } catch (error) {
        llmFailures += 1;
        console.error(
          "[Backtest] Analysis failed for document",
          document.id,
          error,
        );
        const failSnapshot = await broker.getAccountSnapshot();
        this.broadcaster.broadcast({
          type: "backtest_progress",
          runId,
          processed,
          total: effectiveTotal,
          equity: failSnapshot.equity,
          llmFailures,
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      const snapshot = await broker.getAccountSnapshot();
      this.broadcaster.broadcast({
        type: "backtest_progress",
        runId,
        processed,
        total: effectiveTotal,
        equity: snapshot.equity,
        llmFailures,
        timestamp: new Date().toISOString(),
      });

      const rawSimulatedAt = document.filedAt ?? document.createdAt;
      const simulatedAt = normalizeToNextMarketSession(rawSimulatedAt);
      broker.setSimulatedTime(simulatedAt.toISOString());

      const outcome = await this.triageService.evaluate({
        analysis,
        underlying: document.ticker,
        broker,
        riskManager: this.riskManager,
        optionsData,
        asOf: simulatedAt,
      });

      if (outcome.kind !== "trade") {
        continue;
      }

      const { result } = outcome;
      const orderResult = await broker.executeOptionsOrder(result.orderRequest);

      if (!orderResult.success || !orderResult.legs) {
        continue;
      }

      const totalPremiumPaid =
        orderResult.totalPremiumPaid ?? result.estimatedPremium;
      const filledGroup = {
        ...result.positionGroup,
        legs: orderResult.legs,
        totalPremiumPaid,
      };

      const exitResult = await exitSimulator.simulate(
        filledGroup.legs,
        simulatedAt,
        totalPremiumPaid,
      );

      broker.setSimulatedTime(exitResult.exitAt.toISOString());
      await broker.closePositionGroup(
        filledGroup,
        exitResult.exitCondition,
        exitResult.exitPrices,
      );

      const postTradeSnapshot = await broker.getAccountSnapshot();
      this.broadcaster.broadcast({
        type: "backtest_progress",
        runId,
        processed,
        total: effectiveTotal,
        equity: postTradeSnapshot.equity,
        llmFailures,
        timestamp: new Date().toISOString(),
      });

      await prisma.backtestTrade.create({
        data: {
          backtestRunId: runId,
          ticker: document.ticker,
          side: TradeSide.BUY,
          quantity: orderResult.filledQuantity ?? 1,
          price: orderResult.filledPrice ?? 0,
          simulatedAt,
          catalystType: analysis.catalystType,
          direction: analysis.direction,
          magnitudeScore: analysis.magnitudeScore,
          reasoning: analysis.reasoning,
          strategy: filledGroup.strategy,
          legs: filledGroup.legs as object,
          totalPremiumPaid,
          exitAt: exitResult.exitAt,
          exitCondition: exitResult.exitCondition,
          netExitValue: exitResult.netExitValue,
          pnl: exitResult.pnl,
        },
      });
    }

    const finalSnapshot = await broker.getAccountSnapshot();
    const tradeCount = await prisma.backtestTrade.count({
      where: { backtestRunId: runId },
    });

    await prisma.backtestRun.update({
      where: { id: runId },
      data: {
        completedAt: new Date(),
        finalEquity: finalSnapshot.equity,
        parameters: {
          ticker: options.ticker ?? null,
          limit: options.limit ?? null,
          status: "completed",
          documentsProcessed: processed,
          llmFailures,
          tradeCount,
        },
      },
    });

    this.broadcaster.broadcast({
      type: "backtest_complete",
      runId,
      name: options.name,
      initialEquity: options.initialEquity,
      finalEquity: finalSnapshot.equity,
      tradeCount,
      documentsProcessed: processed,
      llmFailures,
      timestamp: new Date().toISOString(),
    });
  }

  async listRuns() {
    return prisma.backtestRun.findMany({
      orderBy: { startedAt: "desc" },
      include: {
        trades: {
          orderBy: { simulatedAt: "asc" },
        },
      },
    });
  }

  async getRun(id: string) {
    return prisma.backtestRun.findUnique({
      where: { id },
      include: {
        trades: {
          orderBy: { simulatedAt: "asc" },
        },
      },
    });
  }
}
