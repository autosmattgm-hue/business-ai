const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
const KEY = env.split(/\r?\n/).find((l) => l.startsWith("NVIDIA_API_KEY=")).slice(15).trim();
const API = "https://integrate.api.nvidia.com/v1/chat/completions";
const OUT = path.join(__dirname, "_probe3_out.txt");
function log(s) { fs.appendFileSync(OUT, s + "\n"); }

// Tiny 1x1 red PNG as base64 -> scaled up test image is not needed; use a real photo URL + a data URL.
const DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC";
const HTTP_IMG = "https://assets.ngc.nvidia.com/products/api-catalog/phi-3-5-vision/example1b.jpg";

function msgs(imgUrl, text) {
  return [{ role: "user", content: [
    { type: "text", text },
    { type: "image_url", image_url: { url: imgUrl } },
  ]}];
}

async function run(label, model, messages, extra = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, max_tokens: 160, temperature: 0, stream: false, ...extra }),
    });
    const txt = await res.text();
    let note;
    if (res.ok) {
      try { const j = JSON.parse(txt); note = JSON.stringify(j.choices?.[0]?.message?.content ?? "").slice(0, 150); } catch { note = txt.slice(0, 150); }
    } else note = "|| " + txt.replace(/\s+/g, " ").slice(0, 150);
    log(`${res.ok ? "PASS" : "FAIL"} ${res.status} ${Date.now() - t0}ms [${label}] ${model}\n      ${note}`);
  } catch (e) {
    log(`FAIL ERR ${Date.now() - t0}ms [${label}] ${model} || ${e.name}`);
  }
}

(async () => {
  fs.writeFileSync(OUT, "=== VISION: http image url ===\n");
  await run("http-img", "meta/llama-3.2-11b-vision-instruct", msgs(HTTP_IMG, "What is in this image? One short sentence."));
  await run("http-img", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", msgs(HTTP_IMG, "What is in this image? One short sentence."));

  log("\n=== VISION: base64 data: URL (needed for user uploads) ===");
  await run("data-url", "meta/llama-3.2-11b-vision-instruct", msgs(DATA_URL, "What single colour is this image?"));
  await run("data-url", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", msgs(DATA_URL, "What single colour is this image?"));

  log("\n=== TEXT-ONLY MODEL given image parts (should reject?) ===");
  await run("img-on-text", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", msgs(HTTP_IMG, "Describe briefly."));

  log("\n=== reasoning_effort on winners ===");
  for (const m of ["nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", "nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3-ultra-550b-a55b"]) {
    await run("reasoning_effort=low", m, [{ role: "user", content: "Reply with exactly: OK" }], { reasoning_effort: "low", max_tokens: 64 });
  }

  log("\n=== name/label sanity: streaming business answer quality ===");
  await run("quality", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", [
    { role: "system", content: "You are a blunt business advisor. Short paragraphs, no markdown." },
    { role: "user", content: "One sentence: what is the fastest way for a 3-person design studio to add revenue?" },
  ], { max_tokens: 300 });

  log("\n=== DONE ===");
})();
