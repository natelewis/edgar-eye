import { describe, expect, it } from "vitest";
import {
  getEtCalendarDate,
  getYesterdayEtCalendarDate,
  isHistoricalCacheEligible,
} from "./historical-cache-eligibility.js";

describe("historical-cache-eligibility", () => {
  const now = new Date("2026-06-13T15:00:00.000Z");

  it("resolves ET calendar dates", () => {
    expect(getEtCalendarDate(new Date("2026-06-13T15:00:00.000Z"))).toBe(
      "2026-06-13",
    );
    expect(getEtCalendarDate(new Date("2026-06-13T03:00:00.000Z"))).toBe(
      "2026-06-12",
    );
  });

  it("computes yesterday in ET", () => {
    expect(getYesterdayEtCalendarDate(now)).toBe("2026-06-12");
  });

  it("treats today and yesterday as ineligible", () => {
    expect(
      isHistoricalCacheEligible(new Date("2026-06-13T12:00:00.000Z"), now),
    ).toBe(false);
    expect(
      isHistoricalCacheEligible(new Date("2026-06-12T12:00:00.000Z"), now),
    ).toBe(false);
  });

  it("treats day before yesterday as eligible", () => {
    expect(
      isHistoricalCacheEligible(new Date("2026-06-11T12:00:00.000Z"), now),
    ).toBe(true);
    expect(
      isHistoricalCacheEligible(new Date("2024-06-01T00:00:00.000Z"), now),
    ).toBe(true);
  });

  it("handles midnight ET boundary", () => {
    const justBeforeMidnightEt = new Date("2026-06-13T03:59:00.000Z");
    const justAfterMidnightEt = new Date("2026-06-13T04:01:00.000Z");

    expect(getEtCalendarDate(justBeforeMidnightEt)).toBe("2026-06-12");
    expect(getEtCalendarDate(justAfterMidnightEt)).toBe("2026-06-13");
    expect(isHistoricalCacheEligible(justBeforeMidnightEt, now)).toBe(false);
    expect(isHistoricalCacheEligible(justAfterMidnightEt, now)).toBe(false);
  });

  it("maps date-only UTC asOf to the correct ET day", () => {
    const asOf = new Date("2024-06-01T00:00:00.000Z");
    expect(getEtCalendarDate(asOf)).toBe("2024-05-31");
    expect(isHistoricalCacheEligible(asOf, now)).toBe(true);
  });
});
