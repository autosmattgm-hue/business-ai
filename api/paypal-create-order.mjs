import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadLocalEnv } = require("../lib/load-env.js");
const { createPayPalOrder } = require("../lib/paypal-service.js");

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
  return rawBody ? JSON.parse(rawBody) : {};
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body;

  try {
    body = await readJsonBody(req);
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
