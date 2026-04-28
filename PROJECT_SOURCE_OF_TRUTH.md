# Pain Intelligence Dashboard — Source of Truth

**Purpose:** Single canonical reference for architecture, configuration, and operations. **Update this file whenever behavior, schema, env vars, ingest logic, deployment steps, or APIs change.**

**Companion:** [`README.md`](./README.md) stays short; deep detail lives here.

---

## 1. Product overview

| Item | Description |
|------|-------------|
| **Goal** | Capture pain signals from multiple public sources, deduplicate, score intensity, run an **Action Engine** (structured opportunity + confidence + action type), surface **Top Actions** (kill shot view), and generate Gemini-backed outreach from diagnoses—not raw dumps. |
| **Primary UI** | Next.js dashboard: Top Actions strip, filters (**Actionable only**), stats, signal feed, CSV export, outreach. |
| **Data store** | SQLite (`pain_signals`) via Drizzle ORM + `better-sqlite3`. |

---

## 2. Tech stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js (App Router), React 19 |
| API | Route handlers under `app/api/**` |
| DB | SQLite; Drizzle ORM; lazy DB init in `src/lib/db/index.ts` (avoid import-time failure in serverless/Docker) |
| AI | Google Gemini via `@google/genai` (`lib/ai/outreach.ts`) |
| Styling | Tailwind CSS 4 |
| Production deploy | Docker Compose: Traefik v3 + TLS + app container (`docker-compose.yml`) |

---

## 3. Repository layout (high signal)

| Path | Role |
|------|------|
| `app/` | Next.js app: `page.tsx` dashboard, `app/api/*` HTTP routes |
| `components/` | UI (`SignalFeed.tsx`, `TopActions.tsx`, etc.) |
| `lib/` | Shared app code: `constants/focus-areas.ts`, `lib/types.ts`, `lib/ai/outreach.ts`, `lib/utils.ts` |
| `src/lib/db/` | Drizzle schema (`schema.ts`), DB singleton (`index.ts`) |
| `src/lib/ingest/` | `run-ingest.ts` — multi-source ingest, hashing, intensity + Action Engine |
| `src/lib/action-engine/` | `opportunity.ts` — heuristics, monetization intensity tweak, optional Gemini refinement |
| `src/lib/html/` | `plain-text.ts` — HTML entity decode + tag strip for readable body text |
| `scripts/` | `ingest-signals.ts`, `ingest-dorks.ts`, `purge-job-rss.ts`, `scrutinize.ts` (host/cron); prod ingest usually via HTTP |
| `public/` | Static assets (e.g. `favicon.ico`) |
| `drizzle.config.ts` | Drizzle Kit config (defaults to `./data/pain.db`) |
| `Dockerfile` | Multi-stage Node 20 build → Next standalone runner |

---

## 4. Data model (`pain_signals`)

Defined in `src/lib/db/schema.ts`. Apply schema changes with **`npm run db:push`** (Drizzle Kit against `DATABASE_PATH` or default `./data/pain.db`).

| Column | Type | Notes |
|--------|------|--------|
| `id` | text PK | Reddit `name` or `rss:…` derived id |
| `source` | text | e.g. `reddit`, `hackernews`, `google_dork` (legacy rows may still say `job_rss`) |
| `source_url` | text | Canonical link |
| `title` | text | Nullable |
| `content` | text | Body used for display + outreach |
| `content_hash` | text | SHA-256 of normalized text; **unique** index for dedup |
| `focus_area` | text | Matched bucket id from `FOCUS_AREAS` |
| `intensity` | integer | 0–100 semantic score |
| `status` | text | `new` \| `outreached` \| `paid` \| `dead` (default `new`) |
| `raw_budget` | text | Reserved |
| `audit_log` | text | Append-only lines from scrutinize |
| `last_verified_at` | timestamp | Last URL proof-of-life check |
| `pain_summary` | text | Action Engine — one-line pain |
| `likely_root_issue` | text | Inferred system/process failure |
| `opportunity_angle` | text | Where an external operator steps in |
| `business_impact` | text | Revenue / risk / inefficiency framing |
| `confidence_score` | real | 0–1 likelihood signal is actionable vs noise |
| `action_type` | text | `direct_outreach` \| `research_deeper` \| `ignore` |
| `buyer_score` | integer | Radar: first-person + business pain heuristics (0–20) |
| `priority` | text | `high` \| `low` from buyer/problem context |
| `identity_json` | text | JSON: `username`, `profile_url`, `platform`, `possible_business` |
| `created_at` | timestamp | Required |
| `last_updated` | timestamp | Set on PATCH status updates |

---

