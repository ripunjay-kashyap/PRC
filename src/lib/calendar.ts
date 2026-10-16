import type { Calendar, DayNum } from './model';

const MS_PER_DAY = 86_400_000;
/** Excel/P6 serial date 25569 = 1970-01-01 */
const SERIAL_EPOCH_OFFSET = 25569;

export const DEFAULT_WORKWEEK: boolean[] = [false, true, true, true, true, true, false];

export function dayFromYMD(y: number, m: number, d: number): DayNum {
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export interface ParsedDateTime {
  day: DayNum;
  minutes: number;
}

/** Parse P6 "YYYY-MM-DD HH:MM" (time optional). Returns null for empty/invalid. */
export function parseP6DateTime(value: string | undefined | null): ParsedDateTime | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(value.trim());
  if (!m) return null;
  const day = dayFromYMD(Number(m[1]), Number(m[2]), Number(m[3]));
  if (!Number.isFinite(day)) return null;
  const minutes = m[4] ? Number(m[4]) * 60 + Number(m[5]) : 0;
  return { day, minutes };
}

/** Midday threshold used to round P6 timestamps to whole working days. */
const MIDDAY = 12 * 60;

/** A P6 start timestamp → start boundary (work begins at the start of the returned day). */
export function startBoundaryFromP6(value: string | undefined | null): DayNum | null {
  const p = parseP6DateTime(value);
  if (!p) return null;
  return p.minutes >= MIDDAY ? p.day + 1 : p.day;
}

/** A P6 finish timestamp → finish boundary (work ends at the end of the day before the returned day). */
export function finishBoundaryFromP6(value: string | undefined | null): DayNum | null {
  const p = parseP6DateTime(value);
  if (!p) return null;
  return p.minutes > MIDDAY ? p.day + 1 : p.day;
}

