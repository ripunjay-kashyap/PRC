// Generates public/samples/afs-demo-resources.csv (illustrative demo loading — NOT from the XER files).
import { writeFileSync } from 'node:fs';
const load = {
  A110: { eng: 1, helper: 4 }, A120: { eng: 1 }, A130: { eng: 1, helper: 1 }, A140: { eng: 1 }, A150: { helper: 3 },
  A210: { plumber: 2, helper: 2 }, A220: { mason: 2, helper: 2 }, A230: { plumber: 3, helper: 2 }, A240: { plumber: 2, helper: 1 },
  A250: { plumber: 2, helper: 2 }, A260: { plumber: 2, helper: 1 }, A270: { plumber: 1, eng: 1 }, A280: { mason: 2, helper: 2 },
  A310: { mason: 1, helper: 3 }, A320: { mason: 1, helper: 3 }, A330: { mason: 2, helper: 1, mixer: 1 }, A340: { wp: 2, helper: 1 },
  A350: { wp: 1 }, A360: { mason: 2, helper: 2, mixer: 1 }, A370: { tiler: 3, helper: 2, tiles: 25 }, A380: { mason: 2, helper: 1 },
  A390: { painter: 3 }, A410: { helper: 3 }, A420: { mason: 2, helper: 2, mixer: 1 }, A430: { wp: 2, helper: 1 }, A440: { wp: 1 },
  A510: { mason: 1, welder: 1, helper: 1 }, A520: { painter: 1 }, A610: { helper: 4 }, A620: { eng: 1 }, A630: { eng: 1 },
};
const res = {
  eng:     { type: 'labor', cost: 3500, a: ['Site Engineer', 1], b: ['Site Engineer - AFS Sched', 1] },
  plumber: { type: 'labor', cost: 1200, a: ['Plumber', 3], b: ['PLUMBER (AFS_scheduled)', 3] },
  mason:   { type: 'labor', cost: 1100, a: ['Mason', 3], b: ['Masons', 2] },
  helper:  { type: 'labor', cost: 700,  a: ['Helper', 5], b: ['Helpers / Mazdoor', 5] },
  wp:      { type: 'labor', cost: 1300, a: ['Waterproofing Applicator', 2], b: ['Waterproofing Crew', 2] },
  tiler:   { type: 'labor', cost: 1200, a: ['Tiler', 3], b: ['Tilers', 2] },
  painter: { type: 'labor', cost: 1000, a: ['Painter', 3], b: ['Painter - Sched', 2] },
  welder:  { type: 'labor', cost: 1200, a: ['Welder / Fabricator', 1], b: ['Fabricator', 1] },
  mixer:   { type: 'equipment', cost: 2500, a: ['Concrete Mixer', 1], b: ['Concrete Mixer Machine', 1] },
  tiles:   { type: 'material', cost: '', a: ['Ceramic Tiles (sqm)', ''], b: ['Ceramic Tiles (sqm)', ''] },
};
const lines = [
  '# ILLUSTRATIVE DEMO RESOURCE LOADING - NOT FROM THE XER FILES (they contain no RSRC/TASKRSRC/RSRCRATE tables).',
  '# Crew sizes, capacities (max_units) and cost rates (INR per unit-day) are invented for demonstration only.',
  'project,activity_code,resource_name,resource_type,units_per_day,max_units,cost_per_unit_day',
];
for (const [file, side] of [['AFS.xer', 'a'], ['AFS_scheduled.xer', 'b']]) {
  for (const [code, needs] of Object.entries(load)) {
    for (const [k, units] of Object.entries(needs)) {
      const r = res[k]; const [name, cap] = r[side];
      lines.push([file, code, name, r.type, units, cap, r.cost].join(','));
    }
  }
}
writeFileSync('public/samples/afs-demo-resources.csv', lines.join('\n') + '\n');
console.log(lines.length, 'lines');
