/* ═══════════════════════════════════════════════════════
   THE SMART BOSS AI — main.js
   Frontend Logic: Chat, Streaming, Markdown, UI Helpers
═══════════════════════════════════════════════════════ */

// ── GLOBALS ─────────────────────────────────────────────
const LOCAL_API_PORTS = [3010, 3000, 3001, 3100, 3200];
const API_BASES = (() => {
  const bases = [];
  const addBase = (value) => {
    const normalized = String(value || "").trim().replace(/\/+$/, "");
    if (normalized && !bases.includes(normalized)) {
      bases.push(normalized);
    }
  };

  if (window.SMART_BOSS_API_BASE) {
    addBase(window.SMART_BOSS_API_BASE);
  }

  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    addBase(window.location.origin);
  }

  const isLocalPage =
    window.location.protocol === "file:" ||
    ["localhost", "127.0.0.1"].includes(window.location.hostname);

  if (isLocalPage) {
    LOCAL_API_PORTS.forEach((port) => addBase(`http://localhost:${port}`));
    LOCAL_API_PORTS.forEach((port) => addBase(`http://127.0.0.1:${port}`));
  }

  return bases;
})();

async function fetchApi(path, init = {}) {
  const requestPath = path.startsWith("/") ? path : `/${path}`;
  let lastError = null;

  for (const base of API_BASES) {
    try {
      const response = await fetch(`${base}${requestPath}`, init);

      if (response.status === 404 && base !== API_BASES[API_BASES.length - 1]) {
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Could not connect to the local or deployed AI server.");
}

const SMART_BOSS_STORAGE = {
  users: "smartboss_users_v1",
  session: "smartboss_session_v1",
};

const SMART_BOSS_DEFAULT_ACCESS = {
  freeDailyRequests: 2,
  freePromoCode: "FREESMART",
  freePromoBonusRequests: 3,
  maxDailyPromoRedeems: 2,
  adminCode: "ADMIN2026",
};

let smartBossPublicConfigPromise = null;
let smartBossPublicConfigCache = null;

function isStorageAvailable() {
  try {
    const probeKey = "__smartboss_probe__";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    return true;
  } catch (_) {
    return false;
  }
}

function readStorageJson(key, fallback) {
  if (!isStorageAvailable()) return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeStorageJson(key, value) {
  if (!isStorageAvailable()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createSmartBossUserId() {
  return `sb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function hashSecret(value) {
  const normalized = String(value || "");

  if (window.crypto?.subtle && window.TextEncoder) {
    const digest = await window.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(normalized),
    );

    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  return normalized;
}

function getSmartBossUsers() {
  return readStorageJson(SMART_BOSS_STORAGE.users, []);
}

function setSmartBossUsers(users) {
  writeStorageJson(SMART_BOSS_STORAGE.users, users);
}

function getSmartBossSession() {
  return readStorageJson(SMART_BOSS_STORAGE.session, null);
}

function setSmartBossSession(session) {
  if (!isStorageAvailable()) return;

  if (session) {
    writeStorageJson(SMART_BOSS_STORAGE.session, session);
  } else {
    window.localStorage.removeItem(SMART_BOSS_STORAGE.session);
  }
}

function getCurrentSmartBossUser() {
  const session = getSmartBossSession();
  if (!session?.userId) return null;

  return getSmartBossUsers().find((user) => user.id === session.userId) || null;
}

function saveUpdatedUser(updatedUser) {
  const users = getSmartBossUsers();
  const index = users.findIndex((user) => user.id === updatedUser.id);
  if (index === -1) return null;

  users[index] = updatedUser;
  setSmartBossUsers(users);
  return updatedUser;
}

function updateCurrentSmartBossUser(mutator) {
  const currentUser = getCurrentSmartBossUser();
  if (!currentUser) return null;

  const draft = {
    ...currentUser,
    usageByDate: { ...(currentUser.usageByDate || {}) },
  };

  const result = mutator(draft) || draft;
  return saveUpdatedUser(result);
}

async function registerSmartBossUser({ name, email, password }) {
  const cleanName = String(name || "").trim();
  const cleanEmail = normalizeEmail(email);
  const cleanPassword = String(password || "");

  if (!cleanName || !cleanEmail || !cleanPassword) {
    throw new Error("Please fill in your name, email, and password.");
  }

  if (cleanPassword.length < 6) {
    throw new Error("Use a password with at least 6 characters.");
  }

  const users = getSmartBossUsers();
  if (users.some((user) => user.email === cleanEmail)) {
    throw new Error("An account with that email already exists.");
  }

  const passwordHash = await hashSecret(cleanPassword);
  const newUser = {
    id: createSmartBossUserId(),
    name: cleanName,
    email: cleanEmail,
    passwordHash,
    role: "user",
    plan: "free",
    createdAt: new Date().toISOString(),
    usageByDate: {},
  };

  users.push(newUser);
  setSmartBossUsers(users);
  setSmartBossSession({
    userId: newUser.id,
    email: newUser.email,
    loggedInAt: new Date().toISOString(),
  });

  return newUser;
}

async function loginSmartBossUser({ email, password }) {
  const cleanEmail = normalizeEmail(email);
  const cleanPassword = String(password || "");
  const user = getSmartBossUsers().find((item) => item.email === cleanEmail);

  if (!user) {
    throw new Error("No account was found for that email.");
  }

  const passwordHash = await hashSecret(cleanPassword);
  if (user.passwordHash !== passwordHash) {
    throw new Error("Incorrect password.");
  }

  setSmartBossSession({
    userId: user.id,
    email: user.email,
    loggedInAt: new Date().toISOString(),
  });

  return user;
}

function logoutSmartBossUser() {
  setSmartBossSession(null);
}

function getDefaultPublicConfig() {
  return {
    supportEmail: "support@smartbossai.com",
    paymentLinks: {
      monthly: "",
      yearly: "",
      lifetime: "",
      paypal: "",
    },
    freeAccess: {
      dailyRequests: SMART_BOSS_DEFAULT_ACCESS.freeDailyRequests,
      promoCode: SMART_BOSS_DEFAULT_ACCESS.freePromoCode,
      promoBonusRequests: SMART_BOSS_DEFAULT_ACCESS.freePromoBonusRequests,
      maxDailyPromoRedeems: SMART_BOSS_DEFAULT_ACCESS.maxDailyPromoRedeems,
    },
    plans: {
      free: { name: "Free Starter" },
      pro: { name: "Smart Boss Pro" },
      admin: { name: "Admin Unlimited" },
    },
  };
}

async function loadSmartBossPublicConfig() {
  if (smartBossPublicConfigPromise) {
    return smartBossPublicConfigPromise;
  }

  smartBossPublicConfigPromise = (async () => {
    try {
      const response = await fetchApi("/api/public-config", { method: "GET" });
      if (!response.ok) {
        throw new Error(`Config request failed with ${response.status}`);
      }

      const config = await response.json();
      smartBossPublicConfigCache = {
        ...getDefaultPublicConfig(),
        ...config,
        freeAccess: {
          ...getDefaultPublicConfig().freeAccess,
          ...(config.freeAccess || {}),
        },
        paymentLinks: {
          ...getDefaultPublicConfig().paymentLinks,
          ...(config.paymentLinks || {}),
        },
        plans: {
          ...getDefaultPublicConfig().plans,
          ...(config.plans || {}),
        },
      };

      return smartBossPublicConfigCache;
    } catch (_) {
      smartBossPublicConfigCache = getDefaultPublicConfig();
      return smartBossPublicConfigCache;
    }
  })();

  return smartBossPublicConfigPromise;
}

function getFreeAccessConfigSync() {
  return (smartBossPublicConfigCache || getDefaultPublicConfig()).freeAccess;
}

function getCurrentUsageSnapshot(user = getCurrentSmartBossUser()) {
  if (!user) {
    return {
      plan: "guest",
      unlimited: false,
      usedToday: 0,
      remainingToday: 0,
      totalToday: 0,
      bonusToday: 0,
      redeemsToday: 0,
    };
  }

  if (user.plan === "admin" || user.plan === "pro") {
    return {
      plan: user.plan,
      unlimited: true,
      usedToday: 0,
      remainingToday: Infinity,
      totalToday: Infinity,
      bonusToday: 0,
      redeemsToday: 0,
    };
  }

  const freeAccess = getFreeAccessConfigSync();
  const todayKey = getTodayKey();
  const usage = user.usageByDate?.[todayKey] || {
    used: 0,
    bonusCredits: 0,
    promoRedeems: 0,
  };
  const totalToday = freeAccess.dailyRequests + usage.bonusCredits;

  return {
    plan: user.plan,
    unlimited: false,
    usedToday: usage.used,
    remainingToday: Math.max(totalToday - usage.used, 0),
    totalToday,
    bonusToday: usage.bonusCredits,
    redeemsToday: usage.promoRedeems,
  };
}

function reserveAiUsageOrThrow() {
  const user = getCurrentSmartBossUser();
  if (!user) {
    throw new Error("Please register or log in to use the AI.");
  }

  if (user.plan === "admin" || user.plan === "pro") {
    return () => {};
  }

  const freeAccess = getFreeAccessConfigSync();
  const todayKey = getTodayKey();
  let applied = false;

  const updatedUser = updateCurrentSmartBossUser((draft) => {
    const usage = draft.usageByDate[todayKey] || {
      used: 0,
      bonusCredits: 0,
      promoRedeems: 0,
    };
    const total = freeAccess.dailyRequests + usage.bonusCredits;

    if (usage.used >= total) {
      throw new Error(
        `Free AI limit reached. Use ${freeAccess.promoCode} in Settings for ${freeAccess.promoBonusRequests} extra uses. You can redeem it ${freeAccess.maxDailyPromoRedeems} times each day, or upgrade in Pricing.`,
      );
    }

    usage.used += 1;
    draft.usageByDate[todayKey] = usage;
    applied = true;
    return draft;
  });

  if (!updatedUser || !applied) {
    throw new Error("Could not reserve AI usage for this request.");
  }

  let refunded = false;
  return () => {
    if (refunded || !applied) return;
    refunded = true;

    updateCurrentSmartBossUser((draft) => {
      const usage = draft.usageByDate[todayKey];
      if (usage?.used > 0) {
        usage.used -= 1;
      }
      draft.usageByDate[todayKey] = usage;
      return draft;
    });
  };
}

function applyLocalAccessCode(code) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  if (!normalizedCode) {
    throw new Error("Enter an access code first.");
  }

  const user = getCurrentSmartBossUser();
  if (!user) {
    throw new Error("Please log in before redeeming a code.");
  }

  if (normalizedCode === SMART_BOSS_DEFAULT_ACCESS.adminCode) {
    updateCurrentSmartBossUser((draft) => {
      draft.plan = "admin";
      draft.role = "admin";
      draft.adminUnlockedAt = new Date().toISOString();
      return draft;
    });

    return {
      ok: true,
      plan: "admin",
      message: "Admin unlimited access unlocked.",
    };
  }

  const freeAccess = getFreeAccessConfigSync();

  if (normalizedCode === String(freeAccess.promoCode || SMART_BOSS_DEFAULT_ACCESS.freePromoCode).toUpperCase()) {
    const todayKey = getTodayKey();

    updateCurrentSmartBossUser((draft) => {
      const usage = draft.usageByDate[todayKey] || {
        used: 0,
        bonusCredits: 0,
        promoRedeems: 0,
      };

      if (usage.promoRedeems >= freeAccess.maxDailyPromoRedeems) {
        throw new Error(
          `${freeAccess.promoCode} has already been used ${freeAccess.maxDailyPromoRedeems} times today.`,
        );
      }

      usage.promoRedeems += 1;
      usage.bonusCredits += freeAccess.promoBonusRequests;
      draft.usageByDate[todayKey] = usage;
      return draft;
    });

    return {
      ok: true,
      plan: "free",
      message: `${freeAccess.promoBonusRequests} extra AI uses added for today.`,
    };
  }

  throw new Error("This code needs server validation.");
}

async function redeemSmartBossAccessCode(code) {
  try {
    return applyLocalAccessCode(code);
  } catch (error) {
    if (error.message !== "This code needs server validation.") {
      throw error;
    }
  }

  const response = await fetchApi("/api/redeem-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Could not redeem access code.");
  }

  updateCurrentSmartBossUser((draft) => {
    draft.plan = payload.plan || draft.plan;
    draft.role = payload.role || draft.role;
    draft.unlockedAt = new Date().toISOString();
    return draft;
  });

  return payload;
}

function ensureNavLink(navList, href, label, options = {}) {
  if (!navList) return null;
  const existing = Array.from(navList.querySelectorAll("a")).find((link) => link.getAttribute("href") === href);
  if (existing) return existing;

  const listItem = document.createElement("li");
  const link = document.createElement("a");
  link.href = href;
  link.textContent = label;

  if (options.id) {
    link.id = options.id;
  }

  if (options.onClick) {
    link.addEventListener("click", options.onClick);
  }

  listItem.appendChild(link);
  navList.appendChild(listItem);
  return link;
}

function initAuthNav() {
  const navList = document.getElementById("nav-links");
  if (!navList) return;

  ensureNavLink(navList, "revenue.html", "Revenue AI");
  ensureNavLink(navList, "pricing.html", "Pricing");
  ensureNavLink(navList, "audit.html", "Money Audit");
  ensureNavLink(navList, "cv.html", "CV Creator");

  const user = getCurrentSmartBossUser();
  if (user) {
    ensureNavLink(navList, "settings.html", "Settings");
    ensureNavLink(navList, "#logout", "Logout", {
      id: "logout-link",
      onClick(event) {
        event.preventDefault();
        logoutSmartBossUser();
        showToast("Logged out successfully", "success");
        window.location.href = "login.html";
      },
    });
    return;
  }

  ensureNavLink(navList, "login.html", "Login");
  ensureNavLink(navList, "register.html", "Register");
}

function sanitizeAiText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/^\s*-\s+/gm, "• ")
    .replace(/^\s*\+\s+/gm, "• ");
}

// ── SIMPLE MARKDOWN PARSER ───────────────────────────────
function parseMarkdown(text) {
  let html = sanitizeAiText(text)
    // Escape HTML (keep < > safe)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    // Code blocks
    .replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    // H3
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    // H2
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    // H1
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Horizontal rule
    .replace(/^---+$/gm, "<hr>")
    // Unordered list items
    .replace(/^[•\-\*] (.+)$/gm, "<li>$1</li>")
    // Ordered list items
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
    // Paragraphs (double newline → <p>)
    .replace(/\n{2,}/g, "</p><p>")
    // Single line breaks
    .replace(/\n/g, "<br>");

  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*?<\/li>(?:<br><li>.*?<\/li>)*)/g, (match) => {
    const items = match.replace(/<br>/g, "");
    return `<ul>${items}</ul>`;
  });

  return `<p>${html}</p>`;
}

// ── AUTO RESIZE TEXTAREA ─────────────────────────────────
function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
}

// ── TOAST NOTIFICATIONS ──────────────────────────────────
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container") ||
    (() => {
      const c = document.createElement("div");
      c.id = "toast-container";
      c.className = "toast-container";
      document.body.appendChild(c);
      return c;
    })();

  const icons = { success: "✅", error: "❌", info: "💡", copy: "📋" };
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || "💡"}</span> ${message}`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = "0"; toast.style.transform = "translateX(20px)"; }, 2500);
  setTimeout(() => toast.remove(), 2900);
}

// ── COPY TO CLIPBOARD ────────────────────────────────────
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => showToast("Copied to clipboard!", "copy"));
}

const externalScriptPromises = new Map();

function loadExternalScript(src) {
  if (externalScriptPromises.has(src)) {
    return externalScriptPromises.get(src);
  }

  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
      if (existing.dataset.loaded === "true") resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });

  externalScriptPromises.set(src, promise);
  return promise;
}

