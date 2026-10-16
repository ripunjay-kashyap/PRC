import { useMemo, useState, type ReactNode } from 'react';
import type { DataIssue } from '../lib/model';

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-5">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-3">{eyebrow}</div>}
        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-tightest text-ink sm:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** Hairline frame with small corner squares (decorative). */
export function Frame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <span className="corner -left-[5px] -top-[5px]" aria-hidden />
      <span className="corner -right-[5px] -top-[5px]" aria-hidden />
      <span className="corner -bottom-[5px] -left-[5px]" aria-hidden />
      <span className="corner -bottom-[5px] -right-[5px]" aria-hidden />
      {children}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className = '', bodyClass = 'p-5' }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function StatTile({ label, value, hint, tone = 'neutral' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'warn' }) {
  const dot = tone === 'bad' ? 'bg-critical' : tone === 'good' ? 'bg-good' : tone === 'warn' ? 'bg-warn' : 'bg-[#d1d5db]';
  const val = tone === 'bad' ? 'text-[#b42318]' : 'text-ink';
  return (
    <div className="card px-5 py-4">
      <div className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${dot}`} /><span className="text-[13px] font-medium text-ink-2">{label}</span></div>
      <div className={`mt-2 text-[30px] font-semibold leading-none tracking-tightest tabular ${val}`}>{value}</div>
      {hint && <div className="mt-2 truncate text-[12px] text-ink-3" title={typeof hint === 'string' ? hint : undefined}>{hint}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'info' | 'navy';
const TONES: Record<Tone, string> = {
  neutral: 'bg-white text-ink-2 ring-line',
  good: 'bg-[#e6f4e6] text-goodText ring-[#bfe3bf]',
  bad: 'bg-[#fbe5e5] text-[#9b1c1c] ring-[#f2c0c0]',
  warn: 'bg-[#fff4dc] text-[#7a5200] ring-[#f6dc9b]',
  info: 'bg-[#eff6ff] text-[#1d4ed8] ring-[#dbeafe]',
  navy: 'bg-ink text-white ring-ink',
};
export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[12px] font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function StatusIcon({ kind }: { kind: 'ok' | 'error' | 'warning' | 'info' }) {
  const paths: Record<string, string> = {
    ok: 'M5 10.5l3 3 7-7',
    error: 'M6 6l8 8M14 6l-8 8',
    warning: 'M10 5v6M10 14.5v.5',
    info: 'M10 9v6M10 5.5v.5',
  };
  const bg = { ok: '#0ca30c', error: '#d03b3b', warning: '#d48a00', info: '#2563eb' }[kind];
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" aria-hidden>
      <circle cx="10" cy="10" r="9" fill={bg} />
      <path d={paths[kind]} stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function Notice({ kind = 'info', title, children, action }: { kind?: 'ok' | 'error' | 'warning' | 'info'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const bg = { ok: 'bg-[#f3faf3] ring-[#d5ecd5]', error: 'bg-[#fef5f5] ring-[#f6d2d2]', warning: 'bg-[#fffaeb] ring-[#f7e3ad]', info: 'bg-white ring-line' }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-card ring-1 ring-inset ${bg}`}>
      <div className="mt-0.5"><StatusIcon kind={kind} /></div>
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium text-ink">{title}</div>}
        {children && <div className="text-ink-2">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Frame className="mx-auto max-w-3xl">
      <div className="hatch flex flex-col items-center justify-center rounded-xl border border-line px-6 py-16 text-center">
        <div className="mb-5 rounded-xl border border-line bg-white p-3 shadow-card">
          <svg viewBox="0 0 48 48" className="h-10 w-10" aria-hidden>
            <rect x="6" y="10" width="22" height="6" rx="3" fill="#0a0a0a" />
            <rect x="14" y="21" width="26" height="6" rx="3" fill="#60a5fa" />
            <rect x="8" y="32" width="16" height="6" rx="3" fill="#d1d5db" />
          </svg>
        </div>
        <h3 className="text-xl font-semibold tracking-tight text-ink">{title}</h3>
        {children && <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-2">{children}</p>}
        {action && <div className="mt-6">{action}</div>}
      </div>
    </Frame>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-2" role="status">
      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="4" fill="none" />
        <path d="M22 12a10 10 0 0 0-10-10" stroke="#2563eb" strokeWidth="4" fill="none" strokeLinecap="round" />
      </svg>
      {label}
    </span>
  );
}

export function IssueList({ issues, max = 50 }: { issues: DataIssue[]; max?: number }) {
  const [showInfo, setShowInfo] = useState(false);
  const shown = issues.filter((i) => showInfo || i.severity !== 'info');
  const infoCount = issues.filter((i) => i.severity === 'info').length;
  if (!issues.length) return <p className="text-sm text-ink-2">No data issues found.</p>;
  return (
    <div>
      <ul className="space-y-2">
        {shown.slice(0, max).map((i, k) => (
          <li key={k} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5"><StatusIcon kind={i.severity === 'error' ? 'error' : i.severity === 'warning' ? 'warning' : 'info'} /></span>
            <span className="text-ink-2"><span className="sr-only">{i.severity}: </span>{i.message}</span>
          </li>
        ))}
      </ul>
      {infoCount > 0 && (
        <button className="mt-2 text-xs font-medium text-accent hover:underline" onClick={() => setShowInfo((v) => !v)}>
          {showInfo ? 'Hide' : 'Show'} {infoCount} informational note{infoCount > 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable, filterable table
// ---------------------------------------------------------------------------

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Value used for sorting and filtering */
  value?: (row: T) => string | number | null;
  align?: 'left' | 'right' | 'center';
  className?: string;
  /** Allow wrapping (long text); other cells stay on one line */
  wrap?: boolean;
}

export function DataTable<T>({ rows, columns, rowKey, filterPlaceholder = 'Filter…', initialSort, empty = 'No rows.', maxHeight, testId, pageSize = 200 }: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T, i: number) => string;
  filterPlaceholder?: string | null;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  empty?: ReactNode;
  maxHeight?: string;
  testId?: string;
  pageSize?: number;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(pageSize);
  const shown = useMemo(() => {
    let out = rows;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      out = out.filter((r) => columns.some((c) => String(c.value ? c.value(r) ?? '' : '').toLowerCase().includes(needle)));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.value) {
        out = [...out].sort((a, b) => {
          const x = col.value!(a);
          const y = col.value!(b);
          if (x === y) return 0;
          if (x === null) return 1;
          if (y === null) return -1;
          const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
          return sort.dir === 'asc' ? r : -r;
        });
      }
    }
    return out;
  }, [rows, columns, q, sort]);
  return (
    <div data-testid={testId}>
      {filterPlaceholder !== null && rows.length > 5 && (
        <div className="mb-3 flex items-center gap-3">
          <input className="input max-w-xs" placeholder={filterPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter table" />
          <span className="text-xs text-ink-3">{shown.length} of {rows.length}</span>
        </div>
      )}
      <div className="overflow-auto rounded-xl border border-line bg-white" style={{ maxHeight }}>
        <table className="min-w-full divide-y divide-line">
          <thead className="sticky top-0 z-10 bg-plane">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} className={`th ${c.align === 'right' ? 'text-right' : ''}`} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.value ? (
                      <button className="inline-flex items-center gap-1 uppercase hover:text-ink" onClick={() => setSort(active && sort!.dir === 'asc' ? { key: c.key, dir: 'desc' } : { key: c.key, dir: 'asc' })}>
                        {c.header}
                        <span className={active ? 'text-accent' : 'text-[#d1d5db]'}>{active && sort!.dir === 'desc' ? '▼' : '▲'}</span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white">
            {shown.slice(0, limit).map((r, i) => (
              <tr key={rowKey(r, i)} className="transition-colors hover:bg-plane">
                {columns.map((c) => (
                  <td key={c.key} className={`td ${c.align === 'right' ? 'text-right tabular' : ''} ${c.wrap ? 'min-w-[16rem] max-w-[28rem]' : 'whitespace-nowrap'} ${c.className ?? ''}`}>{c.render(r)}</td>
                ))}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td className="td py-8 text-center text-ink-3" colSpan={columns.length}>{empty}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {shown.length > limit && (
        <button className="btn-ghost mt-2" onClick={() => setLimit((l) => l + pageSize)}>Show more ({shown.length - limit} hidden)</button>
      )}
    </div>
  );
}
