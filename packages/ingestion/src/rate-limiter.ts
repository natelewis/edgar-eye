export class RateLimiter {
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(maxRequestsPerSecond: number) {
    this.minIntervalMs = Math.ceil(1000 / maxRequestsPerSecond);
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const now = Date.now();
      const elapsed = now - this.lastRequestAt;
      if (elapsed < this.minIntervalMs) {
        await sleep(this.minIntervalMs - elapsed);
      }
      this.lastRequestAt = Date.now();
      return fn();
    };

    const result = this.queue.then(run, run);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
