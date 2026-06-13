import { z } from "zod";

const tradingModeSchema = z.enum(["PAPER", "LIVE"]).default("PAPER");

const envSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    TRADING_MODE: tradingModeSchema,
    ALPACA_PAPER_API_KEY: z.string().default(""),
    ALPACA_PAPER_SECRET_KEY: z.string().default(""),
    ALPACA_LIVE_API_KEY: z.string().default(""),
    ALPACA_LIVE_SECRET_KEY: z.string().default(""),
    ALPACA_API_BASE_URL: z
      .string()
      .url()
      .default("https://paper-api.alpaca.markets"),
    LLM_API_BASE_URL: z
      .string()
      .url()
      .default("http://localhost:11434/v1"),
    LLM_MODEL: z.string().default("llama3.2"),
    LLM_API_KEY: z.string().default("ollama"),
    SEC_USER_AGENT: z
      .string()
      .default("WhaleWatch_LocalBot admin@example.com"),
    MAX_DAILY_DRAWDOWN_PCT: z.coerce.number().positive().max(100).default(5),
    MAX_POSITION_SIZE_PCT: z.coerce.number().positive().max(100).default(20),
    MAX_CONSECUTIVE_LLM_FAILURES: z.coerce.number().int().positive().default(3),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(3001),
    FRONTEND_URL: z.string().url().default("http://localhost:5173"),
    API_SECRET_KEY: z.string().default(""),
    SEC_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
    SEC_WATCH_TICKERS: z.string().default(""),
    SLIPPAGE_BPS: z.coerce.number().nonnegative().max(10_000).default(10),
    HISTORICAL_DATA_CACHE_DIR: z.string().default(".cache/historical-data"),
  })
  .refine(
    (env) =>
      env.TRADING_MODE !== "LIVE" ||
      (env.ALPACA_LIVE_API_KEY.length > 0 &&
        env.ALPACA_LIVE_SECRET_KEY.length > 0),
    {
      message:
        "ALPACA_LIVE_API_KEY and ALPACA_LIVE_SECRET_KEY are required when TRADING_MODE=LIVE",
      path: ["ALPACA_LIVE_API_KEY"],
    },
  );

export type TradingMode = z.infer<typeof tradingModeSchema>;
export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

export function loadEnv(overrides?: Record<string, string | undefined>): Env {
  if (cachedEnv && !overrides) {
    return cachedEnv;
  }

  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }

  if (!overrides) {
    cachedEnv = parsed.data;
  }

  return parsed.data;
}

export function getAlpacaCredentials(env: Env): {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
} {
  if (env.TRADING_MODE === "LIVE") {
    return {
      apiKey: env.ALPACA_LIVE_API_KEY,
      secretKey: env.ALPACA_LIVE_SECRET_KEY,
      baseUrl: "https://api.alpaca.markets",
    };
  }

  return {
    apiKey: env.ALPACA_PAPER_API_KEY,
    secretKey: env.ALPACA_PAPER_SECRET_KEY,
    baseUrl: env.ALPACA_API_BASE_URL,
  };
}

export function parseWatchTickers(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
}
