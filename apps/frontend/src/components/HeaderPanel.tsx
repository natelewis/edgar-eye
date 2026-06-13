import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { StatusState } from "../types";

interface HeaderPanelProps {
  connected: boolean;
  status: StatusState;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function HeaderPanel({ connected, status }: HeaderPanelProps) {
  const location = useLocation();
  const isLive = status.tradingMode === "LIVE";

  return (
    <header className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur px-6 py-4">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50">
            Edgar Eye
          </h1>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
              isLive
                ? "badge-live bg-red-600 text-white"
                : "bg-emerald-600 text-white"
            }`}
          >
            {status.tradingMode}
          </span>
          <span
            className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-red-500"}`}
            role="status"
            aria-label={connected ? "WebSocket connected" : "WebSocket disconnected"}
          />
          <span className="sr-only">
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>

        <nav className="flex gap-2">
          <NavLink to="/" active={location.pathname === "/"}>
            Dashboard
          </NavLink>
          <NavLink to="/backtesting" active={location.pathname === "/backtesting"}>
            Backtesting
          </NavLink>
        </nav>

        <div className="flex flex-wrap gap-6 text-sm">
          <Metric label="System" value={status.systemStatus.toUpperCase()} />
          <Metric
            label="Equity"
            value={formatCurrency(status.accountEquity)}
          />
          <Metric
            label="Buying Power"
            value={formatCurrency(status.buyingPower)}
          />
          <Metric
            label="LLM Latency"
            value={
              status.lastLlmLatencyMs
                ? `${status.lastLlmLatencyMs}ms`
                : "—"
            }
          />
        </div>
      </div>
    </header>
  );
}

function NavLink({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-zinc-800 text-zinc-50"
          : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
      }`}
    >
      {children}
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="font-mono text-zinc-100">{value}</div>
    </div>
  );
}
