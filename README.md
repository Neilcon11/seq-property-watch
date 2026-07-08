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
