import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { loadPortfolio } from '../src/lib/loader';
import { applyCsvImport, importAssignmentsCsv } from '../src/lib/resources/csvAssignments';
import { suggestGroups } from '../src/lib/resources/matching';
import { defaultSettings } from '../src/lib/settings';
import { analyzePortfolio, runOptimization } from '../src/lib/pipeline';
import { exportWorkbook, SHEET_HEADERS } from '../src/lib/report/excel';
import { buildChatSummary, recommendedScenario } from '../src/lib/chat/summary';
import { validateChatRequest } from '../api/chat';

function setup() {
  let model = loadPortfolio([
    { name: 'AFS.xer', data: readFileSync('samples/AFS.xer') },
    { name: 'AFS_scheduled.xer', data: readFileSync('samples/AFS_scheduled.xer') },
  ]);
  model = applyCsvImport(model, importAssignmentsCsv(readFileSync('public/samples/afs-demo-resources.csv', 'utf8'), model, 'afs-demo-resources.csv'));
  const groups = suggestGroups(model);
  const settings = defaultSettings(model);
  return { model, groups, settings, analysis: analyzePortfolio(model, groups, settings), optimization: runOptimization(model, groups, settings) };
}

describe('Excel export', () => {
  const input = setup();
  it('contains every sheet with the expected headers, frozen header rows and data', async () => {
    const buf = await exportWorkbook(ExcelJS, { ...input, generatedAt: new Date('2026-10-16T10:00:00Z') });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(['Summary', 'Projects', 'Daily Demand', 'Conflicts', 'Scenario Comparison', 'Recommended Changes', 'Assumptions & Missing Data']);
    for (const [name, headers] of Object.entries(SHEET_HEADERS)) {
      const ws = wb.getWorksheet(name)!;
      const row = (ws.getRow(1).values as unknown[]).slice(1);
      expect(row, name).toEqual([...headers]);
      expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(ws.rowCount, name).toBeGreaterThan(1);
    }
    expect(wb.getWorksheet('Scenario Comparison')!.rowCount).toBe(7);
    expect(wb.getWorksheet('Projects')!.getRow(2).getCell(1).value).toBe('AFS [AFS]');
    const assumptions = wb.getWorksheet('Assumptions & Missing Data')!;
    const text = assumptions.getSheetValues().flat().join(' ');
    expect(text).toMatch(/imported from a CSV, not from the XER files/);
    expect(text).toMatch(/no_plan_end/);
  });

  it('works before optimisation has run', async () => {
    const buf = await exportWorkbook(ExcelJS, { ...input, optimization: null });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets).toHaveLength(7);
  });
});

describe('chat summary', () => {
  const input = setup();
  it('is compact, accepted by /api/chat and carries the data flags', () => {
    const s = buildChatSummary(input);
    const size = new TextEncoder().encode(JSON.stringify(s)).length;
    expect(size).toBeLessThan(28 * 1024);
    expect(validateChatRequest({ message: 'q', history: [], summary: s }).ok).toBe(true);
    const json = JSON.stringify(s);
    expect(json).toContain('DEMO CSV');
    expect(json).toContain('CPM computed by the app');
    expect((s.scenarios as unknown[]).length).toBe(6);
    expect(s.selectedScenario).toBeDefined();
    expect(json).not.toContain('%T'); // never raw XER
  });
  it('recommends the lowest-Z feasible capacity-respecting scenario', () => {
    const rec = recommendedScenario(input.optimization.scenarios)!;
    expect(rec.enforcesCapacity && rec.feasible).toBe(true);
    for (const s of input.optimization.scenarios.filter((x) => x.enforcesCapacity && x.feasible)) {
      expect(rec.metrics.objective.Z).toBeLessThanOrEqual(s.metrics.objective.Z);
    }
  });
});
