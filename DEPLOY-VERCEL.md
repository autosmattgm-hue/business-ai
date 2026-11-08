# Deploy THE SMART BOSS AI to Vercel

## Deploy Folder

Deploy this folder only:

```text
C:\Users\JOHN\Desktop\smart boss
```

Do not deploy the nested `smart-boss-ai/` folder.

## Before You Deploy

You need:

- A Vercel account
- A GitHub account
- Your NVIDIA API key

## Recommended Flow

### 1. Put the project on GitHub

Create a new GitHub repository and upload the contents of:

```text
C:\Users\JOHN\Desktop\smart boss
```

### 2. Import the repo into Vercel

In Vercel:

1. Click `Add New...`
2. Click `Project`
3. Import the GitHub repository
4. Keep the Root Directory as the repository root

### 3. Configure Environment Variables

In the Vercel project:

1. Open `Settings`
2. Open `Environment Variables`
3. Add:

```text
NVIDIA_API_KEY=your_real_nvidia_key
```

Apply it to:

- Production
- Preview
- Development

### 4. Build Settings

This project does not need a custom build command.

Use:

- Framework Preset: `Other`
- Build Command: leave empty if Vercel does not require one
- Output Directory: leave empty
- Install Command: leave empty unless Vercel asks for one

### 5. Deploy

Click `Deploy`.

After deployment, Vercel will serve:

- static pages from the root HTML files
- the AI backend from `api/chat.mjs`

## Important Project Files

- `vercel.json`: enables clean URLs like `/business`
- `api/chat.mjs`: Vercel serverless function
- `lib/chat-service.js`: shared AI prompt and streaming logic
- `server.js`: local development server only

## Test After Deployment

After the first deploy, test these pages:

- `/`
- `/business`
- `/ideas`
- `/planner`
- `/pricing`
- `/resources`
- `/presentation`
- `/prompt`

Then test the AI:

1. Open `/business`
2. Ask a simple question
3. Confirm a streamed answer appears

If the site loads but AI does not respond:

- check `NVIDIA_API_KEY` in Vercel settings
- redeploy after adding or changing the variable
- check the `Functions` logs in Vercel

## Redeploying Changes

Any new push to the connected GitHub branch will trigger a new deploy automatically.

## Optional Custom Domain

After deployment:

1. Open the Vercel project
2. Go to `Settings`
3. Go to `Domains`
4. Add your domain
5. Follow the DNS instructions Vercel gives you

## Local Test Before Deploy

In PowerShell:

```powershell
$env:NVIDIA_API_KEY="your_key_here"
node server.js
```

Then open:

```text
http://localhost:3010
```

Open in Chrome:

```powershell
Start-Process chrome "http://localhost:3010"
```

Or use the helper launcher:

```powershell
powershell -ExecutionPolicy Bypass -File .\launch-local.ps1 -ApiKey "your_key_here" -Port 3010 -OpenChrome
```

## Troubleshooting

### AI returns a server error

Check:

- your NVIDIA key is valid
- the environment variable name is exactly `NVIDIA_API_KEY`

### Static pages work but `/business` or `/pricing` fails on deploy

Check:

- `vercel.json` exists
- you deployed the root folder, not the nested legacy folder

### Wrong project deployed

If you accidentally import `smart-boss-ai/`, delete that Vercel project and import the root project again.
