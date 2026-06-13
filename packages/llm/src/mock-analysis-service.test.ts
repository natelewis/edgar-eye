import { describe, expect, it } from "vitest";
import { MockAnalysisService } from "./mock-analysis-service.js";

const service = new MockAnalysisService();

describe("MockAnalysisService", () => {
  it("returns bullish directional signal for merger keywords", async () => {
    const result = await service.analyzeFiling({
      ticker: "AAPL",
      title: "Entry into Merger Agreement",
      cleanedText: "The company announced a merger and acquisition deal.",
    });

    expect(result.catalystType).toBe("DIRECTIONAL");
    expect(result.direction).toBe("BULLISH");
    expect(result.magnitudeScore).toBeGreaterThanOrEqual(80);
  });

  it("returns bearish directional signal for bankruptcy keywords", async () => {
    const result = await service.analyzeFiling({
      ticker: "XYZ",
      title: "Chapter 11 Bankruptcy Filing",
      cleanedText: "The company filed for bankruptcy amid going concern doubts.",
    });

    expect(result.catalystType).toBe("DIRECTIONAL");
    expect(result.direction).toBe("BEARISH");
    expect(result.magnitudeScore).toBeGreaterThanOrEqual(80);
  });

  it("returns volatility signal for investigation keywords", async () => {
    const result = await service.analyzeFiling({
      ticker: "ABC",
      title: "SEC inquiry announced",
      cleanedText: "The company received a subpoena and sec inquiry.",
    });

    expect(result.catalystType).toBe("VOLATILITY");
    expect(result.direction).toBe("NEUTRAL");
    expect(result.magnitudeScore).toBeGreaterThanOrEqual(85);
  });

  it("returns NONE when there is no material signal", async () => {
    const result = await service.analyzeFiling({
      ticker: "ABC",
      title: "Quarterly administrative update",
      cleanedText: "Routine filing with no structural changes.",
    });

    expect(result.catalystType).toBe("NONE");
    expect(result.magnitudeScore).toBeLessThan(80);
  });

  it("keeps magnitude within [0, 99]", async () => {
    const result = await service.analyzeFiling({
      ticker: "AAPL",
      title: "Merger acquisition record revenue new contract buyback",
      cleanedText:
        "merger acquisition record revenue new contract partnership buyback dividend increase",
    });

    expect(result.magnitudeScore).toBeGreaterThanOrEqual(0);
    expect(result.magnitudeScore).toBeLessThanOrEqual(99);
  });

  it("produces deterministic output for identical input", async () => {
    const input = {
      ticker: "AAPL",
      title: "Merger Agreement",
      cleanedText: "A merger was announced today.",
    };
    const first = await service.analyzeFiling(input);
    const second = await service.analyzeFiling(input);

    expect(first.catalystType).toBe(second.catalystType);
    expect(first.direction).toBe(second.direction);
    expect(first.magnitudeScore).toBe(second.magnitudeScore);
    expect(first.reasoning).toBe(second.reasoning);
  });
});
