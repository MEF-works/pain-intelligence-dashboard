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
| `src/lib/html/` | `plain-text.ts` — HTML entity decode + tag strip for readable RSS/body text |
| `scripts/` | `ingest-signals.ts`, `scrutinize.ts` (host/cron); prod ingest usually via HTTP |
| `public/` | Static assets (e.g. `favicon.ico`) |
| `drizzle.config.ts` | Drizzle Kit config (defaults to `./data/pain.db`) |
| `Dockerfile` | Multi-stage Node 20 build → Next standalone runner |

---

## 4. Data model (`pain_signals`)

Defined in `src/lib/db/schema.ts`. Apply schema changes with **`npm run db:push`** (Drizzle Kit against `DATABASE_PATH` or default `./data/pain.db`).

| Column | Type | Notes |
|--------|------|--------|
| `id` | text PK | Reddit `name` or `rss:…` derived id |
| `source` | text | e.g. `reddit`, `job_rss` |
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
| `JOB_RSS_URL` | Optional | Default Remote OK RSS in `run-ingest.ts` |
| `JOB_RSS_ENABLED` | Optional | Set `false` to skip Remote OK RSS only |
| `TWITTER_BEARER_TOKEN` | Optional | Enables X/Twitter recent search ingest |
| `TWITTER_SEARCH_QUERIES` | Optional | Queries separated by `\|\|\|\|` (four pipes). Defaults in `run-ingest.ts` |
| `GITHUB_TOKEN` | Optional | Higher GitHub Search API rate limits for issue ingest |
| `GITHUB_ISSUES_QUERY` | Optional | Override GitHub issue search query |
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

**Security note:** Lock down `/api/cron/ingest` with `CRON_SECRET` in production.

---

## 7. Ingest pipeline

Entry: `runIngest()` in `src/lib/ingest/run-ingest.ts` (also invoked by `GET /api/cron/ingest`).

### 7.1 Sources (run order)

| Source | `source` value | Notes |
|--------|----------------|--------|
| Reddit | `reddit` | `/r/{sub}/new.json?limit=25`; subs include **saas**, **webdev**, **uxdesign**, plus ecommerce/shopify/wordpress/smallbusiness/entrepreneur/startups/dropshipping/roastmystore |
| Remote OK RSS | `job_rss` | Skipped when `JOB_RSS_ENABLED=false` |
| Hacker News | `hackernews` | Firebase `newstories` + item JSON; link or `item?id=` |
| X / Twitter | `twitter` | Requires `TWITTER_BEARER_TOKEN`; recent search (default queries OR override env) |
| GitHub issues | `github_issue` | GitHub Search API; optional `GITHUB_TOKEN` |

**Not implemented in-repo** (need separate APIs / contracts): Product Hunt comments, status-page incident ingestion — add deliberately when keys and parsing rules are defined.

### 7.2 Gate + dedup

- **Filter:** `firstMatchingFocus()` — text must hit [`lib/constants/focus-areas.ts`](./lib/constants/focus-areas.ts). First category in object order wins.
- **Dedup:** SHA-256 `content_hash` unique index.
- **Noise:** Rows classified `ignore` with very low confidence may be **discarded** before insert (see `shouldDiscardSignal`).

### 7.3 Scoring

1. **`computeSemanticIntensity`** — base semantic score (keywords + length multiplier).
2. **`adjustIntensityMonetization`** — boosts money/customers/scaling signals; penalizes vague tech-only noise.
3. **Action Engine** (`buildOpportunityFields`): heuristics fill `pain_summary`, `likely_root_issue`, `opportunity_angle`, `business_impact`, `confidence_score`, `action_type`. If `GEMINI_API_KEY` is set and `ACTION_ENGINE_GEMINI` is not `false`, fields are **refined** with Gemini (`gemini-2.0-flash`).

### 7.4 Alerts

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
| **Reddit sub list** (`DEFAULT_SUBS`) | Same as above |
| **Env vars** | Update `.env.example` + this doc; restart containers |
| **Docker hostname** | Edit Traefik labels in `docker-compose.yml` + DNS |
| **API contract** | Update §6 and any consumer (dashboard fetch shapes) |

---

## 14. Changelog (maintainers)

Append dated entries when shipping meaningful changes:

| Date | Summary |
|------|---------|
| 2026-04-28 | Action Engine columns; monetization intensity; multi-source ingest (HN, optional Twitter/GitHub); Top Actions UI; actionable filter; outreach uses structured fields; optional RSS disable via `JOB_RSS_ENABLED`. |
| *(add rows below)* | |

---

## 15. Known constraints / caveats

- Reddit JSON may fail or rate-limit; ingest logs warnings and skips bad responses.
- Focus matching is **substring-based** — widening keywords increases recall and noise.
- SQLite file must be **writable** by the `node` user in Docker (`chown` after `docker cp`).
- Production image is **standalone Next** — host `npm run scrutinize` targets whichever `pain.db` path you point `DATABASE_PATH` at (often requires syncing DB or running against mounted copy).

---

*Last reviewed: 2026-04-28.*
