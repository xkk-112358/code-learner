/**
 * OpenAI-compatible provider.
 * Uses Node.js https module (VS Code extension host compatible).
 */

import { AIProvider, AIProviderConfig, ExplanationRequest } from './provider';
import { nodeRequest, parseSSEStream, readStreamToString } from './streaming';
import { buildExplanationPrompt } from './prompt-builder';

export class OpenAIProvider implements AIProvider {
  readonly name = 'OpenAI';
  private config: AIProviderConfig;
  private abortController: AbortController | null = null;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  updateConfig(config: AIProviderConfig): void {
    this.config = config;
  }

  async *explainCell(request: ExplanationRequest): AsyncIterable<string> {
    const { systemPrompt, userPrompt } = buildExplanationPrompt(request);

    const endpoint = this.config.endpoint.replace(/\/$/, '');
    const url = `${endpoint}/chat/completions`;

    this.abortController = new AbortController();

    const body = JSON.stringify({
      model: this.config.model,
      stream: true,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    try {
      const response = await nodeRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body,
        signal: this.abortController.signal,
      });

      if (response.statusCode < 200 || response.statusCode >= 300) {
        // Try to read error body
        const errorBody = await readStreamToString(response.body);
        let errorMessage = `OpenAI API error (${response.statusCode})`;
        try {
          const err = JSON.parse(errorBody);
          errorMessage = err.error?.message || errorMessage;
        } catch {
          errorMessage = errorBody || errorMessage;
        }
        throw new Error(errorMessage);
      }

      for await (const data of parseSSEStream(response.body)) {
        try {
          const parsed = JSON.parse(data);
          // Streamed error events (e.g. rate limits) must propagate — not be
          // silently skipped like malformed payloads.
          if (parsed.error) {
            throw new Error(parsed.error.message || `OpenAI API error (${response.statusCode})`);
          }
          const choices = parsed.choices;
          if (choices && choices.length > 0) {
            const delta = choices[0].delta;
            const finishReason = choices[0].finish_reason;

            if (delta?.content) {
              yield delta.content;
            }

            if (finishReason && finishReason !== 'null' && finishReason !== null) {
              // Truncated output must not be treated as a complete result
              // (and must not be cached) — surface it to the user instead.
              if (finishReason === 'length') {
                throw new Error('AI response was truncated by max_tokens. Increase codeLearner.maxTokens and retry.');
              }
              break;
            }
          }
        } catch (e) {
          // Only skip malformed SSE payloads (JSON.parse failures).
          if (e instanceof SyntaxError) {
            continue;
          }
          throw e;
        }
      }
    } catch (error) {
      // Aborting destroys the socket, which surfaces as an arbitrary stream
      // error (e.g. ECONNRESET) rather than 'Request aborted' — treat any
      // error after an abort as a clean cancellation.
      if (this.abortController?.signal.aborted || (error instanceof Error && error.message === 'Request aborted')) {
        return;
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
