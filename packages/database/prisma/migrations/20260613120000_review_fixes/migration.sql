-- AlterEnum
ALTER TYPE "TradeStatus" ADD VALUE 'PENDING';

-- DropIndex
DROP INDEX "DocumentLog_accessionNumber_idx";

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLog_accessionNumber_key" ON "DocumentLog"("accessionNumber");

-- CreateIndex
CREATE INDEX "DocumentLog_createdAt_idx" ON "DocumentLog"("createdAt");

-- CreateIndex
CREATE INDEX "DocumentLog_ticker_filedAt_createdAt_idx" ON "DocumentLog"("ticker", "filedAt", "createdAt");

-- CreateIndex
CREATE INDEX "AnalysisReport_createdAt_idx" ON "AnalysisReport"("createdAt");

-- CreateIndex
CREATE INDEX "TradeLog_createdAt_idx" ON "TradeLog"("createdAt");

-- CreateIndex
CREATE INDEX "BacktestTrade_backtestRunId_simulatedAt_idx" ON "BacktestTrade"("backtestRunId", "simulatedAt");
