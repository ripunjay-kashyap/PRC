import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Badge, Card, Frame, IssueList, Notice, PageHeader, Spinner, StatusIcon } from '../components/ui';
import type { PageProps } from './types';
import type { DataIssue } from '../lib/model';

const SAMPLE_FILES = ['AFS.xer', 'AFS_scheduled.xer'];
const SAMPLE_CSV = 'afs-demo-resources.csv';

export function UploadPage({ go }: PageProps) {
  const { state, loadFiles, importCsv, reset, analysis } = useStore();
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [csvIssues, setCsvIssues] = useState<DataIssue[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const model = state.model;

  async function handleFiles(list: FileList | File[]) {
    const files = [...list];
    const errs: string[] = [];
    const xers = files.filter((f) => /\.xer$/i.test(f.name));
    const csvs = files.filter((f) => /\.csv$/i.test(f.name));
    for (const f of files) if (!/\.(xer|csv)$/i.test(f.name)) errs.push(`${f.name}: not an .xer or .csv file — ignored.`);
    if (!xers.length) {
      if (csvs.length && model) {
        const text = await csvs[0].text();
        setCsvIssues(importCsv(csvs[0].name, text));
      } else errs.push('Select at least one Primavera P6 .xer file.');
      setErrors(errs);
      return;
    }
    setBusy(true);
    try {
      const inputs = await Promise.all(xers.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
      const csv = csvs[0] ? { name: csvs[0].name, text: await csvs[0].text() } : null;
      const m = loadFiles(inputs, csv);
      if (m.files.every((f) => !f.ok)) errs.push('None of the files could be read as a valid XER.');
      setCsvIssues(null);
    } catch (e) {
      errs.push(`Could not read the files: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setErrors(errs);
    }
  }

  async function loadSample() {
    setBusy(true);
    setErrors([]);
    try {
      const inputs = await Promise.all(
        SAMPLE_FILES.map(async (name) => {
          const r = await fetch(`/samples/${name}`);
          if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
          return { name, data: new Uint8Array(await r.arrayBuffer()) };
        }),
      );
      const csvRes = await fetch(`/samples/${SAMPLE_CSV}`);
      const csv = csvRes.ok ? { name: SAMPLE_CSV, text: await csvRes.text() } : null;
      loadFiles(inputs, csv, true);
      setCsvIssues(null);
    } catch (e) {
      setErrors([`Could not load the sample data: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setBusy(false);
    }
  }

  const dropzone = (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); void handleFiles(e.dataTransfer.files); }}
      className={`relative flex flex-col items-center justify-center rounded-xl border px-6 text-center transition-colors ${model ? 'py-8' : 'py-12'} ${drag ? 'border-accent bg-accent-soft' : 'hatch border-line bg-white'}`}
    >
      <div className="mb-3 rounded-xl border border-line bg-white p-2.5 shadow-card">
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-ink" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 15V4m0 0L8 8m4-4l4 4M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" /></svg>
      </div>
      <p className="text-[15px] font-medium text-ink">Drop .xer files here <span className="font-normal text-ink-3">— optionally with a resource-assignment .csv</span></p>
      <p className="mt-1 text-[13px] text-ink-3">Several files and several projects per file. Windows-1252 and UTF-8 are detected automatically.</p>
      <button className="btn-secondary mt-4" onClick={() => fileInput.current?.click()} disabled={busy}>Browse files</button>
      <input ref={fileInput} type="file" multiple accept=".xer,.csv" className="hidden" data-testid="file-input" onChange={(e) => e.target.files && void handleFiles(e.target.files)} />
      {busy && <div className="mt-3"><Spinner label="Parsing…" /></div>}
    </div>
  );

  return (
    <div>
      {!model ? (
        <section className="dots -mx-4 -mt-8 mb-6 px-4 pb-4 pt-12 sm:-mx-6 sm:px-6 lg:-mx-10 lg:-mt-10 lg:px-10 lg:pt-16">
          <Frame className="mx-auto max-w-5xl">
            <div className="rounded-2xl border border-line bg-white px-6 pb-10 pt-12 text-center sm:px-12 sm:pt-16">
              <div className="eyebrow mb-6">
                <span className="rounded bg-ink px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">M.Tech</span>
                Primavera P6 · Multi-project resource allocation
              </div>
              <h1 className="mx-auto max-w-3xl text-balance text-[40px] font-semibold leading-[1.05] tracking-tightest text-ink sm:text-[56px]">
                Level resources across every project
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-balance text-[17px] leading-relaxed text-ink-2">
                Upload P6 schedules, pool matching crews across sites, find the days you are over-allocated and get a constraint-checked plan — explained in plain language.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <button className="btn-primary px-4 py-2.5 text-[15px]" onClick={loadSample} disabled={busy} data-testid="load-sample">
                  Load sample data
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 10h12m-5-5l5 5-5 5" /></svg>
                </button>
                <button className="btn-secondary px-4 py-2.5 text-[15px]" onClick={() => fileInput.current?.click()} disabled={busy}>Upload your .xer files</button>
              </div>
              <div className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-center gap-2">
                {[
                  ['#0a0a0a', 'Parse XER'],
                  ['#2563eb', 'Detect conflicts'],
                  ['#1baf7a', 'Optimize with SGS'],
                  ['#eb6834', 'Explain with AI'],
                ].map(([c, t], i) => (
                  <div key={t} className="flex items-center gap-2">
                    {i > 0 && <span className="hidden h-px w-6 bg-line sm:block" />}
                    <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${i === 0 ? 'border-line bg-white text-ink shadow-card' : 'border-transparent bg-plane text-ink-2'}`}>
                      <span className="flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-semibold text-white" style={{ background: c }}>{i + 1}</span>
                      {t}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mx-auto mt-10 max-w-3xl text-left">{dropzone}</div>
            </div>
          </Frame>
          <div className="mx-auto mt-10 grid max-w-5xl overflow-hidden rounded-xl border border-line bg-white sm:grid-cols-3">
            {[
              ['Deterministic numbers', 'CPM, conflict detection and a serial schedule generation scheme run in your browser. Nothing is guessed.'],
              ['Every constraint checked', 'Logic with lags, fixed durations, data dates and pooled capacity are validated for each of six scenarios.'],
              ['Excel-ready output', 'A seven-sheet workbook with demand vs capacity, recommended shifts, transfers, hires and assumptions.'],
            ].map(([t, d], i) => (
              <div key={t} className={`p-6 ${i > 0 ? 'border-t border-line sm:border-l sm:border-t-0' : ''}`}>
                <div className="text-[15px] font-semibold tracking-tight">{t}</div>
                <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{d}</p>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <>
          <PageHeader
            eyebrow="Step 1 · Upload"
            title="Your schedules"
            subtitle="Files are parsed in your browser and never uploaded to a server; the original files are never modified."
            actions={
              <>
                <button className="btn-secondary" onClick={loadSample} disabled={busy} data-testid="load-sample">Reload sample data</button>
                <button className="btn-ghost" onClick={() => { reset(); setErrors([]); setCsvIssues(null); }}>Clear all</button>
              </>
            }
          />
          {dropzone}
        </>
      )}

      {errors.length > 0 && (
        <div className="mt-4 space-y-2">{errors.map((e, i) => <Notice key={i} kind="error" title={e} />)}</div>
      )}

      {model && (
        <>
          <h2 className="mb-4 mt-10 text-xl font-semibold tracking-tight">Validation summary</h2>
          <div className="grid gap-4 md:grid-cols-2" data-testid="file-summaries">
            {model.files.map((f) => {
              const projects = model.projects.filter((p) => p.fileId === f.fileId);
              const acts = model.activities.filter((a) => projects.some((p) => p.key === a.projectKey));
              const errs = f.issues.filter((i) => i.severity === 'error').length;
              const warns = f.issues.filter((i) => i.severity === 'warning').length;
              return (
                <Card
                  key={f.fileId}
                  title={<span className="flex items-center gap-2"><StatusIcon kind={!f.ok ? 'error' : warns ? 'warning' : 'ok'} />{f.fileName}</span>}
                  subtitle={f.ok ? `P6 ${f.header[0] ?? ''} export · ${f.header[1] ?? ''}` : 'Invalid file'}
                  actions={f.ok ? <Badge tone={warns ? 'warn' : 'good'}>{errs ? `${errs} errors` : warns ? `${warns} warnings` : 'Valid'}</Badge> : <Badge tone="bad">Rejected</Badge>}
                >
                  {f.ok && (
                    <dl className="mb-4 grid grid-cols-3 gap-3 text-sm">
                      <div><dt className="label">Projects</dt><dd className="font-semibold">{projects.map((p) => p.shortName).join(', ') || '—'}</dd></div>
                      <div><dt className="label">Activities</dt><dd className="font-semibold tabular">{acts.length}</dd></div>
                      <div><dt className="label">Tables</dt><dd className="font-semibold tabular">{f.tables.length}</dd></div>
                    </dl>
                  )}
                  {f.ok && (
                    <div className="mb-4 flex flex-wrap gap-1.5">
                      {f.tables.map((t) => <Badge key={t.name} tone="info" title={`${t.fields.length} fields`}>{t.name} · {t.rowCount}</Badge>)}
                      {['RSRC', 'TASKRSRC', 'RSRCRATE'].filter((t) => !f.tables.some((x) => x.name === t)).map((t) => <Badge key={t} tone="warn">{t} missing</Badge>)}
                    </div>
                  )}
                  <IssueList issues={f.issues} />
                </Card>
              );
            })}
          </div>

          <Card className="mt-6" title="Portfolio-level notes" subtitle="Issues across files: missing deadlines, resources, duplicate projects, unscheduled projects">
            <IssueList issues={(analysis?.issues ?? model.issues).filter((i) => !i.fileId)} />
          </Card>

          <Card
            className="mt-6"
            title="Resource assignments"
            subtitle={model.assignments.length ? `${model.assignments.length} assignments on ${new Set(model.assignments.map((a) => a.resourceKey)).size} resources (${model.assignments.some((a) => a.source === 'csv') ? 'from CSV' : 'from XER'})` : 'No resource assignments loaded'}
            actions={<button className="btn-secondary" onClick={() => csvInput.current?.click()}>Import assignment CSV</button>}
          >
            <input ref={csvInput} type="file" accept=".csv" className="hidden" data-testid="csv-input" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsvIssues(importCsv(f.name, await f.text())); }} />
            {state.usingDemoData && (
              <Notice kind="warning" title="Illustrative demo resource loading">
                The sample XER files contain no RSRC, TASKRSRC or RSRCRATE tables. To demonstrate the optimizer, crew sizes, capacities and cost rates were loaded from <code>{SAMPLE_CSV}</code>. These values are invented and are flagged in every report.
              </Notice>
            )}
            {!model.assignments.length && (
              <Notice kind="warning" title="Resource conflicts can't be analysed yet">
                The XER files carry no resource assignments. Import a CSV with the columns below, or use “Load sample data”.
              </Notice>
            )}
            {csvIssues && <div className="mt-3"><IssueList issues={csvIssues} /></div>}
            <details className="mt-4 text-sm text-ink-2">
              <summary className="cursor-pointer font-medium text-ink">CSV format</summary>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-plane p-3 text-xs">{`project,activity_code,resource_name,resource_type,units_per_day,max_units,cost_per_unit_day
AFS.xer,A230,Plumber,labor,3,3,1200
,A420,Concrete Mixer,equipment,1,1,2500      ← blank project = every loaded project`}</pre>
              <p className="mt-2">Use <code>total_qty</code> (hours) instead of <code>units_per_day</code> if you have total quantities. <code>project</code> may be a file name, short name or proj_id.</p>
            </details>
          </Card>

          <div className="mt-6 flex justify-end">
            <button className="btn-primary" onClick={() => go(model.assignments.length ? 'mapping' : 'comparison')}>
              Continue to {model.assignments.length ? 'Resource Mapping' : 'Project Comparison'} →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
