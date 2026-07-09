# SEQ Property Watch

A Railway-hosted dashboard for South East Queensland property opportunities.

## What it does

- Shows the current property dashboard.
- Stores new records in PostgreSQL when DATABASE_URL is connected.
- Polls Gmail for matching property emails when Gmail API variables are configured.
- Checks configured public land-listing pages for Sunshine Coast land opportunities.
- Scores possible investment opportunities including subdivision, granny flat, second dwelling and share-home angles.
- Sends Telegram alerts for newly detected opportunities when Telegram variables are configured.

## Railway variables

Required for the deployed app:

- NODE_ENV=production
- PORT=3000

Required for persistence:

- DATABASE_URL

Required for live Gmail checks:

- GMAIL_CLIENT_ID
- GMAIL_CLIENT_SECRET
- GMAIL_REFRESH_TOKEN
- GMAIL_QUERY

Required for Telegram alerts:

- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID

Optional controls:

- AUTO_CHECK_ENABLED=true
- CHECK_INTERVAL_MINUTES=30
- CHECK_SECRET
- ONLINE_LAND_SOURCE_URLS
- INTEREST_RATE
- DEPOSIT_RATE
- EXPENSE_RATE
- CAPITAL_GROWTH_RATE
- WEEKLY_RENT_TOWNHOUSE
- WEEKLY_RENT_HOUSE
- WEEKLY_RENT_ROOM
- WEEKLY_RENT_GRANNY_FLAT

## Endpoints

- GET /api/health
- GET /api/records
- GET /api/opportunities
- POST /api/check?secret=YOUR_CHECK_SECRET

## Notes

Investment figures are indicative estimates only. Confirm zoning, overlays, rental evidence, build costs, lending and tax before acting.
# SEQ Property Watch

A Railway-ready dashboard for South East Queensland property opportunities, including vacant land, email-sourced home-and-land packages, and townhouse stock.

## What is live

- Public static dashboard served by Node.js
- /api/health health-check endpoint
- Share buttons for the app and individual properties
- Public land/source links where available
- Public/source-safe images where available

## What is placeholder or manual data

The current property records are a snapshot from Neil's email and public land sources. There is no live Gmail sync or database yet.

## Local development

```bash
npm install
npm start
```

Open http://localhost:3000.

## Railway

Railway should use:

- Build: Nixpacks
- Start command: npm start
- Health check path: /api/health
- Production branch: main

## Environment variables

Required:

- NODE_ENV=production

Not required currently:

- DATABASE_URL - only needed if persistent storage is added later.

## Security notes

No Gmail links, passwords, API keys, or private credentials are committed. Email-derived listings are represented as public-facing summaries only.
