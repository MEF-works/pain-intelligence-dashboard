# Pain Intelligence Dashboard

Sovereign signal intel: SQLite + Drizzle, Reddit + RSS ingest, pipeline stats (status + source counts), focus filters, Gemini outreach, CSV export, and a Refresh control to reload from the DB.

## Run locally

1. `npm install`
2. Copy `.env.example` → `.env` / `.env.local` and set at least `GEMINI_API_KEY`
3. `npx drizzle-kit push` (creates `data/pain.db` as needed)
4. `npm run dev` — http://localhost:3000
5. Optional: `npm run ingest`

## VM / Docker (Traefik + HTTPS)

**Public host:** [https://signal.mgmalkz.com](https://signal.mgmalkz.com) — point DNS (A/AAAA) at the VM; open 80 and 443.

1. In the repo, copy `.env` from `.env.example` and set at least:
   - `LETSENCRYPT_EMAIL` (required for ACME)
   - `GEMINI_API_KEY`, and `CRON_SECRET` if you curl `/api/cron/ingest` from a scheduler
2. **Schema once on the host:** `export DATABASE_PATH=./data/pain.db && npx drizzle-kit push`
3. `docker compose build && docker compose up -d`
4. Health check: `GET /api/health` (e.g. for Uptime Kuma)

SQLite in production is the **`pain_data`** Docker volume, path `/app/data/pain.db` in the `pain-intel` service.

After `docker compose cp ./data/pain.db pain-intel:/app/data/pain.db`, fix ownership so the `node` user can write (otherwise ingest/API errors):  
`docker compose exec -u root pain-intel chown node:node /app/data/pain.db`

**Daily ingest** (no TS runtime in the prod image; call the app API from cron):

`0 5 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://signal.mgmalkz.com/api/cron/ingest`

(05:00 UTC daily; set `CRON_SECRET` in `.env` to match the header the API expects.)

## Legacy AI Studio

Original template reference: [AI Studio](https://ai.studio/apps/a5ff57f1-5ae8-4f63-a2ed-6bc7d08fce6e)
