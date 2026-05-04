import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  sanitizeModelText,
  validateChatRequest,
  requestChatCompletion,
} = require("../lib/chat-service.js");

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const validationError = validateChatRequest(req.body);
  if (validationError) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: validationError }));
    return;
  }

  try {
    const response = await requestChatCompletion(req.body, process.env.NVIDIA_API_KEY);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("NVIDIA API error:", errorText);
      res.statusCode = response.status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "AI service error", detail: errorText }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");

    let buffer = "";
    let inThinking = false;

    for await (const chunk of response.body) {
      buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim() || line === "data: [DONE]" || !line.startsWith("data: ")) {
          continue;
        }

        try {
          const json = JSON.parse(line.slice(6));
          const delta = json.choices?.[0]?.delta?.content || "";

          if (delta.includes("<think>")) {
            inThinking = true;
            continue;
          }

          if (delta.includes("</think>")) {
            inThinking = false;
            continue;
          }

          if (!inThinking && delta) {
            const cleanedDelta = sanitizeModelText(delta);
            if (cleanedDelta) {
              res.write(`data: ${JSON.stringify({ token: cleanedDelta })}\n\n`);
            }
          }
        } catch (error) {
          console.error("SSE parse error:", error.message);
        }
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("Vercel API error:", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Internal server error", detail: error.message }));
  }
}
