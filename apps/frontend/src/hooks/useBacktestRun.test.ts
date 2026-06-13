import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBacktestRun } from "./useBacktestRun";
import type {
  BacktestFailure,
  BacktestProgress,
  BacktestResult,
} from "../types";

const noWsProps = {
  backtestProgress: null as BacktestProgress | null,
  backtestResult: null as BacktestResult | null,
  backtestFailure: null as BacktestFailure | null,
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useBacktestRun", () => {
  it("marks the run as running immediately after start", () => {
    const { result } = renderHook(() => useBacktestRun(noWsProps));

    expect(result.current.isRunning).toBe(false);
    act(() => {
      result.current.start("run-1");
    });

    expect(result.current.isRunning).toBe(true);
    expect(result.current.activeRunId).toBe("run-1");
  });

  it("reflects WebSocket progress for the active run", () => {
    const progress: BacktestProgress = {
      runId: "run-1",
      processed: 2,
      total: 5,
      equity: 100_000,
    };
    const { result, rerender } = renderHook((props) => useBacktestRun(props), {
      initialProps: noWsProps,
    });

    act(() => {
      result.current.start("run-1");
    });
    rerender({ ...noWsProps, backtestProgress: progress });

    expect(result.current.progress).toEqual(progress);
    expect(result.current.isRunning).toBe(true);
  });

  it("clears running state when WebSocket reports completion", () => {
    const onComplete = vi.fn();
    const completeResult: BacktestResult = {
      runId: "run-1",
      name: "Run",
      initialEquity: 100_000,
      finalEquity: 105_000,
      tradeCount: 3,
      documentsProcessed: 5,
      llmFailures: 0,
    };
    const { result, rerender } = renderHook((props) => useBacktestRun(props), {
      initialProps: { ...noWsProps, onComplete },
    });

    act(() => {
      result.current.start("run-1");
    });
    rerender({ ...noWsProps, onComplete, backtestResult: completeResult });

    expect(result.current.isRunning).toBe(false);
    expect(result.current.result).toEqual(completeResult);
    expect(onComplete).toHaveBeenCalled();
  });

  it("falls back to polling when the WebSocket is silent", async () => {
    const onComplete = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "run-1",
        name: "Run",
        startedAt: "2026-01-01",
        completedAt: "2026-01-01",
        initialEquity: 100_000,
        finalEquity: 110_000,
        parameters: {
          status: "completed",
          documentsProcessed: 4,
          llmFailures: 1,
          tradeCount: 2,
        },
        trades: [],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useBacktestRun({ ...noWsProps, onComplete }),
    );

    act(() => {
      result.current.start("run-1");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/backtests/run-1");
    expect(result.current.isRunning).toBe(false);
    expect(result.current.result?.tradeCount).toBe(2);
    expect(onComplete).toHaveBeenCalled();
  });
});
