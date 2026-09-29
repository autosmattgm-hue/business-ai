/**
 * THE SMART BOSS AI — Provider HTTP transport
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS (measured, not guessed)
 *
 * Node's built-in fetch() is undici, and undici enforces a 10s *connect*
 * timeout on every brand-new TLS connection. An aborted request also destroys
 * its socket, so a fallback chain that aborts slow models pays for a fresh TLS
 * handshake on every single attempt.
 *
 * Live measurement against https://integrate.api.nvidia.com on this account:
 *   GET /v1/models on a warm keep-alive socket ....  120 -  545 ms
 *   raw TLS handshake ............................  235 -  264 ms
 *   chat completions needing a NEW socket ........ 4.1s - 19s  (often > 10s)
 *   → fetch threw "TypeError: fetch failed", cause UND_ERR_CONNECT_TIMEOUT
 *
 * Result: every model in the chain died before it was ever tried and the user
 * saw "The AI service could not be reached". A persistent keep-alive agent plus
 * explicit, generous phase timeouts removes that whole class of failure.
 *
 * Timeouts this module owns (all overridable through env):
 *   SMARTBOSS_CONNECT_TIMEOUT_MS     DNS + TCP + TLS handshake  (default 20000)
 *   SMARTBOSS_RESPONSE_HEADER_MS     wait for response headers  (default 45000)
 *   SMARTBOSS_STREAM_IDLE_MS         gap between streamed bytes (default 45000)
 *
 * The call resolves to a standard web Response, so the rest of the code base
 * keeps using response.ok / response.status / response.text() / response.body.
 */

"use strict";

const https = require("node:https");
const http = require("node:http");
const { URL } = require("node:url");

function positiveInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.min(Math.max(safe, min), max);
}

const CONNECT_TIMEOUT_MS = positiveInt(
  process.env.SMARTBOSS_CONNECT_TIMEOUT_MS,
  20_000,
  2_000,
  120_000,
);

const HEADER_TIMEOUT_MS = positiveInt(
  process.env.SMARTBOSS_RESPONSE_HEADER_MS,
  45_000,
  5_000,
  300_000,
);

const STREAM_IDLE_MS = positiveInt(
  process.env.SMARTBOSS_STREAM_IDLE_MS,
  45_000,
  5_000,
  300_000,
);

// One agent for the whole process: sockets are reused, so every chat after the
// first one skips the TLS handshake entirely.
const agent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 12,
  maxFreeSockets: 4,
  scheduling: "lifo",
  timeout: STREAM_IDLE_MS,
});

const SOCKET_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "ERR_SSL_PROTOCOL_ERROR",
]);

/** Error type the chat service recognises as "the wire failed, try again". */
class TransportError extends Error {
  constructor(message, code, phase) {
    super(message);
    this.name = "TransportError";
    this.code = code || "ETIMEDOUT";
    this.phase = phase || "transport"; // connect | headers | stream | config
    this.transport = true;
    this.retryable = true;
  }
}

