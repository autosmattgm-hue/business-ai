const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadLocalEnv } = require("./lib/load-env");
loadLocalEnv(__dirname);

const { getPublicAppConfig, getSecretAccessConfig } = require("./lib/app-config");
const {
  MODEL,
  FALLBACK_MODELS,
  DEFAULT_MODEL_PROFILE,
  MODEL_OPTIONS,
  cacheChatResponse,
  getCachedChatResponse,
  getChatErrorStatus,
  getProviderErrorMessage,
  getPublicChatError,
  getPublicModelOptions,
  validateChatRequest,
  streamCompleteChatResponse,
} = require("./lib/chat-service");
const { createPayPalOrder, capturePayPalOrder } = require("./lib/paypal-service");

const DEFAULT_PORT = Number(process.env.PORT) || 3010;
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, "public"))
  ? path.join(__dirname, "public")
  : __dirname;

const PAGE_ROUTES = {
  "/": "index.html",
  "/business": "business.html",
  "/ideas": "ideas.html",
  "/planner": "planner.html",
  "/pricing": "pricing.html",
  "/pricing-strategy": "pricing-strategy.html",
  "/pricing-builder": "pricing-strategy.html",
  "/checkout": "checkout.html",
  "/payment-success": "payment-success.html",
  "/revenue": "revenue.html",
  "/audit": "audit.html",
  "/email": "email.html",
  "/office": "office.html",
  "/resources": "resources.html",
  "/documents": "documents.html",
  "/resume": "resume.html",
  "/cv": "cv.html",
  "/voice": "voice.html",
  "/presentation": "presentation.html",
  "/prompt": "prompt.html",
  "/login": "login.html",
  "/register": "register.html",
  "/settings": "settings.html",
};

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function sendJson(res, statusCode, data) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function startSse(res) {
  setCorsHeaders(res);
  res.writeHead(200, {
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
  });
  res.write(": connected\n\n");
}

function writeSseData(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function finishSse(res) {
  res.write("data: [DONE]\n\n");
  res.end();
}

function handleHealth(res) {
  sendJson(res, 200, {
    ok: true,
    service: "smart-boss-ai",
    model: MODEL,
    fallbackModels: FALLBACK_MODELS,
    defaultModelProfile: DEFAULT_MODEL_PROFILE,
    modelOptions: MODEL_OPTIONS,
    hasApiKey: Boolean(process.env.NVIDIA_API_KEY),
  });
}

function handleModels(res) {
  sendJson(res, 200, getPublicModelOptions());
}

function handlePublicConfig(res) {
  sendJson(res, 200, getPublicAppConfig());
}

async function handleRedeemCode(req, res) {
  let body;

  try {
    body = JSON.parse(await readRequestBody(req));
  } catch (error) {
    sendJson(res, 400, { error: "Invalid JSON body", detail: error.message });
    return;
  }

  const code = String(body?.code || "").trim().toUpperCase();
  if (!code) {
    sendJson(res, 400, { error: "Missing access code" });
    return;
  }

  const secrets = getSecretAccessConfig();

  if (code === secrets.adminCode) {
    sendJson(res, 200, {
      ok: true,
      plan: "admin",
      role: "admin",
      unlimited: true,
      message: "Admin unlimited access unlocked.",
    });
    return;
  }

  if (secrets.proCodes.includes(code)) {
    sendJson(res, 200, {
      ok: true,
      plan: "pro",
      role: "user",
      unlimited: true,
      message: "Smart Boss Pro unlocked.",
    });
    return;
  }

  sendJson(res, 400, { error: "Invalid access code" });
}

async function handleCreatePayPalOrder(req, res) {
  let body;

  try {
    body = JSON.parse(await readRequestBody(req));
  } catch (error) {
    sendJson(res, 400, { error: "Invalid JSON body", detail: error.message });
    return;
  }

  try {
    const order = await createPayPalOrder({
      planKey: body?.planKey,
      userId: body?.userId,
      userEmail: body?.userEmail,
    });
    sendJson(res, 200, order);
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Could not create PayPal order.",
      detail: error.detail,
    });
  }
}

