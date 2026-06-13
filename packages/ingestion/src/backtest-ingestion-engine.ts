import { prisma, type DocumentLog } from "@edgar-eye/database";

export interface BacktestDocument {
  document: DocumentLog;
}

export class BacktestIngestionEngine {
  async *streamDocuments(options?: {
    ticker?: string;
    limit?: number;
  }): AsyncGenerator<BacktestDocument> {
    const documents = await prisma.documentLog.findMany({
      where: options?.ticker ? { ticker: options.ticker } : undefined,
      orderBy: [{ filedAt: "asc" }, { createdAt: "asc" }],
      take: options?.limit,
    });

    for (const document of documents) {
      yield { document };
    }
  }

  async countDocuments(ticker?: string): Promise<number> {
    return prisma.documentLog.count({
      where: ticker ? { ticker } : undefined,
    });
  }
}
