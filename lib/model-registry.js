/**
 * THE SMART BOSS AI - Model Registry
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for every NVIDIA NIM model this app can talk to.
 *
 * WHY THIS EXISTS
 *   NVIDIA retires and re-entitles hosted models without warning. When that
 *   happens the API answers:
 *     410 Gone -> "model has been deprecated"
 *     404      -> "Function '<uuid>': Not found for account"
 *   Before this registry those model names were hard-coded in six different
 *   places, so a retirement silently killed the whole fallback chain and every
 *   chat failed with "The configured AI model has been deprecated."
 *
 *   This file keeps the live names in one place, and LEGACY_ALIASES below
 *   transparently rewrites any retired name found in .env or Vercel env vars to
 *   a working replacement, so an old deployment heals itself on the next boot.
 *
 * Every entry was verified live against
 *   GET  https://integrate.api.nvidia.com/v1/models
 *   POST https://integrate.api.nvidia.com/v1/chat/completions
 * on this account. "Entitled" here means the endpoint really returned a
 * completion, not merely that it appears in the public model catalog.
 */

"use strict";


const MODELS = {
  "nvidia/nemotron-3-super-120b-a12b": {
    id: "nvidia/nemotron-3-super-120b-a12b",
    label: "Nemotron 3 Super 120B",
    maxTokens: 16_384,
    vision: false,
    reasoning: true,
    supportsReasoningEffort: true,
    firstTokenBudgetMs: 20_000,
    priority: 1,
    note: "Best all-round: 1.2s first token, full answer in about 7s. Can 503 when busy.",
  },
  "meta/llama-3.2-11b-vision-instruct": {
    id: "meta/llama-3.2-11b-vision-instruct",
    label: "Llama 3.2 11B Vision",
    maxTokens: 4_096,
    vision: true,
    reasoning: false,
    supportsReasoningEffort: false,
    firstTokenBudgetMs: 20_000,
    priority: 2,
    note: "Fastest first token (0.5s) and reads images. Everyday quick chat.",
  },
  "nvidia/nemotron-3-ultra-550b-a55b": {
    id: "nvidia/nemotron-3-ultra-550b-a55b",
    label: "Nemotron 3 Ultra 550B",
    maxTokens: 16_384,
    vision: false,
    reasoning: true,
    supportsReasoningEffort: true,
    firstTokenBudgetMs: 20_000,
    priority: 3,
    note: "Flagship quality. 1.6s first token, about 14s for a long answer.",
  },
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": {
    id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    label: "Nemotron 3 Nano Omni 30B",
    maxTokens: 8_192,
    vision: true,
    reasoning: true,
    supportsReasoningEffort: true,
    firstTokenBudgetMs: 45_000,
    priority: 4,
    note: "Reasoning plus vision, but slow first token (measured 15.9s).",
  },
  "nvidia/nemotron-3.5-lightning-30b-a3b": {
    id: "nvidia/nemotron-3.5-lightning-30b-a3b",
    label: "Nemotron 3.5 Lightning 30B",
    maxTokens: 8_192,
    vision: false,
    reasoning: true,
    supportsReasoningEffort: false,
    firstTokenBudgetMs: 45_000,
    priority: 5,
    note: "Measured 20.7s to first byte and streams a plan first; sanitizer trims it.",
  },
  "z-ai/glm-5.3-flash": {
    id: "z-ai/glm-5.3-flash",
    label: "GLM 5.3 Flash",
    maxTokens: 8_192,
    vision: false,
    reasoning: false,
    supportsReasoningEffort: false,
    firstTokenBudgetMs: 45_000,
    priority: 9,
    note: "Works, but a cold container took 40s to answer. Emergency use only.",
  },
};

/**
 * Retired / not-entitled model id -> live replacement.
 * Covers every name this project has ever shipped, so an existing .env or Vercel
 * environment upgrades itself without the operator editing anything.
 */
