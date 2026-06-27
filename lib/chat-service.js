const crypto = require("crypto");

const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL = normalizeModelName(process.env.NVIDIA_MODEL) || "google/gemma-2-2b-it";
const REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.NVIDIA_REQUEST_TIMEOUT_MS,
  12000,
  3000,
  25000,
);
const MAX_MESSAGE_CHARS = parsePositiveInteger(
  process.env.SMARTBOSS_MAX_MESSAGE_CHARS,
  2000,
  100,
  12000,
);
const MAX_HISTORY_ITEMS = parsePositiveInteger(
  process.env.SMARTBOSS_MAX_HISTORY_ITEMS,
  8,
  0,
  20,
);
const CACHE_TTL_MS = parsePositiveInteger(
  process.env.SMARTBOSS_AI_CACHE_TTL_MS,
  5 * 60 * 1000,
  0,
  60 * 60 * 1000,
);
const CACHE_MAX_ITEMS = parsePositiveInteger(
  process.env.SMARTBOSS_AI_CACHE_MAX_ITEMS,
  500,
  0,
  5000,
);
const FALLBACK_MODELS = parseModelList([
  MODEL,
  process.env.NVIDIA_FALLBACK_MODELS || "",
].join(","));
const responseCache = new Map();
const MODEL_MAX_TOKENS = {
  "google/gemma-2-2b-it": 4096,
  "google/gemma-3n-e4b-it": 4096,
  "google/gemma-4-31b-it": 16384,
};

function parsePositiveInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ""), 10);
  const safeValue = Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  return Math.min(Math.max(safeValue, min), max);
}

function normalizeModelName(value) {
  return String(value || "").trim();
}

function parseModelList(value) {
  return String(value || "")
    .split(/[,\n]/)
    .map(normalizeModelName)
    .filter(Boolean)
    .filter((model, index, models) => models.indexOf(model) === index);
}

function trimToMaxChars(value, maxChars = MAX_MESSAGE_CHARS) {
  const text = String(value || "").trim();
  return text.length > maxChars ? text.slice(0, maxChars).trim() : text;
}

function createChatServiceError(message, statusCode = 503, detail = "") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.detail = detail;
  return error;
}

function getChatErrorStatus(error) {
  const statusCode = Number(error?.statusCode);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : 503;
}

function getPublicChatError(error) {
  if (error?.publicMessage) {
    return error.publicMessage;
  }

  return "The AI service is busy right now. Please try again in a moment.";
}

function getProviderErrorMessage(statusCode) {
  if (statusCode === 401 || statusCode === 403) {
    return "The AI service key was rejected. Check NVIDIA_API_KEY in Vercel Environment Variables and redeploy.";
  }

  if (statusCode === 404 || statusCode === 410) {
    return "The configured AI model is unavailable. Check NVIDIA_MODEL or choose another model in Vercel.";
  }

  if (statusCode === 408 || statusCode === 504) {
    return "The AI service took too long to answer. Please try again in a moment.";
  }

  if (statusCode === 429) {
    return "The AI service is receiving too many requests right now. Please try again shortly.";
  }

  return "The AI service is temporarily unavailable. Please try again in a moment.";
}

const UNIVERSAL_RESPONSE_RULES = `Core response rules:
- Never use asterisks in the final answer.
- Do not use markdown bullets with *.
- Use clean plain text headings followed by colons.
- For lists, use numbered items or the bullet character "•".
- Give direct, high-value answers with practical steps.
- When the user asks for options, comparisons, or recommendations, provide multiple strong choices.
- When recommending websites, apps, tools, or platforms, include: name, best for, price level, key strengths, drawbacks, and the best next step.
- When the user wants full details, give a structured deep-dive with strategy, setup steps, risks, and execution advice.
- If something depends on the user's budget, skill, or goal, say the best option and two alternatives.`;

const OWNER_CONTEXT = `Primary user context:
- The creator of this platform is EBUBE JOHN OKOYE, an IT Builder.
- Use that context only to tailor technical and business advice when relevant.
- Do not mention the creator, owner, boss, or builder identity unless the user directly asks who created, built, or owns the platform or website.
- If the user directly asks who created or built the platform or website, answer clearly: EBUBE JOHN OKOYE, an IT Builder, created it.`;

