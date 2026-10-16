import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore, type ChatMessage } from '../state/store';
import { Badge, Card, EmptyState, Notice, PageHeader, Spinner } from '../components/ui';
import { buildChatSummary } from '../lib/chat/summary';
import type { PageProps } from './types';

type ChatStatus = 'unknown' | 'ok' | 'not_configured';

/** Minimal, safe rendering: paragraphs, "- " bullets and **bold** (no HTML injection). */
function RichText({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>));
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length} className="my-1 list-disc space-y-0.5 pl-5">{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const line of text.split('\n')) {
    const m = /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(line);
    if (m) list.push(m[1]);
    else {
      flush();
      if (line.trim()) blocks.push(<p key={blocks.length} className="my-1">{inline(line.replace(/^#+\s*/, ''))}</p>);
    }
  }
  flush();
  return <>{blocks}</>;
}

export function AssistantPage({ go }: PageProps) {
  const store = useStore();
  const { state, analysis, setChat } = store;
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<ChatStatus>('unknown');
  const endRef = useRef<HTMLDivElement>(null);
  const summary = useMemo(
    () => (state.model && state.settings ? buildChatSummary({ model: state.model, groups: state.groups, settings: state.settings, analysis, optimization: state.optimization, selectedScenarioId: state.selectedScenarioId }) : null),
    [state.model, state.groups, state.settings, analysis, state.optimization, state.selectedScenarioId],
  );
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [state.chat.length, loading]);

  const starters = useMemo(() => {
    const out = ['Which resource is the biggest bottleneck?', 'Which scenario do you recommend, and why?', 'Will every project meet its deadline?', 'What data is missing or assumed in this analysis?'];
    const opt = state.optimization;
    const sel = opt?.scenarios.find((s) => s.id === state.selectedScenarioId) ?? opt?.scenarios.find((s) => s.id === 'pooled_float');
    const shift = sel?.recommendations.shifts[0];
    if (shift) out.unshift(`Why was ${shift.project}'s ${shift.code} (${shift.name}) shifted?`);
    return out;
  }, [state.optimization, state.selectedScenarioId]);

  if (!state.model || !summary) return <EmptyState title="No projects loaded" action={<button className="btn-primary" onClick={() => go('upload')}>Go to Upload</button>}>Load schedules and run the optimization, then ask questions about the results.</EmptyState>;
  const summaryKb = new TextEncoder().encode(JSON.stringify(summary)).length / 1024;

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || loading) return;
    const history = state.chat.filter((m) => !m.error).slice(-10).map(({ role, text }) => ({ role, text }));
    const next: ChatMessage[] = [...state.chat, { role: 'user', text: msg }];
    setChat(next);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg, history, summary }) });
      const data = (await res.json().catch(() => null)) as { reply?: string; error?: string; code?: string } | null;
      if (res.status === 503 && data?.code === 'not_configured') {
        setStatus('not_configured');
        setChat([...next, { role: 'model', text: 'Chat not configured: the server has no GEMINI_API_KEY. All analysis results remain available on the other pages.', error: true }]);
      } else if (res.status === 404 || res.status === 405 || !data) {
        setStatus('not_configured');
        setChat([...next, { role: 'model', text: 'Chat not configured: the /api/chat endpoint is not available on this deployment (run with `vercel dev` or deploy to Vercel).', error: true }]);
      } else if (!res.ok || !data.reply) {
        setChat([...next, { role: 'model', text: data.error ?? `Request failed (HTTP ${res.status}).`, error: true }]);
      } else {
        setStatus('ok');
        setChat([...next, { role: 'model', text: data.reply }]);
      }
    } catch (e) {
      setChat([...next, { role: 'model', text: `Could not reach the chat service: ${e instanceof Error ? e.message : String(e)}`, error: true }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="AI assistant"
        subtitle="Gemini explains the results in plain language. It only sees a compact summary of numbers the app has already computed and is instructed never to invent allocations."
        actions={state.chat.length > 0 && <button className="btn-ghost" onClick={() => setChat([])}>Clear conversation</button>}
      />
      {status === 'not_configured' && <div className="mb-4"><Notice kind="warning" title="Chat not configured">Set <code>GEMINI_API_KEY</code> in the Vercel project's environment variables and redeploy. Everything else in the app works without it.</Notice></div>}
      {!state.optimization && <div className="mb-4"><Notice kind="info" title="Optimization has not been run yet" action={<button className="btn-secondary" onClick={() => go('scenarios')}>Run it</button>}>The assistant can explain conflicts now, and scenarios after you run the optimization.</Notice></div>}
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card bodyClass="flex h-[min(70vh,680px)] flex-col p-0">
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5" data-testid="chat-log" aria-live="polite">
            {state.chat.length === 0 && (
              <div className="py-6 text-center">
                <p className="text-sm text-ink-2">Ask about bottlenecks, shifted activities, deadlines or trade-offs between scenarios.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {starters.map((s) => <button key={s} className="rounded-full bg-navy-50 px-3 py-1.5 text-sm text-navy-600 ring-1 ring-navy-100 hover:bg-navy-100" onClick={() => void send(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {state.chat.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${m.role === 'user' ? 'rounded-br-md bg-navy-700 text-white' : m.error ? 'rounded-bl-md bg-[#fdf0f0] text-[#9b1c1c] ring-1 ring-[#f2c0c0]' : 'rounded-bl-md bg-plane text-ink ring-1 ring-line'}`}>
                  {m.role === 'model' && !m.error ? <RichText text={m.text} /> : m.text}
                  {m.error && i === state.chat.length - 1 && <button className="mt-1 block text-xs font-medium underline" onClick={() => { const q = state.chat[i - 1]?.text; setChat(state.chat.slice(0, i - 1)); if (q) void send(q); }}>Retry</button>}
                </div>
              </div>
            ))}
            {loading && <div className="flex justify-start"><div className="rounded-2xl rounded-bl-md bg-plane px-4 py-3 ring-1 ring-line"><Spinner label="Thinking…" /></div></div>}
            <div ref={endRef} />
          </div>
          <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
            <textarea
              className="input min-h-[42px] flex-1 resize-none"
              rows={1}
              maxLength={2000}
              placeholder="Ask a question about the schedule…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
              aria-label="Message"
            />
            <button className="btn-primary" disabled={loading || !input.trim()} type="submit">Send</button>
          </form>
        </Card>
        <div className="space-y-4">
          <Card title="What the assistant sees" subtitle="Sent with each question; never the raw XER files.">
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Badge tone="info">{(summary.projects as unknown[]).length} projects</Badge>
              <Badge tone="info">{(summary.resourceGroups as unknown[]).length} resource groups</Badge>
              <Badge tone="info">{(summary.scenarios as unknown[]).length} scenarios</Badge>
              <Badge>{summaryKb.toFixed(1)} KB</Badge>
            </div>
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer font-medium text-navy-500">View summary JSON</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-plane p-2 text-[11px] leading-snug">{JSON.stringify(summary, null, 2)}</pre>
            </details>
          </Card>
          <Card title="Guardrails">
            <ul className="list-disc space-y-1 pl-5 text-xs text-ink-2">
              <li>Numbers come only from the app's deterministic engine.</li>
              <li>The model must say when data is missing and must not invent allocations.</li>
              <li>The server accepts only message, last 10 turns and a summary ≤ 30 KB.</li>
              <li>The API key stays on the server (Vercel env var).</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
