import { useMemo, useState, type ReactNode } from 'react';
import type { DataIssue } from '../lib/model';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ title, subtitle, actions, children, className = '', bodyClass = 'p-5' }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-2">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function StatTile({ label, value, hint, tone = 'neutral' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'warn' }) {
  const ring = tone === 'bad' ? 'before:bg-critical' : tone === 'good' ? 'before:bg-good' : tone === 'warn' ? 'before:bg-warn' : 'before:bg-navy-100';
  return (
    <div className={`card relative overflow-hidden px-4 py-3.5 before:absolute before:inset-y-0 before:left-0 before:w-1 ${ring}`}>
      <div className="label">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-2">{hint}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'info' | 'navy';
const TONES: Record<Tone, string> = {
  neutral: 'bg-plane text-ink-2 ring-line',
  good: 'bg-[#e6f4e6] text-goodText ring-[#bfe3bf]',
  bad: 'bg-[#fbe5e5] text-[#9b1c1c] ring-[#f2c0c0]',
  warn: 'bg-[#fff4dc] text-[#7a5200] ring-[#f6dc9b]',
  info: 'bg-navy-50 text-navy-600 ring-navy-100',
  navy: 'bg-navy-700 text-white ring-navy-700',
};
export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
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
  const bg = { ok: '#0ca30c', error: '#d03b3b', warning: '#c98500', info: '#2a5d93' }[kind];
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" aria-hidden>
      <circle cx="10" cy="10" r="9" fill={bg} />
      <path d={paths[kind]} stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function Notice({ kind = 'info', title, children, action }: { kind?: 'ok' | 'error' | 'warning' | 'info'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const bg = { ok: 'bg-[#eef8ee] ring-[#cfe9cf]', error: 'bg-[#fdf0f0] ring-[#f2c0c0]', warning: 'bg-[#fff8e8] ring-[#f6dc9b]', info: 'bg-navy-50 ring-navy-100' }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-lg px-4 py-3 text-sm ring-1 ring-inset ${bg}`}>
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
    <div className="card flex flex-col items-center justify-center px-6 py-14 text-center">
      <svg viewBox="0 0 48 48" className="mb-4 h-12 w-12" aria-hidden>
        <rect x="6" y="10" width="22" height="6" rx="3" fill="#cde2fb" />
        <rect x="14" y="21" width="26" height="6" rx="3" fill="#fbd6c5" />
        <rect x="8" y="32" width="16" height="6" rx="3" fill="#c3ecd9" />
      </svg>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {children && <p className="mt-1 max-w-md text-sm text-ink-2">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-2" role="status">
      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="10" stroke="#d9e4f1" strokeWidth="4" fill="none" />
        <path d="M22 12a10 10 0 0 0-10-10" stroke="#1f3a5f" strokeWidth="4" fill="none" strokeLinecap="round" />
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
        <button className="mt-2 text-xs font-medium text-navy-500 hover:underline" onClick={() => setShowInfo((v) => !v)}>
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
      <div className="overflow-auto rounded-lg ring-1 ring-line" style={{ maxHeight }}>
        <table className="min-w-full divide-y divide-line">
          <thead className="sticky top-0 z-10 bg-[#f6f6f3]">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} className={`th ${c.align === 'right' ? 'text-right' : ''}`} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.value ? (
                      <button className="inline-flex items-center gap-1 uppercase hover:text-ink" onClick={() => setSort(active && sort!.dir === 'asc' ? { key: c.key, dir: 'desc' } : { key: c.key, dir: 'asc' })}>
                        {c.header}
                        <span className={active ? 'text-ink' : 'text-line'}>{active && sort!.dir === 'desc' ? '▼' : '▲'}</span>
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
              <tr key={rowKey(r, i)} className="hover:bg-[#fafaf7]">
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
