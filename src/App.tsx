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
  return (
    <div className="flex min-h-full">
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 shrink-0 transform bg-navy-900 text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-3 px-5 py-5">
          <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden><rect width="32" height="32" rx="7" fill="#2a5d93" /><rect x="6" y="8" width="14" height="4" rx="2" fill="#86b6ef" /><rect x="10" y="14" width="16" height="4" rx="2" fill="#eb6834" /><rect x="6" y="20" width="10" height="4" rx="2" fill="#1baf7a" /></svg>
          <div>
            <div className="text-sm font-semibold leading-tight">P6 Resource Allocator</div>
            <div className="text-[11px] text-white/60">Multi-project leveling</div>
          </div>
        </div>
        <nav className="mt-2 space-y-0.5 px-3" aria-label="Main">
          {NAV.map((n, i) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              aria-current={page === n.id ? 'page' : undefined}
              className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${page === n.id ? 'bg-white/10 font-medium text-white' : 'text-white/75 hover:bg-white/5 hover:text-white'}`}
            >
              <span className="w-4 text-[11px] tabular text-white/40">{i + 1}</span>
              <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{n.icon}</svg>
              <span className="flex-1">{n.label}</span>
              {status(n.id)}
            </button>
          ))}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 px-5 py-4 text-[11px] leading-relaxed text-white/45">
          All numbers are computed in your browser by deterministic code. The AI assistant only explains them.
        </div>
      </aside>
      {menuOpen && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setMenuOpen(false)} />}
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-plane/95 px-4 py-3 backdrop-blur lg:hidden">
          <button className="btn-ghost px-2" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 6h14M3 10h14M3 14h14" /></svg>
          </button>
          <span className="text-sm font-semibold">{NAV.find((n) => n.id === page)?.label}</span>
        </div>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
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
  );
}

function Dot({ tone, label }: { tone: 'good' | 'warn' | 'info'; label: string }) {
  const c = tone === 'good' ? 'bg-good' : tone === 'warn' ? 'bg-warn' : 'bg-[#86b6ef] animate-pulse';
  return <span className={`h-2 w-2 rounded-full ${c}`} title={label} aria-label={label} />;
}
