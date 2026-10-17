# P6 Multi-Project Resource Allocator

**Live app:** https://prc-coral.vercel.app (click **Load sample data** to try it)

A web app that reads Primavera P6 schedules from several construction projects. It finds the days when those projects need more crew or equipment than the company actually has, and proposes a revised plan that fixes the clash. Every proposed change respects the schedule logic, keeps activity durations as they are, and states its cost and its effect on each deadline. An AI assistant then explains the plan in plain English.

> **One line:** P6 levels one project at a time. This tool levels **all the company's projects together**, against **one shared pool** of crews and machines.

This README is written for civil engineers, not software engineers. Computer terms are explained in construction language as they come up, and there is a [glossary](#12-glossary-software-words-in-site-language) at the end.

---

## Contents

1. [The problem on site](#1-the-problem-on-site)
2. [What the tool does, in five steps](#2-what-the-tool-does-in-five-steps)
3. [A walk through the eight screens](#3-a-walk-through-the-eight-screens)
4. [How it works, in planning terms](#4-how-it-works-in-planning-terms)
5. [The six strategies it compares](#5-the-six-strategies-it-compares)
6. [Results on the sample project](#6-results-on-the-sample-project)
7. [What we used and why](#7-what-we-used-and-why)
8. [Honesty about the data](#8-honesty-about-the-data)
9. [How we know it is right](#9-how-we-know-it-is-right)
10. [Pitch kit: elevator pitch, demo script, viva questions](#10-pitch-kit)
11. [Limitations and future work](#11-limitations-and-future-work)
12. [Glossary](#12-glossary-software-words-in-site-language)
13. [More documents](#13-more-documents)

---

## 1. The problem on site

A contractor usually runs several projects at once. Each one has its own P6 schedule, built by its own planner. But the **plumbers, masons, helpers, the concrete mixer and the site engineer come from one company pool**.

- P6 schedules and levels **each project separately**. Project A's schedule doesn't know that Project B wants the same five masons in the same week.
- The clash shows up **on site, too late**. Two site managers phone the same foreman, one site sits idle while the other is short, work slips, and someone hires extra labour at short notice at a premium rate.
- Fixing it by hand means comparing resource histograms across files in Excel. That is slow, error-prone, and impossible to redo every time a schedule is updated.

**This project answers three questions a planning manager actually asks:**

1. *Where and when are we short of people or equipment across all our projects?*
2. *What is the best way to share them: shift some activities within their float, move crews between sites, or hire extra?*
3. *What does each option cost, and does any project miss its deadline?*

---

## 2. What the tool does, in five steps

| Step | In site language | What the app does |
|---|---|---|
| **1. Read the schedules** | "Give me the P6 files." | Opens the `.xer` export of each project, the same file you'd send to a client or consultant. It reads activities, durations, logic links, lags, calendars, holidays, progress and resources. |
| **2. Match the resources** | "Your 'Mason' and my 'Masons' are the same people." | Different planners name things differently ("Excavator Operator", "Excavator Driver", "Excavator Operator – Project B"). The app suggests which names are the same trade, and **you confirm**. |
| **3. Find the clashes** | "Show me the combined resource histogram." | Adds up the daily requirement of each trade across all projects and compares it with the available crew. It marks over-loaded days, idle days, and clashes that hit **critical activities**. |
| **4. Fix the clashes** | "Re-plan it so we never need more than we have." | Builds six alternative plans (strategies), each obeying the schedule logic, then scores each on cost, delay, overloading and idle crew. |
| **5. Explain and report** | "Give me the report, and tell me why A510 moved." | Exports a 7-sheet Excel report. An AI assistant answers questions in plain English using **only** the numbers the app calculated. |

---

## 3. A walk through the eight screens

1. **Upload.** Drag in the `.xer` files. Each file gets a "health check": which tables it has, how many activities, and what is missing (for example "no deadline in this file" or "no resource data").
2. **Project Comparison.** Durations, number of activities, critical activities, planned man-days per trade, and a timeline showing **when the projects overlap**, since that is when they fight for resources.
3. **Resource Mapping.** The suggested trade groups. You can rename, merge, split or move a resource, then confirm.
4. **Conflict Analysis.** The combined **resource histogram** for each trade: bars stacked by project, a dashed line for available crew, and red bands on overloaded days. Tables list each overloaded period, its peak shortage, and whether it hits critical work. They also list idle and under-used periods.
5. **Optimization Settings.** Your inputs: crew available per trade, daily rate, deadline and priority of each project, cost of moving a crew between sites (and how many days it takes), the hire rate, and how much weight to give to cost versus delay.
6. **Scenarios & Recommendations.** The six strategies side by side, with a recommended one. For the chosen strategy it shows:
   - **which activities move** (old dates, new dates, how much float they use, and why they moved)
   - **crew transfers** between projects
   - **extra hiring** (dates, numbers, cost)
   - **deadline impact** for each project
   - a **Gantt chart** of original versus new bars, and a constraint check that says "All constraints satisfied" or lists any problem
7. **AI Assistant.** Ask "Which trade is the biggest bottleneck?", "Why was A510 shifted?" or "Will every project meet its deadline?" and get an answer built only from the app's results.
8. **Reports.** Download the Excel workbook: Summary, Projects, Daily Demand vs Capacity, Conflicts, Scenario Comparison, Recommended Changes, and Assumptions & Missing Data.

---

## 4. How it works, in planning terms

You already know every idea used here from planning practice. The app applies them systematically, to many projects at once.

### 4.1 Critical Path Method, exactly as P6 does it

From each project's **data date**, the app runs the CPM forward pass (early start and early finish) and backward pass (late start and late finish), then works out **total float**. It honours:

- all four link types (**FS, SS, FF, SF**) with **lags**
- the P6 **calendar** of each activity (working days, daily hours, holidays such as 2 Oct and 25 Dec)
- **progress**: completed activities stay where they happened; activities in progress keep their actual start
- the **data date**: nothing new is planned in the past

> **Proof it is right:** on the scheduled sample file, the app's early dates, late dates and total float match P6's own figures for **all 35 activities**.

### 4.2 Daily resource demand: the combined histogram

Each activity needs so many people or machines per day. For example, 80 man-hours on a 5-day (40-hour) activity means **2 workers a day**. The app adds this up day by day for each trade, **across all projects**, and compares it with the crew available. Wherever the bar goes above the line, you are short.

### 4.3 Resource leveling across projects: how the re-plan is built

This is the same idea as P6's resource leveling, extended to all projects and one shared pool. Think of a planner with a list of activities and a wall chart:

1. **Rank the activities** by urgency (the *priority rule*). The app tries four common rules:
   - **least total float first**: protect the critical path
   - **latest allowable finish first**: whatever must finish soonest goes first
   - **project priority first**: the more important project gets crews first
   - **original start date first**: keep the existing plan as far as possible
2. **Take the most urgent activity** whose predecessors are already placed, and put it on the **earliest date** when its logic allows it **and** enough crew is free for its whole duration. If the crew isn't free, slide it later, one working day at a time.
3. **Repeat** until every activity is placed. Nothing is ever placed against the logic, and no duration is ever squeezed.
4. **Tidy-up pass.** Push every activity as late as it can go without delaying its project, then pull each back as early as it can go. This often closes gaps and finishes sooner. (In research papers this is called "forward-backward improvement" or "justification".)

The app runs all four rules, with and without the tidy-up, and **keeps the best plan**. In computer-science terms the method is a *serial schedule generation scheme*, the standard textbook way to schedule with limited resources.

### 4.4 Rules that are never broken

| Rule | Meaning |
|---|---|
| Logic | Every FS/SS/FF/SF link and lag holds. |
| Durations | No activity is shortened. 10 days stays 10 working days. |
| Data date | No future work is planned before today's data date. |
| Progress | Finished work stays where it happened. Running work keeps its actual start. |
| Crew limit | No trade is ever over-booked, **unless** a strategy allows hiring, and then every hired worker is listed with dates and cost. |

A separate **checker** re-tests every plan against these rules from scratch and reports any breach. In the sample run every strategy has **0 breaches**.

### 4.5 How a plan is scored

Each plan gets one score, **Z**. Lower is better:

**Z = α × Cost + β × Delay + γ × Overloading + δ × Idle crew**

| Part | What it measures | Site meaning |
|---|---|---|
| **Cost** | crew wages + cost of moving crews between sites + extra hiring | the money |
| **Delay** | working days late against each project's deadline, × project priority | like liquidated damages |
| **Overloading** | worker-days booked above the available crew | the clash that hasn't been resolved |
| **Idle crew** | worker-days paid but not used | wasted capacity |

α, β, γ and δ are **weights you set** on the Settings page, so management can say "a day of delay matters more than ₹10,000" and the recommendation follows that policy.

### 4.6 Moving crews between sites

When one project releases, say, 2 masons on the same day another project needs 2 more, the app counts that as a **transfer**. A transfer can carry a cost (transport, induction) and some **mobilisation days**. You set both in Settings.

---

## 5. The six strategies it compares

All six obey the same rules, so the comparison is fair.

| # | Strategy | Plain meaning | What it shows |
|---|---|---|---|
| 1 | **Baseline** | The original P6 dates, untouched. | How bad the clashes are today. |
| 2 | **Level each project separately** | Each site gets a fixed share of each trade and levels on its own, with no sharing. | How most companies work today. |
| 3 | **Share crews, keep original dates** | Pool the crews, but move nothing; hire whatever is short. | The cost of doing nothing to the plan. |
| 4 | **Share crews, shift within float** | Pool the crews; activities may move **only within their float**, so no project finish date moves. | Usually the best "free" improvement. |
| 5 | **Cost first** | Pool the crews; never hire; delay activities if needed. | The cheapest plan, perhaps late. |
| 6 | **Deadline first** | Pool the crews; hire extra whenever waiting would miss a deadline. | The on-time plan, perhaps at extra cost. |

The app **recommends** the feasible strategy with the lowest score Z.

---

## 6. Results on the sample project

**Inputs:** the two attached P6 files of the *AFS Tambaram plumbing, sanitary and building repairs* project, 35 activities each.

- `AFS_scheduled.xer` is scheduled from 27 Aug 2026 and finishes 24 Dec 2026.
- `AFS.xer` is the same job, unscheduled, with a data date of 16 Oct 2026.

They overlap for about 50 working days, so they compete for the same crews. The crew numbers and rates are demonstration values; see [section 8](#8-honesty-about-the-data).

**Clashes found in the original plan:**

- **Masons:** up to **10 needed against 5 available**, a shortage of 5 at the peak.
- **Helpers:** up to **14 needed against 10**, over-booked on 14 days.
- **Plumbers:** up to **7 needed against 6**.
- Total over-booking: **52 worker-days**, of which **26 days fall on critical activities**.

**The six strategies compared:**

| Strategy | Over-booking left | Extra hiring | Total cost (₹) | Late projects | Activities moved |
|---|---|---|---|---|---|
| 1. Baseline | 52 worker-days (peak 5) | 0 | 12,53,200 *(but the clashes are unresolved)* | 0 | 0 |
| 2. Each project separately | 0 | 16 worker-days | 12,80,200 | **1 project, 20 working days late** | 46 |
| 3. Share crews, keep dates | 0 | 52 worker-days | 13,23,400 | 0 | 0 |
| **4. Share crews, shift within float ★** | **0** | **0** | **12,53,200** | **0** | **13** |
| 5. Cost first | 0 | 0 | 12,53,200 | 0 | 13 |
| 6. Deadline first | 0 | 0 | 12,53,200 | 0 | 13 |

**What this means:**

- **Sharing crews and using float removes every clash at no extra cost, with no project finishing later.** Only 13 non-critical activities move (for example roof works A410–A440 and metalwork A510–A520), and each stays within its float.
- **Running each project separately is the worst option.** It makes one project **20 working days late** and still needs hired labour, because a single activity can need more tilers or painters than that site's fixed share.
- **Keeping the dates and hiring** costs about **₹70,000 more** for the same outcome.
- With these crew numbers there is enough float to absorb everything, so strategies 5 and 6 reach the same plan as 4. With tighter crews or deadlines they would diverge, and the app shows by how much.
- All six plans were worked out in about **0.15 seconds** in the browser.

---

## 7. What we used and why

| What | Why it was chosen (plain reason) |
|---|---|
| **Primavera P6 `.xer` files as input** | The industry standard. Planners don't have to re-enter anything; they export what they already have. |
| **A web app that runs in the browser** | Nothing to install: open a link on a laptop or tablet. The schedules are processed **on your own computer**, so project data isn't uploaded anywhere. |
| **Calculation code written by us (TypeScript)** | Every date, shortage and cost comes from fixed, repeatable rules (CPM, histograms, leveling). The same input always gives the same answer, which matters for an engineering decision and for examination. |
| **Background calculation** | The re-planning runs in the background so the screen never freezes, even with large schedules. |
| **Charts (histogram, Gantt, comparison bars)** | Planners read resource histograms and Gantt charts every day, so the results are shown in the form they already trust. |
| **Excel export** | The format managers, clients and consultants actually use. Overloaded cells are highlighted in red. |
| **Google Gemini (AI) as the "explainer" only** | AI can sometimes make up numbers. So the AI is **never allowed to calculate or decide**: it only receives the finished results and is told to use only those numbers and to say "not available" otherwise. Think of a junior engineer who reads the planning report back to the client in simple words. |
| **Vercel hosting** | Free, reliable hosting. The AI key is kept on the server, never in the browser. If one AI model is busy, it automatically tries the next. |

---

## 8. Honesty about the data

- **The sample P6 files contain no resource information.** They have no resource list, no resource assignments and no rates. They also have no planned finish date. This is documented in [`docs/xer-findings.md`](docs/xer-findings.md).
- To demonstrate the method, **Load sample data** adds a small **demonstration crew file**: crew sizes per activity, available crew, and daily rates (₹700/day for a helper, ₹1,100 for a mason, and so on). **These numbers are invented.** The app shows a banner saying so, and the Excel report repeats it.
- With real data (P6 files that contain resources, or a simple CSV of who works on which activity), the same tool gives real answers. Nothing else changes.
- **Missing data is never guessed.** If a trade has no capacity, the app flags it and won't level it until you enter one. If a project has no deadline, it says "no deadline set" and won't claim the project is on time.

---

## 9. How we know it is right

- **The CPM matches P6.** Early dates, late dates and total float agree with P6 for all 35 activities of the scheduled file.
- **Hand-checkable test cases.** For example: three projects need 2 + 2 + 1 excavators on the same days, 3 are available, and the app reports a **shortage of 2**.
- **Every link type is tested** (FS, SS, FF, SF, with lags and negative lags), along with holidays, finished work, work in progress and the data date.
- **Stress test:** 25 randomly generated multi-project networks, under every strategy and rule, give **zero rule breaches**.
- **The checker catches deliberate mistakes:** a shortened duration, a broken link, a start before the data date, a moved finished activity, or over-booking.
- **97 automated checks** pass, plus a full "click through the whole app" test in a real browser. See [`docs/test-report.md`](docs/test-report.md).

---

## 10. Pitch kit

### 30-second elevator pitch

> "Construction companies run several projects at once, but each P6 schedule is planned in isolation, so the same masons and plumbers get booked twice and the clash is found on site. My tool reads the P6 files of all the projects, builds one combined resource histogram, finds every shortage, and re-plans the work with the same CPM logic P6 uses. It compares six strategies on cost and delay. On our sample, sharing crews within float removed all 52 worker-days of over-booking at zero extra cost, with no project finishing late. An AI assistant then explains the plan in plain English, but it never makes up the numbers."

### 2-minute version: talking points

1. **The gap.** P6 levels one project at a time. Companies share crews across projects, and nobody plans the shared pool.
2. **The idea.** Treat all projects as one portfolio with one pool of crews, and re-plan using float, crew transfers or hiring, choosing by cost and deadline.
3. **The method.** Standard CPM, plus a combined resource histogram, plus priority-rule resource leveling (the textbook method), with a tidy-up pass. All schedule rules are enforced and checked independently.
4. **The result.** Six strategies compared on one screen. On the sample, the "share and shift within float" plan removes all clashes for free; "each site on its own" makes a project 20 days late.
5. **The safeguard.** AI is used only to explain, never to calculate, so every number is traceable.
6. **The practical value.** It works from the P6 files the industry already uses, runs in a browser, and exports to Excel.

### Live demo script (about 5 minutes)

| Click | Say |
|---|---|
| Open the site → **Load sample data** | "These are two real P6 exports of a repair project. The app has read the activities, logic, calendar and holidays." |
| **Upload** page: point at the file cards | "It checks each file and tells me honestly what's missing. Here there's no resource data and no planned finish, so we loaded clearly labelled demo crew numbers." |
| **Project Comparison** → timeline | "The two projects overlap for about 50 working days. That is where they fight for crews." |
| **Resource Mapping** → **Confirm mapping** | "'Masons' in one file and 'Mason' in the other are the same trade. The app suggests the match; the planner confirms it." |
| **Conflict Analysis** → choose **Mason** | "Combined histogram: the dashed line is the 5 masons we have; the red bands are the days we'd need up to 10. Several of those days hit critical activities." |
| **Optimization Settings** | "Here management sets crew limits, daily rates, deadlines, project priority, transfer cost and how much delay matters versus cost." |
| **Scenarios** → **Run optimization** | "Six strategies in a fraction of a second. Each one passes the rule check. Strategy 4 is recommended: zero clashes, zero hiring, no project late." |
| Scroll to **Activity shifts** | "Only 13 activities move, all within their float, and each has a reason, like 'waits for Mason'." |
| **Gantt** tab | "Grey is the original bar, colour is the new one." |
| **AI Assistant** → "Which resource is the biggest bottleneck?" | "The AI answers from our numbers. If I ask about cranes, which aren't in the data, it says so instead of inventing something." |
| **Reports** → **Download Excel** | "The full report, ready for the client or management." |

### Questions you may be asked, with answers

**Isn't this just P6 resource leveling?**
No. P6 levels **within one project** against that project's resources. This levels **across all projects** against one shared company pool. It also compares strategies (float, transfers, hiring) on cost and deadline, and reports transfers and hiring explicitly.

**Is the plan optimal?**
It is a **good, rule-compliant plan, not a mathematically proven best**. Exact optimisation of this kind of problem becomes impractically slow for real project sizes. That's why industry tools, P6 included, also use priority-rule methods. We improve on a single run by trying four rules plus a tidy-up pass and keeping the best.

**How do you make sure the AI doesn't give wrong numbers?**
The AI never calculates. It receives only the finished results, is instructed to use only those numbers, and must say "not available" otherwise. Every number on screen comes from the calculation engine and can be checked in the Excel report.

**Where did the crew numbers come from?**
The sample P6 files have no resources, so the crew sizes and rates are demonstration values, clearly labelled everywhere. With a company's real resource data, the same tool gives real results.

**How do you know the CPM is correct?**
On the scheduled file, our early dates, late dates and total float match P6's for every activity. 97 automated checks cover links, lags, calendars, progress and capacity.

**What if a deadline simply can't be met?**
The app works out the **minimum unavoidable delay** from the logic alone and reports it. It never claims a deadline is met when it isn't.

**Can it handle more than two projects, or bigger schedules?**
Yes. Any number of P6 files and projects can be loaded, and the calculation runs in the background.

**What does it cost to use?**
Nothing to install. It runs in a browser; only the optional AI assistant uses a Google key.

---

## 11. Limitations and future work

**Current limitations (be upfront about these):**

- **Heuristic method.** It finds good plans, not guaranteed-best ones.
- **Whole days.** Durations are counted in whole working days; half-days are rounded up.
- **Not yet modelled:** P6 activity constraints (such as "start on or after"), separate resource calendars, crews that change size over time, and skill substitution (for example a mason doing a helper's work).
- **Mobilisation** is counted as a cost, not as days the crew is unavailable.
- **Matching is a suggestion.** Resource names are matched by spelling; a planner must confirm.
- **Demo data.** The sample's crew data is illustrative (see section 8).

**Future work:**

- Read P6 constraints and resource calendars.
- Compare against an exact optimiser on small projects to measure how close the heuristic gets.
- Add skill substitution and crews that vary over time.
- Write the chosen plan back to a new P6 file (the originals are never modified).
- Run trials with real multi-project data from a contractor.

---

## 12. Glossary: software words in site language

| Word | Meaning here |
|---|---|
| **XER file** | The text file P6 exports (File → Export). It contains activities, links, calendars and resources. |
| **Resource group / pool** | One trade or machine shared across all projects, e.g. "Mason" (5 available). |
| **Capacity** | How many of that trade or machine are available per day. |
| **Demand** | How many are needed on a given day, added across all projects. |
| **Over-allocation / shortage** | Demand above capacity: the bar above the dashed line. |
| **Worker-day (unit-day)** | One worker (or machine) for one working day. |
| **Utilisation** | Share of available worker-days actually used. |
| **Scenario / strategy** | One complete alternative plan, built under one policy. |
| **Priority rule** | The rule for ranking which activity gets crews first (least float, latest finish, project priority, original start). |
| **Serial schedule generation scheme (SGS)** | The textbook name for "place activities one by one, earliest date with logic and crew available". |
| **Justification / forward-backward improvement** | The tidy-up pass: push activities late, then pull them early, to close gaps. |
| **Objective / score Z** | The single number that combines cost, delay, overloading and idle crew. Lower is better. |
| **Constraint validator** | The independent checker that re-tests every plan against the rules. |
| **Transfer** | Crew released by one project and taken up by another on the same day. |
| **Hiring** | Extra workers beyond the pool, with dates and cost reported. |
| **Web app** | A program that runs in an internet browser; nothing to install. |
| **AI assistant / LLM (Gemini)** | Google's text AI, used here only to explain results in plain language. |
| **Deterministic** | Same input, same answer, every time: no randomness and no guessing. |

---

## 13. More documents

| Document | For |
|---|---|
| [`docs/methodology.md`](docs/methodology.md) | The formal method: mathematical formulation, algorithm, scenarios, metrics, references. Use it for the report or thesis chapter. |
| [`docs/xer-findings.md`](docs/xer-findings.md) | What the sample P6 files contain and what is missing. |
| [`docs/test-report.md`](docs/test-report.md) | Full results per strategy and every automated check, with pass/fail. |
| [`docs/developer-guide.md`](docs/developer-guide.md) | Installing, running, deploying to Vercel, setting the AI key, code layout and technical assumptions. |
