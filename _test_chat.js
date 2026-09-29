"use strict";

// Throwaway end-to-end checker for the local dev server (see package.json start).
// Usage: node _test_chat.js chat|vision|retired

const BASE = process.env.BASE || "http://127.0.0.1:3010";
const scenario = process.argv[2] || "chat";

const SCENARIOS = {
  chat: {
    message:
      "Give me 3 fast ways a 3-person design studio can add $5k/month. Be direct.",
    mode: "business",
  },
  vision: {
    message: "What is in this image? Answer in one sentence.",
    mode: "business",
    model: "vision",
    images: [
      "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/480px-Cat03.jpg",
    ],
  },
  // A retired id must be auto-healed by lib/model-registry.js, not 410'd.
  retired: {
    message: "Reply with exactly: SELF-HEAL-OK",
    mode: "voice",
    model: "nemotron-super",
  },
};

async function consumeSse(res, t0) {
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = "";
  let text = "";
  let firstByteAt = 0;
  let sseError = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");

      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      try {
        const event = JSON.parse(payload);
        if (event.token) {
          if (!firstByteAt) firstByteAt = Date.now() - t0;
          text += event.token;
        }
        if (event.error) sseError += event.error;
      } catch (_) {
        // partial frame — ignore
      }
    }
  }

  return { text, firstByteAt, sseError };
}

async function main() {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(SCENARIOS[scenario]),
  });

  const contentType = res.headers.get("content-type") || "";
  console.log(`[${scenario}] HTTP ${res.status} ${contentType}`);

  if (!contentType.includes("text/event-stream")) {
    console.log(`  body: ${(await res.text()).slice(0, 600)}`);
    return;
  }

  const { text, firstByteAt, sseError } = await consumeSse(res, t0);
  console.log(
    `  first-token=${firstByteAt}ms  total=${Date.now() - t0}ms  chars=${text.length}`,
  );
  if (sseError) console.log(`  SSE ERROR: ${sseError}`);
  console.log(`  text: ${text.slice(0, 320).replace(/\s+/g, " ")}`);
}

main().catch((error) => {
  console.error(`[${scenario}] FAILED:`, error.message);
  process.exitCode = 1;
});
