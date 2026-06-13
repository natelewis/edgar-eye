import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BackfillFailure,
  BackfillProgress,
  BackfillResult,
} from "../types";

interface UseBackfillRunArgs {
  backfillProgress: BackfillProgress | null;
  backfillResult: BackfillResult | null;
  backfillFailure: BackfillFailure | null;
  onComplete?: () => void;
}

interface UseBackfillRunState {
  activeBackfillId: string | null;
  isRunning: boolean;
  progress: BackfillProgress | null;
  result: BackfillResult | null;
  failure: BackfillFailure | null;
  start: (backfillId: string) => void;
}

export function useBackfillRun({
  backfillProgress,
  backfillResult,
  backfillFailure,
  onComplete,
}: UseBackfillRunArgs): UseBackfillRunState {
  const [activeBackfillId, setActiveBackfillId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<BackfillProgress | null>(null);
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [failure, setFailure] = useState<BackfillFailure | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const finish = useCallback(() => {
    setIsRunning(false);
    onCompleteRef.current?.();
  }, []);

  const start = useCallback((backfillId: string) => {
    setActiveBackfillId(backfillId);
    setIsRunning(true);
    setProgress(null);
    setResult(null);
    setFailure(null);
  }, []);

  useEffect(() => {
    if (!activeBackfillId || !backfillProgress) {
      return;
    }
    if (backfillProgress.backfillId === activeBackfillId) {
      setProgress(backfillProgress);
      setIsRunning(true);
    }
  }, [activeBackfillId, backfillProgress]);

  useEffect(() => {
    if (!activeBackfillId || !backfillResult) {
      return;
    }
    if (backfillResult.backfillId === activeBackfillId) {
      setResult(backfillResult);
      setProgress(null);
      finish();
    }
  }, [activeBackfillId, backfillResult, finish]);

  useEffect(() => {
    if (!activeBackfillId || !backfillFailure) {
      return;
    }
    if (backfillFailure.backfillId === activeBackfillId) {
      setFailure(backfillFailure);
      setProgress(null);
      finish();
    }
  }, [activeBackfillId, backfillFailure, finish]);

  return { activeBackfillId, isRunning, progress, result, failure, start };
}
