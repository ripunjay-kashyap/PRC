import { describe, expect, it, vi } from 'vitest';
import handler, { buildGeminiBody, handleChat, LIMITS, SYSTEM_PROMPT, validateChatRequest } from '../api/chat';

const ENV = { GEMINI_API_KEY: 'test-key', GEMINI_MODEL: '' };
const okBody = { message: 'Which resource is the biggest bottleneck?', history: [], summary: { scenarios: [] } };

const geminiOk = (text = 'Helper is the biggest bottleneck (peak over-allocation 4).') =>
  vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) }));

describe('/api/chat — valid request path (fetch mocked)', () => {
  it('calls Gemini with the server-side system prompt and returns the reply', async () => {
    const f = geminiOk();
    const res = await handleChat(okBody, ENV, f);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: 'Helper is the biggest bottleneck (peak over-allocation 4).', model: 'gemini-3.5-flash-lite' });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    expect(url).not.toContain('test-key');
    const sent = JSON.parse(init.body);
    expect(sent.systemInstruction.parts[0].text).toBe(SYSTEM_PROMPT);
    expect(sent.contents.at(-1).parts[0].text).toContain('QUESTION: Which resource is the biggest bottleneck?');
    expect(sent.contents.at(-1).parts[0].text).toContain('"scenarios":[]');
  });

  it('uses GEMINI_MODEL when set and keeps only the last 10 history turns', async () => {
    const f = geminiOk();
    const history = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', text: `turn ${i}` }));
    await handleChat({ ...okBody, history }, { ...ENV, GEMINI_MODEL: 'gemini-2.5-pro' }, f);
    const [url, init] = f.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toContain('/models/gemini-2.5-pro:generateContent');
    const sent = JSON.parse(init.body);
    expect(sent.contents).toHaveLength(11);
    expect(sent.contents[0].parts[0].text).toBe('turn 4');
  });

  it('system prompt forbids inventing numbers', () => {
    expect(SYSTEM_PROMPT).toMatch(/ONLY the numbers/);
    expect(SYSTEM_PROMPT).toMatch(/Never compute, estimate or invent/);
    expect(SYSTEM_PROMPT).toMatch(/data is not available/);
    expect(SYSTEM_PROMPT).toMatch(/no deadline set has not "met" a deadline/);
    expect(buildGeminiBody({ message: 'q', history: [], summary: {} }).generationConfig.temperature).toBeLessThanOrEqual(0.3);
  });

  it('maps upstream errors, blocks and timeouts to clear errors', async () => {
    const err = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'bad' } }) }));
    expect((await handleChat(okBody, ENV, err)).status).toBe(502);
    expect(err).toHaveBeenCalledTimes(1); // non-transient errors are not retried
    const blocked = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) }));
    expect((await handleChat(okBody, ENV, blocked)).body).toMatchObject({ code: 'blocked' });
    const abort = vi.fn(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
    expect((await handleChat(okBody, ENV, abort)).status).toBe(504);
  });
});

describe('/api/chat — transient upstream errors', () => {
  it('retries an overloaded model, then falls back to gemini-2.5-flash', async () => {
    const urls: string[] = [];
    const f = vi.fn(async (url: string) => {
      urls.push(url);
      return urls.length < 3
        ? { ok: false, status: 503, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) };
    });
    const res = await handleChat(okBody, ENV, f);
    expect(res).toEqual({ status: 200, body: { reply: 'ok', model: 'gemini-2.5-flash' } });
    expect(urls.map((u) => u.split('/models/')[1].split(':')[0])).toEqual(['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-2.5-flash']);
  });
  it('gives a clear busy message when every attempt is overloaded', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const res = await handleChat(okBody, ENV, f);
    expect(f).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: 'upstream_error', error: expect.stringMatching(/busy/) });
  });
});

describe('/api/chat — missing key', () => {
  it('returns 503 not_configured without calling Gemini', async () => {
    const f = geminiOk();
    const res = await handleChat(okBody, { GEMINI_API_KEY: '' }, f);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'not_configured' });
    expect(f).not.toHaveBeenCalled();
    const res2 = await handleChat(okBody, {}, f);
    expect(res2.status).toBe(503);
  });
});

describe('/api/chat — rejects oversized or malformed input', () => {
  const bad: [string, unknown, number][] = [
    ['not an object', [1, 2], 400],
    ['invalid JSON string', '{nope', 400],
    ['extra field (open proxy attempt)', { ...okBody, model: 'x', contents: [] }, 400],
    ['empty message', { ...okBody, message: '   ' }, 400],
    ['message not a string', { ...okBody, message: 42 }, 400],
    ['oversized message', { ...okBody, message: 'x'.repeat(LIMITS.maxMessageChars + 1) }, 413],
    ['history not array', { ...okBody, history: 'hi' }, 400],
    ['bad history role', { ...okBody, history: [{ role: 'system', text: 'x' }] }, 400],
    ['extra history key', { ...okBody, history: [{ role: 'user', text: 'x', parts: [] }] }, 400],
    ['huge history turn', { ...okBody, history: [{ role: 'user', text: 'x'.repeat(LIMITS.maxTurnChars + 1) }] }, 413],
    ['too many history items', { ...okBody, history: Array.from({ length: 101 }, () => ({ role: 'user', text: 'x' })) }, 413],
    ['summary missing', { message: 'q', history: [] }, 400],
    ['summary is array', { ...okBody, summary: [] }, 400],
    ['oversized summary', { ...okBody, summary: { blob: 'x'.repeat(31 * 1024) } }, 413],
  ];
  for (const [name, body, status] of bad) {
    it(name, async () => {
      const f = geminiOk();
      const res = await handleChat(body, ENV, f);
      expect(res.status).toBe(status);
      expect(f).not.toHaveBeenCalled();
    });
  }
  it('accepts a JSON string body and missing history', () => {
    const v = validateChatRequest(JSON.stringify({ message: 'hi', summary: {} }));
    expect(v.ok && v.value.history).toEqual([]);
  });
});

describe('/api/chat — HTTP handler', () => {
  const mockRes = () => {
    const r = { code: 0, payload: undefined as unknown, headers: {} as Record<string, string> };
    const res = {
      status(c: number) { r.code = c; return res; },
      json(b: unknown) { r.payload = b; },
      setHeader(k: string, v: string) { r.headers[k] = v; },
    };
    return { r, res };
  };
  it('rejects non-POST methods', async () => {
    const { r, res } = mockRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(r.code).toBe(405);
    expect(r.headers.Allow).toBe('POST');
  });
  it('rejects oversized bodies by content-length', async () => {
    const { r, res } = mockRes();
    await handler({ method: 'POST', headers: { 'content-length': String(LIMITS.maxBodyBytes + 1) }, body: okBody }, res);
    expect(r.code).toBe(413);
  });
  it('reads the key from process.env', async () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const { r, res } = mockRes();
    await handler({ method: 'POST', headers: {}, body: okBody }, res);
    expect(r.code).toBe(503);
    process.env.GEMINI_API_KEY = 'k';
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 }));
    const m2 = mockRes();
    await handler({ method: 'POST', headers: {}, body: okBody }, m2.res);
    expect(m2.r.code).toBe(200);
    expect(m2.r.payload).toMatchObject({ reply: 'ok' });
    spy.mockRestore();
    if (prev === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prev;
  });
});
