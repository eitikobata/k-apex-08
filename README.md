# K-APEX-08 — Security Console

A fictional corporate SOAR (Security Orchestration, Automation and Response) console built around a real decision engine, a real message queue with a real production outage behind it, and a deliberate line between deterministic logic and optional AI — not a chatbot wearing a security-dashboard skin.

Live demo: https://kapex08.eitikobata.com

On-screen the system is presented as K-APEX-08, the security console operated by Kobata Matrix Corporation — the terminal you type into, the incidents you confirm, the audit trail you read. Every name (K-ID, K-STREAM, K-DIRECTIVE, KURO-ICE, K-SILENCE, K-BLACKBOX, K-BLACKTAPE) is original — nothing here is a real product, and no licensed IP is reproduced (the visual language draws inspiration from the general aesthetic of cyberpunk media, not from any specific copyrighted work).

## What it does

A network simulator generates traffic and heartbeat events for 24 fictional nodes, each with its own "personality" — a baseline noise rate, a severity bias, a few chronically unstable by design. Events flow through K-STREAM, which correlates them on a sliding time window; when a pattern crosses a threshold, an incident is raised at one of three severities (LATCH, SPLICE, SHATTER). K-DIRECTIVE — a 100% deterministic decision engine, no AI anywhere in this path — decides whether the incident resolves itself or needs a human, and severity isn't what decides that: every tier waits on the operator to type a confirmation command into the console's live terminal, unless the dead man's switch has already put the system into autonomous mode, in which case every tier resolves on its own. Severity only changes how much typing a confirmation takes and which KURO-ICE action fires (LATCH gets a flag, SHATTER gets a full node isolation) — not whether the operator gets a say.

If the operator goes quiet, a dead man's switch flips the whole system into autonomous mode — a full-screen lockdown, desaturated and glitching, makes it visually unmistakable that nobody is at the helm. Separately, K-SILENCE watches for network nodes that stop sending their own heartbeat, retrying with real exponential backoff before ever raising an incident — self-resolved silence never becomes anyone's problem. An adaptive Rogue AI detector runs alongside all of this, watching for a signature that gets harder to catch the longer it's ignored, with its own multi-step containment sequence and two distinct failure modes depending on exactly how badly it's handled.

Every resolved incident is archived in K-BLACKBOX with an AI-generated narrative summary and a semantic-search embedding; every action anyone (or anything) takes is written to K-BLACKTAPE, an audit trail that the database itself — not just the application code — refuses to let anyone edit or delete.

## Architecture

```
+------------------------------------------------------------+
|                     Network Simulator                      |
|       24 nodes, tick every 5s, per-node personality        |
+------------------------------------------------------------+
            |
            | events + heartbeats
            v
+------------------------------------------------------------+
|                          K-STREAM                          |
|    Redis Streams ingestion + sliding-window correlation    |
+------------------------------------------------------------+
            |
            | heartbeat gap on a node
            v
+------------------------------------------------------------+
|                         K-SILENCE                          |
|         BullMQ retry with backoff: 10s / 30s / 90s         |
+------------------------------------------------------------+
            |
            | retries exhausted -- raises an incident, same as K-STREAM
            v
+------------------------------------------------------------+
|                        K-DIRECTIVE                         |
|   Pure deterministic decision engine, no AI in this path   |
+------------------------------------------------------------+
            |
            | requires operator unless autonomous mode is active (any tier)
            v
+------------------------------------------------------------+
|                          KURO-ICE                          |
|     Countermeasure execution: LATCH / SPLICE / SHATTER     |
+------------------------------------------------------------+
            |
            v
+------------------------------------------------------------+
|                         K-BLACKBOX                         |
|      AI narrative summary + pgvector search embedding      |
+------------------------------------------------------------+
            |
            v
+------------------------------------------------------------+
|                        K-BLACKTAPE                         |
|  Append-only audit trail, enforced by a Postgres trigger   |
+------------------------------------------------------------+
            |
            | live push over the socket
            v
+------------------------------------------------------------+
|                     WebSocket Gateway                      |
+------------------------------------------------------------+
            |
            v
+------------------------------------------------------------+
|                      Next.js Frontend                      |
|  Console, admin panel, sound system, boot/login sequences  |
+------------------------------------------------------------+
```

K-ID (auth) sits underneath all of it — every route above is reached through it, omitted from the diagram only to keep it readable. Rogue AI isn't drawn either, for the same reason (a linear diagram can't show a branch cleanly) — it runs alongside K-STREAM's correlation as its own adaptive drift detector, feeding the same KURO-ICE containment step through a separate multi-step state machine.

## Key features

**A real production outage, root-caused and documented, not smoothed over.** K-SILENCE's retry queue looked correct in code and sat completely stuck for three-plus days — every retry stuck in `RETRYING`, zero jobs ever processed, no error visible anywhere. It got misdiagnosed once (see Trade-offs below) before permanent structured logging pinned the actual cause to a single missing `password` field in a Redis connection config. That fix, the earlier wrong turn, and a second bug it uncovered (the retry backoff was technically working but never actually observable) are all documented in detail — because a bug that's found, misunderstood, and then correctly fixed is worth more on a resume than a system that never had one.

