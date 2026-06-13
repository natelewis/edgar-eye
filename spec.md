# Project Specification: Alpha-Reasoning Event-Driven Trading Bot

## Core Overview
Build a high-performance, modular, event-driven quantitative trading system in a TypeScript/Node.js monorepo workspace. The system utilizes a local Large Language Model (LLM) running via an OpenAI-compatible server (Ollama/llama.cpp) to read corporate disclosures (SEC 8-K filings) and execute high-conviction trades.

---

## Technical Architecture

### 1. Database & Persistence Layer (`packages/database`)
- Implement a Dockerized PostgreSQL configuration (`docker-compose.yml`) containing an instance named `alpha_trading_db`.
- **CRITICAL:** Enable the `pgvector` extension in the PostgreSQL Docker image to future-proof the system for RAG (Retrieval-Augmented Generation).
- Configure Prisma with the following schema models:
  - `DocumentLog`: Stores ingested SEC documents (`source`, `ticker`, `title`, `rawText`, `cleanedText`).
  - `DocumentEmbedding`: Stores vector embeddings of `cleanedText` using `pgvector` for future contextual retrieval.
  - `AnalysisReport`: Contains structured LLM output (`decision`, `confidence`, `reasoning`, `tokenCount`, `latencyMs` for observability).
  - `TradeLog`: Tracks paper/live trades.
  - `BacktestRun` & `BacktestTrade`: Tracks simulated historical runs.

### 2. The Pluggable Broker Abstraction & Risk Guardrails
Define a unified `IBrokerService` exposing `getBuyingPower()` and `executeOrder()`.
- **`AlpacaService`**: Implements the interface. It must strictly monitor the new dynamic `buying_power` metric (Intraday Margin Framework) and catch pre-trade capital rejections gracefully.
- **`MockBrokerService`**: Implements the interface for backtests, pulling historical candlestick data from Alpaca to simulate instant, slippage-adjusted fills.
- **Environment Toggles (`env.ts`)**: Implement strict `zod` validation. `TRADING_MODE` must be typed as `'PAPER' | 'LIVE'`. Default to `'PAPER'`. The `AlpacaService` must dynamically route API keys based on this variable.
- **Circuit Breaker Module**: Implement a `RiskManager` middleware that intercepts all orders. It must block orders if: (a) Maximum daily drawdown exceeds 5%, (b) Position sizing exceeds 20% of current buying power, or (c) Consecutive LLM failures occur.

### 3. The Ingestion Engine & Latency Protocols
- **Live Ingestion Engine**: Implements high-speed live polling against the SEC EDGAR system using an Accession Number Prediction loop to bypass RSS latency. Enforce a rate limit of <10 requests/sec. Include the HTTP Header: `User-Agent: WhaleWatch_LocalBot admin@example.com`.
- **HTML Stripper**: Build a robust utility using `cheerio` and regex to strip all HTML/XBRL tags from the raw SEC text, returning only the clean narrative paragraphs.
- **Backtest Ingestion Engine**: Reads sequential historical entries from the PostgreSQL database and streams them to the LLM.

### 4. Local Inference Interface (`LLMService`)
- Create an abstraction layer utilizing standard OpenAI SDK architecture pointing to `process.env.LLM_API_BASE_URL` (defaulting to Ollama's local address).
- Enforce strict JSON structured outputs from the LLM, instructing it to evaluate corporate structural changes and output `{"action": "BUY"|"SELL"|"HOLD", "confidence": number, "reasoning": string}`.

---

## Frontend Dashboard Requirements (`apps/frontend`)

Build an interactive React + Vite + Tailwind CSS dashboard.
- **Theme**: Strict Dark Mode.
- **State**: Use WebSockets for real-time streaming from the Node backend.
- **Layout Modules**:
  1. **Header Panel**: System status, LLM inference latency, active Account Equity, and Buying Power. **Must display a prominent green "PAPER" or pulsating red "LIVE" badge based on the backend environment toggle.**
  2. **Live Activity Ticker**: A scrolling feed of ingested documents and the LLM’s real-time reasoning matrix.
  3. **Order Control Matrix**: Displays active positions and execution logs (including trades blocked by the `RiskManager` or Alpaca margin limits).
  4. **Backtesting Control Center (`/backtesting`)**: A dedicateview to run historical simulations, plot equity curves, and review the historical reasoning transcripts for prompt-tuning.

---

## Step-by-Step Implementation Instructions for Cursor
1. Scaffold the workspace directories and create the root `.env` configuration template.
2. Generate the Docker Compose file (with `pgvector`) and establish the Prisma schema.
3. Code the unified `IBrokerService`, environment validation, and `RiskManager` circuit breakers.
4. Build the core `LLMService` and the SEC Ingestion processors (with the HTML stripper and URL prediction logic).
5. Code the React interface client, verifying dark-mode styling, environment badges, and WebSocket connections.
