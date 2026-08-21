import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CircuitBreakerService } from './circuit-breaker.service';

/** Thrown when a response comes back 200 OK but fails content validation
 * (garbled, truncated, or leaking raw input) — distinct from a network/HTTP
 * failure so the caller can report a more useful skippedReason. */
class InvalidResponseError extends Error {}

export interface EnrichmentResult {
  summary: string | null;
  embedding: number[] | null;
  skippedReason?: 'CIRCUIT_OPEN' | 'API_ERROR' | 'NO_API_KEY' | 'INVALID_RESPONSE';
}

/** text-embedding-004's actual output size — must match the `vector(768)` column in case_files.embedding. */
export const EMBEDDING_DIMENSION = 768;

/**
 * NOTE (honesty flag): this talks to the Gemini generateContent/embedContent
 * APIs using the documented request/response shape. It has NOT been run
 * against a live key in this sandbox — the HTTP plumbing and error handling
 * are real, but hasn't been confirmed against a live response yet. The
 * circuit breaker treats any shape drift as a failure and opens — it won't
 * wedge anything either way.
 */
@Injectable()
export class AiEnrichmentService {
  private readonly logger = new Logger(AiEnrichmentService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  async summarizeIncident(incidentContext: Record<string, unknown>): Promise<EnrichmentResult> {
    const apiKey = this.config.get<string>('AI_PROVIDER_API_KEY');
    if (!apiKey) {
      return { summary: null, embedding: null, skippedReason: 'NO_API_KEY' };
    }

    if (!this.circuitBreaker.isRequestAllowed()) {
      this.logger.warn('AI enrichment skipped — circuit breaker OPEN');
      return { summary: null, embedding: null, skippedReason: 'CIRCUIT_OPEN' };
    }

    try {
      const summary = await this.callSummaryApiWithRetry(incidentContext, apiKey);
      this.circuitBreaker.reportSuccess();
      return { summary, embedding: null };
    } catch (err) {
      this.circuitBreaker.reportFailure();
      const skippedReason = err instanceof InvalidResponseError ? 'INVALID_RESPONSE' : 'API_ERROR';
      this.logger.error(`AI enrichment call failed (${skippedReason}): ${(err as Error).message}`);
      return { summary: null, embedding: null, skippedReason };
    }
  }

  /**
   * Separate call, separate failure mode from summarization — but shares
   * the same circuit breaker instance. That's a deliberate simplification
   * for this project's scale (one AI provider, one outage domain in
   * practice): a struggling embedding endpoint also pauses summary calls
   * for a bit, which is an acceptable trade-off here, not a mistake.
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    const apiKey = this.config.get<string>('AI_PROVIDER_API_KEY');
    if (!apiKey) return null;

    if (!this.circuitBreaker.isRequestAllowed()) {
      this.logger.warn('Embedding generation skipped — circuit breaker OPEN');
      return null;
    }

    try {
      const embedding = await this.callEmbeddingApi(text, apiKey);
      this.circuitBreaker.reportSuccess();
      return embedding;
    } catch (err) {
      this.circuitBreaker.reportFailure();
      this.logger.error(`Embedding generation failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * One retry, with a stricter fallback prompt, if the first response
   * fails validation (see validateAndClean below). Covers the common case
   * of a model adding meta-commentary or leaking fragments of the raw
   * JSON context on the first try — usually goes away when told even more
   * explicitly not to do that. If the retry also fails validation, this
   * throws InvalidResponseError and the caller records it distinctly from
   * a network/HTTP failure (skippedReason: 'INVALID_RESPONSE' vs
   * 'API_ERROR' — different problems, different fix).
   */
  private async callSummaryApiWithRetry(incidentContext: Record<string, unknown>, apiKey: string): Promise<string> {
    const raw = await this.callSummaryApi(incidentContext, apiKey, false);
    const cleaned = this.validateAndClean(raw);
    if (cleaned) return cleaned;

    this.logger.warn('AI summary failed validation on first attempt, retrying with a stricter prompt');
    const retryRaw = await this.callSummaryApi(incidentContext, apiKey, true);
    const retryCleaned = this.validateAndClean(retryRaw);
    if (retryCleaned) return retryCleaned;

    throw new InvalidResponseError(`Response failed validation twice. Last raw output: ${retryRaw.slice(0, 200)}`);
  }

  /**
   * Strips markdown artifacts a "plain prose" instruction doesn't always
   * stop (bold/italic markers, backticks, stray headers), then rejects
   * anything that still doesn't look like a real summary: too short,
   * starts with a meta-commentary pattern ("Tone Check", "Note:", "->"),
   * or contains a raw enum-shaped token from the input context (SCREAMING_
   * SNAKE_CASE — a real summary describing "the operator resolved this
   * manually" doesn't emit the literal string MANUAL_OPERATOR). Returns
   * null (not the original text) when validation fails, so a caller can't
   * accidentally use it by mistake.
   */
  private validateAndClean(text: string): string | null {
    const cleaned = text
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .replace(/^#{1,6}\s*/gm, '')
      .trim();

    if (cleaned.length < 15) return null;
    if (/^(tone check|note:|meta:|->|\*|\[)/i.test(cleaned)) return null;
    if (/\b[A-Z][A-Z0-9]*(_[A-Z0-9]+){1,}\b/.test(cleaned)) return null; // e.g. AUTO_TIMEOUT, MANUAL_OPERATOR leaking through

    return cleaned;
  }

  private async callSummaryApi(incidentContext: Record<string, unknown>, apiKey: string, strict: boolean): Promise<string> {
    const baseUrl = this.config.get<string>(
      'AI_PROVIDER_BASE_URL',
      'https://generativelanguage.googleapis.com',
    );
    const model = this.config.get<string>('AI_PROVIDER_MODEL', 'gemini-2.0-flash');

    // NOTE (bugfix): the previous version joined the instruction and the
    // raw JSON.stringify'd context with nothing but a newline — no
    // delimiter, no label. That's very likely why real responses leaked
    // fragments straight from the input (a literal enum value like
    // AUTO_TIMEOUT showing up in the "summary") — the model had no clear
    // signal that the JSON blob was DATA to describe, not something to
    // continue writing. Fenced + labeled now. `strict` adds an even more
    // blunt instruction for the retry path in callSummaryApiWithRetry.
    const prompt = [
      'You are K-BLACKBOX, the case-archive narrator for a fictional corporate security console.',
      'Write a terse, noir-toned 2-3 sentence incident summary describing the INCIDENT_DATA below.',
      'Output ONLY the summary itself — plain prose, no markdown, no headers, no bullet points, no meta-commentary about tone or word choice, no quoting field names or enum values verbatim from the data.',
      strict
        ? 'Your previous attempt failed this constraint. This time, output literally nothing except the 2-3 sentence summary — no preamble, no explanation, no notes before or after it.'
        : '',
      'INCIDENT_DATA:',
      '```json',
      JSON.stringify(incidentContext),
      '```',
    ]
      .filter(Boolean)
      .join('\n');

    const response = await fetch(
      `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 400 },
        }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '<no body>');
      throw new Error(`AI provider responded ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    };
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('AI provider response had no text content');
    }
    // MAX_TOKENS means the response was cut off mid-sentence — better to
    // treat as invalid and retry/fail cleanly than show a sentence that
    // stops halfway. SAFETY/RECITATION/OTHER are all non-STOP too and
    // equally not a usable summary.
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
      throw new Error(`AI provider finished with reason=${candidate.finishReason}, not STOP`);
    }
    return text;
  }

  private async callEmbeddingApi(text: string, apiKey: string): Promise<number[]> {
    const baseUrl = this.config.get<string>(
      'AI_PROVIDER_BASE_URL',
      'https://generativelanguage.googleapis.com',
    );
    const model = this.config.get<string>('AI_PROVIDER_EMBEDDING_MODEL', 'text-embedding-004');

    const response = await fetch(`${baseUrl}/v1beta/models/${model}:embedContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIMENSION,
      }),
    });

if (!response.ok) {
      const errorBody = await response.text().catch(() => '<no body>');
      throw new Error(`Embedding API responded ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as { embedding?: { values?: number[] } };
    const values = data.embedding?.values;
    if (!values || values.length === 0) {
      throw new Error('Embedding API response had no values');
    }
    if (values.length !== EMBEDDING_DIMENSION) {
      // Model changed dimension out from under us — better to fail loudly
      // (circuit breaker records a failure) than silently write a vector
      // that won't match the `vector(768)` column.
      throw new Error(
        `Embedding API returned ${values.length} dimensions, expected ${EMBEDDING_DIMENSION}`,
      );
    }
    return values;
  }
}
