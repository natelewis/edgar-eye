import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient };
export {
  CatalystType,
  TradeDirection,
  StrategyType,
  ExitCondition,
  TradeSide,
  TradingMode,
  TradeStatus,
} from "@prisma/client";
export type {
  DocumentLog,
  DocumentEmbedding,
  AnalysisReport,
  TradeLog,
  BacktestRun,
  BacktestTrade,
} from "@prisma/client";
