// DEVELOPMENT-ONLY rough AI cost estimation for the diagnostics panel.
//
// These are coarse, configurable constants — NOT billing data and NOT shown to
// customers. They exist so a developer can sanity-check the cost of the single
// vision fallback call. Update the per-model rates as provider pricing changes.
//
// No statement content is involved here — only token COUNTS and a model name.

export type ModelPricing = {
  /** USD per 1,000,000 input (prompt) tokens. */
  inputPer1M: number;
  /** USD per 1,000,000 output (completion) tokens. */
  outputPer1M: number;
};

/** Per-model rough rates (USD / 1M tokens). Dev estimate only — keep current-ish. */
export const AI_MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-5.4-mini": { inputPer1M: 0.25, outputPer1M: 2.0 },
};

/** Fallback rates used when the selected model is not in the table above. */
export const DEFAULT_MODEL_PRICING: ModelPricing = { inputPer1M: 0.5, outputPer1M: 2.0 };

export type AiCostEstimate = {
  /** True only when input AND output token counts were available. */
  available: boolean;
  /** Estimated USD cost, or null when an exact estimate is not possible. */
  usd: number | null;
  /** Safe human-readable note (never contains statement content). */
  note: string;
};

/**
 * Estimate the cost of one AI call from token counts. Requires BOTH input and
 * output token counts for an exact figure (these are only populated when the
 * provider-meta debug flag is on). With only a total, returns an explicit
 * "unavailable" note rather than guessing the input/output split.
 */
export function estimateAiCost(
  model: string | null,
  inputTokens: number | null,
  outputTokens: number | null,
  totalTokens: number | null,
): AiCostEstimate {
  if (typeof inputTokens === "number" && typeof outputTokens === "number") {
    const known = model ? AI_MODEL_PRICING[model] : undefined;
    const pricing = known ?? DEFAULT_MODEL_PRICING;
    const usd = (inputTokens / 1_000_000) * pricing.inputPer1M + (outputTokens / 1_000_000) * pricing.outputPer1M;
    return {
      available: true,
      usd: Math.round(usd * 1_000_000) / 1_000_000,
      note: known ? `model ${model}` : "default pricing (model not in table)",
    };
  }
  if (typeof totalTokens === "number") {
    return { available: false, usd: null, note: "exact estimate unavailable — total tokens only" };
  }
  return { available: false, usd: null, note: "no token counts available" };
}

/** Format a USD estimate for display (dev only). */
export function formatUsd(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  return `$${usd.toFixed(4)}`;
}
