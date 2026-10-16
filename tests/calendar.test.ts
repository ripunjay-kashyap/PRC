import { describe, expect, it } from 'vitest';
import {
  WorkCalendar, dayFromYMD, dayToISO, finishBoundaryFromP6, parseClndrData, startBoundaryFromP6, weekday,
} from '../src/lib/calendar';

const cal = new WorkCalendar({ key: 'c', dayHours: 8, workWeek: [false, true, true, true, true, true, false], holidays: [dayFromYMD(2026, 10, 2)], extraWorkdays: [] });
const d = (s: string) => dayFromYMD(Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10)));

describe('calendar', () => {
  it('maps day numbers to weekdays and ISO dates', () => {
    expect(weekday(d('2026-10-16'))).toBe(5); // Friday
    expect(dayToISO(d('2026-10-16'))).toBe('2026-10-16');
  });
  it('converts P6 timestamps to day boundaries', () => {
    expect(startBoundaryFromP6('2026-10-16 09:00')).toBe(d('2026-10-16'));
    expect(finishBoundaryFromP6('2026-10-20 18:00')).toBe(d('2026-10-21'));
    expect(finishBoundaryFromP6('2026-10-16 00:00')).toBe(d('2026-10-16'));
    expect(startBoundaryFromP6('')).toBeNull();
  });
  it('skips weekends and holidays', () => {
    // A220 in AFS_scheduled: 40 h from Tue 29 Sep → Tue 6 Oct (2 Oct holiday)
    expect(cal.finishFrom(d('2026-09-29'), 5)).toBe(d('2026-10-07'));
    expect(cal.countWorkdays(d('2026-09-29'), d('2026-10-07'))).toBe(5);
    expect(cal.startFrom(d('2026-10-07'), 5)).toBe(d('2026-09-29'));
    expect(cal.nextWorkday(d('2026-10-17'))).toBe(d('2026-10-19'));
    expect(cal.prevWorkday(d('2026-10-18'))).toBe(d('2026-10-16'));
  });
  it('shifts by positive and negative lags in working days', () => {
    expect(cal.shift(d('2026-10-16'), 0)).toBe(d('2026-10-16'));
    expect(cal.shift(d('2026-10-16'), 1)).toBe(d('2026-10-17')); // after Friday's work
    expect(cal.shift(d('2026-10-17'), 2)).toBe(d('2026-10-21')); // Mon+Tue
    expect(cal.shift(d('2026-10-21'), -2)).toBe(d('2026-10-19'));
  });
  it('parses the workweek and holidays from clndr_data', () => {
    const p = parseClndrData('(0||CalendarData()( (0||DaysOfWeek()( (0||1()()) (0||2()( (0||0(s|09:00|f|13:00)()))) (0||7()()))) (0||Exceptions()( (0||0(d|46297)()) (0||1(d|46300)( (0||0(s|09:00|f|13:00)())))))))');
    expect(p.workWeek).toEqual([false, true, false, false, false, false, false]);
    expect(p.holidays.map(dayToISO)).toEqual(['2026-10-02']);
    expect(p.extraWorkdays.map(dayToISO)).toEqual(['2026-10-05']);
    expect(parseClndrData('garbage').workWeek).toBeNull();
  });
});
