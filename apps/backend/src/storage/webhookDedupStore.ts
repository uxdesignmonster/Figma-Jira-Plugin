/**
 * Short-lived cache of webhook delivery ids (or synthetic keys) so Jira's
 * at-least-once delivery doesn't double-mark widgets stale. Entries expire
 * after `ttlMs`; memory use is bounded by `maxEntries` via FIFO eviction.
 */
export class WebhookDedupStore {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly maxEntries = 2000,
  ) {}

  /** @returns true if this is a new event, false if already seen. */
  record(id: string): boolean {
    this.sweep();
    if (this.seen.has(id)) return false;
    if (this.seen.size >= this.maxEntries) {
      // Drop oldest entry (Map preserves insertion order).
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.set(id, Date.now());
    return true;
  }

  private sweep(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(id);
      else break; // Map is insertion-ordered; remaining entries are newer.
    }
  }
}
