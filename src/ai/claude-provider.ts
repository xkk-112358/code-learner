/**
 * Anthropic Claude provider.
 * Uses Node.js https module (VS Code extension host compatible).
 */

import { AIProvider, AIProviderConfig, ExplanationRequest } from './provider';
import { nodeRequest, parseSSEStream, readStreamToString } from './streaming';
import { buildExplanationPrompt } from './prompt-builder';

export class ClaudeProvider implements AIProvider {
  readonly name = 'Claude';
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
    const url = `${endpoint}/v1/messages`;

    this.abortController = new AbortController();

    const body = JSON.stringify({
      model: this.config.model,
      stream: true,
      max_tokens: this.config.maxTokens,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    });

    try {
      const response = await nodeRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body,
        signal: this.abortController.signal,
      });

      if (response.statusCode < 200 || response.statusCode >= 300) {
        const errorBody = await readStreamToString(response.body);
        let errorMessage = `Claude API error (${response.statusCode})`;
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
          const eventType = parsed.type;

          switch (eventType) {
            case 'content_block_delta':
              if (parsed.delta?.type === 'text_delta' && parsed.delta.text) {
                yield parsed.delta.text;
              }
              break;
            case 'message_delta':
              // Truncated output must not be treated as a complete result
              // (and must not be cached) — surface it to the user instead.
              if (parsed.delta?.stop_reason === 'max_tokens') {
                throw new Error('AI response was truncated by max_tokens. Increase codeLearner.maxTokens and retry.');
              }
              break;
            case 'message_stop':
              return;
            case 'error':
              throw new Error(parsed.error?.message || 'Claude API error');
          }
        } catch (e) {
          // Only skip malformed SSE payloads (JSON.parse failures). Real
          // streamed API errors (rate limit, overloaded, ...) must propagate —
          // swallowing them yields truncated explanations that then get cached.
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