**A dead man's switch with two triggers and one code path.** Autonomous mode activates either from real operator inactivity or a manual toggle — both converge on the exact same function, differing only in the origin recorded for the audit trail. No duplicated "what happens when autonomous mode starts" logic to keep in sync.

**An adaptive threat detector, not a threshold check.** The Rogue AI detector doesn't fire on a single anomalous event — it needs a signature that's actively drifting further from baseline across samples, simulating something that's trying to stay under a naive detector's radar. Failing to contain it in time doesn't just fail — it spreads to a neighboring node; the wrong command in time gets you a harder retry on the same one. Two distinct failure states, chosen on purpose.

**Two-tier RBAC, with a granular escape hatch.** A coarse role (ADMIN/SENIOR_OPERATOR/OPERATOR/OBSERVER) decides the broad strokes; specific critical actions (approving a SHATTER-tier incident, issuing a Rogue AI containment command) additionally require an explicit per-operator permission grant that even an ADMIN has to hand out deliberately. OBSERVER is read-only everywhere except one deliberately-opened exception (toggling autonomous mode), enforced at the API layer, not hidden by the frontend and hoped for.

**An audit trail the database itself protects.** K-BLACKTAPE started as "the code just never calls UPDATE or DELETE" and is now a Postgres trigger that rejects both unconditionally, regardless of what calls the table or how.

**A full, synced sound design, not four sound effects bolted on.** A looping ambient track starting the moment the login screen mounts, eight distinct one-shot effects scaled by severity, a typewriter-synced click for AI summary reveals, and two custom loading sequences (boot + post-login) timed to match their audio to the millisecond — plus a persisted global mute, because a security console that can't be silenced in an open office is a console nobody keeps open.

**AI kept deliberately out of every real decision.** Correlation, threat tier, and containment action are 100% deterministic pure functions — the security-critical path never calls an external API and can't be degraded by one being slow or down. AI only touches optional narrative enrichment (case summaries, semantic search), sitting behind its own circuit breaker that a failure there can never block or delay a real action.

## Technical decisions & trade-offs

**BullMQ + Redis Streams instead of RabbitMQ** — one Redis instance doing two jobs (Streams for event ingestion, BullMQ for delayed/async work) instead of running a dedicated broker, to save a process on a shared VPS. The cost showed up directly: BullMQ's connection config turned out to be configured separately from the Redis client everything else uses, and the two drifted out of sync (see the outage above) in a way a single dedicated broker connection wouldn't have allowed.

**K-SILENCE's retry mechanism: BullMQ, replaced with simple polling, then reverted** — when the queue first looked stuck, it got swapped for a lighter `@Interval` polling sweep against a timestamp column, no queue infrastructure required. That fix shipped before the real cause was ever found. It went back to BullMQ once permanent `@OnWorkerEvent` logging actually pinned the problem to a five-minute config fix. Kept as a documented decision, not scrubbed from the history: routing around a bug you haven't root-caused yet is a fix that can quietly outlive the reason it existed.

**MFA required for ADMIN only, not every rank** — originally mandatory for every operator. Revised once the OBSERVER role's actual purpose got concrete: letting someone review the project without an enrollment step. Rather than special-case one role, the same exception extends to every non-admin rank, keeping one consistent login flow. The accepted cost is stated plainly rather than glossed over: a granted critical-action permission on a non-admin account is only as strong as its password from that point on.

**Node recovery decoupled from simulated heartbeat noise** — K-SILENCE's backoff originally decided "did the node come back" from real simulated heartbeat data, which sounds more realistic but meant ambient noise almost always cured a node before the first real retry check ever ran — the second and third backoff steps were, in practice, unreachable. Recovery is now an explicit per-attempt probability roll, independent of ambient noise, specifically so a three-step backoff — and a real chance of escalating to an incident — is something that actually happens where it can be watched.

**Cursor pagination over offset for the audit trail** — `LIMIT/OFFSET` is simpler to write but silently skips or repeats rows on a table that's both append-only and fast-moving if a new row lands mid-page-fetch. Cursor-based (`createdAt` + `id` as a tiebreaker) costs a slightly less obvious query, correct under concurrent writes.

**Shared Postgres/Redis across every project on the VPS, isolated logically, not physically** — each project gets its own schema and Redis key prefix rather than a dedicated process. Cheaper and standard practice for a shared platform setup; worth stating plainly that a misconfigured prefix in one project can theoretically collide with another's, since that's the actual model in use here — this is exactly the class of problem behind the K-SILENCE outage above (a config drifting out of sync between two things that share infra).

## Known limitations (intentional, not overlooked)

