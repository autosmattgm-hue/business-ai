const crypto = require("crypto");
const { getSecretAccessConfig, getPaidPlanConfig } = require("./app-config");

const PAYPAL_BASE_URLS = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

function createHttpError(statusCode, message, detail) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.detail = detail;
  return error;
}

function getPayPalConfig() {
  const secrets = getSecretAccessConfig();
  const paypal = secrets.paypal || {};

  if (!paypal.clientId || !paypal.clientSecret) {
    throw createHttpError(
      503,
      "PayPal checkout is not configured yet.",
      "Add SMARTBOSS_PAYPAL_CLIENT_ID and SMARTBOSS_PAYPAL_CLIENT_SECRET.",
    );
  }

  return {
    ...paypal,
    baseUrl: PAYPAL_BASE_URLS[paypal.environment] || PAYPAL_BASE_URLS.sandbox,
  };
}

async function readPayPalJson(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (_) {
    return { raw: text };
  }
}

async function getPayPalAccessToken() {
  const paypal = getPayPalConfig();
  const credentials = Buffer.from(`${paypal.clientId}:${paypal.clientSecret}`).toString("base64");
  const response = await fetch(`${paypal.baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const payload = await readPayPalJson(response);

  if (!response.ok || !payload.access_token) {
    throw createHttpError(response.status || 502, "Could not connect to PayPal.", payload);
  }

  return {
    accessToken: payload.access_token,
    baseUrl: paypal.baseUrl,
  };
}

async function requestPayPal(path, { method = "GET", body, requestId } = {}) {
  const { accessToken, baseUrl } = await getPayPalAccessToken();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await readPayPalJson(response);

  if (!response.ok) {
    throw createHttpError(response.status || 502, payload.message || "PayPal request failed.", payload);
  }

  return payload;
}

function requirePaidPlan(planKey) {
  const plan = getPaidPlanConfig(planKey);

  if (!plan) {
    throw createHttpError(400, "Invalid paid plan.", { planKey });
  }

  return plan;
}

function normalizeMoney(value) {
  const amount = Number.parseFloat(String(value || "0"));
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function assertCapturedAmount(capture, plan) {
  const amount = capture?.amount || {};
  const capturedCurrency = String(amount.currency_code || "").toUpperCase();
  const capturedValue = normalizeMoney(amount.value);

  if (capturedCurrency !== plan.currency || capturedValue !== normalizeMoney(plan.amount)) {
    throw createHttpError(409, "PayPal captured amount does not match the selected plan.", {
      expected: { currency: plan.currency, value: normalizeMoney(plan.amount) },
      captured: { currency: capturedCurrency, value: capturedValue },
    });
  }
}

function createActivationCode(planKey) {
  const planPart = String(planKey || "pro").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const randomPart = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `SB-${planPart}-PRO-${randomPart}`;
}

async function createPayPalOrder({ planKey, userId = "", userEmail = "" } = {}) {
  const plan = requirePaidPlan(planKey);
  const requestId = `smartboss-create-${plan.key}-${crypto.randomUUID()}`;
  const order = await requestPayPal("/v2/checkout/orders", {
    method: "POST",
    requestId,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: `smartboss-${plan.key}`,
          custom_id: `${String(userId || "guest").slice(0, 64)}:${plan.key}`,
          description: `${plan.label} access for THE SMART BOSS AI`,
          invoice_id: `SB-${plan.key.toUpperCase()}-${Date.now()}`,
          amount: {
            currency_code: plan.currency,
            value: normalizeMoney(plan.amount),
          },
        },
      ],
      application_context: {
        brand_name: "THE SMART BOSS AI",
        landing_page: "LOGIN",
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
      },
    },
  });

  return {
    id: order.id,
    status: order.status,
    plan,
  };
}

async function capturePayPalOrder({ orderId, planKey } = {}) {
  const plan = requirePaidPlan(planKey);
  const cleanOrderId = String(orderId || "").trim();

  if (!cleanOrderId) {
    throw createHttpError(400, "Missing PayPal order id.");
  }

  const order = await requestPayPal(`/v2/checkout/orders/${encodeURIComponent(cleanOrderId)}/capture`, {
    method: "POST",
    requestId: `smartboss-capture-${cleanOrderId}`,
  });
  const purchaseUnit = order.purchase_units?.[0] || {};
  const capture = purchaseUnit.payments?.captures?.[0] || {};

  if (order.status !== "COMPLETED" || capture.status !== "COMPLETED") {
    throw createHttpError(409, "PayPal payment was not completed.", {
      orderStatus: order.status,
      captureStatus: capture.status,
    });
  }

  assertCapturedAmount(capture, plan);

  return {
    ok: true,
    orderId: order.id,
    captureId: capture.id,
    activationCode: createActivationCode(plan.key),
    status: order.status,
    plan,
  };
}

module.exports = {
  createPayPalOrder,
  capturePayPalOrder,
};
