import type { ActivityItem } from "../types";

interface ActivityTickerProps {
  activities: ActivityItem[];
}

export function ActivityTicker({ activities }: ActivityTickerProps) {
  if (activities.length === 0) {
    return (
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-400">
          Live Activity
        </h2>
        <p className="text-zinc-500">
          Waiting for ingested documents and LLM reasoning…
        </p>
      </section>
    );
  }

  const doubled = [...activities, ...activities];

  return (
    <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
      <div className="border-b border-zinc-800 px-6 py-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
          Live Activity Ticker
        </h2>
      </div>
      <div className="relative overflow-hidden py-4">
        <div className="ticker-scroll flex w-max gap-4 px-4">
          {doubled.map((item, index) => (
            <ActivityCard key={`${item.id}-${index}`} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ActivityCard({ item }: { item: ActivityItem }) {
  const isAnalysis = item.kind === "analysis";

  return (
    <article className="w-80 shrink-0 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-sm font-semibold text-emerald-400">
          {item.ticker}
        </span>
        <span className="text-xs text-zinc-500">
          {new Date(item.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <p className="mb-2 line-clamp-2 text-sm text-zinc-300">{item.title}</p>
      {isAnalysis && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CatalystBadge
              catalystType={item.catalystType!}
              direction={item.direction!}
            />
            <span className="text-xs text-zinc-400">
              {item.magnitudeScore} score
            </span>
            {item.latencyMs && (
              <span className="text-xs text-zinc-500">{item.latencyMs}ms</span>
            )}
          </div>
          <p className="line-clamp-3 text-xs text-zinc-500">{item.reasoning}</p>
        </div>
      )}
      {!isAnalysis && (
        <span className="text-xs text-blue-400">Document ingested</span>
      )}
    </article>
  );
}

function CatalystBadge({
  catalystType,
  direction,
}: {
  catalystType: "DIRECTIONAL" | "VOLATILITY" | "NONE";
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
}) {
  const label =
    catalystType === "NONE"
      ? "NONE"
      : `${catalystType} ${direction}`;

  const colors = {
    bullish: "bg-emerald-900 text-emerald-300",
    bearish: "bg-red-900 text-red-300",
    neutral: "bg-amber-900 text-amber-300",
    none: "bg-zinc-800 text-zinc-400",
  };

  const colorKey =
    catalystType === "NONE"
      ? "none"
      : direction === "BULLISH"
        ? "bullish"
        : direction === "BEARISH"
          ? "bearish"
          : "neutral";

  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-bold ${colors[colorKey]}`}
    >
      {label}
    </span>
  );
}
