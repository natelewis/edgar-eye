import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HistoricalDataCache,
  optionsContractsKey,
  optionsMinuteBarsKey,
  reviveMinuteBars,
  serializeMinuteBars,
} from "./historical-data-cache.js";

describe("HistoricalDataCache", () => {
  let cacheDir: string;

  afterEach(async () => {
    if (cacheDir) {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  async function makeCache(enabled = true): Promise<HistoricalDataCache> {
    cacheDir = await mkdtemp(path.join(os.tmpdir(), "historical-cache-"));
    return new HistoricalDataCache({ cacheDir, enabled });
  }

  it("returns undefined on miss", async () => {
    const cache = await makeCache();
    const value = await cache.get<number>("stock-last-trade", "AAPL|2024-06-01");
    expect(value).toBeUndefined();
  });

  it("round-trips values through memory", async () => {
    const cache = await makeCache();
    await cache.set("stock-last-trade", "AAPL|2024-06-01", 123.45);
    await expect(cache.get<number>("stock-last-trade", "AAPL|2024-06-01")).resolves.toBe(
      123.45,
    );
  });

  it("persists values to disk across instances", async () => {
    const cache1 = await makeCache();
    await cache1.set("options-contracts", "TSLA|2024-06-01|2024-07-15|historical", [
      { symbol: "TSLA240621C00180000" },
    ]);

    const cache2 = new HistoricalDataCache({ cacheDir });
    await expect(
      cache2.get<Array<{ symbol: string }>>(
        "options-contracts",
        "TSLA|2024-06-01|2024-07-15|historical",
      ),
    ).resolves.toEqual([{ symbol: "TSLA240621C00180000" }]);
  });

  it("round-trips minute bars with Date revival helpers", async () => {
    const cache = await makeCache();
    const bars = [
      {
        symbol: "TSLA240621C00180000",
        timestamp: new Date("2024-06-01T14:30:00.000Z"),
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
      },
    ];
    const key = optionsMinuteBarsKey(
      ["TSLA240621C00180000"],
      "2024-06-01T14:00:00.000Z",
      "2024-06-01T16:00:00.000Z",
    );

    await cache.set("options-minute-bars", key, serializeMinuteBars(bars));
    const cached = await cache.get<ReturnType<typeof serializeMinuteBars>>(
      "options-minute-bars",
      key,
    );
    expect(cached).toBeDefined();
    const revived = reviveMinuteBars(cached ?? []);
    expect(revived[0]?.timestamp).toBeInstanceOf(Date);
    expect(revived[0]?.timestamp.toISOString()).toBe("2024-06-01T14:30:00.000Z");
  });

  it("returns undefined for corrupt cache files", async () => {
    const cache = await makeCache();
    const key = optionsContractsKey("TSLA", "2024-06-01", "2024-07-15", true);
    const hash = createHash("sha256").update(key).digest("hex");
    const filePath = path.join(cacheDir, "options-contracts", `${hash}.json`);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{not-json", "utf8");

    await expect(cache.get("options-contracts", key)).resolves.toBeUndefined();
  });

  it("does not read or write when disabled", async () => {
    const cache = await makeCache(false);

    await cache.set("stock-last-trade", "AAPL|2024-06-01", 100);
    await expect(cache.get("stock-last-trade", "AAPL|2024-06-01")).resolves.toBeUndefined();

    const entries = await readdir(cacheDir).catch(() => []);
    expect(entries).toHaveLength(0);
  });
});
