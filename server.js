const http = require("http");
const fs = require("fs");
const path = require("path");
const {
  sanitizeModelText,
  validateChatRequest,
  requestChatCompletion,
} = require("./lib/chat-service");

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
  "/resources": "resources.html",
  "/presentation": "presentation.html",
  "/prompt": "prompt.html",
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

  const validationError = validateChatRequest(body);
  if (validationError) {
    sendJson(res, 400, { error: validationError });
    return;
  }

  try {
    const response = await requestChatCompletion(body, process.env.NVIDIA_API_KEY);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("NVIDIA API error:", errorText);
      sendJson(res, response.status, { error: "AI service error", detail: errorText });
      return;
    }

    setCorsHeaders(res);
    res.writeHead(200, {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    });

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
    console.error("Server error:", error);

    if (!res.headersSent) {
      sendJson(res, 500, { error: "Internal server error", detail: error.message });
      return;
    }

    res.write(`data: ${JSON.stringify({ token: "\nConnection issue while generating the response." })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
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

  if (req.method === "POST" && urlPath === "/api/chat") {
    await handleChat(req, res);
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
