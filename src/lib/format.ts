import { dayToISO } from './calendar';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "16 Oct 2026" */
export function fmtDay(d: number | null | undefined): string {
  if (d === null || d === undefined || !Number.isFinite(d)) return '—';
  const iso = dayToISO(d);
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}
/** Short "16 Oct" */
export function fmtShort(d: number): string {
  const iso = dayToISO(d);
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}
/** Finish boundary → last working day */
export function fmtFinish(f: number | null | undefined): string {
  return f === null || f === undefined || !Number.isFinite(f) ? '—' : fmtDay(f - 1);
}
export function fmtNum(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return x.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
export function fmtMoney(x: number | null | undefined, currency = ''): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return `${currency ? currency + ' ' : ''}${x.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
export function fmtPct(x: number | null | undefined): string {
  return x === null || x === undefined || !Number.isFinite(x) ? '—' : `${x.toFixed(1)}%`;
}
