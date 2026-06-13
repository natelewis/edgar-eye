import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const count = vi.fn();

vi.mock("@edgar-eye/database", () => ({
  prisma: {
    documentLog: {
      findMany: (...args: unknown[]) => findMany(...args),
      count: (...args: unknown[]) => count(...args),
    },
  },
}));

const { BacktestIngestionEngine } = await import(
  "./backtest-ingestion-engine.js"
);

beforeEach(() => {
  findMany.mockReset();
  count.mockReset();
});

describe("BacktestIngestionEngine", () => {
  it("streams documents ordered by filing date with an optional ticker filter", async () => {
    findMany.mockResolvedValue([
      { id: "a", ticker: "AAPL" },
      { id: "b", ticker: "AAPL" },
    ]);

    const engine = new BacktestIngestionEngine();
    const yielded: string[] = [];
    for await (const { document } of engine.streamDocuments({
      ticker: "AAPL",
      limit: 10,
    })) {
      yielded.push(document.id);
    }

    expect(yielded).toEqual(["a", "b"]);
    expect(findMany).toHaveBeenCalledWith({
      where: { ticker: "AAPL" },
      orderBy: [{ filedAt: "asc" }, { createdAt: "asc" }],
      take: 10,
    });
  });

  it("streams all documents when no ticker is given", async () => {
    findMany.mockResolvedValue([]);

    const engine = new BacktestIngestionEngine();
    for await (const _ of engine.streamDocuments()) {
      // drain
    }

    expect(findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: [{ filedAt: "asc" }, { createdAt: "asc" }],
      take: undefined,
    });
  });

  it("counts documents with a ticker filter", async () => {
    count.mockResolvedValue(42);

    const engine = new BacktestIngestionEngine();
    const result = await engine.countDocuments("TSLA");

    expect(result).toBe(42);
    expect(count).toHaveBeenCalledWith({ where: { ticker: "TSLA" } });
  });

  it("counts all documents when no ticker is given", async () => {
    count.mockResolvedValue(7);

    const engine = new BacktestIngestionEngine();
    const result = await engine.countDocuments();

    expect(result).toBe(7);
    expect(count).toHaveBeenCalledWith({ where: undefined });
  });
});