async function handleCapturePayPalOrder(req, res) {
  let body;

  try {
    body = JSON.parse(await readRequestBody(req));
  } catch (error) {
    sendJson(res, 400, { error: "Invalid JSON body", detail: error.message });
    return;
  }

  try {
    const capture = await capturePayPalOrder({
      orderId: body?.orderId,
      planKey: body?.planKey,
    });
    sendJson(res, 200, capture);
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Could not capture PayPal order.",
      detail: error.detail,
    });
  }
}

function getSafeFilePath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0]);
  const relativePath = decodedPath === "/" ? "/index.html" : decodedPath;
  const normalizedPath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalizedPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return null;
  }

  return filePath;
}

async function readRequestBody(req) {
  const chunks = [];
  let totalSize = 0;

  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > 1_000_000) {
      throw new Error("Request too large");
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function serveStaticFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "File not found" });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
    setCorsHeaders(res);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

async function handleChat(req, res) {
  let body;

  try {
    body = JSON.parse(await readRequestBody(req));
  } catch (error) {
    sendJson(res, 400, { error: "Invalid JSON body", detail: error.message });
    return;
  }

  if (body && typeof body === "object" && !Array.isArray(body)) {
    body = {
      ...body,
      mode: body.mode || "business",
      model: typeof body.model === "string" ? body.model.trim() : body.model,
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
    const result = await streamCompleteChatResponse(body, process.env.NVIDIA_API_KEY, (token) => {
      writeSseData(res, { token });
    });

    if (!result.ok) {
      const errorText = await result.response.text();
      console.error("NVIDIA API error:", errorText);
      writeSseData(res, { error: getProviderErrorMessage(result.response.status) });
      finishSse(res);
      return;
    }

    cacheChatResponse(body, result.text);
    finishSse(res);
  } catch (error) {
    console.error("Server error:", error);

    if (!res.headersSent) {
      sendJson(res, getChatErrorStatus(error), { error: getPublicChatError(error) });
      return;
    }

    writeSseData(res, { error: getPublicChatError(error) });
    finishSse(res);
  }
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlPath = req.url.split("?")[0];

  if (req.method === "GET" && urlPath === "/api/health") {
    handleHealth(res);
    return;
  }

  if (req.method === "GET" && urlPath === "/api/public-config") {
    handlePublicConfig(res);
    return;
  }

  if (req.method === "GET" && urlPath === "/api/models") {
    handleModels(res);
    return;
  }

  if (req.method === "POST" && urlPath === "/api/chat") {
    await handleChat(req, res);
    return;
  }

  if (req.method === "POST" && urlPath === "/api/redeem-code") {
    await handleRedeemCode(req, res);
    return;
  }

  if (req.method === "POST" && urlPath === "/api/paypal-create-order") {
    await handleCreatePayPalOrder(req, res);
    return;
  }

  if (req.method === "POST" && urlPath === "/api/paypal-capture-order") {
    await handleCapturePayPalOrder(req, res);
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const routeFile = PAGE_ROUTES[urlPath];
  const filePath = routeFile
    ? path.join(PUBLIC_DIR, routeFile)
    : getSafeFilePath(urlPath);

  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  serveStaticFile(res, filePath);
});

function startServer(port, fallbackPorts = [3000, 3001, 3100, 3200]) {
  server
    .once("error", (error) => {
      if (error.code === "EADDRINUSE" && fallbackPorts.length) {
        const nextPort = fallbackPorts.shift();
        console.warn(`Port ${port} is busy. Trying http://localhost:${nextPort} instead.`);
        startServer(nextPort, fallbackPorts);
        return;
      }

      console.error("Failed to start server:", error);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`THE SMART BOSS AI running at http://localhost:${port}`);
    });
}

startServer(DEFAULT_PORT);