## 5. Environment variables

Copy from `.env.example`. Production Compose **overrides** `DATABASE_PATH` for the app container.

| Variable | Required | Notes |
|----------|----------|--------|
| `GEMINI_API_KEY` | For outreach | Used by `POST /api/outreach` / `generateTargetedBridge` |
| `DATABASE_PATH` | Recommended | Host/scripts: default `./data/pain.db`. **Container:** forced to `/app/data/pain.db` in `docker-compose.yml` |
| `CRON_SECRET` | Strongly recommended in prod | If set, `GET /api/cron/ingest` requires `Authorization: Bearer <same value>` |
| `SERPER_API_KEY` | For `npm run ingest:dorks` | Serper.dev Google Search API (stores `google_dork` signals) |
| `TWITTER_BEARER_TOKEN` | Optional | Enables X/Twitter recent search ingest |
| `TWITTER_SEARCH_QUERIES` | Optional | Queries separated by `\|\|\|\|` (four pipes). Defaults in `run-ingest.ts` |
| `GITHUB_TOKEN` | Optional | Higher GitHub Search API rate limits for issue ingest |
| `GITHUB_ISSUES_QUERY` | Optional | Override GitHub issue search query |
| `GITHUB_MIN_STARS` | Optional | Repo stargazer floor for GitHub issues (default **5000**; **`0`** disables) |
| `REDDIT_SEARCH_QUERIES` | Optional | Override Reddit global search strings (`\|\|\|\|`-separated); defaults in `lib/constants/reddit-search-queries.ts` |
| `ACTION_ENGINE_GEMINI` | Optional | Set `false` to skip Gemini refinement of Action fields (heuristics only) |
| `NTFY_URL` | Optional | Push notification URL when ingest marks a run “hot” (intensity > 80) |
| `LETSENCRYPT_EMAIL` | Docker + Traefik | ACME/Let’s Encrypt |
| `APP_URL` | Optional | Documented in `.env.example`; not heavily referenced in code — safe for future use |

Generate `CRON_SECRET`: `openssl rand -hex 32`

---

## 6. HTTP API (contract)

All under `/api/*`. Dashboard uses JSON.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | None | Liveness JSON (`ok`, `service`, `at`). Does **not** hit SQLite. |
| GET | `/api/signals` | None | List signals (newest first, capped). Includes `auditLog`, `lastVerifiedAt`, etc. |
| PATCH | `/api/signals/[id]` | None | Body `{ "status": "new" \| "outreached" \| "paid" \| "dead" }` |
| GET | `/api/stats` | None | Aggregates + **`highValueLeads`** (count where `intensity > 85`) |
| POST | `/api/outreach` | None | Body `{ "id": "<signal id>" }` → Gemini bridge text |
| GET | `/api/cron/ingest` | Optional Bearer | Runs full ingest (`runIngest`). `maxDuration` 60s. |
| GET | `/api/cron/ingest-dorks` | Optional Bearer | Serper → `google_dork` rows (`runDorkIngest`). Same DB as dashboard — **use this in Docker** instead of host `npm run ingest:dorks`. `maxDuration` 120s. Requires **`SERPER_API_KEY`**. |

**Security note:** Lock down `/api/cron/ingest` and `/api/cron/ingest-dorks` with `CRON_SECRET` in production.

---

## 7. Ingest pipeline

Entry: `runIngest()` in `src/lib/ingest/run-ingest.ts` (also invoked by `GET /api/cron/ingest`).

### 7.1 Sources (run order)

| Source | `source` value | Notes |
|--------|----------------|--------|
| Reddit | `reddit` | **Global search** `search.json` (first-person queries in `lib/constants/reddit-search-queries.ts`); override with **`REDDIT_SEARCH_QUERIES`** (`||||`-separated). Throttled between calls. |
| Serper | `google_dork` | Queries in `lib/constants/dorks.ts`; requires **`SERPER_API_KEY`**. Prefer **`GET /api/cron/ingest-dorks`** in production (writes container SQLite). Host: **`npm run ingest:dorks`** (writes host `DATABASE_PATH` / `./data/pain.db`). |
| Hacker News | `hackernews` | Firebase `newstories` + item JSON; link or `item?id=` |
| X / Twitter | `twitter` | Requires `TWITTER_BEARER_TOKEN`; recent search (default queries OR override env) |
| GitHub issues | `github_issue` | Search API + **title** must match production/checkout/payment-style pain; repo **`GITHUB_MIN_STARS`** (default **5000**, set `0` to disable). Optional `GITHUB_TOKEN`. |

