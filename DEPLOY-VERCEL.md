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
- PayPal REST app credentials if you want automatic paid-plan activation

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
NVIDIA_MODEL=nvidia/llama-3.1-nemotron-nano-8b-v1
NVIDIA_FALLBACK_MODELS=nvidia/nvidia-nemotron-nano-9b-v2,meta/llama-3.1-8b-instruct,google/gemma-2-2b-it
NVIDIA_REQUEST_TIMEOUT_MS=12000
SMARTBOSS_MAX_MESSAGE_CHARS=2000
SMARTBOSS_MAX_HISTORY_ITEMS=8
SMARTBOSS_MAX_OUTPUT_TOKENS=1400
SMARTBOSS_AI_CACHE_TTL_MS=300000
SMARTBOSS_AI_CACHE_MAX_ITEMS=500
SMARTBOSS_PAYPAL_CLIENT_ID=your_paypal_client_id
SMARTBOSS_PAYPAL_CLIENT_SECRET=your_paypal_client_secret
SMARTBOSS_PAYPAL_ENVIRONMENT=live
SMARTBOSS_PAYPAL_CURRENCY=USD
SMARTBOSS_PLAN_MONTHLY_AMOUNT=9.00
SMARTBOSS_PLAN_YEARLY_AMOUNT=79.00
SMARTBOSS_PLAN_LIFETIME_AMOUNT=149.00
SMARTBOSS_PAYMENT_LINK_MONTHLY=https://www.paypal.com/ncp/payment/WKR8LDGWABW6J
SMARTBOSS_PAYMENT_LINK_YEARLY=https://www.paypal.com/ncp/payment/8BWQCDZ9JSS4J
SMARTBOSS_PAYMENT_LINK_LIFETIME=https://www.paypal.com/ncp/payment/54X56PTY2T4Q8
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
- `api/paypal-create-order.mjs`: creates verified PayPal checkout orders
- `api/paypal-capture-order.mjs`: captures PayPal payment before Pro activation
- `lib/chat-service.js`: shared AI prompt and streaming logic
- `lib/paypal-service.js`: server-side PayPal API integration
- `server.js`: local development server only

## Test After Deployment

After the first deploy, test these pages:

- `/`
- `/business`
- `/ideas`
- `/planner`
- `/pricing`
- `/pricing-strategy`
- `/checkout?plan=monthly`
- `/resources`
- `/presentation`
- `/prompt`

Then test the AI:

1. Open `/business`
2. Ask a simple question
3. Confirm a streamed answer appears

If the site loads but AI does not respond:

- check `NVIDIA_API_KEY` in Vercel settings
- check `NVIDIA_MODEL` if Vercel reports that the configured model is unavailable
- keep `NVIDIA_FALLBACK_MODELS` set to the recommended fallback list unless your NVIDIA account cannot access one of those models
- redeploy after adding or changing the variable
- check the `Functions` logs in Vercel

Then test paid checkout:

1. Open `/pricing`
2. Click a paid plan
3. Confirm `/checkout?plan=...` opens
4. Complete PayPal checkout
5. Confirm the app redirects to `/settings?payment=success...` and shows Pro access

If PayPal checkout falls back to the old payment link:

- check `SMARTBOSS_PAYPAL_CLIENT_ID`
- check `SMARTBOSS_PAYPAL_CLIENT_SECRET`
- check `SMARTBOSS_PAYPAL_ENVIRONMENT=live`
- redeploy after changing Vercel environment variables

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
