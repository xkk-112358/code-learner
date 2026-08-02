/**
 * Streaming helpers for SSE (Server-Sent Events) parsing.
 * Uses Node.js https module (VS Code extension host doesn't have global fetch).
 *
 * Note: openai-provider.ts and claude-provider.ts use `parseSSEStream` for
 * streaming responses. nb-generator.ts uses `nodeRequestAndRead` for
 * non-streaming requests. All HTTP calls in the project route through here.
 */

import * as https from 'https';
import * as http from 'http';

/** Socket idle timeout. Generous on purpose: reasoning models can take a
 *  while to emit the first token, and this is NOT a total-request timeout. */
const REQUEST_TIMEOUT_MS = 120_000;

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: NodeJS.ReadableStream;
}

/**
 * Make an HTTP(S) request with Node.js built-in modules.
 * Returns the response object with a readable stream body.
 */
export function nodeRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  } = {}
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const mod = isHttps ? https : http;

    const reqOptions: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      // Some API gateways (e.g. Cloudflare) reject requests without a
      // User-Agent header.
      headers: { 'User-Agent': 'code-learner-vscode-extension', ...options.headers },
      timeout: REQUEST_TIMEOUT_MS,
    };

    let settled = false;

    const req = mod.request(reqOptions, (res) => {
      const headers: Record<string, string> = {};
      for (const [key, val] of Object.entries(res.headers)) {
        if (val !== undefined) {
          headers[key] = Array.isArray(val) ? val.join(', ') : val;
        }
      }

      settle();
      resolve({
        statusCode: res.statusCode || 0,
        headers,
        body: res,
      });
    });

    // Remove the abort listener once the promise settles so listeners don't
    // accumulate on the signal across requests.
    function settle(): void {
      if (settled) return;
      settled = true;
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
    }

    function onAbort(): void {
      // Remove the listener first: req.destroy() without an error only emits
      // 'close' (not 'error'), so the error handler's settle() would never
      // run and the listener would leak on every cancellation.
      settle();
      req.destroy();
      reject(new Error('Request aborted'));
    }

    req.on('error', (err: NodeJS.ErrnoException) => {
      settle();
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
        reject(new Error(`Network error: Unable to connect to ${urlObj.hostname}. Check your network/proxy settings. (${err.message})`));
      } else {
        reject(new Error(`Request failed: ${err.message}`));
      }
    });

    req.on('timeout', () => {
      settle();
      req.destroy();
      reject(new Error(`Request timeout: ${urlObj.hostname} did not respond within ${REQUEST_TIMEOUT_MS / 1000}s`));
    });

    // Handle abort signal
    if (options.signal) {
      options.signal.addEventListener('abort', onAbort);
    }

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

/**
 * Parse an SSE stream from a Node.js readable stream into an async iterable of data strings.
 */
export async function* parseSSEStream(
  stream: NodeJS.ReadableStream
): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of stream) {
    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk as Buffer, { stream: true });
    buffer += text;

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;

      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;
        yield data;
      } else if (trimmed.startsWith('{')) {
        yield trimmed;
      }
    }
  }

  // Process remaining buffer
  const remaining = buffer.trim();
  if (remaining) {
    if (remaining.startsWith('data: ')) {
      const data = remaining.slice(6);
      if (data !== '[DONE]') yield data;
    } else if (remaining.startsWith('{')) {
      yield remaining;
    }
  }
}

/**
 * Read an entire Node.js readable stream into a string.
 * Used for reading error bodies and by nb-generator.ts for non-streaming calls.
 */
export function readStreamToString(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', reject);
  });
}

/**
 * Convenience wrapper: make a request and read the full response body as a string.
 * Used by nb-generator.ts for non-streaming AI calls.
 */
export async function nodeRequestAndRead(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  } = {}
): Promise<{ statusCode: number; body: string }> {
  const response = await nodeRequest(url, options);
  const body = await readStreamToString(response.body);
  return { statusCode: response.statusCode, body };
}
