import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeProvider } from '../../ai/claude-provider';
import { ExplanationRequest, AIProviderConfig } from '../../ai/provider';
import { CodeCell, CellType, CellMarker } from '../../parser/cell';

const mocks = vi.hoisted(() => ({
  nodeRequest: vi.fn(),
  parseSSEStream: vi.fn(),
  readStreamToString: vi.fn(),
}));

vi.mock('../../ai/streaming', () => ({
  nodeRequest: mocks.nodeRequest,
  parseSSEStream: mocks.parseSSEStream,
  readStreamToString: mocks.readStreamToString,
}));

const config: AIProviderConfig = {
  apiKey: 'sk-ant-test-key',
  endpoint: 'https://api.anthropic.com',
  model: 'claude-x',
  maxTokens: 2000,
  temperature: 0.3,
};

function makeRequest(): ExplanationRequest {
  const cell: CodeCell = {
    index: 0,
    source: 'x = 1',
    language: 'python',
    type: CellType.CODE,
    startLine: 0,
    endLine: 0,
    marker: CellMarker.AUTO_SECTION,
  };
  return {
    cell,
    context: { filePath: '/a.py', language: 'python', fullSource: 'x = 1', projectFiles: [] },
    explanationLanguage: 'en-US',
  };
}

async function* events(items: string[]): AsyncIterable<string> {
  for (const it of items) yield it;
}

describe('ClaudeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.nodeRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });
  });

  it('yields text deltas from content_block_delta events', async () => {
    mocks.parseSSEStream.mockReturnValue(events([
      JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }),
      JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } }),
      JSON.stringify({ type: 'message_stop' }),
    ]));
    const provider = new ClaudeProvider(config);
    let out = '';
    for await (const c of provider.explainCell(makeRequest())) out += c;
    expect(out).toBe('Hello world');
  });

  it('propagates streamed error events — regression: they were swallowed', async () => {
    mocks.parseSSEStream.mockReturnValue(events([
      JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } }),
      JSON.stringify({ type: 'error', error: { message: 'overloaded_error: API is overloaded' } }),
    ]));
    const provider = new ClaudeProvider(config);
    const chunks: string[] = [];
    await expect(async () => {
      for await (const c of provider.explainCell(makeRequest())) chunks.push(c);
    }).rejects.toThrow('overloaded_error: API is overloaded');
  });

  it('skips malformed SSE payloads and continues streaming', async () => {
    mocks.parseSSEStream.mockReturnValue(events([
      'this is not json {',
      JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }),
      JSON.stringify({ type: 'message_stop' }),
    ]));
    const provider = new ClaudeProvider(config);
    let out = '';
    for await (const c of provider.explainCell(makeRequest())) out += c;
    expect(out).toBe('ok');
  });

  it('throws on non-2xx responses with the API error message', async () => {
    mocks.nodeRequest.mockResolvedValue({ statusCode: 429, headers: {}, body: {} });
    mocks.readStreamToString.mockResolvedValue(JSON.stringify({ error: { message: 'rate limited' } }));
    const provider = new ClaudeProvider(config);
    await expect(async () => {
      for await (const c of provider.explainCell(makeRequest())) void c;
    }).rejects.toThrow('rate limited');
  });
});
