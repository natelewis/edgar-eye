-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "TradeAction" AS ENUM ('BUY', 'SELL', 'HOLD');

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "TradingMode" AS ENUM ('PAPER', 'LIVE');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('EXECUTED', 'BLOCKED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "DocumentLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "cleanedText" TEXT NOT NULL,
    "accessionNumber" TEXT,
    "filedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentEmbedding" (
    "id" TEXT NOT NULL,
    "documentLogId" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisReport" (
    "id" TEXT NOT NULL,
    "documentLogId" TEXT NOT NULL,
    "decision" "TradeAction" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT NOT NULL,
    "tokenCount" INTEGER,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeLog" (
    "id" TEXT NOT NULL,
    "analysisReportId" TEXT,
    "ticker" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION,
    "mode" "TradingMode" NOT NULL,
    "status" "TradeStatus" NOT NULL,
    "blockReason" TEXT,
    "alpacaOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestRun" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "parameters" JSONB,
    "initialEquity" DOUBLE PRECISION NOT NULL,
    "finalEquity" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacktestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestTrade" (
    "id" TEXT NOT NULL,
    "backtestRunId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "simulatedAt" TIMESTAMP(3) NOT NULL,
    "decision" "TradeAction" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacktestTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentLog_ticker_idx" ON "DocumentLog"("ticker");

-- CreateIndex
CREATE INDEX "DocumentLog_accessionNumber_idx" ON "DocumentLog"("accessionNumber");

-- CreateIndex
CREATE INDEX "DocumentLog_filedAt_idx" ON "DocumentLog"("filedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentEmbedding_documentLogId_key" ON "DocumentEmbedding"("documentLogId");

-- CreateIndex
CREATE INDEX "AnalysisReport_documentLogId_idx" ON "AnalysisReport"("documentLogId");

-- CreateIndex
CREATE INDEX "AnalysisReport_decision_idx" ON "AnalysisReport"("decision");

-- CreateIndex
CREATE INDEX "TradeLog_ticker_idx" ON "TradeLog"("ticker");

-- CreateIndex
CREATE INDEX "TradeLog_mode_idx" ON "TradeLog"("mode");

-- CreateIndex
CREATE INDEX "TradeLog_status_idx" ON "TradeLog"("status");

-- CreateIndex
CREATE INDEX "BacktestTrade_backtestRunId_idx" ON "BacktestTrade"("backtestRunId");

-- CreateIndex
CREATE INDEX "BacktestTrade_simulatedAt_idx" ON "BacktestTrade"("simulatedAt");

-- AddForeignKey
ALTER TABLE "DocumentEmbedding" ADD CONSTRAINT "DocumentEmbedding_documentLogId_fkey" FOREIGN KEY ("documentLogId") REFERENCES "DocumentLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisReport" ADD CONSTRAINT "AnalysisReport_documentLogId_fkey" FOREIGN KEY ("documentLogId") REFERENCES "DocumentLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeLog" ADD CONSTRAINT "TradeLog_analysisReportId_fkey" FOREIGN KEY ("analysisReportId") REFERENCES "AnalysisReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacktestTrade" ADD CONSTRAINT "BacktestTrade_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "BacktestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