function slugifyDownloadName(value, fallback = "smart-boss-export") {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

function triggerFileDownload({ filename, content, mimeType = "application/octet-stream" }) {
  const blob = content instanceof Blob
    ? content
    : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadTextFile(filename, text) {
  triggerFileDownload({
    filename,
    content: String(text || ""),
    mimeType: "text/plain;charset=utf-8",
  });
}

function buildDownloadHtmlDocument({ title, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${String(title || "Smart Boss Export")}</title>
  <style>
    body {
      font-family: Georgia, "Times New Roman", serif;
      margin: 2rem auto;
      max-width: 8.5in;
      color: #201c17;
      background: #fffdf8;
      line-height: 1.65;
      padding: 0 1rem 2rem;
    }
    h1, h2, h3 { line-height: 1.2; }
    p, li { font-size: 1rem; }
    ul { padding-left: 1.2rem; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function downloadHtmlFile(filename, title, bodyHtml) {
  triggerFileDownload({
    filename,
    content: buildDownloadHtmlDocument({ title, bodyHtml }),
    mimeType: "text/html;charset=utf-8",
  });
}

async function ensureHtml2CanvasLoaded() {
  await loadExternalScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");

  if (!window.html2canvas) {
    throw new Error("Image export library did not load.");
  }

  return window.html2canvas;
}

async function ensureJsPdfLoaded() {
  await loadExternalScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");

  if (!window.jspdf?.jsPDF) {
    throw new Error("PDF export library did not load.");
  }

  return window.jspdf.jsPDF;
}

function cloneElementForExport(element) {
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.left = "-20000px";
  wrapper.style.top = "0";
  wrapper.style.width = `${Math.ceil(element.scrollWidth || element.clientWidth || 816)}px`;
  wrapper.style.padding = "0";
  wrapper.style.margin = "0";
  wrapper.style.background = "#ffffff";
  wrapper.style.zIndex = "-1";

  const clone = element.cloneNode(true);
  clone.removeAttribute("contenteditable");
  clone.querySelectorAll("[contenteditable='true']").forEach((node) => node.removeAttribute("contenteditable"));
  clone.style.boxShadow = "none";
  clone.style.margin = "0";

  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);
  return { wrapper, clone };
}

async function renderElementToCanvas(element, scale = 2) {
  if (!element) {
    throw new Error("There is no export content to download yet.");
  }

  const html2canvas = await ensureHtml2CanvasLoaded();
  const { wrapper, clone } = cloneElementForExport(element);

  try {
    return await html2canvas(clone, {
      scale,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      windowWidth: clone.scrollWidth || clone.clientWidth || wrapper.clientWidth,
      windowHeight: clone.scrollHeight || clone.clientHeight || wrapper.clientHeight,
    });
  } finally {
    wrapper.remove();
  }
}

async function downloadElementImage({ element, filename, mimeType = "image/png", scale = 2 }) {
  const canvas = await renderElementToCanvas(element, scale);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, 1));
  if (!blob) {
    throw new Error("Could not create image download.");
  }

  triggerFileDownload({
    filename,
    content: blob,
    mimeType,
  });
}

async function downloadElementPdf({ element, filename, options = {} }) {
  const canvas = await renderElementToCanvas(element, options.scale || 2);
  const jsPDF = await ensureJsPdfLoaded();
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "letter",
    compress: true,
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = options.marginPt ?? 24;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  const pixelsPerPage = Math.max(1, Math.floor((contentHeight * canvasWidth) / contentWidth));
  let offsetY = 0;
  let pageIndex = 0;

  while (offsetY < canvasHeight) {
    const sliceHeight = Math.min(pixelsPerPage, canvasHeight - offsetY);
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvasWidth;
    pageCanvas.height = sliceHeight;

    const context = pageCanvas.getContext("2d");
    context.drawImage(
      canvas,
      0,
      offsetY,
      canvasWidth,
      sliceHeight,
      0,
      0,
      canvasWidth,
      sliceHeight,
    );

    const imageData = pageCanvas.toDataURL("image/png", 1);
    const imageHeight = (sliceHeight * contentWidth) / canvasWidth;

    if (pageIndex > 0) {
      pdf.addPage();
    }

    pdf.addImage(imageData, "PNG", margin, margin, contentWidth, imageHeight, undefined, "FAST");
    offsetY += sliceHeight;
    pageIndex += 1;
  }

  pdf.save(filename);
}

function toggleEditableElement(elementId, button) {
  const element = typeof elementId === "string" ? document.getElementById(elementId) : elementId;
  if (!element || !button) return;

  const isEditing = element.getAttribute("contenteditable") === "true";
  if (isEditing) {
    element.removeAttribute("contenteditable");
    element.classList.remove("is-editing-output");
    button.textContent = button.dataset.editLabel || "Edit Output";
    showToast("Edits saved in the preview", "success");
    return;
  }

  element.setAttribute("contenteditable", "true");
  element.classList.add("is-editing-output");
  button.dataset.editLabel = button.dataset.editLabel || button.textContent || "Edit Output";
  button.textContent = "Save Edits";
  element.focus();
  showToast("You can now edit the generated output directly", "info");
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsArrayBuffer(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  });
}

async function extractPdfText(file) {
  await loadExternalScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
  if (!window.pdfjsLib) throw new Error("PDF reader library did not load");

  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const arrayBuffer = await readFileAsArrayBuffer(file);
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(" ");
    pages.push(`Page ${pageNumber}:\n${text}`);
  }

  return pages.join("\n\n");
}

