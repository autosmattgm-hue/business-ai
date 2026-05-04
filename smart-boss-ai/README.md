# 👑 THE SMART BOSS AI

> Your elite AI-powered business intelligence platform — professional ideas, pitch coaching, website prompts, and strategic advice powered by Google Gemma 4 via NVIDIA.

---

## 🚀 Features

| Tool | Description |
|------|-------------|
| 🤖 **Business AI Chat** | Elite business advisor — strategy, growth, revenue ideas |
| 💡 **Idea Engine** | Personalized profitable business ideas with revenue estimates |
| 🎤 **Pitch Coach** | AI presentation trainer + pitch builder |
| 🌐 **Website Prompt Generator** | Professional website briefs for any business |

---

## 📁 File Structure

```
smart-boss-ai/
├── server.js              ← Node.js Express backend + NVIDIA API proxy
├── package.json           ← Project dependencies
├── README.md              ← This file
└── public/
    ├── index.html         ← Landing page
    ├── business.html      ← Business AI Chat (all 4 modes)
    ├── ideas.html         ← Business Idea Engine
    ├── presentation.html  ← Pitch Coach
    ├── prompt.html        ← Website Prompt Generator
    ├── style.css          ← Global styles (luxury dark-gold aesthetic)
    └── main.js            ← Frontend logic (chat, streaming, markdown)
```

---

## ⚙️ Setup & Installation

### Prerequisites
- **Node.js** v18 or higher → [nodejs.org](https://nodejs.org)
- NVIDIA API key (already included in server.js)

### Step 1 — Install Dependencies
```bash
cd smart-boss-ai
npm install
```

### Step 2 — Start the Server
```bash
npm start
```

### Step 3 — Open in Browser
```
http://localhost:3000
```

That's it! 🎉

---

## 🔑 API Configuration

The NVIDIA API key and model are set in `server.js`:

```javascript
const NVIDIA_API_KEY = "nvapi-...";   // Your NVIDIA API key
const MODEL = "google/gemma-4-31b-it"; // AI model
```

To change the model, update the `MODEL` constant. Available NVIDIA models:
- `google/gemma-4-31b-it` (default)
- `meta/llama-3.1-70b-instruct`
- `mistralai/mixtral-8x7b-instruct-v0.1`

---

## 📄 Pages

| URL | Page |
|-----|------|
| `/` | Home / Landing Page |
| `/business` | Business AI Chat |
| `/ideas` | Idea Engine |
| `/presentation` | Pitch Coach |
| `/prompt` | Website Prompt Generator |

---

## 🛠️ API Endpoint

**POST** `/api/chat`

```json
{
  "message": "Give me 5 business ideas",
  "mode": "business",
  "history": []
}
```

**Modes:** `business` | `ideas` | `presentation` | `prompt`

Response: Server-Sent Events (streaming)

---

## 🎨 Design

- **Aesthetic:** Luxury Dark Gold — Power, Prestige, Precision
- **Fonts:** Cormorant Garamond (display) + DM Sans (body) + Space Mono (code)
- **Colors:** Deep void black + rich gold (#C9A84C) accent system
- **Animations:** CSS-only, scroll-triggered, staggered reveals

---

## 📦 Dependencies

```json
{
  "express": "^4.18.2",
  "cors": "^2.8.5"
}
```

No heavy frameworks. Pure Node.js + Vanilla JS frontend.

---

## 🌐 Deployment

### Deploy to Railway
```bash
railway login
railway init
railway up
```

### Deploy to Render
1. Push to GitHub
2. New Web Service → select repo
3. Build: `npm install` | Start: `npm start`

### Deploy to VPS (Ubuntu)
```bash
npm install -g pm2
pm2 start server.js --name smart-boss-ai
pm2 save
```

---

## 💡 Usage Tips

1. **Business Chat** — Be specific. Tell it your location, budget, and skills for tailored advice.
2. **Idea Engine** — Fill all fields for best results. Click "Regenerate" for fresh ideas.
3. **Pitch Coach** — Use the Builder tab to create a structured pitch, then refine in AI Chat.
4. **Web Prompts** — Copy the generated prompt into Claude, ChatGPT, Bolt.new, or send to a designer.

---

Made with 👑 by THE SMART BOSS AI Team
