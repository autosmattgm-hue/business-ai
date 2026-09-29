"use strict";

// Throwaway latency probe: measures headers / first-token / total per model,
// twice in a row, so cold-start cost is visible. Run: node _probe4.js
const { loadLocalEnv } = require("./lib/load-env");
loadLocalEnv(__dirname);

const registry = require("./lib/model-registry.js");
const URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const KEY = process.env.NVIDIA_API_KEY;
const HARD_CAP_MS = 70_000;

const MODELS = [
  "nvidia/nemotron-3-super-120b-a12b",
  "meta/llama-3.2-11b-vision-instruct",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
];

async function attempt(model, prompt) {
  const t0 = Date.now();
  const controller = new AbortController();
  const cap = setTimeout(() => controller.abort(), HARD_CAP_MS);
  let headersMs = 0;
  let firstTokenMs = 0;
  let chars = 0;
  let status = 0;
  let note = "";

  try {
    const res = await fetch(URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 120,
        temperature: 0.4,
        top_p: 0.9,
        stream: true,
        reasoning_effort: registry.getModelSpec(model)?.supportsReasoningEffort ? "low" : undefined,
      }),
    });

    status = res.status;
    headersMs = Date.now() - t0;

    if (!res.ok) {
      note = (await res.text()).slice(0, 110).replace(/\s+/g, " ");
    } else {
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = new TextDecoder().decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          try {
            const e = JSON.parse(s.slice(5).trim());
            const token = e.choices?.[0]?.delta?.content || "";
            if (token) {
              if (!firstTokenMs) firstTokenMs = Date.now() - t0;
              chars += token.length;
            }
          } catch (_) {}
        }
      }
      if (!firstTokenMs) note = "streamed 200 but zero content tokens";
    }
  } catch (error) {
    note = `${error.name}: ${error.cause?.code || error.cause?.name || error.message}`.slice(0, 110);
    status = status || 0;
  } finally {
    clearTimeout(cap);
  }

  const flag = firstTokenMs && firstTokenMs <= 20_000 ? "OK " : "SLOW";
  console.log(
    `${status} ${flag} ${model} :: headers=${headersMs} firstToken=${firstTokenMs || "-"} total=${Date.now() - t0} chars=${chars}${note ? " :: " + note : ""}`,
  );
}

(async () => {
  const prompts = [
    "Reply with exactly: ALPHA",
    "Reply with exactly: BRAVO",
  ];

  for (let round = 0; round < prompts.length; round += 1) {
    console.log(`\n--- round ${round + 1} (${round === 0 ? "cold" : "repeat"}) ---`);
    for (const model of MODELS) await attempt(model, prompts[round]);
  }

  console.log("\n--- parallel race (super + vision, first token wins) ---");
  const raceStart = Date.now();
  const winner = await Promise.any(
    ["meta/llama-3.2-11b-vision-instruct", "nvidia/nemotron-3-super-120b-a12b"].map(
      async (model) => {
        const t0 = Date.now();
        const res = await fetch(URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${KEY}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "Give two punchy lines on pricing a service." }],
            max_tokens: 90,
            temperature: 0.6,
            stream: true,
          }),
        });
        const reader = res.body.getReader();
        let text = "";
        while (text.length < 40) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of new TextDecoder().decode(value, { stream: true }).split("\n")) {
            const s = line.trim();
            if (!s.startsWith("data:")) continue;
            try {
              text += JSON.parse(s.slice(5).trim()).choices?.[0]?.delta?.content || "";
            } catch (_) {}
          }
        }
        reader.cancel();
        return `${model} firstToken=${Date.now() - t0}ms`;
      },
    ),
  );
  console.log(`race winner after ${Date.now() - raceStart}ms :: ${winner}`);
})();
