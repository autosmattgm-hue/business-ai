/**
 * THE SMART BOSS AI — Image ingest for the vision profile
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS (measured, not guessed)
 *
 * The hosted NVIDIA endpoint is told to fetch image URLs itself, and on this
 * account that fetch is unreliable. Live measurement against
 * meta/llama-3.2-11b-vision-instruct:
 *
 *   https image URL (Wikimedia) ...... HTTP 500 "Internal Server Error" in 769ms
 *   data:image/png;base64,... ........ HTTP 200, correct answer in 6.5s
 *
 * So a URL the user can open perfectly well in a browser can still fail, and
 * the user sees "The AI service is temporarily unavailable". Base64 payloads,
 * which every file upload naturally produces, work fine — yet extractImageUrls()
 * used to reject them outright.
 *
 * This module turns every accepted image source into a base64 data URL before
 * the request leaves the app:
 *   data:image/...;base64,...  → validated, passed through untouched
 *   https://...                → downloaded here (size + time capped) and encoded
 *
 * If a download fails, the original URL is passed through unchanged so the
 * provider still gets a chance — a broken link is never a hard failure here.
 */

"use strict";

const MAX_IMAGE_BYTES = Math.min(
  Number.parseInt(process.env.SMARTBOSS_MAX_IMAGE_BYTES, 10) || 3_000_000,
  12_000_000,
);

const DOWNLOAD_TIMEOUT_MS = Math.min(
  Number.parseInt(process.env.SMARTBOSS_IMAGE_DOWNLOAD_TIMEOUT_MS, 10) || 15_000,
  60_000,
);

// Formats the hosted vision models on this account accept.
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

const DATA_URL_PATTERN = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i;

function describeSize(bytes) {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

/** Approximate decoded byte size of a base64 payload (no decoding needed). */
function base64DecodedBytes(base64) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function isAcceptableMimeType(mimeType) {
  const normalized = String(mimeType || "").split(";")[0].trim().toLowerCase();
  return ALLOWED_MIME_TYPES.has(normalized) ? normalized : null;
}

/**
 * One image source → { url, note }. `url` is always usable by the provider;
 * `note` explains anything we had to work around or give up on.
 */
async function inlineImage(source) {
  const raw = String(source ?? "").trim();
  if (!raw) return null;

  const dataUrlMatch = DATA_URL_PATTERN.exec(raw);
  if (dataUrlMatch) {
    const mimeType = isAcceptableMimeType(dataUrlMatch[1]);
    if (!mimeType) {
      return {
        url: raw,
        note: `Attached images must be JPEG, PNG, WEBP, GIF or BMP — got ${dataUrlMatch[1]}.`,
      };
    }
    const bytes = base64DecodedBytes(dataUrlMatch[2]);
    if (bytes > MAX_IMAGE_BYTES) {
      return {
        url: "",
        note: `That image is ${describeSize(bytes)} — the AI provider accepts at most ${describeSize(MAX_IMAGE_BYTES)} per image.`,
      };
    }
    return { url: raw, note: "" };
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return { url: "", note: "Attached image is not a valid https:// link or base64 image." };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { url: "", note: "Attached images must use https:// links." };
  }

  let response;
  try {
    response = await fetch(raw, {
      redirect: "follow",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: { Accept: "image/webp,image/*,*/*;q=0.8" },
    });
  } catch (error) {
    // The provider may still reach it even if we cannot.
    return {
      url: raw,
      note: `Could not download the attached image (${error?.name === "TimeoutError" ? "it timed out" : error?.message || "connection error"}) — passing the link to the AI provider instead.`,
    };
  }

  if (!response.ok) {
    return {
      url: raw,
      note: `The attached image link returned HTTP ${response.status} — passing the link to the AI provider instead.`,
    };
  }

  const declaredType = isAcceptableMimeType(response.headers.get("content-type"));
  if (!declaredType) {
    return {
      url: raw,
      note: `The attached link is not an image (${response.headers.get("content-type") || "unknown type"}) — passing the link to the AI provider instead.`,
    };
  }

  const declaredLength = Number.parseInt(response.headers.get("content-length") || "0", 10);
  if (declaredLength > MAX_IMAGE_BYTES) {
    return {
      url: "",
      note: `That image is ${describeSize(declaredLength)} — the AI provider accepts at most ${describeSize(MAX_IMAGE_BYTES)} per image.`,
    };
  }

  let buffer;
  try {
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    return {
      url: raw,
      note: `Could not read the attached image (${error?.message || "connection error"}) — passing the link to the AI provider instead.`,
    };
  }

  if (!buffer.length) return { url: "", note: "The attached image link came back empty." };

  if (buffer.length > MAX_IMAGE_BYTES) {
    return {
      url: "",
      note: `That image is ${describeSize(buffer.length)} — the AI provider accepts at most ${describeSize(MAX_IMAGE_BYTES)} per image.`,
    };
  }

  // The link's own content-type wins over whatever the URL suffix suggests.
  return { url: `data:${declaredType};base64,${buffer.toString("base64")}`, note: "" };
}

/**
 * Converts an image list into provider-safe sources.
 *
 * @param {unknown} images Array (or single value) of https URLs / data URLs.
 * @param {{ maxImages?: number }} [options]
 * @returns {Promise<{ images: string[], notes: string[], rejected: string[] }>}
 */
async function inlineImages(images, options = {}) {
  const maxImages = options.maxImages || Number.POSITIVE_INFINITY;
  const list = (Array.isArray(images) ? images : [images])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, maxImages);

  const urls = [];
  const notes = [];
  const rejected = [];

  const results = await Promise.all(list.map((item) => inlineImage(item)));

  for (const result of results) {
    if (!result) continue;
    if (result.note && !result.url) {
      rejected.push(result.note);
      continue;
    }
    if (result.note) notes.push(result.note);
    if (result.url && !urls.includes(result.url)) urls.push(result.url);
  }

  return { images: urls, notes, rejected };
}

module.exports = {
  inlineImages,
  inlineImage,
  isAcceptableMimeType,
  DATA_URL_PATTERN,
  LIMITS: {
    maxImageBytes: MAX_IMAGE_BYTES,
    downloadTimeoutMs: DOWNLOAD_TIMEOUT_MS,
    allowedTypes: Array.from(ALLOWED_MIME_TYPES),
  },
};

