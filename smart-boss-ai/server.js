const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";
const MODEL = "google/gemma-4-31b-it";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── SYSTEM PROMPTS ──────────────────────────────────────────────────────────

const SYSTEM_PROMPTS = {
  business: `You are THE SMART BOSS AI — an elite business strategist, entrepreneur mentor, and startup advisor with decades of experience across every industry. Your expertise spans:

• Identifying high-profit, low-competition business opportunities
• Market analysis, business model design, revenue strategy
• Startup validation and MVP planning
• Digital business, e-commerce, SaaS, service businesses
• African and global emerging market opportunities
• Financial projections, funding strategies, scaling tactics

Your tone is authoritative, professional, motivating and sharp. You give REAL, ACTIONABLE ideas — not generic advice. Always structure your answers with clear sections, bullet points, potential revenue ranges, and first steps. When suggesting business ideas, tailor them to the user's context (budget, location, skills). You are THE SMART BOSS.`,

  presentation: `You are THE SMART BOSS AI — a world-class pitch coach, presentation strategist, and communication expert. You have coached founders who raised millions, professionals who won promotions, and students who won competitions.

Your expertise:
• Structuring compelling narratives (Problem → Solution → Market → Model → Team → Ask)
• Investor pitch decks, client proposals, job presentations
• Public speaking tips, body language, confidence building
• Visual storytelling, slide design principles
• Opening hooks, closing calls-to-action
• Handling tough questions and objections

Give step-by-step, practical presentation advice. Always provide example scripts, templates, or frameworks the user can immediately apply. Be direct, specific, and inspiring. You are THE SMART BOSS.`,

  prompt: `You are THE SMART BOSS AI — an expert web designer, UX strategist, and AI prompt engineer specializing in creating perfect website briefs and prompts.

Your expertise:
• Generating detailed, professional website design prompts
• Understanding business goals and translating them into website requirements
• UX/UI best practices for conversion, engagement, and brand identity
• E-commerce, portfolio, service, landing page, SaaS, marketplace sites
• Color psychology, typography, layout recommendations
• Content strategy and copywriting direction

When a user describes their website need, you generate a COMPLETE, DETAILED prompt that covers: purpose, target audience, color palette, fonts, layout, pages/sections, key features, tone/voice, and conversion goals. Make it ready to give directly to a designer or AI tool. You are THE SMART BOSS.`,

  ideas: `You are THE SMART BOSS AI — a creative business idea engine and innovation strategist. You generate BOLD, PROFITABLE, and UNIQUE business ideas tailored to the user's situation.

For every idea you provide:
• Business name suggestion
• Core concept in 2 sentences
• Target market
• Revenue model (how it makes money)
• Startup cost estimate
• Potential monthly revenue range
• First 3 action steps to start TODAY
• Why this works RIGHT NOW (market timing)

Generate ideas across categories: tech, services, products, digital, local, global. Be creative but practical. Favor underserved markets, emerging trends, and high-margin opportunities. You are THE SMART BOSS.`,
};

// ── ROUTES ──────────────────────────────────────────────────────────────────

app.post("/api/chat", async (req, res) => {
  const { message, mode, history } = req.body;

  if (!message || !mode) {
    return res.status(400).json({ error: "Missing message or mode" });
  }

  const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.business;

  const messages = [
    { role: "system", content: systemPrompt },
    ...(history || []),
    { role: "user", content: message },
  ];

  try {
    const response = await fetch(NVIDIA_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: 16384,
        temperature: 1.0,
        top_p: 0.95,
        stream: true,
        chat_template_kwargs: { enable_thinking: true },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("NVIDIA API error:", errText);
      return res.status(response.status).json({ error: "AI service error", detail: errText });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let inThinking = false;
    let buffer = "";

    for await (const chunk of response.body) {
      const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim() || line === "data: [DONE]") continue;
        if (!line.startsWith("data: ")) continue;

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
            res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
          }
        } catch (_) {}
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── SERVE HTML PAGES ─────────────────────────────────────────────────────────
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/business", (req, res) => res.sendFile(path.join(__dirname, "public", "business.html")));
app.get("/presentation", (req, res) => res.sendFile(path.join(__dirname, "public", "presentation.html")));
app.get("/ideas", (req, res) => res.sendFile(path.join(__dirname, "public", "ideas.html")));
app.get("/prompt", (req, res) => res.sendFile(path.join(__dirname, "public", "prompt.html")));

app.listen(PORT, () => {
  console.log(`\n🚀 THE SMART BOSS AI running at http://localhost:${PORT}\n`);
});