async function extractDocxText(file) {
  await loadExternalScript("https://unpkg.com/mammoth@1.9.0/mammoth.browser.min.js");
  if (!window.mammoth) throw new Error("DOCX reader library did not load");

  const arrayBuffer = await readFileAsArrayBuffer(file);
  const result = await window.mammoth.extractRawText({ arrayBuffer });
  return result.value || "";
}

async function extractLegacyDocText(file) {
  const arrayBuffer = await readFileAsArrayBuffer(file);
  const byteArray = new Uint8Array(arrayBuffer);
  let text = "";

  for (let index = 0; index < byteArray.length; index += 1) {
    const code = byteArray[index];
    if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9) {
      text += String.fromCharCode(code);
    }
  }

  return text.replace(/\s{2,}/g, " ").trim();
}

function truncateDocumentText(text, maxLength = 45000) {
  const cleanText = String(text || "").trim();
  if (cleanText.length <= maxLength) return cleanText;
  return `${cleanText.slice(0, maxLength)}\n\n[Document truncated for processing due to length.]`;
}

async function extractTextFromFile(file) {
  if (!file) throw new Error("No file selected");

  const extension = file.name.toLowerCase().split(".").pop();

  if (extension === "pdf") return extractPdfText(file);
  if (extension === "docx") return extractDocxText(file);
  if (extension === "doc") return extractLegacyDocText(file);
  if (["txt", "md", "rtf"].includes(extension)) return readFileAsText(file);

  throw new Error("Unsupported file type. Use PDF, DOC, DOCX, TXT, or MD.");
}

function getSpeechRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function supportsSpeechRecognition() {
  return Boolean(getSpeechRecognitionConstructor());
}

function supportsSpeechSynthesis() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function stopSpeaking() {
  if (supportsSpeechSynthesis()) {
    window.speechSynthesis.cancel();
  }
}

function speakText(text) {
  if (!supportsSpeechSynthesis()) {
    throw new Error("Text-to-speech is not supported in this browser.");
  }

  const spokenText = String(text || "").replace(/\s+/g, " ").trim();
  if (!spokenText) {
    throw new Error("There is no text to read aloud.");
  }

  stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(spokenText);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}

function createDictationSession({ textarea, onStart, onStop, onError }) {
  const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
  if (!SpeechRecognitionCtor) {
    throw new Error("Voice dictation is not supported in this browser.");
  }

  const recognition = new SpeechRecognitionCtor();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = true;

  const originalValue = textarea ? textarea.value.trim() : "";
  let finalTranscript = "";
  let stoppedManually = false;

  recognition.onstart = () => {
    if (onStart) onStart();
  };

  recognition.onresult = (event) => {
    let interimTranscript = "";

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0]?.transcript || "";
      if (result.isFinal) finalTranscript += `${transcript} `;
      else interimTranscript += transcript;
    }

    const combined = [originalValue, finalTranscript.trim(), interimTranscript.trim()]
      .filter(Boolean)
      .join(originalValue ? "\n" : " ")
      .replace(/\n /g, "\n");

    if (textarea) {
      textarea.value = combined.trim();
      autoResize(textarea);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  recognition.onerror = (event) => {
    if (onError) onError(event.error || "Voice dictation failed.");
  };

  recognition.onend = () => {
    if (onStop) onStop(stoppedManually);
  };

  return {
    start() {
      recognition.start();
    },
    stop() {
      stoppedManually = true;
      recognition.stop();
    },
  };
}

