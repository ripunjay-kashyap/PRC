# Test report

Generated 2026-10-16 05:52 UTC by `npm run report` (scripts/test-report.ts). All figures below are produced by the app's code, not written by hand.

## 1. Results on the two attached XER files

**Inputs:** `AFS.xer` (unscheduled, data date 2026-10-16) and `AFS_scheduled.xer` (scheduled, data date 2026-08-27). Both contain the same project (proj_id 4518) and are analysed as two projects competing for one pool.
**The XER files have no resource tables.** The resource loading comes from the illustrative demo CSV `public/samples/afs-demo-resources.csv`: crew sizes, capacities and INR cost rates are invented for demonstration. The scheduling logic, durations, calendars and dates come from the XER files.

Default settings: weights α=1, β=10,000, γ=5,000, δ=100; materials excluded from leveling; mobilisation days and transfer cost 0; hire premium 1.5; deadlines AFS [AFS] = none (not in the XER), AFS [AFS_scheduled] = 2026-12-24 (`scd_end_date` fallback).

### Resource groups (suggested by name matching, all 2 members)

| Group | Type | Capacity | Cost / unit-day | Baseline peak demand | Baseline peak over | Over-allocated days | Utilisation |
|---|---|---:|---:|---:|---:|---:|---:|
| Ceramic Tile Sqm | material | missing | — | 25 | 0 | 0 | — |
| Concrete Mixer | equipment | 2 | 2,500 | 2 | 0 | 0 | 21.3% |
| Fabricator | labor | 2 | 1,200 | 1 | 0 | 0 | 18.6% |
| Helper | labor | 10 | 700 | 14 | 4 | 14 | 42.2% |
| Mason | labor | 5 | 1,100 | 10 | 5 | 9 | 36.9% |
| Painter | labor | 5 | 1,000 | 3 | 0 | 0 | 10.6% |
| Plumber | labor | 6 | 1,200 | 7 | 1 | 4 | 46.4% |
| Site Engineer | labor | 2 | 3,500 | 2 | 0 | 0 | 20.8% |
| Tiler | labor | 5 | 1,200 | 3 | 0 | 0 | 26.7% |
| Waterproofing | labor | 4 | 1,300 | 2 | 0 | 0 | 20.6% |

### Metrics per scenario (baseline vs optimized)

| Metric | Baseline (original P6 dates) | Leveling within each project | Pooled resources, original dates | Pooled, flexible starts within float | Cost priority | Deadline priority |
|---|---:|---:|---:|---:|---:|---:|
| Hard-constraint violations | 0 | 0 | 0 | 0 | 0 | 0 |
| Capacity enforced | no (reference) | yes | yes | yes | yes | yes |
| Best priority rule | — | Minimum total float + FBI | — | Latest finish time + FBI | Minimum total float + FBI | Latest finish time + FBI |
| Peak over-allocation (units) | 5 | 0 | 0 | 0 | 0 | 0 |
| Over-allocated unit-days | 52 | 0 | 0 | 0 | 0 | 0 |
| Average utilisation % | 27.1 | 26.4 | 27.1 | 27.9 | 27.9 | 27.9 |
| Resource cost (INR) | 12,53,200 | 12,53,200 | 12,53,200 | 12,53,200 | 12,53,200 | 12,53,200 |
| Transfers (count / cost) | 3 / 0 | 0 / 0 | 3 / 0 | 8 / 0 | 8 / 0 | 8 / 0 |
| Hired unit-days (cost INR) | 0 (0) | 16 (27,000) | 52 (70,200) | 0 (0) | 0 (0) | 0 (0) |
| Total cost (INR, priced groups) | 12,53,200 | 12,80,200 | 13,23,400 | 12,53,200 | 12,53,200 | 12,53,200 |
| AFS [AFS]: finish (duration wd) | 2027-02-15 (85) | 2027-03-15 (105) | 2027-02-15 (85) | 2027-02-15 (85) | 2027-02-15 (85) | 2027-02-15 (85) |
| AFS [AFS_scheduled]: finish (duration wd) | 2026-12-24 (85) | 2027-01-22 (105) | 2026-12-24 (85) | 2026-12-24 (85) | 2026-12-24 (85) | 2026-12-24 (85) |
| Deadline violations (days) | 0 (0) | 1 (20) | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| Idle resource unit-days | 2,272 | 2,537 | 2,272 | 2,191 | 2,191 | 2,191 |
| Activities shifted | 0 | 46 | 0 | 13 | 13 | 13 |
| Objective Z | 17,40,400 | 17,33,900 | 15,50,600 | 14,72,300 | 14,72,300 | 14,72,300 |
| Optimizer runtime (ms) | 3.4 | 53.8 | 2.5 | 29.5 | 23.2 | 28.4 |

