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
  const res = await fetchApi("/api/chat", {
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
window.extractTextFromFile = extractTextFromFile;
window.truncateDocumentText = truncateDocumentText;
window.speakText = speakText;
window.stopSpeaking = stopSpeaking;
window.supportsSpeechRecognition = supportsSpeechRecognition;
window.supportsSpeechSynthesis = supportsSpeechSynthesis;
window.createDictationSession = createDictationSession;
