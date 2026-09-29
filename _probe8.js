"use strict";
// Throwaway probe #8: do ANY remote https image URLs work, or does NVIDIA's
// image fetcher always fail? Writes _probe8_out.txt.
const fs = require("node:fs");
const path = require("node:path");
const { loadLocalEnv } = require("./lib/load-env");

loadLocalEnv(__dirname);

const KEY = process.env.NVIDIA_API_KEY;
const ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL = "meta/llama-3.2-11b-vision-instruct";

const CASES = [
  ["github avatar", "https://avatars.githubusercontent.com/u/583231?v=4"],
  ["github raw", "https://raw.githubusercontent.com/github/explore/main/topics/octocat/octocat.png"],
  ["picsum", "https://picsum.photos/400"],
  ["wikimedia thumb", "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/480px-Cat03.jpg"],
  ["wikimedia full", "https://upload.wikimedia.org/wikipedia/commons/3/3a/Cat03.jpg"],
];

const lines = [];
function log(...parts) {
  const line = parts.join(" ");
  lines.push(line);
  console.log(line);
}

async function attempt(label, imageUrl, model = MODEL) {
  const started = Date.now();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageUrl } },
          { type: "text", text: "What is in this image? One sentence." },
        ],
      }],
      max_tokens: 80,
      temperature: 0.2,
      stream: false,
    }),
  });
  const body = await res.text();
  let answer = "";
  try {
    const json = JSON.parse(body);
    answer = json.choices?.[0]?.message?.content || json.detail || json.error || "";
  } catch {
    answer = body;
  }
  log(`${res.status} ${String(Date.now() - started).padStart(5)}ms  ${label.padEnd(16)} ${String(answer).slice(0, 120).replace(/\s+/g, " ")}`);
}

(async () => {
  log(`### remote image urls against ${MODEL} (non-streaming)`);
  for (const [label, url] of CASES) {
    await attempt(label, url);
  }

  log("\n### same wikimedia thumb through nvidia/nemotron-3-nano-omni-30b-a3b-reasoning");
  await attempt("omni-30b", "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/480px-Cat03.jpg", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning");

  log("\n### llama-3.2-90b-vision with wikimedia thumb");
  await attempt("llama-90b-v", "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/480px-Cat03.jpg", "meta/llama-3.2-90b-vision-instruct");

  fs.writeFileSync(path.join(__dirname, "_probe8_out.txt"), lines.join("\n") + "\n", "utf8");
})().catch((error) => {
  log("PROBE ERROR " + (error?.stack || error?.message || error));
  fs.writeFileSync(path.join(__dirname, "_probe8_out.txt"), lines.join("\n") + "\n", "utf8");
});
