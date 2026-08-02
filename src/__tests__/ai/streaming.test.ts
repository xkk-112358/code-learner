import { describe, it, expect } from 'vitest';
import { Readable } from 'stream';
import { parseSSEStream } from '../../ai/streaming';

function streamFrom(chunks: string[]): NodeJS.ReadableStream {
  return Readable.from(chunks);
}

async function collect(chunks: string[]): Promise<string[]> {
  const out: string[] = [];
  for await (const d of parseSSEStream(streamFrom(chunks))) {
    out.push(d);
  }
  return out;
}

describe('parseSSEStream', () => {
  it('extracts data: payloads', async () => {
    const out = await collect(['data: {"a":1}\n\n', 'data: {"b":2}\n\n']);
    expect(out).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('skips comments, empty lines and [DONE]', async () => {
    const out = await collect([': keep-alive\n\n', 'data: [DONE]\n\n', '\n\n', 'data: {"c":3}\n\n']);
    expect(out).toEqual(['{"c":3}']);
  });

  it('handles payloads split across chunks', async () => {
    const out = await collect(['data: {"hel', 'lo": 1}\n\n']);
    expect(out).toEqual(['{"hello": 1}']);
  });

  it('handles multiple events in one chunk', async () => {
    const out = await collect(['data: {"a":1}\n\ndata: {"b":2}\n\n']);
    expect(out).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('yields raw JSON lines without a data: prefix', async () => {
    const out = await collect(['{"x":1}\n\n']);
    expect(out).toEqual(['{"x":1}']);
  });

  it('flushes the remaining buffer on stream end', async () => {
    const out = await collect(['data: {"end":1}']);
    expect(out).toEqual(['{"end":1}']);
  });

  it('handles CRLF line endings', async () => {
    const out = await collect(['data: {"crlf":1}\r\n\r\n']);
    expect(out).toEqual(['{"crlf":1}']);
  });
});