async function streamSmartBossResponse({ message, mode, history = [], onToken, onDone }) {
  const refundUsage = reserveAiUsageOrThrow();
  let res;

  try {
    res = await fetchApi("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, mode, history }),
    });
  } catch (error) {
    refundUsage();
    throw error;
  }

  if (!res.ok) {
    refundUsage();
    let detail = `Server error: ${res.status}`;

    try {
      const errorJson = await res.json();
      detail = errorJson.detail || errorJson.error || detail;
    } catch (_) {}

    throw new Error(detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim() || line === "data: [DONE]" || !line.startsWith("data: ")) continue;

        try {
          const json = JSON.parse(line.slice(6));
          if (json.token) {
            fullText += json.token;
            if (onToken) onToken(fullText, json.token);
          }
        } catch (_) {}
      }
    }
  } catch (error) {
    refundUsage();
    throw error;
  }

  const cleanText = sanitizeAiText(fullText);
  if (onDone) onDone(cleanText);
  return cleanText;
}

// ── CHAT ENGINE ──────────────────────────────────────────
class SmartBossChat {
  constructor(options) {
    this.mode = options.mode || "business";
    this.history = [];
    this.isStreaming = false;
    this.lastAssistantText = "";
    this.dictationSession = null;
    this.dictationActive = false;

    this.messagesEl = document.getElementById("chat-messages");
    this.inputEl = document.getElementById("chat-input");
    this.sendBtn = document.getElementById("send-btn");
    this.welcomeEl = document.getElementById("chat-welcome");
    this.voiceInputBtn = document.getElementById("voice-input-btn");
    this.readResponseBtn = document.getElementById("read-response-btn");
    this.stopVoiceBtn = document.getElementById("stop-voice-btn");

    this.init();
  }

