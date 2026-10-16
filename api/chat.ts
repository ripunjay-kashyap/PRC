/**
 * POST /api/chat — Gemini-backed explanation of results the app has ALREADY computed.
 *
 * Accepts only { message, history, summary }:
 *   message  string, 1..2000 chars
 *   history  array of { role: 'user' | 'model', text } (only the last 10 turns are used)
 *   summary  JSON object produced by the app (≤ 30 KB serialised)
 * Anything else is rejected, so the endpoint cannot be used as an open Gemini proxy.
 *
 * Env: GEMINI_API_KEY (required), GEMINI_MODEL (default gemini-3.5-flash-lite),
 *      GEMINI_FALLBACK_MODELS (comma-separated; default gemini-3.8-flash,gemini-3.6-flash,gemini-3.1-flash-lite).
 * Self-contained on purpose: Vercel compiles each API route separately.
 */

export const LIMITS = {
  maxMessageChars: 2000,
  maxHistoryTurns: 10,
  maxHistoryItems: 100,
  maxTurnChars: 4000,
  maxSummaryBytes: 30 * 1024,
  maxBodyBytes: 80 * 1024,
  timeoutMs: 25_000,
} as const;

export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

export const SYSTEM_PROMPT = `You are a construction scheduling assistant for project managers, embedded in an app that analyses Primavera P6 schedules across several projects and optimises shared resources.

Rules you must follow:
1. Use ONLY the numbers, dates, names and results contained in the DATA SUMMARY provided with each question. Every figure in that summary was computed deterministically by the app (parser, CPM, conflict detection, serial schedule generation scheme). Quote them exactly.
2. Never compute, estimate or invent new allocations, dates, costs, durations or resource numbers. Do not propose a schedule of your own. If a user asks for something the summary does not contain, say clearly that the data is not available in the current results and, where helpful, say which input (e.g. capacity, cost rate, deadline, resource assignments) the user would need to provide in the app.
3. If the summary flags missing or assumed data (for example demo resource loading that does not come from the XER files, missing capacities, missing deadlines, or projects whose baseline was computed by CPM), mention it when it affects the answer.
4. Never claim all deadlines are met unless the summary shows zero deadline violations for the scenario being discussed. A project with no deadline set has not "met" a deadline: say explicitly that it has no deadline, so the question cannot be answered for it until the user sets one in Optimization Settings.
5. Explain reasons in plain language a site or project manager understands: resource over-allocation, float, critical activities, logic (predecessors), hiring and transfers between projects.
6. Be concise: short paragraphs or bullet points, dates as written in the summary, currency as given. Answer in the language of the question.`;

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

export interface ChatRequest {
  message: string;
  history: ChatTurn[];
  summary: Record<string, unknown>;
}