export function dayToISO(day: DayNum): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function isoToDay(iso: string): DayNum | null {
  const p = parseP6DateTime(iso);
  return p ? p.day : null;
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(day: DayNum): number {
  return (((day + 4) % 7) + 7) % 7;
}

export function serialToDay(serial: number): DayNum {
  return serial - SERIAL_EPOCH_OFFSET;
}

/** Human-readable label for a start boundary (the first working day). */
export function startLabel(start: DayNum): string {
  return dayToISO(start);
}

/** Human-readable label for a finish boundary (the last day of work = boundary - 1). */
export function finishLabel(start: DayNum, finish: DayNum): string {
  return dayToISO(finish > start ? finish - 1 : finish);
}

// ---------------------------------------------------------------------------
// clndr_data parsing
// ---------------------------------------------------------------------------

interface CalNode {
  name: string;
  params: string;
  children: CalNode[];
}

/** Parse P6's nested "(0||NAME(params)(children))" calendar notation. */
export function parseCalendarTree(data: string): CalNode[] {
  let i = 0;
  const s = data;
  const skipWs = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const readUntil = (stop: string): string => {
    const startIdx = i;
    while (i < s.length && s[i] !== stop) i++;
    return s.slice(startIdx, i);
  };
  const parseNode = (): CalNode | null => {
    skipWs();
    if (s[i] !== '(') return null;
    i++; // (
    const header = readUntil('(');
    i++; // (
    const params = readUntil(')');
    i++; // )
    skipWs();
    const children: CalNode[] = [];
    if (s[i] === '(') {
      i++; // children (
      for (;;) {
        skipWs();
        if (i >= s.length) break;
        if (s[i] === ')') {
          i++;
          break;
        }
        const child = parseNode();
        if (!child) {
          i++;
        } else children.push(child);
      }
    }
    skipWs();
    if (s[i] === ')') i++;
    const name = header.split('||').pop() ?? header;
    return { name: name.trim(), params, children };
  };
  const nodes: CalNode[] = [];
  while (i < s.length) {
    const n = parseNode();
    if (n) nodes.push(n);
    else i++;
  }
  return nodes;
}

function findNode(nodes: CalNode[], name: string): CalNode | undefined {
  for (const n of nodes) {
    if (n.name === name) return n;
    const inner = findNode(n.children, name);
    if (inner) return inner;
  }
  return undefined;
}

function hasWorkIntervals(node: CalNode): boolean {
  return node.children.some((c) => /s\|\d{1,2}:\d{2}/.test(c.params) || hasWorkIntervals(c));
}

export interface ParsedCalendarData {
  workWeek: boolean[] | null;
  holidays: DayNum[];
  extraWorkdays: DayNum[];
}

export function parseClndrData(data: string | undefined): ParsedCalendarData {
  const out: ParsedCalendarData = { workWeek: null, holidays: [], extraWorkdays: [] };
  if (!data || !data.includes('DaysOfWeek')) return out;
  try {
    const tree = parseCalendarTree(data);
    const dow = findNode(tree, 'DaysOfWeek');
    if (dow && dow.children.length > 0) {
      const week = [...DEFAULT_WORKWEEK].map(() => false);
      let seen = 0;
      for (const d of dow.children) {
        const n = Number(d.name); // P6: 1 = Sunday ... 7 = Saturday
        if (n >= 1 && n <= 7) {
          week[n - 1] = hasWorkIntervals(d);
          seen++;
        }
      }
      if (seen > 0) out.workWeek = week;
    }
    const exc = findNode(tree, 'Exceptions');
    if (exc) {
      for (const e of exc.children) {
        const m = /d\|(\d+)/.exec(e.params);
        if (!m) continue;
        const day = serialToDay(Number(m[1]));
        if (hasWorkIntervals(e)) out.extraWorkdays.push(day);
        else out.holidays.push(day);
      }
    }
  } catch {
    // fall through with whatever was parsed
  }
  return out;
}

// ---------------------------------------------------------------------------
// Working-day arithmetic
// ---------------------------------------------------------------------------

/**
 * Fast working-day queries for one calendar. All "boundary" arguments are day numbers
 * meaning "the start of that day".
 */
export class WorkCalendar {
  readonly key: string;
  readonly dayHours: number;
  private readonly week: boolean[];
  private readonly holidays: Set<DayNum>;
  private readonly extra: Set<DayNum>;

  constructor(cal: Pick<Calendar, 'key' | 'dayHours' | 'workWeek' | 'holidays' | 'extraWorkdays'>) {
    this.key = cal.key;
    this.dayHours = cal.dayHours > 0 ? cal.dayHours : 8;
    this.week = cal.workWeek.some(Boolean) ? cal.workWeek : DEFAULT_WORKWEEK;
    this.holidays = new Set(cal.holidays);
    this.extra = new Set(cal.extraWorkdays);
  }

  isWorkday(day: DayNum): boolean {
    if (this.extra.has(day)) return true;
    if (this.holidays.has(day)) return false;
    return this.week[weekday(day)];
  }

  /** First working day >= day */
  nextWorkday(day: DayNum): DayNum {
    if (!Number.isFinite(day)) return day;
    let d = day;
    for (let guard = 0; guard < 3660; guard++, d++) if (this.isWorkday(d)) return d;
    return day;
  }

  /** Last working day <= day */
  prevWorkday(day: DayNum): DayNum {
    if (!Number.isFinite(day)) return day;
    let d = day;
    for (let guard = 0; guard < 3660; guard++, d--) if (this.isWorkday(d)) return d;
    return day;
  }

  /** Number of working days in [start, finish) */
  countWorkdays(start: DayNum, finish: DayNum): number {
    if (!Number.isFinite(start) || !Number.isFinite(finish)) return 0;
    let n = 0;
    for (let d = start; d < finish; d++) if (this.isWorkday(d)) n++;
    return n;
  }

  /** Finish boundary of an activity of `days` working days that starts at `start`. */
  finishFrom(start: DayNum, days: number): DayNum {
    if (days <= 0 || !Number.isFinite(start)) return start;
    let d = start;
    let left = days;
    for (let guard = 0; guard < 36600; guard++, d++) {
      if (this.isWorkday(d)) {
        left--;
        if (left === 0) return d + 1;
      }
    }
    return d;
  }

  /** Latest start boundary such that finishFrom(start, days) <= finish. */
  startFrom(finish: DayNum, days: number): DayNum {
    if (days <= 0 || !Number.isFinite(finish)) return finish;
    let d = finish - 1;
    let left = days;
    for (let guard = 0; guard < 36600; guard++, d--) {
      if (this.isWorkday(d)) {
        left--;
        if (left === 0) return d;
      }
    }
    return d;
  }

  /**
   * Shift a boundary by `lag` working days. Positive lags skip that many working days
   * forward; negative lags move back over that many working days. Zero is identity.
   */
  shift(boundary: DayNum, lag: number): DayNum {
    if (lag === 0 || !Number.isFinite(boundary)) return boundary;
    if (lag > 0) return this.finishFrom(this.nextWorkday(boundary), lag);
    return this.startFrom(boundary, -lag);
  }
}
