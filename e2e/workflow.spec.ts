import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';

test('upload → mapping → optimize → recommendations → Excel export → chat', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/#/upload');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // 1. Upload both XER files (+ the assignment CSV, since the XERs carry no resources)
  await page.getByTestId('file-input').setInputFiles(['samples/AFS.xer', 'samples/AFS_scheduled.xer', 'public/samples/afs-demo-resources.csv']);
  const summaries = page.getByTestId('file-summaries');
  await expect(summaries).toContainText('AFS.xer');
  await expect(summaries).toContainText('AFS_scheduled.xer');
  await expect(summaries).toContainText('TASKRSRC missing');
  await expect(page.getByText('112 assignments on 20 resources (from CSV)')).toBeVisible();

  // invalid file is rejected with a clear error
  await page.getByTestId('file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByText('notes.txt: not an .xer or .csv file — ignored.')).toBeVisible();

  // 2. Resource mapping
  await page.getByRole('button', { name: /Resource Mapping/ }).first().click();
  await expect(page.getByTestId('groups')).toContainText('Plumber');
  await expect(page.getByTestId('groups')).toContainText('PLUMBER (AFS_scheduled)');
  await page.getByTestId('confirm-mapping').click();
  await expect(page.getByText('Mapping confirmed')).toBeVisible();

  // 3. Conflicts are shown
  await page.getByRole('button', { name: /Conflict Analysis/ }).first().click();
  await expect(page.getByTestId('conflict-table')).toContainText('Helper');
  await expect(page.locator('.recharts-surface').first()).toBeVisible();

  // 4. Optimize
  await page.getByRole('button', { name: /Scenarios & Recommendations/ }).first().click();
  await page.getByTestId('run-optimization').click();
  const table = page.getByTestId('scenario-table');
  await expect(table).toBeVisible({ timeout: 60000 });
  await expect(table.locator('tbody tr')).toHaveCount(6);
  await expect(table).toContainText('Pooled, flexible starts within float');
  await expect(page.getByTestId('validation-status')).toContainText('All constraints satisfied');

  // 5. Recommendations + Gantt
  await expect(page.getByTestId('recommendations')).toContainText('Activity shifts');
  await expect(page.getByTestId('recommendations')).toContainText('Deadline impact');
  await page.getByRole('tab', { name: /Gantt/ }).click();
  await expect(page.getByTestId('gantt')).toBeVisible();

  // 6. Excel export
  await page.getByRole('button', { name: /Reports/ }).first().click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-excel').click()]);
  expect(download.suggestedFilename()).toMatch(/^p6-resource-report-\d{8}\.xlsx$/);
  const path = await download.path();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(path!));
  expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Projects', 'Daily Demand', 'Conflicts', 'Scenario Comparison', 'Recommended Changes', 'Assumptions & Missing Data']);
  expect(wb.getWorksheet('Scenario Comparison')!.rowCount).toBe(7);

  // 7. Chat: not configured → clear message; configured (mocked) → reply bubble
  await page.route('**/api/chat', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Chat not configured', code: 'not_configured' }) }));
  await page.goto('/#/assistant');
  await page.getByRole('button', { name: 'Which resource is the biggest bottleneck?' }).click();
  await expect(page.getByText('Chat not configured', { exact: true })).toBeVisible();
  await page.unroute('**/api/chat');
  let sent: { message: string; history: unknown[]; summary: Record<string, unknown> } | null = null;
  await page.route('**/api/chat', async (r) => {
    sent = r.request().postDataJSON();
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: 'The **Helper** group is the biggest bottleneck.', model: 'mock' }) });
  });
  await page.getByLabel('Message').fill('Which project finishes last?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('chat-log')).toContainText('The Helper group is the biggest bottleneck.');
  expect(Object.keys(sent!).sort()).toEqual(['history', 'message', 'summary']);
  expect(JSON.stringify(sent!.summary)).toContain('selectedScenario');

  expect(errors).toEqual([]);
});

test('responsive at tablet width', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1000 });
  await page.goto('/#/upload');
  await page.getByTestId('load-sample').click();
  await expect(page.getByTestId('file-summaries')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByLabel('Open menu').click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
});