export type ValidationOutcome = { ok: true; value: ChatRequest } | { ok: false; status: number; error: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

export function validateChatRequest(body: unknown): ValidationOutcome {
  let data = body;
  if (typeof data === 'string') {
    if (data.length > LIMITS.maxBodyBytes) return { ok: false, status: 413, error: 'Request body too large.' };
    try {
      data = JSON.parse(data);
    } catch {
      return { ok: false, status: 400, error: 'Body must be JSON.' };
    }
  }
  if (!isPlainObject(data)) return { ok: false, status: 400, error: 'Body must be a JSON object { message, history, summary }.' };
  const allowed = new Set(['message', 'history', 'summary']);
  const extra = Object.keys(data).filter((k) => !allowed.has(k));
  if (extra.length) return { ok: false, status: 400, error: `Unexpected field(s): ${extra.join(', ')}.` };

  const { message, history, summary } = data as Record<string, unknown>;
  if (typeof message !== 'string' || message.trim() === '') return { ok: false, status: 400, error: '"message" must be a non-empty string.' };
  if (message.length > LIMITS.maxMessageChars) return { ok: false, status: 413, error: `"message" is longer than ${LIMITS.maxMessageChars} characters.` };

  const hist = history === undefined ? [] : history;
  if (!Array.isArray(hist)) return { ok: false, status: 400, error: '"history" must be an array.' };
  if (hist.length > LIMITS.maxHistoryItems) return { ok: false, status: 413, error: '"history" has too many turns.' };
  const turns: ChatTurn[] = [];
  for (const t of hist) {
    if (!isPlainObject(t) || Object.keys(t).some((k) => k !== 'role' && k !== 'text')) {
      return { ok: false, status: 400, error: 'Each history turn must be { role, text }.' };
    }
    if (t.role !== 'user' && t.role !== 'model') return { ok: false, status: 400, error: 'History role must be "user" or "model".' };
    if (typeof t.text !== 'string') return { ok: false, status: 400, error: 'History text must be a string.' };
    if (t.text.length > LIMITS.maxTurnChars) return { ok: false, status: 413, error: `A history turn is longer than ${LIMITS.maxTurnChars} characters.` };
    turns.push({ role: t.role, text: t.text });
  }

  if (!isPlainObject(summary)) return { ok: false, status: 400, error: '"summary" must be a JSON object.' };
  const size = new TextEncoder().encode(JSON.stringify(summary)).length;
  if (size > LIMITS.maxSummaryBytes) return { ok: false, status: 413, error: `"summary" is ${Math.round(size / 1024)} KB; the limit is 30 KB.` };

  return { ok: true, value: { message: message.trim(), history: turns.slice(-LIMITS.maxHistoryTurns), summary } };
}

export interface ChatEnv {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_FALLBACK_MODELS?: string;
}

export interface ChatResponse {
  status: number;
  body: { reply: string; model: string } | { error: string; code: string };
}

export function resolveModel(env: ChatEnv): string {
  const m = (env.GEMINI_MODEL ?? '').trim();
  return /^[a-zA-Z0-9.\-_]{1,64}$/.test(m) ? m : DEFAULT_MODEL;
}

/** Build the Gemini generateContent request body. */
export function buildGeminiBody(req: ChatRequest) {
  const contents = req.history.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
  contents.push({
    role: 'user',
    parts: [
      {
        text:
          'DATA SUMMARY (computed by the app; the only source of numbers you may use):\n```json\n' +
          JSON.stringify(req.summary) +
          '\n```\n\nQUESTION: ' +
          req.message,
      },
    ],
  });
  return {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
  };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export async function handleChat(body: unknown, env: ChatEnv, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<ChatResponse> {
  const key = (env.GEMINI_API_KEY ?? '').trim();
  if (!key) {
    return { status: 503, body: { error: 'Chat not configured: GEMINI_API_KEY is not set on the server.', code: 'not_configured' } };
  }
  const v = validateChatRequest(body);
  if (!v.ok) return { status: v.status, body: { error: v.error, code: 'invalid_request' } };

  const plan = modelPlan(env);
  const body2 = JSON.stringify(buildGeminiBody(v.value));
  const deadline = Date.now() + LIMITS.timeoutMs;
  let last: ChatResponse = { status: 502, body: { error: 'Could not reach the language model service.', code: 'network' } };
  // Rate limits (RPM) and "overloaded" errors are per model, so move straight to the next model.
  for (const model of plan) {
    if (deadline - Date.now() < 1500) break;
    const { response, retryable } = await callGemini(model, key, body2, deadline - Date.now(), fetchImpl);
    last = response;
    if (!retryable) return response;
  }
  return last;
}

/** Fallback models tried in order when the primary is rate-limited, overloaded or unavailable. */
export const DEFAULT_FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.1-flash-lite'];
const MAX_MODELS = 5;
const MODEL_RE = /^[a-zA-Z0-9.\-_]{1,64}$/;
// 404/403: model not found or not enabled for this key; 429: rate limit; 5xx: overloaded/transient.
const RETRYABLE_STATUS = new Set([403, 404, 429, 500, 502, 503, 504]);

/** Primary model, then GEMINI_FALLBACK_MODELS (comma-separated) or the defaults, de-duplicated. */
export function modelPlan(env: ChatEnv): string[] {
  const fallbacks = env.GEMINI_FALLBACK_MODELS !== undefined && env.GEMINI_FALLBACK_MODELS.trim() !== ''
    ? env.GEMINI_FALLBACK_MODELS.split(',').map((m) => m.trim()).filter((m) => MODEL_RE.test(m))
    : DEFAULT_FALLBACK_MODELS;
  return [...new Set([resolveModel(env), ...fallbacks])].slice(0, MAX_MODELS);
}

async function callGemini(model: string, key: string, body: string, budgetMs: number, fetchImpl: FetchLike): Promise<{ response: ChatResponse; retryable: boolean }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), Math.max(1000, budgetMs)) : undefined;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body,
      signal: controller?.signal,
    });
    const data = (await res.json().catch(() => ({}))) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      error?: { message?: string };
    };
    if (!res.ok) {
      const busy = res.status === 503 || res.status === 429 || res.status === 404 || res.status === 403;
      return {
        retryable: RETRYABLE_STATUS.has(res.status),
        response: {
          status: 502,
          body: {
            error: busy
              ? `The language models are busy or rate-limited right now (last: ${model}, HTTP ${res.status}). Please try again in a minute.`
              : `The language model service returned an error (HTTP ${res.status}).`,
            code: 'upstream_error',
          },
        },
      };
    }
    if (data.promptFeedback?.blockReason) {
      return { retryable: false, response: { status: 502, body: { error: `The request was blocked by the model (${data.promptFeedback.blockReason}).`, code: 'blocked' } } };
    }
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
    if (!text) return { retryable: true, response: { status: 502, body: { error: 'The model returned an empty answer.', code: 'empty' } } };
    return { retryable: false, response: { status: 200, body: { reply: text, model } } };
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return {
      retryable: !aborted,
      response: { status: aborted ? 504 : 502, body: { error: aborted ? 'The model took too long to answer.' : 'Could not reach the language model service.', code: aborted ? 'timeout' : 'network' } },
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Minimal request/response shapes (compatible with Vercel's Node.js runtime) to avoid a runtime dependency.
interface ApiRequest {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}
interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed. Use POST.', code: 'method_not_allowed' });
    return;
  }
  const len = Number(req.headers['content-length'] ?? 0);
  if (len > LIMITS.maxBodyBytes) {
    res.status(413).json({ error: 'Request body too large.', code: 'invalid_request' });
    return;
  }
  const out = await handleChat(req.body, { GEMINI_API_KEY: process.env.GEMINI_API_KEY, GEMINI_MODEL: process.env.GEMINI_MODEL, GEMINI_FALLBACK_MODELS: process.env.GEMINI_FALLBACK_MODELS });
  res.status(out.status).json(out.body);
}
