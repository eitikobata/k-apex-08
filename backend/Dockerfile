# K-APEX-08 backend — multi-stage build.
# node:22-slim (Debian-based), não Alpine: evita o incompatibilidade clássica
# entre o binary engine do Prisma e o musl libc do Alpine (já mordido nisso
# nos outros projetos — ver histórico do Nexus Dispatch / Section 8½).

FROM node:22-slim AS builder
WORKDIR /app

# OpenSSL é exigido pelo Prisma engine em tempo de build/generate.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3000
CMD ["node", "dist/main.js"]