  init() {
    if (!this.inputEl) return;

    this.inputEl.addEventListener("input", () => {
      autoResize(this.inputEl);
      const charCount = document.getElementById("char-count");
      if (charCount) charCount.textContent = `${this.inputEl.value.length}/2000`;
    });

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });

    if (this.sendBtn) {
      this.sendBtn.addEventListener("click", () => this.send());
    }

    if (this.voiceInputBtn) {
      this.voiceInputBtn.addEventListener("click", () => this.toggleDictation());
      if (!supportsSpeechRecognition()) this.voiceInputBtn.disabled = true;
    }

    if (this.readResponseBtn) {
      this.readResponseBtn.addEventListener("click", () => this.readLastResponse());
      if (!supportsSpeechSynthesis()) this.readResponseBtn.disabled = true;
    }

    if (this.stopVoiceBtn) {
      this.stopVoiceBtn.addEventListener("click", () => stopSpeaking());
      if (!supportsSpeechSynthesis()) this.stopVoiceBtn.disabled = true;
    }

    // Suggestion chips
    document.querySelectorAll(".suggestion-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        this.inputEl.value = chip.dataset.prompt || chip.textContent.trim();
        autoResize(this.inputEl);
        this.send();
      });
    });

    // Mode buttons in sidebar
    document.querySelectorAll(".sidebar-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".sidebar-mode-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.mode = btn.dataset.mode;
        this.history = [];
        this.clearMessages();
      });
    });

    // New chat
    const newChatBtn = document.getElementById("new-chat-btn");
    if (newChatBtn) {
      newChatBtn.addEventListener("click", () => {
        this.history = [];
        this.clearMessages();
      });
    }
  }

  clearMessages() {
    if (this.messagesEl) this.messagesEl.innerHTML = "";
    if (this.welcomeEl) this.welcomeEl.style.display = "flex";
    this.lastAssistantText = "";
  }

  updateVoiceButtonState(active) {
    if (!this.voiceInputBtn) return;
    this.voiceInputBtn.classList.toggle("is-listening", active);
    this.voiceInputBtn.title = active ? "Stop dictation" : "Start dictation";
    this.voiceInputBtn.setAttribute("aria-label", active ? "Stop dictation" : "Start dictation");
  }

  toggleDictation() {
    if (!this.inputEl) return;

    if (this.dictationActive && this.dictationSession) {
      this.dictationSession.stop();
      return;
    }

    try {
      this.dictationSession = createDictationSession({
        textarea: this.inputEl,
        onStart: () => {
          this.dictationActive = true;
          this.updateVoiceButtonState(true);
          showToast("Voice dictation started", "info");
        },
        onStop: () => {
          this.dictationActive = false;
          this.updateVoiceButtonState(false);
        },
        onError: (error) => {
          this.dictationActive = false;
          this.updateVoiceButtonState(false);
          showToast(`Voice input error: ${error}`, "error");
        },
      });
      this.dictationSession.start();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  readLastResponse() {
    try {
      speakText(this.lastAssistantText);
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async send(overrideMessage = null) {
    const text = overrideMessage || (this.inputEl?.value.trim() || "");
    if (!text || this.isStreaming) return;
    const priorHistory = this.history.slice(-6);

    // Hide welcome, clear input
    if (this.welcomeEl) this.welcomeEl.style.display = "none";
    if (this.inputEl) {
      this.inputEl.value = "";
      autoResize(this.inputEl);
    }

    // Add user message
    this.addMessage("user", text);

    // Add AI placeholder
    const aiBubble = this.addMessage("ai", "", true);
    this.isStreaming = true;
    if (this.sendBtn) this.sendBtn.disabled = true;

    try {
      const cleanResponse = await streamSmartBossResponse({
        message: text,
        mode: this.mode,
        history: priorHistory,
        onToken: (fullText) => {
          this.updateBubble(aiBubble, fullText, true);
        },
      });

      this.updateBubble(aiBubble, cleanResponse, false);
      this.history.push({ role: "user", content: text });
      this.history.push({ role: "assistant", content: cleanResponse });
      this.lastAssistantText = cleanResponse;
      this.addToHistory(text);

    } catch (err) {
      const errorText = `Connection Error:\n\nCould not reach the AI service. Please check the server is running.\n\nDetails: ${err.message}`;
      this.updateBubble(aiBubble, errorText, false);
      this.lastAssistantText = errorText;
    } finally {
      this.isStreaming = false;
      if (this.sendBtn) this.sendBtn.disabled = false;
    }
  }

  addMessage(role, content, isStreaming = false) {
    const wrapper = document.createElement("div");
    wrapper.className = `message ${role}`;

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = role === "ai" ? "👑" : "👤";

    const bubble = document.createElement("div");
    bubble.className = `message-bubble ${isStreaming ? "typing-cursor" : ""}`;
    const cleanContent = role === "ai" ? sanitizeAiText(content) : content;

    if (role === "ai") {
      bubble.innerHTML = cleanContent ? parseMarkdown(cleanContent) : "";
    } else {
      bubble.textContent = cleanContent;
    }

    // Copy button for AI messages
    if (role === "ai" && !isStreaming) {
      const copyBtn = document.createElement("button");
      copyBtn.className = "btn btn-ghost btn-sm";
      copyBtn.style.cssText = "margin-top:0.75rem;font-size:0.75rem;padding:4px 10px;";
      copyBtn.innerHTML = "📋 Copy";
      copyBtn.onclick = () => copyText(cleanContent);
      bubble.appendChild(copyBtn);
    }

    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
    this.messagesEl.appendChild(wrapper);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    return bubble;
  }

  updateBubble(bubble, content, streaming) {
    const cleanContent = sanitizeAiText(content);
    bubble.className = `message-bubble ${streaming ? "typing-cursor" : ""}`;
    bubble.innerHTML = parseMarkdown(cleanContent);

    if (!streaming && cleanContent) {
      const copyBtn = document.createElement("button");
      copyBtn.className = "btn btn-ghost btn-sm";
      copyBtn.style.cssText = "margin-top:0.75rem;font-size:0.75rem;padding:4px 10px;";
      copyBtn.innerHTML = "📋 Copy";
      copyBtn.onclick = () => copyText(cleanContent);
      bubble.appendChild(copyBtn);
    }

    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  addToHistory(query) {
    const historyList = document.getElementById("chat-history-list");
    if (!historyList) return;
    const item = document.createElement("div");
    item.className = "history-item";
    item.textContent = query.slice(0, 40) + (query.length > 40 ? "…" : "");
    item.title = query;
    historyList.prepend(item);
    while (historyList.children.length > 20) historyList.lastChild.remove();
  }
}

// ── PROMPT GENERATOR (prompt.html) ──────────────────────
class PromptGenerator {
  constructor() {
    this.form = document.getElementById("prompt-form");
    this.resultBox = document.getElementById("result-box");
    this.resultContent = document.getElementById("result-content");
    this.generateBtn = document.getElementById("generate-btn");
    this.copyBtn = document.getElementById("copy-prompt-btn");
    this.lastPrompt = "";
    this.init();
  }

  init() {
    if (!this.form) return;
    this.form.addEventListener("submit", (e) => { e.preventDefault(); this.generate(); });
    if (this.copyBtn) this.copyBtn.addEventListener("click", () => copyText(this.lastPrompt));
  }

  async generate() {
    const businessType = document.getElementById("business-type")?.value || "";
    const websiteType = document.getElementById("website-type")?.value || "";
    const audience = document.getElementById("audience")?.value || "";
    const goals = document.getElementById("goals")?.value || "";
    const style = document.getElementById("style-pref")?.value || "";
    const features = document.getElementById("features")?.value || "";

    if (!businessType || !websiteType) { showToast("Please fill in the required fields", "error"); return; }

    const message = `Generate a comprehensive, professional website design prompt for:
- Business/Project: ${businessType}
- Website Type: ${websiteType}
- Target Audience: ${audience || "General audience"}
- Main Goals: ${goals || "Build online presence"}
- Style Preference: ${style || "Modern and professional"}
- Key Features Needed: ${features || "Standard features"}

Create a detailed, ready-to-use prompt that covers all design and development requirements.`;

    this.generateBtn.disabled = true;
    this.generateBtn.innerHTML = '<div class="spinner"></div> Generating...';
    if (this.resultBox) this.resultBox.style.display = "block";
    if (this.resultContent) {
      this.resultContent.textContent = "";
      this.resultContent.className = "result-content typing-cursor";
    }

    let fullText = "";

    try {
      const finalText = await streamSmartBossResponse({
        message,
        mode: "prompt",
        history: [],
        onToken: (streamedText) => {
          fullText = streamedText;
          if (this.resultContent) this.resultContent.textContent = sanitizeAiText(streamedText);
          if (this.resultBox) this.resultBox.scrollTop = this.resultBox.scrollHeight;
        },
      });

      this.lastPrompt = sanitizeAiText(finalText || fullText);
      if (this.resultContent) {
        this.resultContent.className = "result-content";
        this.resultContent.textContent = this.lastPrompt;
      }
      showToast("Prompt generated successfully!", "success");

    } catch (err) {
      if (this.resultContent) this.resultContent.textContent = `Error generating prompt: ${err.message}`;
      showToast("Generation failed", "error");
    } finally {
      this.generateBtn.disabled = false;
      this.generateBtn.innerHTML = "✨ Generate Prompt";
    }
  }
}

// ── NAVIGATION ───────────────────────────────────────────
function initNav() {
  // Active nav link
  const normalizeNavPath = (value) => {
    const path = String(value || "")
      .split("?")[0]
      .split("#")[0]
      .replace(/\\/g, "/")
      .replace(/^https?:\/\/[^/]+/i, "")
      .replace(/^\/+/, "")
      .toLowerCase();

    if (!path || path === "index" || path === "index.html") {
      return "index.html";
    }

    if (path.endsWith(".html")) {
      return path;
    }

    return `${path}.html`;
  };

  const currentPath = normalizeNavPath(window.location.pathname);
  document.querySelectorAll(".nav-links a").forEach((a) => {
    const href = normalizeNavPath(a.getAttribute("href"));
    if (href === currentPath) {
      a.classList.add("active");
    }
  });

  // Mobile nav toggle
  const menuBtn = document.getElementById("nav-menu-btn");
  const navLinks = document.getElementById("nav-links");
  if (menuBtn && navLinks) {
    menuBtn.addEventListener("click", () => navLinks.classList.toggle("open"));
    document.addEventListener("click", (e) => {
      if (!menuBtn.contains(e.target) && !navLinks.contains(e.target)) {
        navLinks.classList.remove("open");
      }
    });
  }

  // Mobile sidebar
  const sidebarBtn = document.getElementById("sidebar-toggle");
  const sidebar = document.getElementById("chat-sidebar");
  if (sidebarBtn && sidebar) {
    sidebarBtn.addEventListener("click", () => sidebar.classList.toggle("open"));
  }

  // Scroll nav shadow
  window.addEventListener("scroll", () => {
    const nav = document.querySelector(".nav");
    if (nav) nav.style.borderBottomColor = window.scrollY > 20 ? "rgba(201,168,76,0.3)" : "rgba(201,168,76,0.15)";
  });
}

// ── COUNTER ANIMATION ────────────────────────────────────
function animateCounters() {
  document.querySelectorAll("[data-count]").forEach((el) => {
    const target = parseInt(el.dataset.count, 10);
    const suffix = el.dataset.suffix || "";
    let current = 0;
    const step = target / 60;
    const timer = setInterval(() => {
      current += step;
      if (current >= target) { current = target; clearInterval(timer); }
      el.textContent = Math.floor(current).toLocaleString() + suffix;
    }, 25);
  });
}

// ── INTERSECTION OBSERVER (scroll animations) ────────────
function initScrollAnimations() {
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = "1";
        entry.target.style.transform = "translateY(0)";
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll(".feature-card, .step-item, .idea-card").forEach((el) => {
    el.style.opacity = "0";
    el.style.transform = "translateY(20px)";
    el.style.transition = "opacity 0.5s ease, transform 0.5s ease";
    obs.observe(el);
  });
}

// ── INIT ─────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initAuthNav();
  initNav();
  initScrollAnimations();

  // Counters on index
  const statsSection = document.querySelector(".stats-bar");
  if (statsSection) {
    const statsObs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) { animateCounters(); statsObs.disconnect(); }
    }, { threshold: 0.5 });
    statsObs.observe(statsSection);
  }

  // Init chat if on chat page
  if (document.getElementById("chat-messages")) {
    const mode = document.body.dataset.mode || "business";
    window.chatInstance = new SmartBossChat({ mode });
  }

  // Init prompt generator
  if (document.getElementById("prompt-form")) {
    new PromptGenerator();
  }
});

