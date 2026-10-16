import { readFileSync } from 'node:fs';
import { parseRawXer } from '../src/lib/xer/rawParser';
for (const f of ['samples/AFS.xer', 'samples/AFS_scheduled.xer']) {
  const raw = parseRawXer(readFileSync(f));
  console.log(`\n### ${f.split('/')[1]}\n\n| Table | Rows | Fields |\n|---|---:|---|`);
  for (const t of raw.tableOrder) { const tb = raw.tables.get(t)!; console.log(`| ${t} | ${tb.rows.length} | ${tb.fields.map(x=>'`'+x+'`').join(', ')} |`); }
}
// empty-field profile for TASK in both
for (const f of ['samples/AFS.xer', 'samples/AFS_scheduled.xer']) {
  const raw = parseRawXer(readFileSync(f));
  const t = raw.tables.get('TASK')!;
  const empty = t.fields.filter(fl => t.rows.every(r => r[fl] === ''));
  console.log(`\n${f} TASK fields empty in every row:`, empty.join(', '));
}