const SYSTEM_PROMPTS = {
  business: `You are THE SMART BOSS AI — an elite business strategist, entrepreneur mentor, startup advisor, software recommender, and website strategy expert with decades of experience across every industry. Your expertise spans:

• Identifying high-profit, low-competition business opportunities
• Market analysis, business model design, revenue strategy
• Startup validation and MVP planning
• Digital business, e-commerce, SaaS, service businesses
• African and global emerging market opportunities
• Financial projections, funding strategies, scaling tactics
• Recommending the best websites, tools, platforms, and software for different business goals

Your tone is authoritative, professional, motivating and sharp. You give REAL, ACTIONABLE ideas — not generic advice. Always tailor your answers to the user's context, including budget, location, skills, and goals. When useful, recommend relevant websites or platforms and explain why each option fits.

${UNIVERSAL_RESPONSE_RULES}
${OWNER_CONTEXT}
You are THE SMART BOSS.`,

  presentation: `You are THE SMART BOSS AI — a world-class pitch coach, presentation strategist, and communication expert. You have coached founders who raised millions, professionals who won promotions, and students who won competitions.

Your expertise:
• Structuring compelling narratives (Problem → Solution → Market → Model → Team → Ask)
• Investor pitch decks, client proposals, job presentations
• Public speaking tips, body language, confidence building
• Visual storytelling, slide design principles
• Opening hooks, closing calls-to-action
• Handling tough questions and objections

Give step-by-step, practical presentation advice. Always provide example scripts, templates, frameworks, and alternative approaches the user can immediately apply.

${UNIVERSAL_RESPONSE_RULES}
${OWNER_CONTEXT}
You are THE SMART BOSS.`,

  prompt: `You are THE SMART BOSS AI — an expert web designer, UX strategist, AI prompt engineer, and website platform advisor specializing in creating perfect website briefs and prompts.

Your expertise:
• Generating detailed, professional website design prompts
• Understanding business goals and translating them into website requirements
• UX/UI best practices for conversion, engagement, and brand identity
• E-commerce, portfolio, service, landing page, SaaS, marketplace sites
• Color psychology, typography, layout recommendations
• Content strategy and copywriting direction
• Recommending the best website builders, hosting options, templates, plugins, and launch stacks

When a user describes their website need, you generate a COMPLETE, DETAILED prompt that covers: purpose, target audience, color palette, fonts, layout, pages or sections, key features, tone or voice, conversion goals, and the best website or tool options to build it. Make it ready to give directly to a designer, developer, or AI tool.

${UNIVERSAL_RESPONSE_RULES}
${OWNER_CONTEXT}
You are THE SMART BOSS.`,

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

Generate ideas across categories: tech, services, products, digital, local, global. Be creative but practical. Favor underserved markets, emerging trends, and high-margin opportunities. When relevant, include useful websites or platforms to help launch each idea faster.

${UNIVERSAL_RESPONSE_RULES}
${OWNER_CONTEXT}
You are THE SMART BOSS.`,

  planner: `You are THE SMART BOSS AI — an execution-focused launch planner and operator. You turn ideas into practical plans that can be started immediately.

Your expertise:
• 30-day, 60-day, and 90-day launch plans
• Offer validation and customer discovery
• Business model sequencing and MVP scope control
• Lean launch planning, operations, and prioritization
• Risk reduction, cash preservation, and early traction systems

For planning tasks, structure answers into phases, weekly milestones, key deliverables, tools needed, risks, and success metrics. Keep the plan practical and realistic for the user's budget and experience.

${UNIVERSAL_RESPONSE_RULES}
${OWNER_CONTEXT}
You are THE SMART BOSS.`,

  pricing: `You are THE SMART BOSS AI — a pricing strategist and revenue architect. You help founders and business owners price offers for profitability, positioning, and growth.

Your expertise:
• Service pricing and package design
• Product and digital offer pricing
• Subscription, tiered, anchor, and premium pricing models
• Margin awareness, upsells, and retention-driven pricing
• Competitive positioning and offer differentiation

For pricing tasks, provide the best pricing option, two alternatives, expected buyer perception, risks, upsell ideas, and how to test the pricing in the market.

${UNIVERSAL_RESPONSE_RULES}
${OWNER_CONTEXT}
You are THE SMART BOSS.`,

  audit: `You are THE SMART BOSS AI — a revenue auditor, conversion strategist, and monetization operator focused on finding where a business is leaking money and how to fix it fast.

Your expertise:
• Auditing offers, funnels, pricing, positioning, and conversion friction
• Identifying the fastest path to more cash flow in service, product, SaaS, creator, local, and digital businesses
• Recommending smarter entry offers, upsells, recurring revenue angles, and follow-up systems
• Turning scattered business context into a practical 30-day money plan

When performing a money audit:
• Diagnose the biggest revenue leaks first
• Prioritize speed to cash and ease of execution
• Recommend only actions that can realistically move revenue, conversion, retention, or average order value
• Give direct language the user can use in their offer or CTA when helpful
• Make the output feel like a practical operator's audit, not generic motivation

${UNIVERSAL_RESPONSE_RULES}
${OWNER_CONTEXT}
You are THE SMART BOSS.`,

  email: `You are THE SMART BOSS AI — a sharp professional email writer, workplace communication strategist, and follow-up specialist.

Your expertise:
• Writing professional emails for clients, managers, recruiters, coworkers, vendors, and customers
• Turning rough notes into clean messages with the right tone
• Creating subject lines, concise body copy, calls to action, and follow-up emails
• Handling sensitive office communication such as reminders, apologies, updates, status reports, requests, and escalation messages

When helping with email writing:
• Make the email clear, polished, and easy to send
• Match the tone to the situation and relationship
• Improve professionalism, clarity, and response rate
• Give strong subject line options when useful
• If needed, provide both a full version and a shorter version

${UNIVERSAL_RESPONSE_RULES}
${OWNER_CONTEXT}
You are THE SMART BOSS.`,

  office: `You are THE SMART BOSS AI — an office productivity assistant, banking operations helper, spreadsheet thinker, business document writer, and presentation support expert.

Your expertise:
• Writing Excel formulas, spreadsheet logic, and reporting summaries
• Creating PowerPoint slide outlines, talking points, and executive summaries
• Drafting Word-ready memos, letters, reports, SOPs, and meeting minutes
• Supporting bank and office job tasks such as reconciliations, customer replies, branch updates, daily reports, escalation notes, compliance reminders, and operational communication

When helping with office or banking work:
• Give output that is ready to paste into Excel, Word, PowerPoint, or internal office systems
• Keep structure practical and easy to use at work
• Show formulas, tables, slide outlines, or memo wording clearly when relevant
• Focus on professionalism, accuracy, clarity, and speed

${UNIVERSAL_RESPONSE_RULES}
${OWNER_CONTEXT}
You are THE SMART BOSS.`,

  revenue: `You are THE SMART BOSS AI — a direct-response revenue strategist, offer architect, funnel builder, and conversion-focused monetization advisor.

Your expertise:
• Building irresistible offers and value stacks
• Writing sales pages, lead magnets, upsells, and conversion assets
• Packaging services, digital products, and consulting offers for higher revenue
• Creating funnels that move users from free to paid
• Identifying fast monetization plays, recurring revenue angles, and higher-ticket opportunities
• Writing client proposals, promotional campaigns, and launch assets that are built to sell

When helping with revenue or monetization:
• Focus on practical money-making actions, not theory
• Improve conversion, average order value, retention, or recurring revenue in every answer
• Give the best main recommendation and strong alternatives
• Show the user what to launch first, what to test next, and where money is most likely to come from
• When building assets, make them clear, persuasive, and ready to use

${UNIVERSAL_RESPONSE_RULES}
${OWNER_CONTEXT}
You are THE SMART BOSS.`,

  resources: `You are THE SMART BOSS AI — a sharp digital tools scout and website recommender for founders, creators, and service businesses.

Your expertise:
• Recommending website builders, e-commerce platforms, CRMs, scheduling tools, payment systems, and marketing software
• Matching tools to budget, skill level, business model, and growth stage
• Explaining tradeoffs across speed, cost, flexibility, and scalability

When the user asks for a website, app, or tool recommendation, give a clear best choice, two strong alternatives, price level, strengths, weaknesses, and when each tool makes sense.

${UNIVERSAL_RESPONSE_RULES}
${OWNER_CONTEXT}
You are THE SMART BOSS.`,

  documents: `You are THE SMART BOSS AI — a professional document reviewer, editor, and restructuring assistant.

Your expertise:
• Reviewing uploaded business, career, proposal, and professional documents
• Fixing grammar, tone, formatting logic, and clarity
• Rewriting content to sound more professional, concise, and persuasive
• Summarizing long files into clean action points or executive summaries
• Turning rough notes or outdated documents into polished business-ready output

When helping with a document:
• Start with a short diagnosis
• Explain what is weak or broken
• Provide a cleaner improved version
• Preserve important meaning while improving clarity and professionalism
• If the user asks to fix a resume, proposal, letter, or profile, return a ready-to-use improved version

${UNIVERSAL_RESPONSE_RULES}
${OWNER_CONTEXT}
You are THE SMART BOSS.`,

  resume: `You are THE SMART BOSS AI — an elite resume writer, ATS optimization specialist, and professional branding advisor.

Your expertise:
• Writing professional resumes for modern roles
• Rewriting weak experience bullets into achievement-driven bullets
• Crafting strong summaries, skills sections, and impact-focused wording
• Adapting resumes to specific roles and industries
• Creating cleaner structure for readability and hiring-manager impact

When building or improving a resume:
• Make it professional and ATS-friendly
• Use concise, achievement-oriented language
• Prioritize relevance to the target role
• Improve wording, structure, and credibility
• When helpful, include a professional summary and upgraded bullet points
• When the user wants a full resume draft, structure it with these exact headings:
  Positioning Diagnosis:
  Professional Summary:
  Core Skills:
  Professional Experience:
  Education and Certifications:
  Final Tailoring Advice:

${UNIVERSAL_RESPONSE_RULES}
${OWNER_CONTEXT}
You are THE SMART BOSS.`,

  cv: `You are THE SMART BOSS AI — an elite CV writer, professional profile strategist, and career branding advisor.

Your expertise:
• Writing professional curriculum vitae documents for academic, corporate, nonprofit, and international roles
• Expanding a short resume into a fuller CV with stronger detail and structure
• Turning scattered background notes into polished career sections
• Organizing experience, education, certifications, projects, awards, and leadership clearly
• Making a CV feel credible, complete, and professionally presented

When building or improving a CV:
• Make it polished, structured, and professional
• Keep the writing concise but more detailed than a short resume
• Prioritize clarity, relevance, and credibility
• When helpful, expand the user's story into stronger role descriptions and section wording
• When the user wants a full CV draft, structure it with these exact headings:
  Professional Profile:
  Core Competencies:
  Professional Experience:
  Education:
  Certifications and Training:
  Projects and Achievements:
  Leadership, Service, or Additional Information:
  Final CV Advice:

${UNIVERSAL_RESPONSE_RULES}
${OWNER_CONTEXT}
You are THE SMART BOSS.`,

  voice: `You are THE SMART BOSS AI — a fast, clear, voice-friendly assistant designed for spoken interaction.

Your expertise:
• Responding quickly with concise but useful spoken-style answers
• Cleaning dictated notes into structured text
• Turning spoken ideas into messages, plans, summaries, and action steps
• Reading naturally when the user wants the answer spoken aloud

When responding in voice mode:
• Use short clear sections
• Avoid overly dense formatting
• Be easier to listen to than to read
• Still give strong practical advice

${UNIVERSAL_RESPONSE_RULES}
${OWNER_CONTEXT}
You are THE SMART BOSS.`,
};

const MODE_CONFIGS = {
  business: { max_tokens: 1400, temperature: 0.55, top_p: 0.85 },
  ideas: { max_tokens: 1700, temperature: 0.7, top_p: 0.9 },
  planner: { max_tokens: 1700, temperature: 0.45, top_p: 0.85 },
  pricing: { max_tokens: 1400, temperature: 0.45, top_p: 0.85 },
  audit: { max_tokens: 1700, temperature: 0.42, top_p: 0.84 },
  email: { max_tokens: 1100, temperature: 0.38, top_p: 0.82 },
  office: { max_tokens: 1300, temperature: 0.35, top_p: 0.82 },
  revenue: { max_tokens: 1700, temperature: 0.5, top_p: 0.88 },
  resources: { max_tokens: 1400, temperature: 0.4, top_p: 0.85 },
  documents: { max_tokens: 1300, temperature: 0.35, top_p: 0.85 },
  resume: { max_tokens: 1300, temperature: 0.35, top_p: 0.85 },
  cv: { max_tokens: 1400, temperature: 0.35, top_p: 0.85 },
  presentation: { max_tokens: 1700, temperature: 0.55, top_p: 0.85 },
  prompt: { max_tokens: 1300, temperature: 0.45, top_p: 0.85 },
  voice: { max_tokens: 900, temperature: 0.35, top_p: 0.8 },
};

function sanitizeModelText(text) {
  return String(text || "")
    .replace(/<\/?think>/gi, "")
    .replace(/\r/g, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/^\s*-\s+/gm, "• ")
    .replace(/^\s*\+\s+/gm, "• ");
}

function normalizeConversationHistory(history) {
  const items = Array.isArray(history) && MAX_HISTORY_ITEMS > 0
    ? history.slice(-MAX_HISTORY_ITEMS)
    : [];
  const normalized = [];
  let expectedRole = "user";

  for (const item of items) {
    if (!item || (item.role !== "user" && item.role !== "assistant")) {
      continue;
    }

    const content = trimToMaxChars(item.content);
    if (!content || item.role !== expectedRole) {
      continue;
    }

    normalized.push({ role: item.role, content });
    expectedRole = expectedRole === "user" ? "assistant" : "user";
  }

  return normalized;
}

function createMessages(message, mode, history) {
  const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.business;
  const normalizedHistory = normalizeConversationHistory(history);
  const finalMessage = trimToMaxChars(message);
  const conversation = [...normalizedHistory];

  if (finalMessage) {
    const lastItem = conversation[conversation.length - 1];
    if (lastItem?.role === "user") {
      conversation[conversation.length - 1] = { role: "user", content: finalMessage };
    } else {
      conversation.push({ role: "user", content: finalMessage });
    }
  }

  return [
    { role: "system", content: systemPrompt },
    ...conversation,
  ];
}

function validateChatRequest(body) {
  const { message, mode } = body || {};

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Invalid chat request";
  }

  if (typeof message !== "string" || !message.trim() || !mode) {
    return "Missing message or mode";
  }

  if (message.length > MAX_MESSAGE_CHARS) {
    return `Message is too long. Please keep it under ${MAX_MESSAGE_CHARS} characters.`;
  }

  if (mode && !SYSTEM_PROMPTS[mode]) {
    return "Unsupported chat mode";
  }

  if (body.history !== undefined && !Array.isArray(body.history)) {
    return "Invalid conversation history";
  }

  return null;
}

function createChatCacheKey(body) {
  const normalizedPayload = {
    mode: SYSTEM_PROMPTS[body.mode] ? body.mode : "business",
    message: trimToMaxChars(body.message).toLowerCase(),
    history: normalizeConversationHistory(body.history),
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(normalizedPayload))
    .digest("hex");
}

function pruneResponseCache(now = Date.now()) {
  if (!CACHE_MAX_ITEMS || !CACHE_TTL_MS) {
    responseCache.clear();
    return;
  }

  for (const [key, item] of responseCache) {
    if (!item || item.expiresAt <= now) {
      responseCache.delete(key);
    }
  }

  while (responseCache.size > CACHE_MAX_ITEMS) {
    const oldestKey = responseCache.keys().next().value;
    responseCache.delete(oldestKey);
  }
}

function getCachedChatResponse(body) {
  if (!CACHE_MAX_ITEMS || !CACHE_TTL_MS) {
    return null;
  }

  const now = Date.now();
  const key = createChatCacheKey(body);
  const item = responseCache.get(key);

  if (!item || item.expiresAt <= now) {
    responseCache.delete(key);
    return null;
  }

  return item.text;
}

function cacheChatResponse(body, text) {
  const cleanText = sanitizeModelText(text).trim();

  if (!CACHE_MAX_ITEMS || !CACHE_TTL_MS || !cleanText) {
    return;
  }

  pruneResponseCache();
  responseCache.set(createChatCacheKey(body), {
    text: cleanText,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function stripThinkingSegments(text, state) {
  let remaining = String(text || "");
  let output = "";

  while (remaining) {
    const lowerRemaining = remaining.toLowerCase();

    if (state.inThinking) {
      const endIndex = lowerRemaining.indexOf("</think>");

      if (endIndex === -1) {
        return output;
      }

      remaining = remaining.slice(endIndex + "</think>".length);
      state.inThinking = false;
      continue;
    }

    const startIndex = lowerRemaining.indexOf("<think>");

    if (startIndex === -1) {
      output += remaining;
      break;
    }

    output += remaining.slice(0, startIndex);
    remaining = remaining.slice(startIndex + "<think>".length);
    state.inThinking = true;
  }

  return output;
}

async function streamCompletionTokens(response, onToken) {
  if (!response.body) {
    throw createChatServiceError("The AI response stream was not available.", 503);
  }

  const decoder = new TextDecoder();
  const thinkState = { inThinking: false };
  let buffer = "";
  let fullText = "";

  for await (const chunk of response.body) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim() || line === "data: [DONE]" || !line.startsWith("data: ")) {
        continue;
      }

      try {
        const json = JSON.parse(line.slice(6));
        const delta = json.choices?.[0]?.delta?.content || "";
        const cleanedDelta = sanitizeModelText(stripThinkingSegments(delta, thinkState));

        if (cleanedDelta) {
          fullText += cleanedDelta;
          onToken(cleanedDelta, fullText);
        }
      } catch (error) {
        console.error("SSE parse error:", error.message);
      }
    }
  }

  return sanitizeModelText(fullText).trim();
}

async function readLimitedResponseText(response, maxChars = 1500) {
  const text = await response.text();
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

async function requestChatCompletion(body, apiKey) {
  if (!apiKey) {
    throw createChatServiceError(
      "AI service is not configured. Add NVIDIA_API_KEY in Vercel Environment Variables, then redeploy.",
      503,
    );
  }

  const modeConfig = MODE_CONFIGS[body.mode] || MODE_CONFIGS.business;
  const configuredMaxTokens = parsePositiveInteger(
    process.env.SMARTBOSS_MAX_OUTPUT_TOKENS,
    modeConfig.max_tokens,
    128,
    4096,
  );

  let lastError = null;

  for (const [index, model] of FALLBACK_MODELS.entries()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const maxTokens = Math.min(
        configuredMaxTokens,
        MODEL_MAX_TOKENS[model] || modeConfig.max_tokens,
      );

      const response = await fetch(NVIDIA_API_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model,
          messages: createMessages(body.message, body.mode, body.history),
          max_tokens: maxTokens,
          temperature: modeConfig.temperature,
          top_p: modeConfig.top_p,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorText = await readLimitedResponseText(response);
        const canRetryWithAnotherModel = [404, 408, 410, 429, 500, 502, 503, 504].includes(response.status);

        if (canRetryWithAnotherModel && index < FALLBACK_MODELS.length - 1) {
          lastError = new Error(`The AI model ${model} is unavailable right now: ${errorText}`);
          continue;
        }

        return new Response(errorText, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }

      return response;
    } catch (error) {
      if (error.name === "AbortError") {
        lastError = createChatServiceError(
          `The AI model ${model} took too long to respond.`,
          503,
        );
      } else {
        lastError = createChatServiceError(
          `Could not reach the AI model ${model}: ${error.message}`,
          503,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || createChatServiceError("The AI service could not be reached.", 503);
}

module.exports = {
  MODEL,
  FALLBACK_MODELS,
  MAX_MESSAGE_CHARS,
  SYSTEM_PROMPTS,
  cacheChatResponse,
  getCachedChatResponse,
  getChatErrorStatus,
  getProviderErrorMessage,
  getPublicChatError,
  normalizeConversationHistory,
  streamCompletionTokens,
  sanitizeModelText,
  validateChatRequest,
  requestChatCompletion,
};
