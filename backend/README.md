# K-APEX-08 — backend

Console de segurança corporativa fictício da Kobata Matrix Corporation.
SOAR/SIEM em miniatura, cyberpunk sujo, sem freio de "isso ajuda no currículo" — ver brief completo.

Este é o **backend**. O frontend (`k-apex-08-console`) é um repo/deploy separado.

---

## Honestidade sobre o que foi (e não foi) testado aqui

Esse código foi escrito e revisado num sandbox sem acesso ao binário nativo do
Prisma Engine (domínio bloqueado por rede). Isso significa:

- **Testado de verdade, rodando aqui**: toda a lógica pura (algoritmos sem
  I/O) — token bucket, correlação por janela deslizante, detector adaptativo
  de rogue AI, backoff exponencial do K-SILENCE, state machine de contenção
  rogue AI, motor de decisão do K-DIRECTIVE, circuit breaker do K-BLACKBOX,
  parser de comandos de terminal. **66 testes passando, 8 suítes.**
- **Revisado à mão, não compilado**: todo o resto (services que usam
  PrismaService, controllers, guards, gateway WebSocket) — porque os tipos
  do Prisma Client só existem depois de `npx prisma generate`, que precisa
  baixar um binário nativo que esse sandbox não conseguiu acessar.
- **`tsc --noEmit` rodou aqui** e achou (e eu corrigi) dois bugs reais antes
  de você nem tocar no código: faltava a preview feature
  `postgresqlExtensions` no schema Prisma (pro pgvector funcionar), e os
  tipos do WebAuthn (`RegistrationResponseJSON` etc.) estavam sendo
  importados do pacote errado (`@simplewebauthn/server` em vez de
  `@simplewebauthn/types`). Depois dessas correções, os **únicos** erros
  restantes do `tsc --noEmit` (13, catalogados) são todos rastreáveis à
  ausência do Prisma Client gerado — nenhum é um bug de lógica.
- **WebAuthn**: a chamada real da API do `@simplewebauthn/server` v10 foi
  escrita contra a assinatura de tipos real (inspecionei o `.d.ts` instalado,
  não chutei), mas nunca rodou contra um autenticador de verdade (chave
  física / biometria). Trate como "implementado, precisa de um passe com
  hardware real" antes de confiar nele pra login de produção.
- **IA (K-BLACKBOX)**: a chamada pra API da Anthropic está com o shape de
  request/response certo, mas nunca bateu na rede de verdade aqui (sem key
  configurada no sandbox). Circuit breaker garante que uma falha aqui nunca
  trava nada crítico.

## Passo 1 — o que rodar primeiro, sempre

```bash
npm install
npx prisma generate
```

Se `prisma generate` der qualquer erro diferente de rede, me manda a mensagem
inteira que eu conserto na hora — essa é a única parte que eu não consegui
validar de ponta a ponta daqui.

## Passo 2 — infra local

```bash
docker compose -f docker-compose.local.yml up -d
cp .env.local.example .env
npx prisma migrate dev --name init
```

Isso sobe Postgres (com pgvector) na porta `5433` e Redis na `6380` — portas
não-default de propósito, pra não brigar com qualquer Postgres/Redis que já
esteja rodando aí na sua máquina.

## Passo 3 — rodar

```bash
npm run start:dev
```

Servidor sobe em `http://localhost:3000`. WebSocket do console em
`ws://localhost:3000/console`.

## Testes

```bash
npm test              # unitários (lógica pura) — não precisa de DB/Redis
npm run test:cov      # com cobertura — precisa do Prisma gerado (passo 1)
npm run test:e2e      # precisa de Postgres+Redis rodando (passo 2) e migrado
npm run test:mutation # Stryker — precisa do Prisma gerado, demora mais
```

`npm test` sozinho, sem `prisma generate`, já roda as 66 suítes de lógica
pura de cara — é o jeito mais rápido de confirmar que o ambiente tá são antes
de mexer com banco.

### Sobre mutation testing (Stryker)

Configurado pra rodar sobre `src/**/*.ts`, excluindo módulos/DTOs/main. Meta
é 100%, perseguida de verdade — mas mutante sobrevivente que for
**equivalente de verdade** (mudança de código sem mudança de comportamento
observável) deve ser documentado e ignorado, não caçado até virar teste
vazio. Relatório HTML sai em `reports/mutation/index.html`.

## Arquitetura (recap rápido — brief completo tem mais detalhe)

- **K-ID**: Argon2id, JWT + refresh rotation com detecção de reuso, TOTP
  obrigatório, WebAuthn opcional, RBAC + permissão granular, rate limit via
  token bucket implementado na mão.
- **K-STREAM**: simulador de rede + correlação por janela deslizante +
  detector adaptativo de rogue AI, tudo via Redis Streams (consumer group).
- **K-SILENCE**: heartbeat de nós, retry com backoff exponencial via BullMQ,
  só escala pra incidente se esgotar tentativas.
- **K-DIRECTIVE**: motor de decisão 100% determinístico (sem IA no caminho
  crítico), dead man's switch (timeout automático **e** botão manual, mesma
  função por baixo).
- **KURO-ICE**: execução da contramedida, com delay proposital.
- **Rogue AI**: state machine própria (ISOLATE → TRACE → PURGE), comando
  errado escala, timeout espalha pro nó vizinho, dead man's switch resolve
  com lockdown preventivo (mais caro, sem tentar replicar a sequência manual).
- **K-BLACKBOX**: arquivo de casos, resumo via IA opcional atrás de circuit
  breaker, busca semântica via pgvector, replay a partir do K-BLACKTAPE.
- **K-BLACKTAPE**: audit trail, só cria, nunca edita/apaga.
- **Commands**: camada única — botão de UI e comando de terminal (parser
  estilo Hacknet) convergem no mesmo `CommandService`.
- **Outbox pattern**: toda escrita que precisa ir pro Postgres *e* pro Redis
  Stream passa por uma tabela transacional + worker de publicação garantida.
- **Idempotência**: todo job BullMQ é protegido contra reprocessamento via
  `IdempotencyService` (chave única por fila+job).

## Hardening TODO (documentado, não implementado — escopo consciente)

- K-BLACKTAPE não tem `REVOKE UPDATE/DELETE` a nível de banco — a
  imutabilidade hoje é só "o código nunca chama update/delete", não
  reforçada pelo Postgres.
- `totpSecret` está em texto plano no banco — numa VPS de produção de
  verdade isso pediria criptografia em repouso (app-level encryption ou
  `pgcrypto`).
- Embeddings do K-BLACKBOX: a busca semântica via pgvector está pronta, mas
  a geração do embedding em si (endpoint de embeddings da IA) ainda não está
  chamada em lugar nenhum — só o resumo textual está.

---

Sugestão de commit pra essa entrega inicial:

```
feat(backend): scaffold completo do K-APEX-08 — K-ID, K-STREAM, K-SILENCE,
K-DIRECTIVE, KURO-ICE, Rogue AI, K-BLACKBOX, K-BLACKTAPE, Commands/Gateway

66 testes unitários passando (lógica pura). Prisma Client precisa ser
gerado localmente (bloqueado por rede no ambiente onde foi escrito).
```
