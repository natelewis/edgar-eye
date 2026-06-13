import { useCallback, useEffect, useRef, useState } from "react";
import type { TradeStatus, WsEvent } from "@edgar-eye/shared";
import type {
  ActivityItem,
  BackfillFailure,
  BackfillProgress,
  BackfillResult,
  BacktestFailure,
  BacktestProgress,
  BacktestResult,
  PositionItem,
  StatusState,
  TradeItem,
} from "../types";

const DEFAULT_STATUS: StatusState = {
  systemStatus: "idle",
  tradingMode: "PAPER",
  accountEquity: 0,
  buyingPower: 0,
  consecutiveLlmFailures: 0,
};

function parseWsEvent(raw: string): WsEvent | null {
  try {
    const data = JSON.parse(raw) as WsEvent;
    if (typeof data !== "object" || data === null || !("type" in data)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function useTradingSocket() {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<StatusState>(DEFAULT_STATUS);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [trades, setTrades] = useState<TradeItem[]>([]);
  const [positions, setPositions] = useState<PositionItem[]>([]);
  const [backtestProgress, setBacktestProgress] =
    useState<BacktestProgress | null>(null);
  const [backtestResult, setBacktestResult] =
    useState<BacktestResult | null>(null);
  const [backtestFailure, setBacktestFailure] =
    useState<BacktestFailure | null>(null);
  const [backfillProgress, setBackfillProgress] =
    useState<BackfillProgress | null>(null);
  const [backfillResult, setBackfillResult] =
    useState<BackfillResult | null>(null);
  const [backfillFailure, setBackfillFailure] =
    useState<BackfillFailure | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) {
        return;
      }
      setConnected(true);
    };

    ws.onclose = () => {
      if (!mountedRef.current) {
        return;
      }
      setConnected(false);
      reconnectRef.current = setTimeout(() => {
        if (mountedRef.current) {
          connect();
        }
      }, 3000);
    };

    ws.onmessage = (event) => {
      const data = parseWsEvent(event.data as string);
      if (!data) {
        return;
      }

      switch (data.type) {
        case "status":
          setStatus({
            systemStatus: data.systemStatus,
            tradingMode: data.tradingMode,
            accountEquity: data.accountEquity,
            buyingPower: data.buyingPower,
            lastLlmLatencyMs: data.lastLlmLatencyMs,
            consecutiveLlmFailures: data.consecutiveLlmFailures,
          });
          break;

        case "document":
          setActivities((prev) =>
            [
              {
                id: data.document.id,
                kind: "document" as const,
                ticker: data.document.ticker,
                title: data.document.title,
                timestamp: data.timestamp,
              },
              ...prev,
            ].slice(0, 100),
          );
          break;

        case "analysis":
          setActivities((prev) =>
            [
              {
                id: `${data.documentId}-analysis`,
                kind: "analysis" as const,
                ticker: data.ticker,
                title: data.title,
                catalystType: data.catalystType,
                direction: data.direction,
                magnitudeScore: data.magnitudeScore,
                reasoning: data.reasoning,
                latencyMs: data.latencyMs,
                timestamp: data.timestamp,
              },
              ...prev,
            ].slice(0, 100),
          );
          break;

        case "trade":
          setTrades((prev) =>
            [
              {
                ticker: data.ticker,
                side: data.side,
                quantity: data.quantity,
                price: data.price,
                status: data.status as TradeStatus,
                blockReason: data.blockReason,
                mode: data.mode,
                strategy: data.strategy,
                totalPremiumPaid: data.totalPremiumPaid,
                positionGroupId: data.positionGroupId,
                timestamp: data.timestamp,
              },
              ...prev,
            ].slice(0, 100),
          );
          break;

        case "position_closed":
          setTrades((prev) =>
            [
              {
                ticker: data.underlying,
                side: "SELL" as const,
                quantity: 1,
                price: data.netExitValue,
                status: "EXECUTED" as TradeStatus,
                mode: status.tradingMode,
                strategy: data.strategy,
                totalPremiumPaid: data.totalPremiumPaid,
                positionGroupId: data.positionGroupId,
                timestamp: data.timestamp,
              },
              ...prev,
            ].slice(0, 100),
          );
          break;

        case "positions":
          setPositions(data.positions);
          break;

        case "backtest_progress":
          setBacktestFailure(null);
          setBacktestProgress({
            runId: data.runId,
            processed: data.processed,
            total: data.total,
            equity: data.equity,
            llmFailures: data.llmFailures,
          });
          break;

        case "backtest_complete":
          setBacktestResult({
            runId: data.runId,
            name: data.name,
            initialEquity: data.initialEquity,
            finalEquity: data.finalEquity,
            tradeCount: data.tradeCount,
            documentsProcessed: data.documentsProcessed,
            llmFailures: data.llmFailures,
          });
          setBacktestProgress(null);
          break;

        case "backtest_failed":
          setBacktestFailure({
            runId: data.runId,
            reason: data.reason,
          });
          setBacktestProgress(null);
          break;

        case "backfill_progress":
          setBackfillFailure(null);
          setBackfillProgress({
            backfillId: data.backfillId,
            ticker: data.ticker,
            processed: data.processed,
            total: data.total,
            ingested: data.ingested,
            skipped: data.skipped,
          });
          break;

        case "backfill_complete":
          setBackfillResult({
            backfillId: data.backfillId,
            ticker: data.ticker,
            ingested: data.ingested,
            skipped: data.skipped,
          });
          setBackfillProgress(null);
          break;

        case "backfill_failed":
          setBackfillFailure({
            backfillId: data.backfillId,
            ticker: data.ticker,
            reason: data.reason,
          });
          setBackfillProgress(null);
          break;
      }
    };
  }, [status.tradingMode]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    connected,
    status,
    activities,
    trades,
    positions,
    backtestProgress,
    backtestResult,
    backtestFailure,
    backfillProgress,
    backfillResult,
    backfillFailure,
  };
}
