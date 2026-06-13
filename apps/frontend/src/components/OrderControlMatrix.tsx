import type { PositionItem, TradeItem } from "../types";

interface OrderControlMatrixProps {
  trades: TradeItem[];
  positions: PositionItem[];
}

export function OrderControlMatrix({
  trades,
  positions,
}: OrderControlMatrixProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900">
        <div className="border-b border-zinc-800 px-6 py-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
            Active Positions
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs uppercase text-zinc-500">
                <th className="px-6 py-3">Ticker</th>
                <th className="px-6 py-3">Qty</th>
                <th className="px-6 py-3">Avg Entry</th>
                <th className="px-6 py-3">Mkt Value</th>
                <th className="px-6 py-3">Unrealized P/L</th>
              </tr>
            </thead>
            <tbody>
              {positions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-zinc-500">
                    No open positions
                  </td>
                </tr>
              ) : (
                positions.map((p) => (
                  <tr
                    key={p.ticker}
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                  >
                    <td className="px-6 py-3 font-mono font-semibold">
                      {p.ticker}
                    </td>
                    <td className="px-6 py-3 font-mono">{p.quantity}</td>
                    <td className="px-6 py-3 font-mono">
                      ${p.avgEntryPrice.toFixed(2)}
                    </td>
                    <td className="px-6 py-3 font-mono">
                      ${p.marketValue.toFixed(2)}
                    </td>
                    <td
                      className={`px-6 py-3 font-mono ${
                        p.unrealizedPl >= 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      ${p.unrealizedPl.toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900">
        <div className="border-b border-zinc-800 px-6 py-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
            Execution Log
          </h2>
        </div>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-900">
              <tr className="border-b border-zinc-800 text-left text-xs uppercase text-zinc-500">
                <th className="px-6 py-3">Time</th>
                <th className="px-6 py-3">Ticker</th>
                <th className="px-6 py-3">Strategy</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {trades.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-zinc-500">
                    No trades yet
                  </td>
                </tr>
              ) : (
                trades.map((t, i) => (
                  <tr
                    key={`${t.timestamp}-${i}`}
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                  >
                    <td className="px-6 py-3 text-xs text-zinc-500">
                      {new Date(t.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-6 py-3 font-mono font-semibold">
                      {t.ticker}
                    </td>
                    <td className="px-6 py-3 text-xs text-zinc-400">
                      {t.strategy ?? t.side}
                    </td>
                    <td className="px-6 py-3">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-6 py-3 text-xs text-zinc-400">
                      {t.status === "EXECUTED" && t.totalPremiumPaid
                        ? `$${t.totalPremiumPaid.toFixed(2)} premium`
                        : t.status === "EXECUTED" && t.price
                          ? `${t.quantity.toFixed(2)} @ $${t.price.toFixed(2)}`
                          : t.blockReason ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: "EXECUTED" | "PENDING" | "BLOCKED" | "REJECTED" | "FAILED";
}) {
  const styles = {
    EXECUTED: "bg-emerald-900/50 text-emerald-300",
    PENDING: "bg-blue-900/50 text-blue-300",
    BLOCKED: "bg-amber-900/50 text-amber-300",
    REJECTED: "bg-red-900/50 text-red-300",
    FAILED: "bg-zinc-800 text-zinc-400",
  };

  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}
