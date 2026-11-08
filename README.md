# THE SMART BOSS AI

THE SMART BOSS AI is a Vercel-ready business intelligence site with:

- Business AI chat
- Idea generation
- Launch planning
- Pricing strategy
- Business toolkit and website recommendations
- Pitch coaching
- Website prompt generation

## Canonical Project

Deploy the root folder:

```text
C:\Users\JOHN\Desktop\smart boss
```

The nested `smart-boss-ai/` folder is an older copy and should not be used as the main deploy target.

## Project Structure

```text
smart boss/
├── api/
│   └── chat.mjs
├── lib/
│   └── chat-service.js
├── business.html
├── ideas.html
├── index.html
├── main.js
├── planner.html
├── presentation.html
├── pricing.html
├── prompt.html
├── resources.html
├── server.js
├── style.css
├── vercel.json
└── .env.example
```

## Local Run

1. Set your NVIDIA API key:

```powershell
$env:NVIDIA_API_KEY="your_key_here"
```

2. Start the local server:

```powershell
node server.js
```

3. Open the site:

```text
http://localhost:3010
```

4. Open it directly in Chrome:

```powershell
Start-Process chrome "http://localhost:3010"
```

If `chrome` is not on PATH, open that URL manually in Chrome.

You can also use the included launcher script:

```powershell
powershell -ExecutionPolicy Bypass -File .\launch-local.ps1 -ApiKey "your_key_here" -Port 3010 -OpenChrome
```

## Environment Variable

Required:

```text
NVIDIA_API_KEY
```

The API key is not stored in the deployable app code. You must add it in your local environment and in Vercel project settings.

## Routes

- `/`
- `/business`
- `/ideas`
- `/planner`
- `/pricing`
- `/resources`
- `/presentation`
- `/prompt`
- `/api/chat`

## Deployment

See:

- [DEPLOY-VERCEL.md](C:\Users\JOHN\Desktop\smart boss\DEPLOY-VERCEL.md)

## Notes

- `vercel.json` enables clean URLs like `/business` instead of `/business.html`
- `api/chat.mjs` is the Vercel serverless function
- `server.js` is the local Node server for development