Total optimisation time for all six scenarios: 152 ms (Node.js, this container). The cost of the material group (Ceramic Tile Sqm) is not priced because the demo CSV gives it no rate; every total excludes it, and the UI and Excel flag this.

**Reading the results.** Against the pooled capacity, the baseline over-allocates Helper, Mason and Plumber (peak 5 units). Within-float pooling (scenario 4) removes every over-allocation without hiring and without moving either project finish. It is the recommended plan (lowest Z). Leveling each project separately with a fixed share (scenario 2) delays AFS [AFS_scheduled] by 20 working days past its deadline and needs 16 unavoidable hired unit-days, because single activities need more Tilers/Painters than that project's share. Keeping the original dates (scenario 3) needs 52 hired unit-days. With these demo capacities the float absorbs every conflict, so the cost- and deadline-priority scenarios (5, 6) reach the same plan as scenario 4. A deadline-infeasibility case is covered by `tests/integration.test.ts`.

## 2. Automated tests

### Unit & integration (Vitest): 94 / 94 passed, 0 failed

**tests/calendar.test.ts**

| Test | Result |
|---|---|
| calendar maps day numbers to weekdays and ISO dates | ✅ pass |
| calendar converts P6 timestamps to day boundaries | ✅ pass |
| calendar skips weekends and holidays | ✅ pass |
| calendar shifts by positive and negative lags in working days | ✅ pass |
| calendar parses the workweek and holidays from clndr_data | ✅ pass |

**tests/chat.test.ts**

| Test | Result |
|---|---|
| /api/chat — valid request path (fetch mocked) calls Gemini with the server-side system prompt and returns the reply | ✅ pass |
| /api/chat — valid request path (fetch mocked) uses GEMINI_MODEL when set and keeps only the last 10 history turns | ✅ pass |
| /api/chat — valid request path (fetch mocked) system prompt forbids inventing numbers | ✅ pass |
| /api/chat — valid request path (fetch mocked) maps upstream errors, blocks and timeouts to clear errors | ✅ pass |
| /api/chat — missing key returns 503 not_configured without calling Gemini | ✅ pass |
| /api/chat — rejects oversized or malformed input not an object | ✅ pass |
| /api/chat — rejects oversized or malformed input invalid JSON string | ✅ pass |
| /api/chat — rejects oversized or malformed input extra field (open proxy attempt) | ✅ pass |
| /api/chat — rejects oversized or malformed input empty message | ✅ pass |
| /api/chat — rejects oversized or malformed input message not a string | ✅ pass |
| /api/chat — rejects oversized or malformed input oversized message | ✅ pass |
| /api/chat — rejects oversized or malformed input history not array | ✅ pass |
| /api/chat — rejects oversized or malformed input bad history role | ✅ pass |
| /api/chat — rejects oversized or malformed input extra history key | ✅ pass |
| /api/chat — rejects oversized or malformed input huge history turn | ✅ pass |
| /api/chat — rejects oversized or malformed input too many history items | ✅ pass |
| /api/chat — rejects oversized or malformed input summary missing | ✅ pass |
| /api/chat — rejects oversized or malformed input summary is array | ✅ pass |
| /api/chat — rejects oversized or malformed input oversized summary | ✅ pass |
| /api/chat — rejects oversized or malformed input accepts a JSON string body and missing history | ✅ pass |
| /api/chat — HTTP handler rejects non-POST methods | ✅ pass |
| /api/chat — HTTP handler rejects oversized bodies by content-length | ✅ pass |
| /api/chat — HTTP handler reads the key from process.env | ✅ pass |

