function parseCodeList(value) {
  return String(value || "")
    .split(/[,\n]/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function getPublicAppConfig() {
  return {
    supportEmail: process.env.SMARTBOSS_SUPPORT_EMAIL || "support@smartbossai.com",
    paymentLinks: {
      monthly: process.env.SMARTBOSS_PAYMENT_LINK_MONTHLY || "",
      yearly: process.env.SMARTBOSS_PAYMENT_LINK_YEARLY || "",
      lifetime: process.env.SMARTBOSS_PAYMENT_LINK_LIFETIME || "",
      paypal: process.env.SMARTBOSS_PAYMENT_LINK_PAYPAL || "",
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
        description: "Paid access for heavier daily AI usage and faster workflows.",
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
  };
}

module.exports = {
  getPublicAppConfig,
  getSecretAccessConfig,
};
