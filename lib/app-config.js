function parseCodeList(value) {
  return String(value || "")
    .split(/[,\n]/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function normalizePayPalEnvironment(value) {
  return String(value || "").trim().toLowerCase() === "live" ? "live" : "sandbox";
}

function getAmount(value, fallback) {
  const normalized = Number.parseFloat(String(value || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(normalized) && normalized > 0 ? normalized.toFixed(2) : fallback;
}

function getCurrency() {
  return String(process.env.SMARTBOSS_PAYPAL_CURRENCY || "USD").trim().toUpperCase() || "USD";
}

function getProPriceOptions() {
  return {
    monthly: {
      price: "$9",
      amount: getAmount(process.env.SMARTBOSS_PLAN_MONTHLY_AMOUNT, "9.00"),
      cadence: "/month",
      description: "Best for users who want affordable access without a yearly commitment.",
    },
    yearly: {
      price: "$79",
      amount: getAmount(process.env.SMARTBOSS_PLAN_YEARLY_AMOUNT, "79.00"),
      cadence: "/year",
      description: "Good for loyal users and gives you better upfront cash flow.",
    },
    lifetime: {
      price: "$149",
      amount: getAmount(process.env.SMARTBOSS_PLAN_LIFETIME_AMOUNT, "149.00"),
      cadence: "one-time",
      description: "A launch deal for early supporters who want long-term access and help fund growth faster.",
    },
  };
}

function getPaidPlanConfig(planKey) {
  const priceOptions = getProPriceOptions();
  const normalized = String(planKey || "").trim().toLowerCase();
  const option = priceOptions[normalized];

  if (!option) {
    return null;
  }

  const labels = {
    monthly: "Smart Boss Pro Monthly",
    yearly: "Smart Boss Pro Yearly",
    lifetime: "Founder Lifetime",
  };

  return {
    key: normalized,
    label: labels[normalized],
    amount: option.amount,
    currency: getCurrency(),
    price: option.price,
    cadence: option.cadence,
  };
}

function getPublicAppConfig() {
  const paypalClientId = process.env.SMARTBOSS_PAYPAL_CLIENT_ID || "";
  const paypalClientSecret = process.env.SMARTBOSS_PAYPAL_CLIENT_SECRET || "";

  return {
    supportEmail: process.env.SMARTBOSS_SUPPORT_EMAIL || "support@smartbossai.com",
    paymentLinks: {
      monthly: process.env.SMARTBOSS_PAYMENT_LINK_MONTHLY || "",
      yearly: process.env.SMARTBOSS_PAYMENT_LINK_YEARLY || "",
      lifetime: process.env.SMARTBOSS_PAYMENT_LINK_LIFETIME || "",
      paypal: process.env.SMARTBOSS_PAYMENT_LINK_PAYPAL || "",
    },
    paypal: {
      clientId: paypalClientId,
      currency: getCurrency(),
      environment: normalizePayPalEnvironment(process.env.SMARTBOSS_PAYPAL_ENVIRONMENT),
      enabled: Boolean(paypalClientId && paypalClientSecret),
    },
    freeAccess: {
      dailyRequests: 2,
      promoCode: "FREESMART",
      promoBonusRequests: 3,
      maxDailyPromoRedeems: 2,
    },
    plans: {
      free: {
        name: "Free Starter",
        description: "Try the platform with limited AI access each day.",
      },
      pro: {
        name: "Smart Boss Pro",
        description: "Paid access for heavier daily AI usage and faster revenue workflows.",
        priceOptions: getProPriceOptions(),
      },
      admin: {
        name: "Admin Unlimited",
        description: "Full internal admin access across all AI tools.",
      },
    },
  };
}

function getSecretAccessConfig() {
  return {
    adminCode: String(process.env.SMARTBOSS_ADMIN_CODE || "ADMIN2026").trim().toUpperCase(),
    proCodes: parseCodeList(process.env.SMARTBOSS_PRO_CODES || ""),
    paypal: {
      clientId: process.env.SMARTBOSS_PAYPAL_CLIENT_ID || "",
      clientSecret: process.env.SMARTBOSS_PAYPAL_CLIENT_SECRET || "",
      currency: getCurrency(),
      environment: normalizePayPalEnvironment(process.env.SMARTBOSS_PAYPAL_ENVIRONMENT),
    },
  };
}

module.exports = {
  getPublicAppConfig,
  getSecretAccessConfig,
  getPaidPlanConfig,
};