**tests/conflicts.test.ts**

| Test | Result |
|---|---|
| conflict detection 2 + 2 + 1 excavators on overlapping days with capacity 3 → shortage of 2 | ✅ pass |
| conflict detection reports utilisation, idle and under-utilised periods | ✅ pass |
| conflict detection hired units remove the over-allocation | ✅ pass |
| conflict detection finds idle gaps inside the active window | ✅ pass |
| project comparison summarises durations, demand and overlaps | ✅ pass |

**tests/cpm.test.ts**

| Test | Result |
|---|---|
| CPM on the attached files reproduces P6 early dates and total float for AFS_scheduled.xer | ✅ pass |
| CPM on the attached files computes a CPM baseline for the unscheduled AFS.xer from its data date | ✅ pass |
| CPM on the attached files defaults the deadline to scd_end_date when plan_end_date is empty | ✅ pass |

**tests/integration.test.ts**

| Test | Result |
|---|---|
| full pipeline on both attached XER files imports the demo loading and matches resources across the two files | ✅ pass |
| full pipeline on both attached XER files detects baseline conflicts against pooled capacity | ✅ pass |
| full pipeline on both attached XER files runs all six scenarios | ✅ pass |
| full pipeline on both attached XER files scenario baseline: zero hard-constraint violations, durations unchanged, every relationship satisfied | ✅ pass |
| full pipeline on both attached XER files scenario project_leveling: zero hard-constraint violations, durations unchanged, every relationship satisfied | ✅ pass |
| full pipeline on both attached XER files scenario pooled_original: zero hard-constraint violations, durations unchanged, every relationship satisfied | ✅ pass |
| full pipeline on both attached XER files scenario pooled_float: zero hard-constraint violations, durations unchanged, every relationship satisfied | ✅ pass |
| full pipeline on both attached XER files scenario cost_priority: zero hard-constraint violations, durations unchanged, every relationship satisfied | ✅ pass |
| full pipeline on both attached XER files scenario deadline_priority: zero hard-constraint violations, durations unchanged, every relationship satisfied | ✅ pass |
| full pipeline on both attached XER files leveled pooled scenarios remove the baseline over-allocation | ✅ pass |
| full pipeline on both attached XER files reports a deadline miss honestly when a deadline is infeasible | ✅ pass |
| full pipeline on both attached XER files works on the XER files alone (no resources): scenarios run, nothing to level | ✅ pass |

**tests/matching.test.ts**

| Test | Result |
|---|---|
| resource name normalisation normalises case, punctuation, plurals and synonyms | ✅ pass |
| resource name normalisation strips project suffixes | ✅ pass |
| similarity scoring matches the spec example names | ✅ pass |
| similarity scoring does not match different trades | ✅ pass |
| group suggestion and editing groups matching labour across projects but never across types | ✅ pass |
| group suggestion and editing supports split and merge | ✅ pass |

**tests/objective.test.ts**

| Test | Result |
|---|---|
| objective function Z = αC + βD + γO + δU combines the four components linearly | ✅ pass |
| objective function Z = αC + βD + γO + δU evaluates cost, delay, over-allocation and idle time from a schedule | ✅ pass |
| objective function Z = αC + βD + γO + δU prices hires and flags groups with no cost rate | ✅ pass |
| transfers detects a unit moving from one project to another on the same day | ✅ pass |

**tests/parser.test.ts**