const LEGACY_ALIASES = {
  // Shipped defaults from v2.x, all now retired on the hosted endpoint.
  "nvidia/llama-3.1-nemotron-nano-8b-v1": "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/nvidia-nemotron-nano-9b-v2": "nvidia/nemotron-3-super-120b-a12b",
  "mistralai/mistral-medium-3.5-128b": "nvidia/nemotron-3-super-120b-a12b",
  "deepseek-ai/deepseek-v4-flash": "nvidia/nemotron-3-ultra-550b-a55b",
  "deepseek-ai/deepseek-v4-pro": "nvidia/nemotron-3-ultra-550b-a55b",
  "minimaxai/minimax-m2.7": "meta/llama-3.2-11b-vision-instruct",
  // Older names that have appeared in earlier copies of this project.
  "google/gemma-2-2b-it": "meta/llama-3.2-11b-vision-instruct",
  "google/gemma-3n-e4b-it": "meta/llama-3.2-11b-vision-instruct",
  "nvidia/llama3-chatqa-1.5-70b": "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/llama-3.1-nemotron-70b-instruct": "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/llama-3.1-nemotron-ultra-253b-v1": "nvidia/nemotron-3-ultra-550b-a55b",
};

/**
 * Models that show up in GET /v1/models but cannot actually be called with this
 * API key. Measured behaviour, so the fallback chain never wastes seconds:
 *   404 "Function '<uuid>': Not found for account"  -> not entitled
 *   504 after ~300s                                  -> upstream never answers
 *   >120s with no bytes                              -> unusable for chat
 */
const NOT_ENTITLED = new Set([
  "moonshotai/kimi-k2.6",
  "mistralai/mistral-large-2-instruct",
  "mistralai/mistral-large",
  "google/gemma-3-4b-it",
  "google/gemma-3-12b-it",
  "microsoft/phi-3-vision-128k-instruct",
  "nvidia/nemotron-nano-3-30b-a3b",
  "nvidia/llama-3.1-nemotron-51b-instruct",
  "nvidia/nemotron-4-340b-instruct",
  "moonshotai/kimi-k3",
  "deepseek-ai/deepseek-v4.1-flash",
  "deepseek-ai/deepseek-coder-6.7b-instruct",
  "z-ai/glm-5.3",
  "google/gemma-4-31b-it",
  "meta/llama-3.2-90b-vision-instruct",
]);

const DEFAULT_CHAT_MODEL = "nvidia/nemotron-3-super-120b-a12b";
const DEFAULT_VISION_MODEL = "meta/llama-3.2-11b-vision-instruct";

/** Resolve one model id, rewriting any retired name to a live replacement. */
function resolveModelId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return LEGACY_ALIASES[raw] || raw;
}

/** Resolve and de-duplicate a comma or newline separated model list. */
function resolveModelList(value) {
  const out = [];
  for (const item of String(value ?? "").split(/[,\n]+/)) {
    const resolved = resolveModelId(item);
    if (resolved && !out.includes(resolved)) out.push(resolved);
  }
  return out;
}

/** Registry entry for a model, or null for unknown ids. */
function getModelSpec(value) {
  return MODELS[resolveModelId(value)] || null;
}

function isKnownModel(value) {
  return Boolean(getModelSpec(value));
}

function isVisionCapable(value) {
  return Boolean(getModelSpec(value)?.vision);
}

function getMaxTokens(value, fallback = 4_096) {
  return getModelSpec(value)?.maxTokens ?? fallback;
}

/** True when a model is known to be uncallable on this account. */
function isKnownUnentitled(value) {
  return NOT_ENTITLED.has(resolveModelId(value));
}

/** Registry models ordered by priority, optionally vision-capable only. */
function listModels({ visionOnly = false } = {}) {
  return Object.values(MODELS)
    .filter((spec) => (visionOnly ? spec.vision : true))
    .sort((a, b) => a.priority - b.priority);
}

/** Ordered ids used as the last-resort chain when nothing else works. */
function defaultChain({ visionOnly = false } = {}) {
  return listModels({ visionOnly }).map((spec) => spec.id);
}

module.exports = {
  MODELS,
  LEGACY_ALIASES,
  NOT_ENTITLED,
  DEFAULT_CHAT_MODEL,
  DEFAULT_VISION_MODEL,
  resolveModelId,
  resolveModelList,
  getModelSpec,
  isKnownModel,
  isVisionCapable,
  getMaxTokens,
  isKnownUnentitled,
  listModels,
  defaultChain,
};

