import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadLocalEnv } = require("../lib/load-env.js");
const {
  cacheChatResponse,
  getCachedChatResponse,
  getChatErrorStatus,
  getProviderErrorMessage,
  getPublicChatError,
  validateChatRequest,
  requestChatCompletion,
  streamCompletionTokens,
} = require("../lib/chat-service.js");

loadLocalEnv(process.cwd());

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    if (Buffer.isBuffer(req.body)) {
      const rawBufferBody = req.body.toString("utf8").trim();
      return rawBufferBody ? JSON.parse(rawBufferBody) : {};
    }

    if (req.body instanceof Uint8Array) {
      const rawTypedArrayBody = Buffer.from(req.body).toString("utf8").trim();
      return rawTypedArrayBody ? JSON.parse(rawTypedArrayBody) : {};
    }

    return req.body;
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawBody) {
    return {};
  }

  return JSON.parse(rawBody);
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function startSse(res) {
  res.statusCode = 200;
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.write(": connected\n\n");
}

function writeSseData(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function finishSse(res) {
  res.write("data: [DONE]\n\n");
  res.end();
}

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

  let body;

  try {
    body = await readJsonBody(req);
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Invalid JSON body", detail: error.message }));
    return;
  }

  if (body && typeof body === "object" && !Array.isArray(body)) {
    body = {
      ...body,
      mode: body.mode || "business",
      history: Array.isArray(body.history) ? body.history : [],
      message: typeof body.message === "string" ? body.message.trim() : body.message,
    };
  }

  const validationError = validateChatRequest(body);
  if (validationError) {
    sendJson(res, 400, { error: validationError });
    return;
  }

  const cachedResponse = getCachedChatResponse(body);
  if (cachedResponse) {
    startSse(res);
    writeSseData(res, { token: cachedResponse, cached: true });
    finishSse(res);
    return;
  }

  if (!process.env.NVIDIA_API_KEY) {
    sendJson(res, 503, {
      error: "AI service is not configured. Add NVIDIA_API_KEY in Vercel Environment Variables, then redeploy.",
    });
    return;
  }

  startSse(res);

  try {
    const response = await requestChatCompletion(body, process.env.NVIDIA_API_KEY);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("NVIDIA API error:", errorText);
      writeSseData(res, { error: getProviderErrorMessage(response.status) });
      finishSse(res);
      return;
    }

    const fullText = await streamCompletionTokens(response, (token) => {
      writeSseData(res, { token });
    });

    cacheChatResponse(body, fullText);
    finishSse(res);
  } catch (error) {
    console.error("Vercel API error:", error);

    if (!res.headersSent) {
      sendJson(res, getChatErrorStatus(error), { error: getPublicChatError(error) });
      return;
    }

    writeSseData(res, { error: getPublicChatError(error) });
    finishSse(res);
  }
}