| Test | Result |
|---|---|
| raw XER parser — attached sample files reads every table with correct row counts (AFS.xer) | ✅ pass |
| raw XER parser — attached sample files reads SCHEDOPTIONS in the scheduled file | ✅ pass |
| raw XER parser — attached sample files decodes windows-1252 characters (en dash in WBS name) | ✅ pass |
| raw XER parser — attached sample files builds the model for AFS_scheduled.xer | ✅ pass |
| raw XER parser — attached sample files flags the unscheduled AFS.xer file (no early dates) and missing deadline | ✅ pass |
| raw XER parser — attached sample files merges files and disambiguates duplicate projects | ✅ pass |
| raw XER parser — synthetic fixtures parses multiple projects, resources, rates and all relationship types | ✅ pass |
| raw XER parser — synthetic fixtures reports missing tables instead of throwing | ✅ pass |
| raw XER parser — synthetic fixtures handles empty values and short rows | ✅ pass |
| raw XER parser — synthetic fixtures accepts LF line endings, UTF-8 BOM and a missing end marker | ✅ pass |
| raw XER parser — synthetic fixtures decodes windows-1252 bytes that are invalid UTF-8 | ✅ pass |
| raw XER parser — synthetic fixtures rejects files that are not XER | ✅ pass |
| unit conversions converts hours to working days using day_hr_cnt | ✅ pass |
| unit conversions computes units per day as target_qty / duration hours | ✅ pass |

**tests/report.test.ts**

| Test | Result |
|---|---|
| Excel export contains every sheet with the expected headers, frozen header rows and data | ✅ pass |
| Excel export works before optimisation has run | ✅ pass |
| chat summary is compact, accepted by /api/chat and carries the data flags | ✅ pass |
| chat summary recommends the lowest-Z feasible capacity-respecting scenario | ✅ pass |

**tests/sgs.test.ts**

| Test | Result |
|---|---|
| serial SGS — relationship types with lags FS with lag 2: B starts 2 working days after A finishes | ✅ pass |
| serial SGS — relationship types with lags SS with lag 1: B starts 1 working day after A starts | ✅ pass |
| serial SGS — relationship types with lags FF with lag 1: B finishes 1 working day after A finishes | ✅ pass |
| serial SGS — relationship types with lags SF with lag 3: B finishes no earlier than 3 working days after A starts | ✅ pass |
| serial SGS — relationship types with lags negative lag (lead) on FS | ✅ pass |
| serial SGS — relationship types with lags the validator accepts all of them and catches a manual violation | ✅ pass |
| serial SGS — resources, fixed work and data date never exceeds pooled capacity | ✅ pass |
| serial SGS — resources, fixed work and data date keeps completed activities fixed and in-progress activities at their actual start | ✅ pass |
| serial SGS — resources, fixed work and data date never schedules before the data date | ✅ pass |
| serial SGS — resources, fixed work and data date hires (and reports) units a single activity needs beyond capacity | ✅ pass |
| serial SGS — resources, fixed work and data date within-float window hires instead of delaying a critical activity | ✅ pass |
| serial SGS — randomised property test produces feasible schedules for random multi-project networks | ✅ pass |

**tests/validator.test.ts**

| Test | Result |
|---|---|
| constraint validator accepts a valid schedule | ✅ pass |
| constraint validator catches a shortened duration | ✅ pass |
| constraint validator catches a relationship violation | ✅ pass |
| constraint validator catches a start before the data date | ✅ pass |
| constraint validator catches a moved completed activity | ✅ pass |
| constraint validator catches over-capacity unless the extra units are hired | ✅ pass |

### End-to-end (Playwright, Chromium): 2 passed, 0 failed

| Test | Result |
|---|---|
| workflow.spec.ts › upload → mapping → optimize → recommendations → Excel export → chat | ✅ pass |
| workflow.spec.ts › responsive at tablet width | ✅ pass |

### Build checks

`npm run typecheck`, `npm run lint` and `npm run build` must pass before `npm run report` (they are run first by the script chain).

## 3. Not verifiable in this environment

- Live Gemini calls: there was no API key here, so `/api/chat` is tested with a mocked `fetch` only (valid request, missing key, malformed and oversized input, upstream errors, timeout). Test it after deploying to Vercel (see README).
- `vercel dev` / a real Vercel deployment.