/** Error the chat service already understands as "our own deadline fired". */
function makeAbortError() {
  const error = new Error("The AI request was cancelled.");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

function describeSocketError(error) {
  const code = error?.code || "";
  if (code === "ECONNRESET" || code === "EPIPE") {
    return "The AI provider closed the connection while the request was in flight";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "The AI provider host name could not be resolved";
  }
  if (code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ENETUNREACH") {
    return "The AI provider could not be reached from this network";
  }
  return `The connection to the AI provider failed (${code || error?.message || "unknown error"})`;
}


/** Wrap a Node IncomingMessage in a web Response, with an idle guard. */
function toResponse(res, req) {
  const stream = new ReadableStream({
    start(controller) {
      res.on("data", (chunk) => {
        controller.enqueue(new Uint8Array(chunk));
        if (controller.desiredSize !== null && controller.desiredSize <= 0) res.pause();
      });
      res.once("end", () => controller.close());
      res.once("error", (error) => controller.error(error));
    },
    pull() {
      res.resume();
    },
    cancel() {
      res.destroy();
    },
  });

  // Streaming phase guard: a model that goes quiet after the first token used
  // to hang the request until the platform killed the function.
  res.socket?.setTimeout(STREAM_IDLE_MS, () => {
    const error = new TransportError(
      "The AI model stopped sending data mid-answer",
      "ESTREAMIDLE",
      "stream",
    );
    res.destroy(error);
    req.destroy(error);
  });

  const headers = new Headers();
  for (const [key, value] of Object.entries(res.headers || {})) {
    if (value === undefined) continue;
    headers.append(key, Array.isArray(value) ? value.join(", ") : String(value));
  }

  return new Response(stream, {
    status: res.statusCode || 502,
    statusText: res.statusMessage || "",
    headers,
  });
}

/**
 * POST a JSON payload and resolve with a web Response as soon as headers land.
 *
 * @param {object} options
 * @param {string} options.url                Absolute http(s) URL.
 * @param {object} [options.headers]          Extra request headers.
 * @param {object} options.payload            JSON-serialisable body.
 * @param {AbortSignal} [options.signal]      Caller-owned cancellation.
 * @param {number} [options.headersTimeoutMs] Per-request header budget.
 * @returns {Promise<Response>}
 */
function postJson({ url, headers = {}, payload, signal, headersTimeoutMs = 0 }) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(new TransportError("The AI provider URL is invalid.", "EINVALIDURL", "config"));
      return;
    }

    if (target.protocol !== "https:" && target.protocol !== "http:") {
      reject(new TransportError("The AI provider URL must use https.", "EINVALIDURL", "config"));
      return;
    }

    const body = Buffer.from(JSON.stringify(payload ?? {}), "utf8");
    const transport = target.protocol === "https:" ? https : http;
    const isSecure = target.protocol === "https:";
    let settled = false;
    let headersTimer = null;

    const req = transport.request({
      agent: isSecure ? agent : undefined,
      hostname: target.hostname,
      port: target.port || (isSecure ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: "POST",
      servername: isSecure ? target.hostname : undefined,
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        "Content-Length": body.length,
        ...headers,
      },
    });

    const settle = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (headersTimer) clearTimeout(headersTimer);
      if (signal) signal.removeEventListener("abort", onAbort);
      fn(arg);
    };

    const rejectWith = (error) => {
      settle(reject, error);
      req.destroy();
    };

    function onAbort() {
      rejectWith(makeAbortError());
    }

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    // Header phase budget. The socket timer set on "socket" covers a handshake
    // that never completes; this one covers a server that completes the TLS
    // handshake and then never answers the request.
    const headerBudget = positiveInt(
      headersTimeoutMs || HEADER_TIMEOUT_MS,
      HEADER_TIMEOUT_MS,
      1_000,
      600_000,
    );
    headersTimer = setTimeout(() => {
      rejectWith(new TransportError(
        `The AI provider did not answer within ${Math.round(headerBudget / 1_000)}s.`,
        "EHEADERTIMEOUT",
        "headers",
      ));
    }, headerBudget);

    req.on("socket", (socket) => {
      socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
        rejectWith(new TransportError(
          `Connecting to the AI provider took longer than ${Math.round(CONNECT_TIMEOUT_MS / 1_000)}s.`,
          "ECONNECTTIMEOUT",
          "connect",
        ));
      });
    });

    req.on("response", (res) => {
      if (settled) {
        res.resume();
        return;
      }
      res.socket?.setTimeout(0); // toResponse() installs the idle guard
      settle(resolve, toResponse(res, req));
    });

    req.on("error", (error) => {
      if (error?.name === "AbortError" || signal?.aborted) {
        rejectWith(makeAbortError());
        return;
      }
      if (error instanceof TransportError) {
        rejectWith(error);
        return;
      }
      const code = error?.code || "";
      rejectWith(SOCKET_ERROR_CODES.has(code)
        ? new TransportError(describeSocketError(error), code, "connect")
        : new TransportError(
          `The connection to the AI provider failed (${error?.message || "unknown error"})`,
          code || "EREQUEST",
          "connect",
        ));
    });

    req.write(body);
    req.end();
  });
}

module.exports = {
  postJson,
  TransportError,
  TIMEOUTS: {
    connectMs: CONNECT_TIMEOUT_MS,
    headerMs: HEADER_TIMEOUT_MS,
    streamIdleMs: STREAM_IDLE_MS,
  },
  agent,
};