**Not implemented in-repo** (need separate APIs / contracts): Product Hunt comments, status-page incident ingestion — add deliberately when keys and parsing rules are defined.

### 7.2 Radar (quality gate)

All sources pass through [`src/lib/ingest/signal-filters.ts`](./src/lib/ingest/signal-filters.ts) inside `capturePainSignal` **after** hash-dedup checks: drop SEO/tutorial hosts (`isJunkUrl`), require **problem language** (`expressesProblem`), require **identity-capable platform** (Reddit/Twitter/GitHub/HN; Google dork only when URL looks like a real site outage, not publisher help). Reddit additionally requires **first-person** (`my` / `I` / `our`). **Buyer score** + **`priority`** (`high` \| `low`) and **`identity_json`** are persisted.

### 7.3 Gate + dedup

- **Focus:** `firstMatchingFocus()` — text must hit [`lib/constants/focus-areas.ts`](./lib/constants/focus-areas.ts). First category in object order wins.
- **Dedup:** SHA-256 `content_hash` unique index.
- **Noise:** Rows classified `ignore` with very low confidence may be **discarded** before insert (see `shouldDiscardSignal`).

### 7.4 Scoring

1. **`computeSemanticIntensity`** — base semantic score (keywords + length multiplier).
2. **`adjustIntensityMonetization`** — boosts money/customers/scaling signals; penalizes vague tech-only noise.
3. **Action Engine** (`buildOpportunityFields`): heuristics fill `pain_summary`, `likely_root_issue`, `opportunity_angle`, `business_impact`, `confidence_score`, `action_type`. If `GEMINI_API_KEY` is set and `ACTION_ENGINE_GEMINI` is not `false`, fields are **refined** with Gemini (`gemini-2.0-flash`).

### 7.5 Alerts

If any inserted signal has intensity **> 80**, optionally POST to `NTFY_URL`.

---

## 8. Scrutinize (proof-of-life)

- **Script:** `npm run scrutinize` → `scripts/scrutinize.ts`
- **Behavior:** Loads **10 newest** rows with `status = 'new'`, `fetch`es `source_url`, marks **`dead`** on HTTP **404/410** or removal-like HTML markers; always updates `last_verified_at` and appends `audit_log`.
- **Runtime:** Intended for host with Node + same `DATABASE_PATH` as data you care about; **not** bundled in production Docker image by default.

---

## 9. Outreach (Gemini)

- **File:** `lib/ai/outreach.ts`
- **Model:** `gemini-2.0-flash` (verify in file if upgraded)
- **Prompt:** Forensic / sovereign-stack framing; symptom + financial/trust gap + solution; banned generic “I can help you fix this” style lines.

---

## 10. Docker / Traefik production

| Item | Detail |
|------|--------|
| Compose file | `docker-compose.yml` |
| App service | `pain-intel`, image `pain-intel:latest`, port **3000** internal |
| TLS | Traefik + Let’s Encrypt HTTP-01; host rule **`signal.mgmalkz.com`** (change labels if domain changes) |
| Persistent SQLite | Named volume **`pain_data`** → `/app/data/pain.db` |
| Env merge | `env_file: .env` + `environment.DATABASE_PATH=/app/data/pain.db` |

**Host scripts vs. live dashboard DB:** `npm run ingest`, `npm run ingest:dorks`, and `npm run db:purge-job-rss` default to **`./data/pain.db` on the VM filesystem** (unless `DATABASE_PATH` points elsewhere). The Traefik **`pain-intel`** container uses a **different file**: `/app/data/pain.db` on volume **`pain_data`**. Rows ingested on the host will **not** appear on https://signal… until they exist in the container DB. Options:

1. **One-time sync (overwrite container DB with host file)** — backup first, then:
   ```bash
   docker compose cp ./data/pain.db pain-intel:/app/data/pain.db
   docker compose exec -u root pain-intel chown node:node /app/data/pain.db
   docker compose restart pain-intel
   ```
2. **Long-term:** bind-mount host `./data` → `/app/data` in `docker-compose.yml` (replace the named volume for that service) so host scripts and the app always share one `pain.db`.

**First-time / schema:** Run `npm run db:push` on host with `DATABASE_PATH=./data/pain.db`, then seed container volume, e.g.:

```bash
docker compose cp ./data/pain.db pain-intel:/app/data/pain.db
docker compose exec -u root pain-intel chown node:node /app/data/pain.db
docker compose restart pain-intel
```

**Deploy code changes:**

```bash
git pull
docker compose build pain-intel
docker compose up -d pain-intel
```

**Scheduled ingest (VM cron example):**

