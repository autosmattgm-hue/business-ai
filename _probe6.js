"use strict";
// Raw SSE field dump: what does NVIDIA actually stream for reasoning models?
const { loadLocalEnv } = require("./lib/load-env");
loadLocalEnv(__dirname);
const KEY = process.env.NVIDIA_API_KEY;
const URL = "https://integrate.api.nvidia.com/v1/chat/completions";

async function dump(model, prompt, maxTokens) {
  const a = Date.now();
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature: 0.4, top_p: 0.9, stream: true, reasoning_effort: "low" }),
  });
  console.log(`\n### ${model} :: ${prompt.slice(0, 40)} :: status=${res.status} headers=${Date.now() - a}ms`);
  if (!res.ok) { console.log("BODY:", (await res.text()).slice(0, 300)); return; }
  const fields = new Set();
  let contentChars = 0, reasoningChars = 0, finish = "", usage = "", raw = [], sawData = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of new TextDecoder().decode(value, { stream: true }).split("\n")) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const payload = s.slice(5).trim();
      if (payload === "[DONE]") continue;
      sawData += 1;
      let j; try { j = JSON.parse(payload); } catch { continue; }
      const c = j.choices?.[0] || {};
      const d = c.delta || {};
      Object.keys(d).forEach((k) => fields.add(k + "=" + typeof d[k] + (typeof d[k] === "string" ? `[${d[k].length}]` : "")));
      if (raw.length < 8) raw.push(payload.slice(0, 260));
      if (typeof d.content === "string") contentChars += d.content.length;
      if (typeof d.reasoning === "string") reasoningChars += d.reasoning.length;
      if (typeof d.reasoning_content === "string") reasoningChars += d.reasoning_content.length;
      if (c.finish_reason) finish = c.finish_reason;
      if (j.usage) usage = JSON.stringify(j.usage);
    }
  }
  console.log(`dataLines=${sawData} contentChars=${contentChars} reasoningChars=${reasoningChars} finish=${finish || "-"} total=${Date.now() - a}ms`);
  console.log("delta fields:", [...fields].slice(0, 12).join(" | ") || "none");
  if (usage) console.log("usage:", usage);
  raw.forEach((r, i) => console.log(`  raw[${i}]:`, r));
}

(async () => {
  await dump("nvidia/nemotron-3-super-120b-a12b", "Reply with exactly: ALPHA", 120);
  await dump("nvidia/nemotron-3-super-120b-a12b", "Give me three sharp lines on pricing a consulting service for a small client.", 400);
  await dump("meta/llama-3.2-11b-vision-instruct", "Give me three sharp lines on pricing a consulting service for a small client.", 400);
})().catch((e) => console.log("PROBE ERROR", e.name, e.cause?.code || e.message));
