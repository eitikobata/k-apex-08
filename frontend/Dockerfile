# K-APEX-08 console — frontend (Next.js, App Router)
#
# Multi-stage build: deps -> builder -> runner. Only the final `runner`
# stage ships in the image; the other two exist purely to keep build tools
# and the full node_modules tree out of what actually runs in production.
# Requires next.config.js's `output: 'standalone'` — that's what makes
# .next/standalone exist for the runner stage to copy.

# ---- deps: install exactly once, cached separately from source changes ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: needs the NEXT_PUBLIC_* vars at BUILD time, not runtime — ----
# Next.js inlines them into the client JS bundle during `next build`. If
# these are only set on the running container (not passed as build args
# here), the demo-autofill button and API/WS URLs will silently fall back
# to their localhost defaults in the built bundle.
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_DEMO_CALLSIGN
ARG NEXT_PUBLIC_DEMO_PASSWORD
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_DEMO_CALLSIGN=$NEXT_PUBLIC_DEMO_CALLSIGN
ENV NEXT_PUBLIC_DEMO_PASSWORD=$NEXT_PUBLIC_DEMO_PASSWORD

RUN npm run build

# ---- runner: minimal image, only what `next start` (standalone) needs ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Don't run as root in the container — standard hardening, costs nothing.
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
