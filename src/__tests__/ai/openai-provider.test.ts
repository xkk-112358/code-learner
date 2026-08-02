import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from '../../ai/openai-provider';
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
  apiKey: 'sk-test-key',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-x',
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

describe('OpenAIProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.nodeRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });
  });

  it('yields content deltas and stops at finish_reason', async () => {
    mocks.parseSSEStream.mockReturnValue(events([
      JSON.stringify({ choices: [{ delta: { content: 'Hi' }, finish_reason: null }] }),
      JSON.stringify({ choices: [{ delta: { content: ' there' }, finish_reason: null }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      // Must not be consumed after finish_reason
      JSON.stringify({ choices: [{ delta: { content: 'EXTRA' }, finish_reason: null }] }),
    ]));
    const provider = new OpenAIProvider(config);
    let out = '';
    for await (const c of provider.explainCell(makeRequest())) out += c;
    expect(out).toBe('Hi there');
  });

  it('propagates streamed error events — regression: they were skipped', async () => {
    mocks.parseSSEStream.mockReturnValue(events([
      JSON.stringify({ choices: [{ delta: { content: 'partial' }, finish_reason: null }] }),
      JSON.stringify({ error: { message: 'Rate limit exceeded' } }),
    ]));
    const provider = new OpenAIProvider(config);
    const chunks: string[] = [];
    await expect(async () => {
      for await (const c of provider.explainCell(makeRequest())) chunks.push(c);
    }).rejects.toThrow('Rate limit exceeded');
  });

  it('skips malformed SSE payloads and continues streaming', async () => {
    mocks.parseSSEStream.mockReturnValue(events([
      'garbage {{{',
      JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: null }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    ]));
    const provider = new OpenAIProvider(config);
    let out = '';
    for await (const c of provider.explainCell(makeRequest())) out += c;
    expect(out).toBe('ok');
  });
});
