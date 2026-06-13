import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useBackfillRun } from "../hooks/useBackfillRun";
import { useBacktestRun } from "../hooks/useBacktestRun";
import type {
  BackfillFailure,
  BackfillProgress,
  BackfillResult,
  BacktestFailure,
  BacktestProgress,
  BacktestResult,
  BacktestRunRecord,
} from "../types";

interface BacktestingPageProps {
  backtestProgress: BacktestProgress | null;
  backtestResult: BacktestResult | null;
  backtestFailure: BacktestFailure | null;
  backfillProgress: BackfillProgress | null;
  backfillResult: BackfillResult | null;
  backfillFailure: BackfillFailure | null;
}

export function BacktestingPage({
  backtestProgress,
  backtestResult,
  backtestFailure,
  backfillProgress,
  backfillResult,
  backfillFailure,
}: BacktestingPageProps) {
  const [name, setName] = useState("Historical Simulation");
  const [initialEquity, setInitialEquity] = useState(100_000);
  const [ticker, setTicker] = useState("");
  const [limit, setLimit] = useState("");
  const [backfillLimit, setBackfillLimit] = useState("50");
  const [backfillSince, setBackfillSince] = useState("");
  const [runs, setRuns] = useState<BacktestRunRecord[]>([]);
  const [selectedRun, setSelectedRun] = useState<BacktestRunRecord | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [documentCount, setDocumentCount] = useState<number | null>(null);
  const [backfillSubmitting, setBackfillSubmitting] = useState(false);
  const [backfillError, setBackfillError] = useState<string | null>(null);

  const fetchDocumentCount = useCallback(async () => {
    const params = new URLSearchParams();
    if (ticker) {
      params.set("ticker", ticker);
    }
    const query = params.toString();
    const url = query
      ? `/api/backtests/documents/count?${query}`
      : "/api/backtests/documents/count";

    try {
      const response = await fetch(url);
      if (!response.ok) {
        setDocumentCount(null);
        return;
      }
      const data = (await response.json()) as { count: number };
      setDocumentCount(data.count);
    } catch {
      setDocumentCount(null);
    }
  }, [ticker]);

  const fetchRuns = useCallback(async () => {
    try {
      const response = await fetch("/api/backtests");
      if (!response.ok) {
        setLoadError(`Failed to load backtests (${response.status})`);
        return;
      }
      const data = (await response.json()) as BacktestRunRecord[];
      setRuns(data);
      setLoadError(null);
    } catch {
      setLoadError("Failed to load backtests");
    }
  }, []);

  const run = useBacktestRun({
    backtestProgress,
    backtestResult,
    backtestFailure,
    onComplete: fetchRuns,
  });

  const backfill = useBackfillRun({
    backfillProgress,
    backfillResult,
    backfillFailure,
    onComplete: fetchDocumentCount,
  });

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    void fetchDocumentCount();
  }, [fetchDocumentCount]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/api/backtests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          initialEquity,
          ticker: ticker || undefined,
          limit: limit ? parseInt(limit, 10) : undefined,
        }),
      });

      const body = (await response.json().catch(() => null)) as {
        error?: string;
        runId?: string;
      } | null;

      if (!response.ok || !body?.runId) {
        setSubmitError(
          body?.error ?? `Backtest request failed (${response.status})`,
        );
        return;
      }

      run.start(body.runId);
    } catch {
      setSubmitError("Backtest request failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBackfill() {
    if (!ticker.trim()) {
      setBackfillError("Enter a ticker before fetching historical 8-Ks");
      return;
    }

    setBackfillSubmitting(true);
    setBackfillError(null);

    try {
      const parsedLimit = backfillLimit
        ? parseInt(backfillLimit, 10)
        : undefined;

      const response = await fetch("/api/ingestion/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          limit: parsedLimit,
          since: backfillSince || undefined,
        }),
      });

      const body = (await response.json().catch(() => null)) as {
        error?: string;
        backfillId?: string;
      } | null;

      if (!response.ok || !body?.backfillId) {
        setBackfillError(
          body?.error ?? `Backfill request failed (${response.status})`,
        );
        return;
      }

      backfill.start(body.backfillId);
    } catch {
      setBackfillError("Backfill request failed");
    } finally {
      setBackfillSubmitting(false);
    }
  }

  const isRunning = run.isRunning;
  const progress = run.progress;
  const result = run.result;
  const failure = run.failure;
  const isBackfilling = backfill.isRunning;
  const backfillProgressState = backfill.progress;
  const backfillResultState = backfill.result;
  const backfillFailureState = backfill.failure;

  const equityCurve = buildEquityCurve(selectedRun);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6 lg:col-span-1"
        >
          <h2 className="text-lg font-semibold text-zinc-100">
            Run Simulation
          </h2>

          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              required
            />
          </Field>

          <Field label="Initial Equity">
            <input
              type="number"
              value={initialEquity}
              onChange={(e) => setInitialEquity(Number(e.target.value))}
              className="input"
              min={1000}
              required
            />
          </Field>

          <Field label="Ticker Filter (optional)">
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              className="input"
              placeholder="AAPL"
            />
          </Field>

          <Field label="Document Limit (optional)">
            <input
              type="number"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="input"
              min={1}
              placeholder="All"
            />
          </Field>

          {documentCount !== null && (
            <p className="text-xs text-zinc-500">
              {documentCount.toLocaleString()} document
              {documentCount === 1 ? "" : "s"} available
              {ticker ? ` for ${ticker}` : ""}
            </p>
          )}

          <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <h3 className="text-sm font-medium text-zinc-200">
              Historical 8-K Backfill
            </h3>

            <Field label="Backfill Limit">
              <input
                type="number"
                value={backfillLimit}
                onChange={(e) => setBackfillLimit(e.target.value)}
                className="input"
                min={1}
                max={200}
              />
            </Field>

            <Field label="Since Date (optional)">
              <input
                type="date"
                value={backfillSince}
                onChange={(e) => setBackfillSince(e.target.value)}
                className="input"
              />
            </Field>

            <button
              type="button"
              onClick={() => void handleBackfill()}
              disabled={
                backfillSubmitting ||
                isBackfilling ||
                isRunning ||
                !ticker.trim()
              }
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {isBackfilling ? "Fetching…" : "Fetch Historical 8-Ks"}
            </button>

            {!ticker.trim() && (
              <p className="text-xs text-zinc-500">
                Enter a ticker above to fetch SEC 8-K filings into the database.
              </p>
            )}

            {backfillError && (
              <p className="rounded-lg border border-red-800/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
                {backfillError}
              </p>
            )}

            {(isBackfilling || backfillProgressState) && (
              <div className="rounded-lg bg-zinc-900 p-3">
                <div className="mb-2 flex justify-between text-sm">
                  <span className="text-zinc-400">Backfill progress</span>
                  <span className="font-mono text-zinc-200">
                    {backfillProgressState
                      ? `${backfillProgressState.processed}/${backfillProgressState.total}`
                      : "…"}
                  </span>
                </div>
                {backfillProgressState && (
                  <p className="text-xs text-zinc-500">
                    {backfillProgressState.ingested} ingested,{" "}
                    {backfillProgressState.skipped} skipped
                  </p>
                )}
              </div>
            )}

            {backfillResultState && (
              <p className="text-xs text-emerald-400">
                Backfill complete: {backfillResultState.ingested} ingested,{" "}
                {backfillResultState.skipped} skipped.
              </p>
            )}

            {backfillFailureState && (
              <p className="rounded-lg border border-red-800/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
                {backfillFailureState.reason}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={
              submitting || isRunning || isBackfilling || documentCount === 0
            }
            className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {isRunning ? "Running…" : "Start Backtest"}
          </button>

          {documentCount === 0 && (
            <p className="text-xs text-amber-400">
              No documents ingested yet
              {ticker ? ` for ${ticker}` : ""} — fetch historical 8-Ks above.
            </p>
          )}

          {submitError && (
            <p className="rounded-lg border border-red-800/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
              {submitError}
            </p>
          )}

          {(isRunning || progress) && (
            <div className="rounded-lg bg-zinc-950 p-4">
              <div className="mb-2 flex justify-between text-sm">
                <span className="text-zinc-400">Progress</span>
                <span className="font-mono text-zinc-200">
                  {progress ? `${progress.processed}/${progress.total}` : "…"}
                </span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-zinc-800"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={progress?.total ?? 100}
                aria-valuenow={progress?.processed ?? 0}
              >
                <div
                  className={`h-full bg-emerald-500 transition-all ${
                    progress ? "" : "animate-pulse"
                  }`}
                  style={{
                    width: progress
                      ? `${(progress.processed / Math.max(progress.total, 1)) * 100}%`
                      : "100%",
                  }}
                />
              </div>
              {progress && (
                <p className="mt-2 text-xs text-zinc-500">
                  Equity: ${progress.equity.toLocaleString()}
                  {progress.llmFailures
                    ? ` · ${progress.llmFailures} analysis failures`
                    : ""}
                </p>
              )}
            </div>
          )}

          {failure && (
            <div className="rounded-lg border border-red-800/50 bg-red-950/30 p-4 text-sm">
              <p className="font-semibold text-red-300">Backtest failed</p>
              <p className="text-zinc-300">{failure.reason}</p>
            </div>
          )}

          {result && (
            <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/30 p-4 text-sm">
              <p className="font-semibold text-emerald-300">Complete</p>
              <p className="text-zinc-300">
                {result.name}: ${result.initialEquity.toLocaleString()} → $
                {result.finalEquity.toLocaleString()}
              </p>
              <p className="text-zinc-500">
                {result.tradeCount} trades from {result.documentsProcessed}{" "}
                documents
              </p>
              {result.tradeCount === 0 && (
                <p className="mt-2 text-amber-400">
                  No trades were triggered — the analyzed filings did not produce
                  high-confidence signals.
                </p>
              )}
              {result.llmFailures > 0 && (
                <p className="mt-1 text-amber-400">
                  {result.llmFailures} document
                  {result.llmFailures === 1 ? "" : "s"} could not be analyzed.
                </p>
              )}
            </div>
          )}
        </form>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 lg:col-span-2">
          <h2 className="mb-4 text-lg font-semibold text-zinc-100">
            Equity Curve
          </h2>
          {equityCurve.length > 1 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={equityCurve}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#71717a" tick={{ fontSize: 11 }} />
                <YAxis
                  stroke="#71717a"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    background: "#18181b",
                    border: "1px solid #3f3f46",
                    borderRadius: 8,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="equity"
                  stroke="#34d399"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-16 text-center text-zinc-500">
              Select a completed backtest run to view equity curve
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900">
          <div className="border-b border-zinc-800 px-6 py-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
              Past Runs
            </h2>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {loadError ? (
              <p className="px-6 py-8 text-center text-red-300">{loadError}</p>
            ) : runs.length === 0 ? (
              <p className="px-6 py-8 text-center text-zinc-500">No runs yet</p>
            ) : (
              runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedRun(run)}
                  className={`block w-full border-b border-zinc-800/50 px-6 py-3 text-left transition hover:bg-zinc-800/30 ${
                    selectedRun?.id === run.id ? "bg-zinc-800/50" : ""
                  }`}
                >
                  <div className="flex justify-between">
                    <span className="font-medium text-zinc-200">{run.name}</span>
                    <span className="text-xs text-zinc-500">
                      {new Date(run.startedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-400">
                    ${run.initialEquity.toLocaleString()}
                    {run.finalEquity != null &&
                      ` → $${run.finalEquity.toLocaleString()}`}
                    {" · "}
                    {run.trades.length} trades
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900">
          <div className="border-b border-zinc-800 px-6 py-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
              Reasoning Transcripts
            </h2>
          </div>
          <div className="max-h-64 space-y-3 overflow-y-auto p-4">
            {!selectedRun || selectedRun.trades.length === 0 ? (
              <p className="text-center text-zinc-500">
                Select a run with trades to review LLM reasoning
              </p>
            ) : (
              selectedRun.trades.map((trade) => (
                <article
                  key={trade.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-950 p-3"
                >
                  <div className="mb-1 flex items-center gap-2 text-sm">
                    <span className="font-mono font-semibold text-emerald-400">
                      {trade.ticker}
                    </span>
                    <span className="text-xs font-bold text-amber-300">
                      {trade.strategy}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {trade.catalystType} {trade.direction} · {trade.magnitudeScore}
                    </span>
                    {trade.exitCondition && (
                      <span className="text-xs text-blue-400">
                        {trade.exitCondition}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400">{trade.reasoning}</p>
                  {trade.pnl != null && (
                    <p
                      className={`mt-1 text-xs font-mono ${
                        trade.pnl >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      PnL: ${trade.pnl.toFixed(2)}
                    </p>
                  )}
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function buildEquityCurve(
  run: BacktestRunRecord | null,
): { label: string; equity: number }[] {
  if (!run) {
    return [];
  }

  let equity = run.initialEquity;
  const points: { label: string; equity: number }[] = [
    { label: "Start", equity: run.initialEquity },
  ];

  for (const trade of run.trades) {
    if (trade.pnl != null) {
      equity += trade.pnl;
    } else if (trade.netExitValue != null) {
      equity += trade.netExitValue - trade.totalPremiumPaid;
    }

    const label = trade.exitAt
      ? new Date(trade.exitAt).toLocaleDateString()
      : new Date(trade.simulatedAt).toLocaleDateString();

    points.push({ label, equity });
  }

  if (run.finalEquity != null) {
    points.push({ label: "End", equity: run.finalEquity });
  }

  return points;
}