- **WebAuthn/passkey support is implemented against the real, documented `@simplewebauthn/server` API but has never been exercised against physical hardware.** The HTTP plumbing and challenge/response flow are real; a live YubiKey or platform authenticator has never touched it.
- **No horizontal scaling story yet.** The AI circuit breaker's state lives in a single process's memory — running more than one backend instance would mean each has its own independent breaker rather than a shared one. Fine at the current single-instance scale; a real multi-instance deployment would need that state moved to Redis.
- **The 24-node roster is fixed at seed time, not an admin-managed resource.** Adding, removing, or re-tuning a node's simulated personality today is a data change, not something exposed anywhere in the UI.
- **Services wired to live Prisma/Redis/BullMQ have no automated tests.** Every piece of pure decision/calculation logic (82 tests, 100% mutation score via Stryker) is fully covered; the infrastructure-dependent services were instead validated end-to-end, manually, against real Postgres/Redis/BullMQ — which is what actually surfaced the real bugs documented above, including the outage. A proper integration-test harness against ephemeral infra is the natural next investment.

## Stack

| Layer | Tech |
|---|---|
| Backend | NestJS, TypeScript, Prisma |
| Database | PostgreSQL + pgvector (shared instance) |
| Queues | Redis Streams (event ingestion), BullMQ (delayed/async jobs) |
| Real-time | Socket.IO (WebSocket) |
| AI (optional enrichment only) | Gemini (summaries + `text-embedding-004` embeddings), own circuit breaker |
| Auth | Argon2id, JWT + rotating opaque refresh tokens, TOTP (RFC 6238), WebAuthn, hand-rolled token bucket rate limiting |
| Frontend | Next.js (App Router), TypeScript, Tailwind CSS, xterm.js, Zustand |
| Infra | Docker (multi-stage builds), EasyPanel, shared services across projects |

## Running locally

Requires Docker and Docker Compose.

```bash
git clone https://github.com/eitikobata/k-apex-08.git
cd k-apex-08/backend

# spin up local Postgres (with pgvector) + Redis
cd infra
docker compose -f docker-compose.dev.yml up -d
cd ..

cp .env.example .env   # fill in TOTP_ENCRYPTION_KEY at minimum: openssl rand -base64 32
npm install
npx prisma generate
npx prisma migrate dev
node prisma/seed.js      # creates the first ADMIN — prints the callsign/password/TOTP secret once
npm run start:dev
```

```bash
# frontend, separate terminal, same clone
cd k-apex-08/frontend
cp .env.local.example .env.local   # point NEXT_PUBLIC_API_BASE_URL / NEXT_PUBLIC_WS_URL at the backend above
npm install
npm run dev
```

Frontend: `http://localhost:3001` (or whatever port `next dev` picks)
Backend: `http://localhost:3000`

Minimum environment variables (backend, in `.env`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB` | Redis connection (Streams + BullMQ both use this) |
| `JWT_ACCESS_SECRET` | Signs access tokens |
| `TOTP_ENCRYPTION_KEY` | AES-256-GCM key for TOTP secrets at rest — `openssl rand -base64 32` |
| `AI_PROVIDER_API_KEY` | Optional — K-BLACKBOX summaries/embeddings degrade gracefully without it |

Frontend (`.env.local`): `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_WS_URL`, and optionally `NEXT_PUBLIC_DEMO_CALLSIGN` / `NEXT_PUBLIC_DEMO_PASSWORD` (only renders a "fill demo credentials" button on the login screen when both are set).

## Project structure

```
k-apex-08/                # monorepo — two independently deployed apps, one repo
├── backend/
│   ├── src/
│   │   ├── k-id/          # auth, RBAC, rate limiting, TOTP, WebAuthn
│   │   ├── k-stream/       # network simulator + sliding-window correlation
│   │   ├── k-silence/       # node heartbeat monitoring + BullMQ retry
│   │   ├── k-directive/     # decision engine + dead man's switch
│   │   ├── kuro-ice/        # countermeasure execution
│   │   ├── rogue-ai/        # adaptive detector + containment state machine
│   │   ├── k-blackbox/      # case archive, AI summaries, semantic search
│   │   └── common/
│   │       └── blacktape/    # append-only audit trail
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   ├── seed.js           # first ADMIN, plain JS (not ts-node) — ships in the production container
│   │   └── migrate-encrypt-totp-secrets.js   # one-off, re-runnable data migration
│   ├── infra/                # local-dev-only compose file, never deployed
│   └── Dockerfile
└── frontend/
    ├── src/
    │   ├── app/              # login, console, admin — Next.js App Router
    │   ├── components/       # panels, node grid, terminal, sound, boot/loading screens
    │   └── lib/               # api client, socket client, zustand stores
    ├── public/
    │   └── audio/             # ambient loop + 8 one-shot effects
    └── Dockerfile
```

`backend/infra/` never ships to production — Postgres and Redis run as separate, shared EasyPanel services in production, reused across every project in this portfolio rather than provisioned per-project. `backend/` and `frontend/` deploy as two separate EasyPanel services from the same repo, each pointed at its own subfolder.

## Author

Built by Eiti Kobata as a portfolio project. Every module name (K-ID, K-STREAM, K-DIRECTIVE, KURO-ICE, K-SILENCE, K-BLACKBOX, K-BLACKTAPE) is original — no licensed characters, IP, or trademarks.