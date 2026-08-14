-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "OperatorRole" AS ENUM ('ADMIN', 'SENIOR_OPERATOR', 'OPERATOR', 'OBSERVER');

-- CreateEnum
CREATE TYPE "AuthEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'MFA_SUCCESS', 'MFA_FAILURE', 'REFRESH_SUCCESS', 'REFRESH_REUSE_DETECTED', 'LOGOUT', 'SESSION_REVOKED', 'LOCKOUT_TRIGGERED', 'WEBAUTHN_REGISTERED', 'WEBAUTHN_SUCCESS', 'WEBAUTHN_FAILURE');

-- CreateEnum
CREATE TYPE "RawEventKind" AS ENUM ('NOISE', 'ANOMALOUS_TRAFFIC', 'PRIVILEGED_ACCESS_ATTEMPT', 'NODE_SILENCE', 'AUTH_INTRUSION_ATTEMPT', 'ROGUE_AI_SIGNATURE');

-- CreateEnum
CREATE TYPE "SilenceStatus" AS ENUM ('ALIVE', 'RETRYING', 'CONFIRMED_SILENT', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ThreatTier" AS ENUM ('LATCH', 'SPLICE', 'SHATTER');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('PENDING_CORRELATION', 'AWAITING_OPERATOR', 'AUTO_RESOLVING', 'RESOLVED', 'ESCALATED', 'ROGUE_AI_ACTIVE', 'ROGUE_AI_SPREAD');

-- CreateEnum
CREATE TYPE "ResolutionOrigin" AS ENUM ('MANUAL_OPERATOR', 'AUTO_TIMEOUT', 'MANUAL_TOGGLE_AUTONOMOUS', 'AUTO_LOW_SEVERITY');

-- CreateEnum
CREATE TYPE "RogueAiState" AS ENUM ('DETECTED', 'CONTAINED_STEP_1', 'CONTAINED_STEP_2', 'NEUTRALIZED', 'ESCALATED', 'SPREAD');

-- CreateEnum
CREATE TYPE "RogueAiCommand" AS ENUM ('ISOLATE', 'TRACE', 'PURGE');

-- CreateEnum
CREATE TYPE "KuroIceTier" AS ENUM ('LATCH', 'SPLICE', 'SHATTER');

-- CreateEnum
CREATE TYPE "KuroIceStatus" AS ENUM ('PENDING', 'ESTABLISHING_LINK', 'EXECUTED', 'FAILED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "operators" (
    "id" TEXT NOT NULL,
    "callsign" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "OperatorRole" NOT NULL DEFAULT 'OPERATOR',
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_permissions" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operator_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "replacedByHash" TEXT,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webauthn_credentials" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "deviceLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "operatorId" TEXT NOT NULL,
    "tokens" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "lastRefill" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "failCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("operatorId")
);

-- CreateTable
CREATE TABLE "auth_events" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT,
    "type" "AuthEventType" NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_nodes" (
    "id" TEXT NOT NULL,
    "codeName" TEXT NOT NULL,
    "sector" INTEGER NOT NULL,
    "baselineNoiseRate" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "severityBias" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "isChronicallyFlaky" BOOLEAN NOT NULL DEFAULT false,
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_events" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "kind" "RawEventKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureVector" JSONB,
    "correlationTag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silence_states" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "status" "SilenceStatus" NOT NULL DEFAULT 'ALIVE',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextRetryAt" TIMESTAMP(3),
    "firstMissedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "escalatedIncidentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "silence_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silence_retry_attempts" (
    "id" TEXT NOT NULL,
    "silenceStateId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "backoffMs" INTEGER NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "silence_retry_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "tier" "ThreatTier" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'PENDING_CORRELATION',
    "kind" "RawEventKind" NOT NULL,
    "correlationTag" TEXT,
    "summary" TEXT,
    "contributingEventIds" TEXT[],
    "resolutionOrigin" "ResolutionOrigin",
    "resolvedByOperatorId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "alarmFatigueDeprioritized" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rogue_ai_incidents" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "state" "RogueAiState" NOT NULL DEFAULT 'DETECTED',
    "nodeId" TEXT NOT NULL,
    "expectedNextCommand" "RogueAiCommand",
    "stepDeadlineAt" TIMESTAMP(3),
    "spreadToNodeId" TEXT,
    "resolvedAutonomously" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rogue_ai_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rogue_ai_command_attempts" (
    "id" TEXT NOT NULL,
    "rogueAiIncidentId" TEXT NOT NULL,
    "command" "RogueAiCommand" NOT NULL,
    "wasExpected" BOOLEAN NOT NULL,
    "wasWithinDeadline" BOOLEAN NOT NULL,
    "issuedByOperatorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rogue_ai_command_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kuro_ice_actions" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "tier" "KuroIceTier" NOT NULL,
    "status" "KuroIceStatus" NOT NULL DEFAULT 'PENDING',
    "actionType" TEXT NOT NULL,
    "triggeredByAutonomous" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resultDetail" JSONB,

    CONSTRAINT "kuro_ice_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_files" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "aiSummary" TEXT,
    "aiSummaryFailed" BOOLEAN NOT NULL DEFAULT false,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blacktape_entries" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blacktape_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_state" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "autonomousModeActive" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3),
    "activatedOrigin" "ResolutionOrigin",
    "activatedByOperatorId" TEXT,

    CONSTRAINT "system_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_heartbeats" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operator_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "streamKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_jobs" (
    "id" TEXT NOT NULL,
    "queueName" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operators_callsign_key" ON "operators"("callsign");

-- CreateIndex
CREATE UNIQUE INDEX "operators_email_key" ON "operators"("email");

-- CreateIndex
CREATE UNIQUE INDEX "operator_permissions_operatorId_scope_key" ON "operator_permissions"("operatorId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_operatorId_idx" ON "refresh_tokens"("operatorId");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "webauthn_credentials_credentialId_key" ON "webauthn_credentials"("credentialId");

-- CreateIndex
CREATE INDEX "auth_events_operatorId_idx" ON "auth_events"("operatorId");

-- CreateIndex
CREATE INDEX "auth_events_type_idx" ON "auth_events"("type");

-- CreateIndex
CREATE UNIQUE INDEX "network_nodes_codeName_key" ON "network_nodes"("codeName");

-- CreateIndex
CREATE INDEX "raw_events_nodeId_createdAt_idx" ON "raw_events"("nodeId", "createdAt");

-- CreateIndex
CREATE INDEX "raw_events_correlationTag_idx" ON "raw_events"("correlationTag");

-- CreateIndex
CREATE UNIQUE INDEX "silence_states_escalatedIncidentId_key" ON "silence_states"("escalatedIncidentId");

-- CreateIndex
CREATE INDEX "incidents_status_idx" ON "incidents"("status");

-- CreateIndex
CREATE INDEX "incidents_tier_idx" ON "incidents"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "rogue_ai_incidents_incidentId_key" ON "rogue_ai_incidents"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "case_files_incidentId_key" ON "case_files"("incidentId");

-- CreateIndex
CREATE INDEX "blacktape_entries_category_idx" ON "blacktape_entries"("category");

-- CreateIndex
CREATE INDEX "blacktape_entries_targetType_targetId_idx" ON "blacktape_entries"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "operator_heartbeats_operatorId_createdAt_idx" ON "operator_heartbeats"("operatorId", "createdAt");

-- CreateIndex
CREATE INDEX "outbox_events_status_idx" ON "outbox_events"("status");

-- CreateIndex
CREATE UNIQUE INDEX "processed_jobs_queueName_idempotencyKey_key" ON "processed_jobs"("queueName", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "operator_permissions" ADD CONSTRAINT "operator_permissions_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_limit_buckets" ADD CONSTRAINT "rate_limit_buckets_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_events" ADD CONSTRAINT "raw_events_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "network_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silence_states" ADD CONSTRAINT "silence_states_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "network_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silence_states" ADD CONSTRAINT "silence_states_escalatedIncidentId_fkey" FOREIGN KEY ("escalatedIncidentId") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silence_retry_attempts" ADD CONSTRAINT "silence_retry_attempts_silenceStateId_fkey" FOREIGN KEY ("silenceStateId") REFERENCES "silence_states"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolvedByOperatorId_fkey" FOREIGN KEY ("resolvedByOperatorId") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rogue_ai_incidents" ADD CONSTRAINT "rogue_ai_incidents_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rogue_ai_command_attempts" ADD CONSTRAINT "rogue_ai_command_attempts_rogueAiIncidentId_fkey" FOREIGN KEY ("rogueAiIncidentId") REFERENCES "rogue_ai_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kuro_ice_actions" ADD CONSTRAINT "kuro_ice_actions_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_files" ADD CONSTRAINT "case_files_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_heartbeats" ADD CONSTRAINT "operator_heartbeats_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;
