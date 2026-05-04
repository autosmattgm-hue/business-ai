/* ═══════════════════════════════════════════════════════
   THE SMART BOSS AI — main.js
   Frontend Logic: Chat, Streaming, Markdown, UI Helpers
═══════════════════════════════════════════════════════ */

// ── GLOBALS ─────────────────────────────────────────────
const API_BASE = window.location.origin;

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

async function streamSmartBossResponse({ message, mode, history = [], onToken, onDone }) {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, mode, history }),
  });

  if (!res.ok) {
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

    this.messagesEl = document.getElementById("chat-messages");
    this.inputEl = document.getElementById("chat-input");
    this.sendBtn = document.getElementById("send-btn");
    this.welcomeEl = document.getElementById("chat-welcome");

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
  }

  async send(overrideMessage = null) {
    const text = overrideMessage || (this.inputEl?.value.trim() || "");
    if (!text || this.isStreaming) return;

    // Hide welcome, clear input
    if (this.welcomeEl) this.welcomeEl.style.display = "none";
    if (this.inputEl) {
      this.inputEl.value = "";
      autoResize(this.inputEl);
    }

    // Add user message
    this.addMessage("user", text);
    this.history.push({ role: "user", content: text });

    // Add AI placeholder
    const aiBubble = this.addMessage("ai", "", true);
    this.isStreaming = true;
    if (this.sendBtn) this.sendBtn.disabled = true;

    let fullResponse = "";

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, mode: this.mode, history: this.history.slice(-10) }),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim() || line === "data: [DONE]") continue;
          if (!line.startsWith("data: ")) continue;
          try {
            const json = JSON.parse(line.slice(6));
            if (json.token) {
              fullResponse += json.token;
              this.updateBubble(aiBubble, fullResponse, true);
            }
          } catch (_) {}
        }
      }

      const cleanResponse = sanitizeAiText(fullResponse);
      this.updateBubble(aiBubble, cleanResponse, false);
      this.history.push({ role: "assistant", content: cleanResponse });
      this.addToHistory(text);

    } catch (err) {
      this.updateBubble(aiBubble, `Connection Error:\n\nCould not reach the AI service. Please check the server is running.\n\nDetails: ${err.message}`, false);
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
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, mode: "prompt", history: [] }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          try {
            const json = JSON.parse(line.slice(6));
            if (json.token) {
              fullText += json.token;
              if (this.resultContent) this.resultContent.textContent = sanitizeAiText(fullText);
              this.resultBox.scrollTop = this.resultBox.scrollHeight;
            }
          } catch (_) {}
        }
      }

      this.lastPrompt = sanitizeAiText(fullText);
      if (this.resultContent) this.resultContent.className = "result-content";
      showToast("Prompt generated successfully!", "success");

    } catch (err) {
      if (this.resultContent) this.resultContent.textContent = "Error generating prompt. Please check server.";
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
  const currentPath = window.location.pathname;
  document.querySelectorAll(".nav-links a").forEach((a) => {
    if (a.getAttribute("href") === currentPath ||
        (currentPath === "/" && a.getAttribute("href") === "/") ||
        (currentPath !== "/" && a.getAttribute("href") !== "/" && currentPath.startsWith(a.getAttribute("href")))) {
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
window.streamSmartBossResponse = streamSmartBossResponse;
