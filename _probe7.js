"use strict";
// Throwaway probe #7: why does the vision path 503? Prints raw provider bodies
// and the account's real vision-capable model ids. Writes _probe7_out.txt.
const fs = require("node:fs");
const path = require("node:path");
const { loadLocalEnv } = require("./lib/load-env");

loadLocalEnv(__dirname);

const KEY = process.env.NVIDIA_API_KEY;
const ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
const HOST = "integrate.api.nvidia.com";

const WIKI_IMG =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/480px-Cat03.jpg";
// 1x1 red pixel, encodes the whole image inline so NVIDIA never has to fetch it.
const DATA_IMG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const lines = [];
function log(...parts) {
  const line = parts.join(" ");
  lines.push(line);
  console.log(line);
}

function visionMessages(imageUrl) {
  return [
    { role: "user", content: "What is in this image? Answer in one sentence." },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageUrl } },
        { type: "text", text: "Describe this image in one sentence." },
      ],
    },
  ];
}

async function drain(res, capMs) {
  const started = Date.now();
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let content = "";
  let reasoning = "";
  let rawHead = "";
  let finish = "";
  for (;;) {
    if (Date.now() - started > capMs) {
      rawHead += " <<CAP>>";
      break;
    }
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (rawHead.length < 1200) rawHead += chunk;
    for (const rawLine of chunk.split("\n")) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let json;
      try { json = JSON.parse(payload); } catch { continue; }
      const delta = json.choices?.[0]?.delta || {};
      if (typeof delta.content === "string") content += delta.content;
      if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content;
      if (typeof delta.reasoning === "string") reasoning += delta.reasoning;
      if (json.choices?.[0]?.finish_reason) finish = json.choices[0].finish_reason;
    }
  }
  return { content, reasoning, finish, rawHead };
}

async function post(label, model, messages) {
  const started = Date.now();
  log(`\n### ${label} :: model=${model}`);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 160,
        temperature: 0.2,
        top_p: 0.9,
        stream: true,
      }),
    });
    log(`status=${res.status} headers=${Date.now() - started}ms`);
    if (!res.ok) {
      const body = await res.text();
      log("BODY: " + body.slice(0, 500).replace(/\s+/g, " "));
      return;
    }
    const result = await drain(res, 45_000);
    log(`content=${result.content.length} reasoning=${result.reasoning.length} finish=${result.finishReason || result.finish || "-"} total=${Date.now() - started}ms`);
    log("content: " + result.content.slice(0, 200).replace(/\s+/g, " "));
    log("raw head: " + result.rawHead.slice(0, 300).replace(/\s+/g, " "));
  } catch (error) {
    log(`THREW after ${Date.now() - started}ms :: ${error.name} ${error.cause?.code || error.cause?.message || error.message}`);
  }
}

async function listVisionModels() {
  const res = await fetch(`https://${HOST}/v1/models`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  const json = await res.json().catch(() => null);
  const ids = (json?.data || []).map((entry) => entry.id);
  log(`\n### /v1/models status=${res.status} count=${ids.length}`);
  const candidates = ids.filter((id) => /vision|vl|minicpm|internvl|llava|nemotron-nano-omni|omni|kimi|minimax|qwen/i.test(id));
  log("vision-ish candidates:");
  candidates.forEach((id) => log("   " + id));
  return ids;
}

(async () => {
  const ids = await listVisionModels();
  const visionModel = ids.includes("meta/llama-3.2-11b-vision-instruct")
    ? "meta/llama-3.2-11b-vision-instruct"
    : (ids.find((id) => /vision|vl|omni/i.test(id)) || "meta/llama-3.2-11b-vision-instruct");
  log(`\nchosen vision model: ${visionModel}`);

  await post("A: wikimedia url", visionModel, visionMessages(WIKI_IMG));
  await post("B: inline data url", visionModel, visionMessages(DATA_IMG));
  await post("C: text only sanity", visionModel, [
    { role: "user", content: "Reply with exactly: VISION-SANE" },
  ]);

  fs.writeFileSync(
    path.join(__dirname, "_probe7_out.txt"),
    lines.join("\n") + "\n",
    "utf8",
  );
})().catch((error) => {
  log("PROBE ERROR " + (error?.stack || error?.message || error));
  fs.writeFileSync(path.join(__dirname, "_probe7_out.txt"), lines.join("\n") + "\n", "utf8");
});
