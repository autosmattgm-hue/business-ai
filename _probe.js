const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
const KEY = env.split(/\r?\n/).find((l) => l.startsWith("NVIDIA_API_KEY=")).slice(15).trim();
const API = "https://integrate.api.nvidia.com/v1/chat/completions";
const OUT = path.join(__dirname, "_probe_out.txt");

const candidates = [
  "nvidia/nemotron-3-ultra-550b-a55b",
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  "nvidia/nemotron-nano-3-30b-a3b",
  "nvidia/llama-3.1-nemotron-51b-instruct",
  "nvidia/nemotron-4-340b-instruct",
  "moonshotai/kimi-k3",
  "moonshotai/kimi-k2.6",
  "deepseek-ai/deepseek-v4.1-flash",
  "z-ai/glm-5.3",
  "z-ai/glm-5.3-flash",
  "openai/gpt-oss-20b",
  "mistralai/mistral-large-2-instruct",
  "google/gemma-4-31b-it",
  "google/gemma-3-12b-it",
  "google/gemma-3-4b-it",
  "meta/llama-3.2-11b-vision-instruct",
  "meta/llama-3.2-90b-vision-instruct",
  "microsoft/phi-3-vision-128k-instruct",
];

function log(s) { fs.appendFileSync(OUT, s + "\n"); }

async function probe(model, extra, timeoutMs) {
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
        ...extra,
      }),
    });
    clearTimeout(timer);
    const txt = await res.text();
    const ms = Date.now() - t0;
    let note = "";
    if (res.ok) {
      try { const j = JSON.parse(txt); note = "content=" + JSON.stringify(j.choices?.[0]?.message?.content ?? "").slice(0, 60); } catch {}
    } else {
      note = "|| " + txt.replace(/\s+/g, " ").slice(0, 110);
    }
    return `${res.ok ? "PASS" : "FAIL"} ${String(res.status).padEnd(4)} ${String(ms).padStart(6)}ms  ${model.padEnd(42)} ${note}`;
  } catch (e) {
    return `FAIL ERR  ${String(Date.now() - t0).padStart(6)}ms  ${model.padEnd(42)} || ${e.name}: ${e.message}`;
  }
}

(async () => {
  fs.writeFileSync(OUT, "=== PLAIN CHAT (stream:false) ===\n");
  const results = await Promise.all(candidates.map((m) => probe(m, {}, 45000)));
  results.forEach(log);

  log("\n=== REASONING_EFFORT SUPPORT ===");
  const re = await Promise.all([
    probe("moonshotai/kimi-k3", { reasoning_effort: "low" }, 45000),
    probe("nvidia/nemotron-nano-3-30b-a3b", { reasoning_effort: "low" }, 45000),
    probe("nvidia/nemotron-3-super-120b-a12b", { reasoning_effort: "low" }, 60000),
    probe("deepseek-ai/deepseek-v4.1-flash", { reasoning_effort: "low" }, 45000),
    probe("openai/gpt-oss-20b", { reasoning_effort: "low" }, 45000),
  ]);
  re.forEach(log);

  log("\n=== STREAM:true SMOKE ===");
  for (const m of ["nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", "moonshotai/kimi-k3", "openai/gpt-oss-20b", "nvidia/nemotron-3.5-lightning-30b-a3b"]) {
    const t0 = Date.now();
    try {
      const res = await fetch(API, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ model: m, messages: [{ role: "user", content: "Say OK" }], max_tokens: 40, stream: true }) });
      let raw = "";
      for await (const c of res.body) raw += Buffer.from(c).toString();
      log(`${res.status} ${Date.now() - t0}ms ${m}  delta=${/"content":/.test(raw)} hasThinkTag=${/think/.test(raw)} bytes=${raw.length}`);
    } catch (e) { log(`ERR ${m} ${e.message}`); }
  }

  log("\n=== VISION (image_url parts) ===");
  const vmsgs = [{ role: "user", content: [
    { type: "text", text: "What is in this image? One short sentence." },
    { type: "image_url", image_url: { url: "https://assets.ngc.nvidia.com/products/api-catalog/phi-3-5-vision/example1b.jpg" } },
  ]}];
  for (const m of ["meta/llama-3.2-11b-vision-instruct", "meta/llama-3.2-90b-vision-instruct", "microsoft/phi-3-vision-128k-instruct", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", "openai/gpt-oss-20b"]) {
    const t0 = Date.now();
    try {
      const res = await fetch(API, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: m, messages: vmsgs, max_tokens: 128, temperature: 0 }) });
      const txt = (await res.text()).replace(/\s+/g, " ").slice(0, 190);
      log(`${res.status} ${Date.now() - t0}ms ${m}\n     ${txt}`);
    } catch (e) { log(`ERR ${m} ${e.message}`); }
  }
  log("\n=== DONE ===");
})();
