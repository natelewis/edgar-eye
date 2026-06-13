import { Route, Routes } from "react-router-dom";
import { ActivityTicker } from "./components/ActivityTicker";
import { HeaderPanel } from "./components/HeaderPanel";
import { OrderControlMatrix } from "./components/OrderControlMatrix";
import { useTradingSocket } from "./hooks/useTradingSocket";
import { BacktestingPage } from "./pages/BacktestingPage";

export default function App() {
  const socket = useTradingSocket();

  return (
    <div className="min-h-screen bg-zinc-950">
      <HeaderPanel connected={socket.connected} status={socket.status} />

      <Routes>
        <Route
          path="/"
          element={
            <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
              <ActivityTicker activities={socket.activities} />
              <OrderControlMatrix
                trades={socket.trades}
                positions={socket.positions}
              />
            </main>
          }
        />
        <Route
          path="/backtesting"
          element={
            <BacktestingPage
              backtestProgress={socket.backtestProgress}
              backtestResult={socket.backtestResult}
              backtestFailure={socket.backtestFailure}
              backfillProgress={socket.backfillProgress}
              backfillResult={socket.backfillResult}
              backfillFailure={socket.backfillFailure}
            />
          }
        />
      </Routes>
    </div>
  );
}
