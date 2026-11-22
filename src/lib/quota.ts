/**
 * The project runs on OpenRouter's free models only. Free models are capped per account per day
 * (50 requests on this key), so every draft checks the remaining quota before calling a model.
 */
export type FreeQuota = { used: number; limit: number; remaining: number };

let memo: { at: number; value: FreeQuota | null } | null = null;

/** Remaining free-model requests today. Returns null if OpenRouter doesn't report it. Not counted against the quota. */
export async function getFreeQuota(opts: { fresh?: boolean } = {}): Promise<FreeQuota | null> {
  if (!opts.fresh && memo && Date.now() - memo.at < 15_000) return memo.value;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return null;
    const q = (await res.json())?.data?.free_model_daily_requests;
    const value =
      q && typeof q.remaining === "number" ? { used: q.used ?? 0, limit: q.limit ?? 0, remaining: q.remaining } : null;
    memo = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}

/** Call after spending requests so the next read isn't stale. */
export function invalidateQuota() {
  memo = null;
}

export class QuotaExhaustedError extends Error {
  constructor(public quota: FreeQuota) {
    super(
      `Today's free OpenRouter requests are used up (${quota.used}/${quota.limit}). The daily limit resets at midnight UTC.`,
    );
    this.name = "QuotaExhaustedError";
  }
}