// ── EXPORTED HELPERS ─────────────────────────────────────
window.SmartBossChat = SmartBossChat;
window.copyText = copyText;
window.showToast = showToast;
window.parseMarkdown = parseMarkdown;
window.sanitizeAiText = sanitizeAiText;
window.slugifyDownloadName = slugifyDownloadName;
window.downloadTextFile = downloadTextFile;
window.downloadHtmlFile = downloadHtmlFile;
window.downloadElementPdf = downloadElementPdf;
window.downloadElementImage = downloadElementImage;
window.toggleEditableElement = toggleEditableElement;
window.streamSmartBossResponse = streamSmartBossResponse;
window.extractTextFromFile = extractTextFromFile;
window.truncateDocumentText = truncateDocumentText;
window.speakText = speakText;
window.stopSpeaking = stopSpeaking;
window.supportsSpeechRecognition = supportsSpeechRecognition;
window.supportsSpeechSynthesis = supportsSpeechSynthesis;
window.createDictationSession = createDictationSession;
window.registerSmartBossUser = registerSmartBossUser;
window.loginSmartBossUser = loginSmartBossUser;
window.logoutSmartBossUser = logoutSmartBossUser;
window.getCurrentSmartBossUser = getCurrentSmartBossUser;
window.getCurrentUsageSnapshot = getCurrentUsageSnapshot;
window.redeemSmartBossAccessCode = redeemSmartBossAccessCode;
window.loadSmartBossPublicConfig = loadSmartBossPublicConfig;
