import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CircuitBreakerService } from './circuit-breaker.service';

export interface EnrichmentResult {
  summary: string | null;
  embedding: number[] | null;
  skippedReason?: 'CIRCUIT_OPEN' | 'API_ERROR' | 'NO_API_KEY';
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
      const summary = await this.callSummaryApi(incidentContext, apiKey);
      this.circuitBreaker.reportSuccess();
      return { summary, embedding: null };
    } catch (err) {
      this.circuitBreaker.reportFailure();
      this.logger.error(`AI enrichment call failed: ${(err as Error).message}`);
      return { summary: null, embedding: null, skippedReason: 'API_ERROR' };
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

  private async callSummaryApi(incidentContext: Record<string, unknown>, apiKey: string): Promise<string> {
    const baseUrl = this.config.get<string>(
      'AI_PROVIDER_BASE_URL',
      'https://generativelanguage.googleapis.com',
    );
    const model = this.config.get<string>('AI_PROVIDER_MODEL', 'gemini-2.0-flash');

    const prompt = [
      'You are K-BLACKBOX, the case-archive narrator for a fictional corporate security console.',
      'Write a terse, noir-toned 2-3 sentence incident summary from this JSON, in English:',
      JSON.stringify(incidentContext),
    ].join('\n');

    const response = await fetch(
      `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 300 },
        }),
      },
    );

if (!response.ok) {
      const errorBody = await response.text().catch(() => '<no body>');
      throw new Error(`AI provider responded ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('AI provider response had no text content');
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