```cron
0 5 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://signal.mgmalkz.com/api/cron/ingest
30 5 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://signal.mgmalkz.com/api/cron/ingest-dorks
```

**Purge legacy `job_rss` rows (real DB lives in the container):**  
`npm run db:purge-job-rss` on the **host** uses `./data/pain.db` by default — often **not** the same file as production (volume `pain_data`). If it reports **0 deleted** but the site still shows `job_rss`, delete inside **`pain-intel`** with stdlib Python (`-T` avoids “input device is not a TTY”):

```bash
docker compose exec -T pain-intel python3 -c "import sqlite3; c=sqlite3.connect('/app/data/pain.db'); n=c.execute('select count(*) from pain_signals where source=?',('job_rss',)).fetchone()[0]; c.execute('delete from pain_signals where source=?',('job_rss',)); c.commit(); c.close(); print('job_rss rows before delete:', n)"
```

---

## 11. NPM scripts

| Script | Command |
|--------|---------|
| Dev | `npm run dev` |
| Build / start | `npm run build` → `npm run start` |
| Lint | `npm run lint` |
| DB schema push | `npm run db:push` |
| Drizzle Studio | `npm run db:studio` |
| Ingest (host) | `npm run ingest` |
| Scrutinize | `npm run scrutinize` |

---

## 12. UI behaviors (dashboard)

- **Top Actions (`TopActions.tsx`):** Up to **3** signals ranked by `action_type` (direct outreach first), then **confidence × intensity**. Shows pain summary, opportunity angle, source link, **1-click outreach** (+ copy).
- **Intensity:** Prominent badge; red **> 80**, orange **> 60** (`SignalFeed.tsx`).
- **Pain summary:** Shown above keyword-highlighted body when present.
- **Actionable only:** Toggle — shows rows with **confidence_score > 0.7** and **action_type = direct_outreach**.
- **Last verified:** From `lastVerifiedAt` / scrutinize.
- **High value leads:** `/api/stats` — **intensity > 85** (DB-wide).
- **Filters:** Search text, focus-area chips, hide `dead`, actionable toggle.
- **CSV export:** Includes Action Engine columns (`painSummary`, `opportunityAngle`, `confidenceScore`, `actionType`).

---

## 13. Maintenance checklist (when you change the system)

| Change | Action |
|--------|--------|
| **Schema** (`schema.ts`) | `npm run db:push` on each environment; restart app; document breaking changes here |
| **Focus keywords** (`focus-areas.ts`) | Redeploy/rebuild; **existing rows unchanged** — new ingest picks up new rules |
| **Reddit search queries** (`REDDIT_SEARCH_QUERIES` / `lib/constants/reddit-search-queries.ts`) | First-person + pain phrases; edit list when tuning recall vs noise |
| **GitHub floor** | `GITHUB_MIN_STARS` (default 5000; `0` disables star gate) |
| **Env vars** | Update `.env.example` + this doc; restart containers |
| **Docker hostname** | Edit Traefik labels in `docker-compose.yml` + DNS |
| **API contract** | Update §6 and any consumer (dashboard fetch shapes) |

---

## 14. Changelog (maintainers)

Append dated entries when shipping meaningful changes:

| Date | Summary |
|------|---------|
| 2026-04-28 | Action Engine columns; monetization intensity; multi-source ingest (HN, optional Twitter/GitHub); Top Actions UI; actionable filter; outreach uses structured fields; optional RSS disable via `JOB_RSS_ENABLED`. |
| 2026-04-29 | Removed job-board RSS ingest entirely; `npm run db:purge-job-rss` deletes legacy `job_rss` rows; Serper dork ingest documented. |
| 2026-04-29 | `GET /api/cron/ingest-dorks` — runs `runDorkIngest` inside the app (container DB); host `npm run ingest:dorks` remains for local/dev. |
| 2026-04-29 | **Ingest radar v2:** Reddit → global `search.json` queries; `signal-filters` (junk URL, problem language, first-person Reddit, buyer score); GitHub title + **min stars**; Twitter user expansion; DB columns `buyer_score`, `priority`, `identity_json`. LinkedIn/Discord not added (no free API / scope). |
| *(add rows below)* | |

---

## 15. Known constraints / caveats

- Reddit JSON may fail or rate-limit; ingest logs warnings and skips bad responses.
- Focus matching is **substring-based** — widening keywords increases recall and noise.
- SQLite file must be **writable** by the `node` user in Docker (`chown` after `docker cp`).
- Production image is **standalone Next** — host `npm run scrutinize` targets whichever `pain.db` path you point `DATABASE_PATH` at (often requires syncing DB or running against mounted copy).

---

*Last reviewed: 2026-04-28.*
