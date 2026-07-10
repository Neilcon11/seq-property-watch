# SEQ Property Watch

Railway-hosted dashboard for South East Queensland land, home-and-land, townhouse and investment opportunities.

## Current capabilities

- PostgreSQL-backed property records, property versions, email import activity, media metadata, brand configs, marketing sheets, public links and job logs.
- Gmail sync stores and deduplicates by unique Gmail message ID, while also retaining thread ID.
- Manual **Sync Gmail Now** button on the dashboard and Email Import Activity page.
- Email Import Activity admin page at /admin/email-imports with statuses, counts, errors and reprocess actions.
- Confidence-based property email detection using sender, subject, body text, links and attachment filenames.
- Special parsing paths for the supplied Affinity/Morayfield, generic land updates, Riverbank and Burnside Hills examples.
- Media metadata classification for facade, floorplan, site plan, masterplan, map, estate imagery, logos and email signatures.
- Property versioning records previous and new data when later emails update a matching property identity.
- Two initial brand records: Hello Home Property and Beach Investor.
- Brand-aware marketing preview at /marketing/:propertyId.
- Public share links at /share/property/:secureToken.
- One-page PDF download endpoint at /api/marketing/:propertyId/pdf.

## Railway services

Required:

- Web service
- PostgreSQL database

Recommended before enabling production media extraction:

- S3-compatible object storage for media assets

## Environment variables

Required:

- NODE_ENV=production
- DATABASE_URL

Required for Gmail sync:

- GMAIL_CLIENT_ID
- GMAIL_CLIENT_SECRET
- GMAIL_REFRESH_TOKEN
- GMAIL_QUERY
- GMAIL_BACKFILL_QUERY optional override
- AUTO_CHECK_ENABLED=true
- CHECK_INTERVAL_MINUTES=5

Required for Telegram alerts:

- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID

Recommended for media storage:

- S3_ENDPOINT
- S3_REGION
- S3_BUCKET
- S3_ACCESS_KEY_ID
- S3_SECRET_ACCESS_KEY
- MEDIA_BASE_URL

Optional:

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
- GET /api/dashboard
- GET /api/records
- GET /api/opportunities
- POST /api/sync/gmail
- GET /api/email-imports
- POST /api/email-imports/:gmailMessageId/reprocess
- GET /api/brands
- GET /marketing/:propertyId
- GET /api/marketing/:propertyId/pdf
- POST /api/marketing/:propertyId/share
- GET /share/property/:secureToken

## Notes

Public marketing pages use public-safe fields only. Gmail IDs, Gmail links, raw email bodies, bank details, commission notes, private SharePoint links and internal notes must not be used in public exports.

Investment figures are indicative estimates only. Confirm zoning, overlays, rental evidence, build costs, lending and tax before acting.
