import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BacktestFailure,
  BacktestProgress,
  BacktestResult,
  BacktestRunRecord,
} from "../types";

const POLL_INTERVAL_MS = 2000;

interface UseBacktestRunArgs {
  backtestProgress: BacktestProgress | null;
  backtestResult: BacktestResult | null;
  backtestFailure: BacktestFailure | null;
  onComplete?: () => void;
}

interface UseBacktestRunState {
  activeRunId: string | null;
  isRunning: boolean;
  progress: BacktestProgress | null;
  result: BacktestResult | null;
  failure: BacktestFailure | null;
  start: (runId: string) => void;
}

/// Tracks an in-flight backtest. Running state is set the moment a run is
/// accepted (so the UI never looks idle) and is kept in sync via both the
/// WebSocket stream and a polling fallback in case the socket drops.
export function useBacktestRun({
  backtestProgress,
  backtestResult,
  backtestFailure,
  onComplete,
}: UseBacktestRunArgs): UseBacktestRunState {
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<BacktestProgress | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [failure, setFailure] = useState<BacktestFailure | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const finish = useCallback(() => {
    setIsRunning(false);
    onCompleteRef.current?.();
  }, []);

  const start = useCallback((runId: string) => {
    setActiveRunId(runId);
    setIsRunning(true);
    setProgress(null);
    setResult(null);
    setFailure(null);
  }, []);

  useEffect(() => {
    if (!activeRunId || !backtestProgress) {
      return;
    }
    if (backtestProgress.runId === activeRunId) {
      setProgress(backtestProgress);
      setIsRunning(true);
    }
  }, [activeRunId, backtestProgress]);

  useEffect(() => {
    if (!activeRunId || !backtestResult) {
      return;
    }
    if (backtestResult.runId === activeRunId) {
      setResult(backtestResult);
      setProgress(null);
      finish();
    }
  }, [activeRunId, backtestResult, finish]);

  useEffect(() => {
    if (!activeRunId || !backtestFailure) {
      return;
    }
    if (backtestFailure.runId === activeRunId) {
      setFailure(backtestFailure);
      setProgress(null);
      finish();
    }
  }, [activeRunId, backtestFailure, finish]);

  useEffect(() => {
    if (!isRunning || !activeRunId) {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(`/api/backtests/${activeRunId}`);
        if (!response.ok || cancelled) {
          return;
        }
        const run = (await response.json()) as BacktestRunRecord;
        if (cancelled || !run.completedAt) {
          return;
        }

        const status = run.parameters?.status;
        if (status === "failed") {
          setFailure({
            runId: run.id,
            reason: run.parameters?.reason ?? "Backtest failed",
          });
        } else {
          setResult({
            runId: run.id,
            name: run.name,
            initialEquity: run.initialEquity,
            finalEquity: run.finalEquity ?? run.initialEquity,
            tradeCount: run.parameters?.tradeCount ?? run.trades.length,
            documentsProcessed: run.parameters?.documentsProcessed ?? 0,
            llmFailures: run.parameters?.llmFailures ?? 0,
          });
        }
        setProgress(null);
        finish();
      } catch {
        // Transient fetch error; the next interval tick retries.
      }
    };

    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isRunning, activeRunId, finish]);

  return { activeRunId, isRunning, progress, result, failure, start };
}
