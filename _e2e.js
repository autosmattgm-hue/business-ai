"use strict";

// Throwaway end-to-end checker. Spawns its own dev server, runs the scenarios
// below against it, prints timings, then shuts it down.
// Usage: node _e2e.js [chat|vision|retired|all]

const { spawn } = require("child_process");

const PORT = Number(process.env.TEST_PORT || 3111);
const BASE = `http://127.0.0.1:${PORT}`;
const scenarioArg = process.argv[2] || "all";

const SCENARIOS = {
  chat: {
    label: "default chat (no model chosen)",
    body: {
      message: "Give me 3 fast ways a 3-person design studio can add $5k/month. Be direct.",
      mode: "business",
    },
  },
  vision: {
    label: "vision profile with an https image",
    body: {
      message: "What is in this image? Answer in one sentence.",
      mode: "business",
      model: "vision",
      images: [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/480px-Cat03.jpg",
      ],
    },
  },
  retired: {
    label: "explicit model + reasoning_effort path",
    body: {
      message: "Reply with exactly: SELF-HEAL-OK",
      mode: "voice",
      model: "nemotron-super",
    },
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
      const json = await res.json();
      console.log(`health ${res.status} model=${json.model} fallbacks=${(json.fallbackModels || []).length}`);
      return true;
    } catch (_) {
      await sleep(500);
    }
    if (child.exitCode !== null) {
      console.log(`server exited early with code ${child.exitCode}`);
      return false;
    }
  }
  return false;
}

async function consumeSse(res, t0) {
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = "";
  let text = "";
  let firstTokenMs = 0;
  let sseError = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let index = buffer.indexOf("\n");
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");

      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      try {
        const event = JSON.parse(payload);
        if (event.token) {
          if (!firstTokenMs) firstTokenMs = Date.now() - t0;
          text += event.token;
        }
        if (event.error) sseError += event.error;
      } catch (_) {
        /* partial frame */
      }
    }
  }

  return { text, firstTokenMs, sseError };
}

async function runScenario(key) {
  const { label, body } = SCENARIOS[key];
  const t0 = Date.now();

  let res;
  try {
    res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.log(`FAIL [${key}] ${label}: ${error.message}`);
    return false;
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const raw = (await res.text()).slice(0, 400);
    console.log(`FAIL [${key}] ${label}: HTTP ${res.status} ${raw}`);
    return false;
  }

  const { text, firstTokenMs, sseError } = await consumeSse(res, t0);
  const ok = Boolean(text.trim()) && !sseError;

  console.log(
    `${ok ? "PASS" : "FAIL"} [${key}] ${label} :: first-token=${firstTokenMs}ms total=${Date.now() - t0}ms chars=${text.length}`,
  );
  if (sseError) console.log(`     provider error: ${sseError}`);
  console.log(`     ${text.slice(0, 220).replace(/\s+/g, " ") || "(empty)"}${text.length > 220 ? "…" : ""}`);

  return ok;
}

async function main() {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "ignore", "pipe"],
  });

  let serverLog = "";
  child.stderr.on("data", (chunk) => {
    serverLog += chunk.toString();
    if (serverLog.length > 4000) serverLog = serverLog.slice(-4000);
  });

  try {
    if (!(await waitForServer(child))) {
      console.log("server never became healthy\n" + serverLog);
      return 1;
    }

    const keys = scenarioArg === "all" ? Object.keys(SCENARIOS) : [scenarioArg];
    const results = [];
    for (const key of keys) results.push(await runScenario(key));

    return results.every(Boolean) ? 0 : 1;
  } finally {
    child.kill();
  }
}

main().then((code) => {
  console.log(code === 0 ? "ALL SCENARIOS PASSED" : "SOME SCENARIOS FAILED");
  process.exit(code);
});
