import { useState } from 'react';
import { useStore } from '../state/store';
import { Card, EmptyState, Notice, PageHeader, Spinner } from '../components/ui';
import { exportWorkbook, SHEET_HEADERS } from '../lib/report/excel';
import { buildChatSummary } from '../lib/chat/summary';
import type { PageProps } from './types';

function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

export function ReportsPage({ go }: PageProps) {
  const { state, analysis, stale } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!state.model || !state.settings || !analysis) return <EmptyState title="Nothing to report yet" action={<button className="btn-primary" onClick={() => go('upload')}>Go to Upload</button>}>Load schedules first.</EmptyState>;
  const { model, settings, groups, optimization } = state;

  async function exportExcel() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { default: ExcelJS } = await import('exceljs');
      const buf = await exportWorkbook(ExcelJS, { model: model!, groups, settings: settings!, analysis: analysis!, optimization, selectedScenarioId: state.selectedScenarioId });
      const name = `p6-resource-report-${stamp()}.xlsx`;
      download(buf, name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      setDone(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Reports" subtitle="Export the full analysis to Excel. The original XER files are never modified." />
      {!optimization && <div className="mb-4"><Notice kind="info" title="The optimization has not been run" action={<button className="btn-secondary" onClick={() => go('scenarios')}>Run it</button>}>The report will contain the comparison and conflicts, but no scenarios or recommendations.</Notice></div>}
      {stale && <div className="mb-4"><Notice kind="warning" title="Scenario results are out of date — re-run the optimization before exporting." /></div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Excel workbook" subtitle="Formatted headers, frozen header rows, filters and red highlighting of over-allocations.">
          <ul className="mb-5 space-y-1.5 text-sm">
            {Object.entries(SHEET_HEADERS).map(([name, headers]) => (
              <li key={name} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-navy-500" /><span><span className="font-medium">{name}</span> <span className="text-ink-3">— {headers.slice(0, 4).join(', ')}{headers.length > 4 ? '…' : ''}</span></span></li>
            ))}
          </ul>
          <button className="btn-primary" onClick={exportExcel} disabled={busy} data-testid="export-excel">{busy ? <Spinner label="Building workbook…" /> : 'Download Excel report'}</button>
          {done && <div className="mt-3"><Notice kind="ok" title={`Downloaded ${done}`} /></div>}
          {error && <div className="mt-3"><Notice kind="error" title="Export failed">{error}</Notice></div>}
        </Card>
        <Card title="Analysis summary (JSON)" subtitle="The same compact summary the AI assistant receives — useful as a dissertation appendix.">
          <button className="btn-secondary" onClick={() => download(JSON.stringify(buildChatSummary({ model, groups, settings, analysis, optimization, selectedScenarioId: state.selectedScenarioId }), null, 2), `p6-analysis-summary-${stamp()}.json`, 'application/json')}>Download summary JSON</button>
        </Card>
      </div>
    </div>
  );
}
