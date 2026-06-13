import { TradeStatus } from "@edgar-eye/database";
import { describe, expect, it } from "vitest";
import { toTradeStatus } from "./trade-status.js";

describe("toTradeStatus", () => {
  it("maps broker order statuses to database trade statuses", () => {
    expect(toTradeStatus("EXECUTED")).toBe(TradeStatus.EXECUTED);
    expect(toTradeStatus("PENDING")).toBe(TradeStatus.PENDING);
    expect(toTradeStatus("REJECTED")).toBe(TradeStatus.REJECTED);
    expect(toTradeStatus("FAILED")).toBe(TradeStatus.FAILED);
  });
});
