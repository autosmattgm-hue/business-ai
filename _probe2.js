const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
const KEY = env.split(/\r?\n/).find((l) => l.startsWith("NVIDIA_API_KEY=")).slice(15).trim();
const API = "https://integrate.api.nvidia.com/v1/chat/completions";
const OUT = path.join(__dirname, "_probe2_out.txt");

function log(s) { fs.appendFileSync(OUT, s + "\n"); }

// Models that hung in the parallel batch — retest SERIALLY with a generous timeout.
const suspects = [
  "moonshotai/kimi-k3",
  "deepseek-ai/deepseek-v4.1-flash",
  "z-ai/glm-5.3",
  "z-ai/glm-5.3-flash",
  "openai/gpt-oss-20b",
  "google/gemma-4-31b-it",
  "meta/llama-3.2-90b-vision-instruct",
];

async function probe(model, timeoutMs) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(API, {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        max_tokens: 64,
        temperature: 0,
        stream: false,
      }),
    });
    clearTimeout(timer);
    const txt = await res.text();
    let note = "";
    if (res.ok) {
      try { const j = JSON.parse(txt); note = "content=" + JSON.stringify(j.choices?.[0]?.message?.content ?? "").slice(0, 50); } catch {}
    } else note = "|| " + txt.replace(/\s+/g, " ").slice(0, 100);
    return `${res.ok ? "PASS" : "FAIL"} ${String(res.status).padEnd(4)} ${String(Date.now() - t0).padStart(6)}ms  ${model.padEnd(38)} ${note}`;
  } catch (e) {
    return `FAIL ERR  ${String(Date.now() - t0).padStart(6)}ms  ${model.padEnd(38)} || ${e.name}`;
  }
}

// Streaming latency (time-to-first-byte) for the confirmed winners.
const streamCandidates = [
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "meta/llama-3.2-11b-vision-instruct",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
];

(async () => {
  fs.writeFileSync(OUT, "=== SERIAL RETEST OF TIMED-OUT MODELS (120s cap) ===\n");
  for (const m of suspects) log(await probe(m, 120000));

  log("\n=== TIME TO FIRST BYTE (stream:true, real business prompt) ===");
  for (const m of streamCandidates) {
    const t0 = Date.now();
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          model: m,
          messages: [
            { role: "system", content: "You are a blunt business advisor. Answer in short paragraphs." },
            { role: "user", content: "I run a 3-person web design studio in Lagos. How do I raise prices without losing clients? Give 5 concrete steps." },
          ],
          max_tokens: 700, temperature: 0.5, top_p: 0.85, stream: true,
        }),
      });
      let ttfb = 0, raw = "", tokens = 0;
      for await (const c of res.body) {
        const s = Buffer.from(c).toString();
        if (!ttfb && /"content":/.test(s)) ttfb = Date.now() - t0;
        raw += s;
        tokens += (s.match(/data: /g) || []).length;
      }
      const finish = (raw.match(/"finish_reason":"(\w+)"/) || [])[1] || "?";
      log(`${res.status} ttfb=${String(ttfb).padStart(5)}ms total=${String(Date.now() - t0).padStart(6)}ms chunks=${String(tokens).padStart(4)} finish=${finish.padEnd(7)} ${m}`);
    } catch (e) { log(`ERR ${m} ${e.name}`); }
  }
  log("\n=== DONE ===");
})();
