import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CircuitBreakerService } from './circuit-breaker.service';

export interface EnrichmentResult {
  summary: string | null;
  embedding: number[] | null;
  skippedReason?: 'CIRCUIT_OPEN' | 'API_ERROR' | 'NO_API_KEY';
}

/**
 * NOTE (honesty flag): this talks to the Anthropic Messages API using the
 * documented request/response shape. It has NOT been run against a live key
 * in this sandbox (no key configured here) — the HTTP plumbing and error
 * handling are real, but you're the first one to see it hit the network.
 * If the response shape has drifted, the circuit breaker will just treat
 * repeated parse failures as failures and open — it won't wedge anything.
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

  private async callSummaryApi(incidentContext: Record<string, unknown>, apiKey: string): Promise<string> {
    const baseUrl = this.config.get<string>('AI_PROVIDER_BASE_URL', 'https://api.anthropic.com');
    const prompt = [
      'You are K-BLACKBOX, the case-archive narrator for a fictional corporate security console.',
      'Write a terse, noir-toned 2-3 sentence incident summary from this JSON, in English:',
      JSON.stringify(incidentContext),
    ].join('\n');

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`AI provider responded ${response.status}`);
    }

    const data = (await response.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((block) => block.type === 'text')?.text;
    if (!text) {
      throw new Error('AI provider response had no text content block');
    }
    return text;
  }
}
