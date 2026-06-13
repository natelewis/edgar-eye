-- CreateEnum
CREATE TYPE "CatalystType" AS ENUM ('DIRECTIONAL', 'VOLATILITY', 'NONE');

-- CreateEnum
CREATE TYPE "TradeDirection" AS ENUM ('BULLISH', 'BEARISH', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "StrategyType" AS ENUM ('ATM_CALL', 'ATM_PUT', 'STRADDLE', 'STRANGLE');

-- CreateEnum
CREATE TYPE "ExitCondition" AS ENUM ('TAKE_PROFIT', 'STOP_LOSS', 'TIME_STOP');

-- AlterTable AnalysisReport
ALTER TABLE "AnalysisReport" DROP COLUMN "decision";
ALTER TABLE "AnalysisReport" DROP COLUMN "confidence";
ALTER TABLE "AnalysisReport" ADD COLUMN "catalystType" "CatalystType" NOT NULL DEFAULT 'NONE';
ALTER TABLE "AnalysisReport" ADD COLUMN "direction" "TradeDirection" NOT NULL DEFAULT 'NEUTRAL';
ALTER TABLE "AnalysisReport" ADD COLUMN "magnitudeScore" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "AnalysisReport" ALTER COLUMN "catalystType" DROP DEFAULT;
ALTER TABLE "AnalysisReport" ALTER COLUMN "direction" DROP DEFAULT;
ALTER TABLE "AnalysisReport" ALTER COLUMN "magnitudeScore" DROP DEFAULT;

-- DropIndex
DROP INDEX IF EXISTS "AnalysisReport_decision_idx";

-- CreateIndex
CREATE INDEX "AnalysisReport_catalystType_idx" ON "AnalysisReport"("catalystType");

-- AlterTable TradeLog
ALTER TABLE "TradeLog" ADD COLUMN "strategy" "StrategyType";
ALTER TABLE "TradeLog" ADD COLUMN "legs" JSONB;
ALTER TABLE "TradeLog" ADD COLUMN "totalPremiumPaid" DOUBLE PRECISION;
ALTER TABLE "TradeLog" ADD COLUMN "positionGroupId" TEXT;
ALTER TABLE "TradeLog" ADD COLUMN "exitAt" TIMESTAMP(3);
ALTER TABLE "TradeLog" ADD COLUMN "exitCondition" "ExitCondition";
ALTER TABLE "TradeLog" ADD COLUMN "netExitValue" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "TradeLog_positionGroupId_idx" ON "TradeLog"("positionGroupId");

-- AlterTable BacktestTrade
ALTER TABLE "BacktestTrade" DROP COLUMN "decision";
ALTER TABLE "BacktestTrade" DROP COLUMN "confidence";
ALTER TABLE "BacktestTrade" ADD COLUMN "catalystType" "CatalystType" NOT NULL DEFAULT 'NONE';
ALTER TABLE "BacktestTrade" ADD COLUMN "direction" "TradeDirection" NOT NULL DEFAULT 'NEUTRAL';
ALTER TABLE "BacktestTrade" ADD COLUMN "magnitudeScore" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "BacktestTrade" ADD COLUMN "strategy" "StrategyType" NOT NULL DEFAULT 'ATM_CALL';
ALTER TABLE "BacktestTrade" ADD COLUMN "legs" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "BacktestTrade" ADD COLUMN "totalPremiumPaid" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "BacktestTrade" ADD COLUMN "exitAt" TIMESTAMP(3);
ALTER TABLE "BacktestTrade" ADD COLUMN "exitCondition" "ExitCondition";
ALTER TABLE "BacktestTrade" ADD COLUMN "netExitValue" DOUBLE PRECISION;
ALTER TABLE "BacktestTrade" ADD COLUMN "pnl" DOUBLE PRECISION;
ALTER TABLE "BacktestTrade" ALTER COLUMN "catalystType" DROP DEFAULT;
ALTER TABLE "BacktestTrade" ALTER COLUMN "direction" DROP DEFAULT;
ALTER TABLE "BacktestTrade" ALTER COLUMN "magnitudeScore" DROP DEFAULT;
ALTER TABLE "BacktestTrade" ALTER COLUMN "strategy" DROP DEFAULT;
ALTER TABLE "BacktestTrade" ALTER COLUMN "legs" DROP DEFAULT;
ALTER TABLE "BacktestTrade" ALTER COLUMN "totalPremiumPaid" DROP DEFAULT;

-- DropEnum
DROP TYPE IF EXISTS "TradeAction";
