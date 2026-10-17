# Developer guide

Setup, local development, deployment, testing and code layout. For what the project does and why, see the [README](../README.md).

## Tech stack

Live site: https://prc-coral.vercel.app


React 18 + Vite 6 + TypeScript, Tailwind CSS, Recharts, ExcelJS, Vitest, Playwright, and a Vercel serverless function (`api/chat.ts`, Node.js) for Gemini.

## Setup

Requirements: Node.js 20+ (developed on Node 22) and npm.

```bash
npm install
cp .env.example .env        # optional: only needed for the AI chat; never commit .env
```

`.env` (git-ignored):

```
GEMINI_API_KEY=your-key-from-aistudio.google.com
GEMINI_MODEL=gemini-3.5-flash-lite   # optional, this is the default
```

## Local development

**Option A: `vercel dev` (closest to production, serves `/api/chat` as a real function):**

```bash
npm i -g vercel
vercel link          # once, links the folder to your Vercel project
vercel env pull .env # optional: pulls GEMINI_API_KEY from the Vercel project
vercel dev           # http://localhost:3000
```

**Option B: plain Vite.** `npm run dev` (http://localhost:5173). A small dev-only Vite middleware serves `/api/chat` from `api/chat.ts`, using `GEMINI_API_KEY` from `.env`, so the chat also works here. Without a key the assistant shows "Chat not configured" and everything else works.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck (`tsc -b`) and production build to `dist/` |
| `npm run typecheck` | TypeScript only |
| `npm run lint` | ESLint |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run test:e2e` | Playwright end-to-end test (builds, serves `vite preview`, runs Chromium) |
| `npm run report` | Typecheck, lint, build, all tests, then regenerates `docs/test-report.md` |
| `npm run findings` | Prints the table inventory of the sample XER files used in `docs/xer-findings.md` |

For Playwright on a fresh machine run `npx playwright install chromium` once. `playwright.config.ts` uses `/opt/pw-browsers/chromium` automatically when that path exists.

## Deploying to Vercel

1. Push the repository to GitHub.
2. In the Vercel dashboard choose **Add New → Project** and import the repo. The framework is detected as **Vite**; `vercel.json` sets the build command (`npm run build`), the output (`dist`), the SPA rewrite, and a 30 s limit for `api/chat.ts`.
3. Open **Settings → Environment Variables** and add:
   - `GEMINI_API_KEY`: your Google AI Studio key. Select Production (and Preview if wanted). Never put it in client code or the repo.
   - `GEMINI_MODEL` (optional): the primary model, default `gemini-3.5-flash-lite`.
   - `GEMINI_FALLBACK_MODELS` (optional): comma-separated models tried in order when the primary is rate-limited (429), overloaded (503) or unavailable (403/404). Default `gemini-3.8-flash,gemini-3.6-flash,gemini-3.1-flash-lite`. Each model has its own per-minute quota, so falling back avoids RPM errors. The reply shows which model answered.
4. **Deploy.** If you add or change a variable after the first deployment, go to **Deployments → ⋯ → Redeploy**, because environment variables are read at deploy time.

### Testing the chat after deployment

1. Open the deployed URL, click **Load sample data**, open **Resource Mapping** and click **Confirm mapping**.
2. Open **Scenarios & Recommendations** and click **Run optimization**.
3. Open **AI Assistant** and click a starter question such as *"Which resource is the biggest bottleneck?"*. The answer should quote numbers that appear on the Conflict Analysis page (for example Helper, peak over-allocation 4).
4. Check the guardrails:
   - Ask *"How many cranes do we need next March?"*. The assistant should say the data isn't in the results rather than invent a number.
   - Ask *"Will every project meet its deadline?"*. It should mention that AFS [AFS] has no deadline set and quote the scenario's deadline violations.
5. Check the endpoint directly (it must reject anything other than `{message, history, summary}`):

   ```bash
   # valid
   curl -s -X POST https://<your-app>.vercel.app/api/chat -H 'Content-Type: application/json' \
     -d '{"message":"Summarise the data","history":[],"summary":{"projects":[]}}'
   # rejected (400): extra field
   curl -s -X POST https://<your-app>.vercel.app/api/chat -H 'Content-Type: application/json' \
     -d '{"message":"hi","history":[],"summary":{},"model":"x"}'
   # rejected (405): wrong method
   curl -s https://<your-app>.vercel.app/api/chat
   ```

   If the response is `{"code":"not_configured"}` (HTTP 503), the key isn't set for that environment, or you haven't redeployed since adding it. Function logs are under **Deployments → (deployment) → Functions**.

## Using your own data

- **XER files with resources** (`RSRC`, `TASKRSRC`, `RSRCRATE`) need nothing extra. Capacities come from `RSRCRATE.max_qty_per_hr`, cost rates from `cost_per_qty`, and units per day = `target_qty / activity duration hours`.
- **XER files without resources** (like the samples): import a CSV on the Upload page.

  ```
  project,activity_code,resource_name,resource_type,units_per_day,max_units,cost_per_unit_day
  AFS.xer,A230,Plumber,labor,3,3,1200
  ,A420,Concrete Mixer,equipment,1,1,2500      (blank project = every loaded project)
  ```

  `total_qty` (hours) can replace `units_per_day`. `project` may be a file name, short name or proj_id.

## Assumptions

Decisions not fixed by the brief are listed here. They also appear in the Excel *Assumptions & Missing Data* sheet.

1. **Sample resource data is illustrative.** The two attached XER files contain no `RSRC`, `TASKRSRC` or `RSRCRATE` tables (see `docs/xer-findings.md`). To demonstrate leveling, **Load sample data** also loads `public/samples/afs-demo-resources.csv`. Its crew sizes, capacities and INR cost rates are **invented**, and that is flagged on the Upload page, in the chat summary and in the Excel report. Nothing is silently guessed: without a CSV the app reports that conflicts can't be analysed.
2. **Same project in two files.** Both samples contain project 4518 "AFS" (one unscheduled, one scheduled). Projects are keyed by *file + proj_id*, shown as `AFS [AFS]` and `AFS [AFS_scheduled]`, flagged as possible versions of one project, and analysed as two projects competing for one pool.
3. **Unscheduled P6 projects.** If a project's not-started activities have no early dates (AFS.xer), its baseline is the app's CPM forward pass from the data date, and it is flagged. The setting *Unscheduled P6 projects → P6 target dates* uses the raw target dates instead.
4. **Time unit = working day.** Hour durations are divided by `day_hr_cnt` and rounded up (fractional cases are flagged). Timestamps before 12:00 count from the start of that day. Lags use the successor's calendar.
5. **Deadlines** default to `plan_end_date`, then `scd_end_date` (flagged; AFS_scheduled → 24 Dec 2026), then none. With no deadline no delay penalty applies, and the UI says so.
6. **Pooled capacity** = sum of member capacities. An identical XER resource (same `rsrc_id` and name) found in several files counts once. If any member's capacity is unknown, the group is flagged and not leveled until a capacity is entered.
7. **Cost per unit-day** = `RSRCRATE.cost_per_qty × 8` for XER resources, or the CSV value. Groups without a rate are excluded from cost totals and listed as unpriced. Hire cost defaults to the rate × hire premium (1.5).
8. **Fixed work.** Completed activities keep their actual dates. In-progress activities keep their actual start and run their remaining duration from the data date. Level-of-effort and WBS-summary activities keep their P6 dates and are not leveled.
9. **Transfers** are counted when one project's allocation of a group drops on the same working day another's rises. Cost = units × (transfer cost + mobilisation days × daily rate). Mobilisation is **costed, not modelled as lost capacity**. Within-project leveling (scenario 2) uses dedicated shares, so it has no transfers.
10. **Hiring** is always explicit (dates, units, cost). The *unavoidable* units an activity needs beyond the whole capacity are hired in every leveled scenario; otherwise it could never be scheduled.
11. **Materials** are excluded from leveling by default (toggle in Settings).
12. **Default objective weights** α = 1, β = 10,000 per weighted day late, γ = 5,000 per over-allocated unit-day, δ = 100 per idle unit-day. All are editable.
13. **Recommended scenario** = lowest Z among scenarios that are feasible and enforce capacity.
14. The chat summary is limited to about 28 KB (lists are trimmed) to stay under the server's 30 KB cap.

## Limitations

- The SGS with priority rules and forward-backward improvement is a **heuristic**: it gives good feasible plans but no proven optimum (see `methodology.md`).
- P6 activity constraints (start-on-or-after etc.), resource calendars, resource curves, multiple rates over time, roles and activity-code-based priorities are not modelled. Durations are whole working days.
- Live Gemini responses could not be tested in the development environment (no API key). The endpoint is unit-tested with a mocked `fetch`.
- Browser `localStorage` can hold several MB. Very large portfolios may exceed it, in which case results are recomputed instead of restored.

## Project structure

```
api/chat.ts                    Vercel function: validation, system prompt, Gemini call
src/lib/xer/                   raw XER reader, model builder
src/lib/calendar.ts            P6 calendar parsing and working-day arithmetic
src/lib/resources/             CSV import, name matching and grouping
src/lib/analysis/              daily demand, conflicts, project comparison
src/lib/scheduling/            context, CPM, SGS, justification, validator, objective,
                               transfers, recommendations, scenarios
src/lib/report/excel.ts        ExcelJS workbook
src/lib/chat/summary.ts        compact summary sent to the chat
src/lib/pipeline.ts            analysis / optimisation entry points
src/worker/                    Web Worker for the optimizer
src/pages, src/components, src/charts   UI
tests/                         Vitest unit and integration tests
e2e/                           Playwright end-to-end test
samples/, public/samples/      the two attached XER files (+ demo CSV)
```
