import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from './state/store';
import { UploadPage } from './pages/UploadPage';
import { ComparisonPage } from './pages/ComparisonPage';
import { MappingPage } from './pages/MappingPage';
import { ConflictsPage } from './pages/ConflictsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ScenariosPage } from './pages/ScenariosPage';
import { AssistantPage } from './pages/AssistantPage';
import { ReportsPage } from './pages/ReportsPage';

export type PageId = 'upload' | 'comparison' | 'mapping' | 'conflicts' | 'settings' | 'scenarios' | 'assistant' | 'reports';

const NAV: { id: PageId; label: string; icon: ReactNode }[] = [
  { id: 'upload', label: 'Upload', icon: <path d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5M4 13v2.5h12V13" /> },
  { id: 'comparison', label: 'Project Comparison', icon: <path d="M4 6h8M4 10h12M4 14h6" /> },
  { id: 'mapping', label: 'Resource Mapping', icon: <path d="M5 6h3m4 0h3M5 14h3m4 0h3M8 6l4 8M12 6l-4 8" /> },
  { id: 'conflicts', label: 'Conflict Analysis', icon: <path d="M3 15h14M5 15V9m4 6V5m4 10v-7m4 7v-3M2.5 7.5h15" /> },
  { id: 'settings', label: 'Optimization Settings', icon: <path d="M4 6h7m3 0h2M4 14h2m3 0h7M11 4v4M7 12v4" /> },
  { id: 'scenarios', label: 'Scenarios & Recommendations', icon: <path d="M4 15V11m4 4V7m4 8V9m4 6V5" /> },
  { id: 'assistant', label: 'AI Assistant', icon: <path d="M4 5h12v8H9l-3 3v-3H4z" /> },
  { id: 'reports', label: 'Reports', icon: <path d="M6 3h6l3 3v11H6zM12 3v3h3M8 11h5M8 14h5" /> },
];

function pageFromHash(): PageId {
  const h = window.location.hash.replace(/^#\/?/, '') as PageId;
  return NAV.some((n) => n.id === h) ? h : 'upload';
}

export function App() {
  const [page, setPage] = useState<PageId>(pageFromHash);
  const [menuOpen, setMenuOpen] = useState(false);
  const { state, stale } = useStore();
  useEffect(() => {
    const on = () => setPage(pageFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (p: PageId) => {
    window.location.hash = `/${p}`;
    setPage(p);
    setMenuOpen(false);
    window.scrollTo({ top: 0 });
  };
  const status = (id: PageId): ReactNode => {
    if (id === 'upload' && state.model) return <Dot tone="good" label="loaded" />;
    if (id === 'mapping' && state.model && state.model.assignments.length) return state.groupsConfirmed ? <Dot tone="good" label="confirmed" /> : <Dot tone="warn" label="needs confirmation" />;
    if (id === 'scenarios' && state.optimization) return stale ? <Dot tone="warn" label="out of date" /> : <Dot tone="good" label="results ready" />;
    if (id === 'scenarios' && state.optStatus === 'running') return <Dot tone="info" label="running" />;
    return null;
  };
  const current = NAV.find((n) => n.id === page)!;
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <aside className={`fixed inset-y-0 left-0 z-40 flex w-[264px] shrink-0 transform flex-col border-r border-line bg-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="flex h-16 items-center gap-2.5 border-b border-line px-5">
            <Logo />
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight">P6 Allocator</div>
              <div className="text-[11px] text-ink-3">Multi-project resource leveling</div>
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
            <div className="label mb-2 px-3">Workflow</div>
            <ol className="relative space-y-0.5">
              {NAV.map((n, i) => {
                const active = page === n.id;
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => go(n.id)}
                      aria-current={active ? 'page' : undefined}
                      className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[14px] transition-colors ${active ? 'bg-plane font-medium text-ink ring-1 ring-line' : 'text-ink-2 hover:bg-plane hover:text-ink'}`}
                    >
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] tabular ${active ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink-3 group-hover:border-[#d1d5db]'}`}>{i + 1}</span>
                      <svg viewBox="0 0 20 20" className="h-[17px] w-[17px] shrink-0 opacity-80" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{n.icon}</svg>
                      <span className="flex-1 leading-snug">{n.label}</span>
                      {status(n.id)}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
          <div className="m-3 rounded-xl border border-line bg-plane p-3.5 text-[12px] leading-relaxed text-ink-2">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-ink">
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M10 2.5l6 2.5v4.5c0 4-2.6 6.6-6 8-3.4-1.4-6-4-6-8V5z" /><path d="M7.5 10l2 2 3-3.5" /></svg>
              Deterministic engine
            </div>
            Every number is computed in your browser. The AI assistant only explains results.
          </div>
        </aside>
        {menuOpen && <div className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[1px] lg:hidden" onClick={() => setMenuOpen(false)} />}
        <div className="min-w-0 flex-1 bg-plane/60">
          <div className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white/85 px-4 backdrop-blur sm:px-6 lg:px-8">
            <button className="btn-ghost -ml-2 px-2 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 6h14M3 10h14M3 14h14" /></svg>
            </button>
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className="hidden text-ink-3 sm:inline">Workspace</span>
              <svg viewBox="0 0 20 20" className="hidden h-4 w-4 text-ink-3 sm:block" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 5l5 5-5 5" /></svg>
              <span className="truncate font-medium text-ink">{current.label}</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {state.model && <span className="hidden items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-xs text-ink-2 md:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-good" />{state.model.projects.length} projects · {state.model.activities.length} activities</span>}
              {page !== 'scenarios' && state.model && <button className="btn-secondary py-1.5" onClick={() => go('scenarios')}>Scenarios</button>}
              <button className="btn-accent py-1.5" onClick={() => go('assistant')}>
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6z" /></svg>
                Ask AI
              </button>
            </div>
          </div>
          {state.usingDemoData && (
            <div className="sky border-b border-line px-4 py-2 text-center text-[13px] text-ink-2">
              Showing the sample AFS schedules with <span className="font-medium text-ink">illustrative demo resource loading</span> — crew sizes and rates are invented, not from the XER files.
            </div>
          )}
          <main className="mx-auto max-w-[1360px] px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
            {page === 'upload' && <UploadPage go={go} />}
            {page === 'comparison' && <ComparisonPage go={go} />}
            {page === 'mapping' && <MappingPage go={go} />}
            {page === 'conflicts' && <ConflictsPage go={go} />}
            {page === 'settings' && <SettingsPage go={go} />}
            {page === 'scenarios' && <ScenariosPage go={go} />}
            {page === 'assistant' && <AssistantPage go={go} />}
            {page === 'reports' && <ReportsPage go={go} />}
          </main>
        </div>
      </div>
    </div>
  );
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0a0a0a" />
      <rect x="7" y="9" width="12" height="3.5" rx="1.75" fill="#fff" />
      <rect x="11" y="14.25" width="14" height="3.5" rx="1.75" fill="#60a5fa" />
      <rect x="7" y="19.5" width="9" height="3.5" rx="1.75" fill="#fff" opacity=".7" />
    </svg>
  );
}

function Dot({ tone, label }: { tone: 'good' | 'warn' | 'info'; label: string }) {
  const c = tone === 'good' ? 'bg-good' : tone === 'warn' ? 'bg-warn' : 'bg-accent animate-pulse';
  return <span className={`h-2 w-2 rounded-full ${c}`} title={label} aria-label={label} />;
}
