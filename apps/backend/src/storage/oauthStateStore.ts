import { randomBytes } from "node:crypto";

type StateEntry = { installationId: string; expiresAt: number };

/**
 * Short-lived mapping from OAuth `state` → installationId. Entries are
 * single-use and expire after the TTL to limit replay.
 */
export class OAuthStateStore {
  private readonly store = new Map<string, StateEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = 10 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  create(installationId: string): string {
    const state = randomBytes(24).toString("hex");
    this.store.set(state, {
      installationId,
      expiresAt: Date.now() + this.ttlMs,
    });
    return state;
  }

  consume(state: string): string | null {
    const entry = this.store.get(state);
    if (!entry) return null;
    this.store.delete(state);
    if (entry.expiresAt < Date.now()) return null;
    return entry.installationId;
  }
}
