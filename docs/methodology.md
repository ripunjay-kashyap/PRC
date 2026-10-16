# Methodology

This chapter describes the computational method behind the app: how P6 data is turned into a scheduling model, how the multi-project resource-allocation problem is formulated, the heuristic used to solve it, the scenarios compared and the metrics reported. The code locations are given so every statement can be checked against the implementation.

## 1. Data model

Each XER file is parsed (`src/lib/xer/`) into projects $P$, activities $J$, precedence relations $E$, resources, assignments and calendars. Projects and activities are keyed by *file + P6 id*, so the same project exported twice stays two distinct projects.

| Symbol | Meaning | Source |
|---|---|---|
| $p(j)$ | project of activity $j$ | `TASK.proj_id` |
| $d_j$ | remaining duration in working days | $\lceil$`remain_drtn_hr_cnt` / `day_hr_cnt`$\rceil$ |
| $\mathcal{C}_j$ | working calendar of $j$ | `CALENDAR.clndr_data` (workweek + holiday exceptions) |
| $DD_{p}$ | data date of project $p$ | `PROJECT.last_recalc_date` |
| $(i,j,\tau,\ell)\in E$ | relation of type $\tau\in\{FS,SS,FF,SF\}$ with lag $\ell$ working days | `TASKPRED` |
| $k \in K$ | pooled resource group | confirmed resource mapping |
| $r_{jk}$ | units of group $k$ used per working day by $j$ | `target_qty / duration_hours` (TASKRSRC or CSV) |
| $R_k$ | capacity of group $k$ (units/day) | `RSRCRATE.max_qty_per_hr`, CSV or user |
| $c_k$ | cost per unit-day of $k$ | `RSRCRATE.cost_per_qty` × 8, CSV or user |
| $D_p$ | deadline of project $p$ | `plan_end_date` → `scd_end_date` → user |
| $w_p$ | project priority weight | user (default 1) |

Time is discrete: one period is a calendar day. An activity starting at $S_j$ works on the days $t\in[S_j, F_j)$ with $\mathcal C_j(t)=1$ (a working day), and $F_j=\phi_j(S_j)$ is the boundary after its $d_j$-th working day. Milestones have $F_j=S_j$.

$J^{fix}\subseteq J$ are completed activities (fixed at their actual dates), in-progress activities (actual start kept, remaining duration from the data date), and level-of-effort and WBS-summary activities (P6 dates kept).

## 2. Problem formulation

### Decision variables

* $S_j\in\mathbb Z$: start of each not-started activity $j\in J\setminus J^{fix}$ (its finish $F_j=\phi_j(S_j)$ follows from it)
* $h_{kt}\ge 0$: extra units of group $k$ hired on day $t$, allowed only in scenarios that permit hiring

### Hard constraints

1. **Precedence with lags (all four P6 types).** With $\sigma_\ell^{\mathcal C}(b)$ shifting a boundary $b$ by $\ell$ working days on calendar $\mathcal C$ (the successor's):

$$
\begin{aligned}
FS:&\; S_j \ge \sigma_\ell(F_i) &\qquad SS:&\; S_j \ge \sigma_\ell(S_i)\\
FF:&\; F_j \ge \sigma_\ell(F_i) &\qquad SF:&\; F_j \ge \sigma_\ell(S_i)
\end{aligned}
\qquad \forall (i,j,\tau,\ell)\in E
$$

2. **Fixed durations.** $\bigl|\{t\in[S_j,F_j):\mathcal C_j(t)=1\}\bigr| = d_j$, and work starts and ends on working days. Durations are never compressed.
3. **Data date.** $S_j \ge DD_{p(j)}$ for every not-started activity.
4. **Fixed work.** $S_j=S_j^{actual}$ for $j\in J^{fix}$ (and $F_j=F_j^{actual}$ when completed).
5. **Pooled capacity.** For every leveled group $k$ and day $t$:

$$
u_{kt} \;=\; \sum_{j:\;t\in[S_j,F_j),\;\mathcal C_j(t)=1,\;t\ge DD_{p(j)}} r_{jk} \;\le\; R_k + h_{kt}
$$

   with $h_{kt}=0$ in scenarios that do not allow hiring, apart from *unavoidable* hires (§4.3).

In plain language, the plan must respect the logic and lags, keep every duration, start nothing before the data date, leave work already done or under way where it is, and use no more of any pooled resource on any day than is available plus any units explicitly hired.

### Objective

$$
\min Z = \alpha\,C + \beta\,D + \gamma\,O + \delta\,U
$$

| Term | Definition |
|---|---|
| $C$ (cost) | $\sum_{k,t} c_k\,u_{kt}$ (resource cost) $+ \sum_{\text{transfers}} q\,(c^{tr}_k + m_k c_k)$ $+ \sum_{k,t} c^{hire}_k h_{kt}$ |
| $D$ (delay) | $\sum_p w_p \max\bigl(0, \text{workdays}(D_p, F_p)\bigr)$, with $F_p=\max_{j:p(j)=p}F_j$ |
| $O$ (over-allocation) | $\sum_{k,t}\max(0, u_{kt}-R_k-h_{kt})$ (unit-days not covered by capacity or hires) |
| $U$ (under-utilisation) | $\sum_{k}\sum_{t\in W_k}\max(0, R_k-u_{kt})$ (idle unit-days inside the group's active window $W_k$) |

Here $c^{tr}_k$ is the transfer cost per unit, $m_k$ the mobilisation days, $c^{hire}_k$ the hire rate (default $1.5\,c_k$), and $q$ the units moved. The weights $\alpha,\beta,\gamma,\delta$ are set by the user (defaults 1; 10 000 per weighted day late; 5 000 per over-allocated unit-day; 100 per idle unit-day). $O$ is zero for every plan that satisfies constraint 5, so it only distinguishes the un-leveled reference scenarios.

**Transfer rule.** On working day $t$, let $\Delta_{pk}=u_{pkt}-u_{pk,t-1}$ be the change in project $p$'s use of $k$. Then $q_{kt}=\min\bigl(\sum_p \max(0,-\Delta_{pk}), \sum_p\max(0,\Delta_{pk})\bigr)$ units transfer, paired greedily from the largest drop to the largest rise (`src/lib/scheduling/transfers.ts`). Mobilisation is costed rather than modelled as lost capacity, which is a stated simplification.

This is a multi-project resource-constrained project scheduling problem (RCMPSP) with generalised minimum time lags, calendars and optional resource augmentation. The RCPSP is strongly NP-hard (Blazewicz et al., 1983), so a constructive heuristic is used.

## 3. Pre-processing: CPM

`src/lib/scheduling/cpm.ts` runs a calendar-aware forward pass in topological order (logic loops are detected and reported) to get the earliest start/finish $ES_j, EF_j$, and the logic-only finish of each project $EF_p$. A backward pass from $\min(EF_p, D_p)$ gives $LS_j, LF_j$ and the total float $TF_j=\text{workdays}(ES_j, LS_j)$, which is negative when a deadline is earlier than the logic allows. A second backward pass from $D_p$ alone gives the latest start that still meets the deadline, $LS^{D}_j$.

**Validation of the CPM.** On `AFS_scheduled.xer` the computed ES, EF, LS and total float equal P6's values for all 35 activities, including the 2 Oct holiday (`tests/cpm.test.ts`). For the unscheduled `AFS.xer` the CPM dates become the baseline (flagged).

The **minimum unavoidable delay** of project $p$ is $\max(0, \text{workdays}(D_p, EF_p))$: no resource decision can beat the logic. It is reported whenever a deadline is infeasible, so the app never claims a deadline is met when it is not.

## 4. Serial schedule generation scheme

### 4.1 Algorithm (`src/lib/scheduling/sgs.ts`)

```
place all fixed activities; add their usage to the resource profile
eligible ← not-started activities whose predecessors are all placed
while activities remain:
    j ← eligible activity with the best priority value (ties: topological order)
    ES ← earliest start allowed by placed predecessors (FS/SS/FF/SF + lags) and the data date
    S_j ← FINDSLOT(j, ES)            (see 4.3)
    record hires needed at S_j; add r_jk to the profile on j's working days
    add successors whose predecessors are now all placed to eligible
```

Each activity is placed only after all its predecessors, and every P6 relation is a minimum time lag (“successor ≥ predecessor + lag”). Placing an activity at or after its earliest start therefore never violates a relation, and later placements cannot invalidate earlier ones. Every schedule the SGS produces is time-feasible by construction (Kolisch, 1996).

### 4.2 Priority rules

Lower value is scheduled first. The rules are standard in the RCPSP literature (Kolisch, 1996; Kurtulus & Davis, 1982 for the multi-project case):

| Rule | Priority value |
|---|---|
| MIN_TF: minimum total float | $TF_j$, then $LF_j$ |
| LFT: latest finish time | $LF_j$, then $TF_j$ |
| PROJECT_WEIGHT: project priority | $-w_{p(j)}$, then $LF_j$ |
| EST: earliest original start | baseline $S_j$, then $TF_j$ |

### 4.3 Slot search and hiring (FINDSLOT)

Let $A_k=\max(0, r_{jk}-R_k)$ be the *unavoidable* extra units: an activity that alone needs more than the whole pool could never be scheduled, so these units are always hired and reported. Let the latest desired start be
$\bar S_j=\infty$ (no window), $\max(ES_j, LS_j)$ (*within float*) or $\max(ES_j, LS^{D}_j)$ (*meet deadline*).

1. Scan $t=ES, ES+1,\dots,\bar S_j$ over valid starts and take the first $t$ where $u_{kt'}+r_{jk}\le R_k+h_{kt'}+A_k$ for all $k$ and all working days $t'$ of $j$.
2. If none is found and the scenario hires to hold the window, choose $t\in[ES,\bar S_j]$ that minimises (largest daily shortage, total shortage, $t$), subject to the per-group hire limit, and hire the shortage.
3. Otherwise delay beyond $\bar S_j$ until the activity fits.

### 4.4 Forward-backward improvement (justification)

After the SGS, `justify()` applies one double-justification pass (Valls, Ballestín & Quintanilla, 2005):

* **Right pass.** Activities are taken in decreasing finish order. Each is moved to its latest start that keeps every successor relation, fits the current resource profile (hires frozen) and does not move its project's finish.
* **Left pass.** Activities are taken in increasing start order. Each is moved to its earliest start that fits.

Every move keeps the plan logic- and resource-feasible relative to the other activities' positions. Hired units that become unnecessary are trimmed afterwards. The justified plan replaces the SGS plan only if it ranks no worse (by $Z$, or by the scenario's ranking key).

### 4.5 Selecting the plan

For each scenario the SGS runs with all four rules, each with and without justification (8 candidates). Candidates are compared lexicographically: first by the number of hard-constraint violations found by the independent validator, then by the scenario's key (§5). The best is kept and the candidate list is reported.

## 5. Scenarios (`src/lib/scheduling/scenarios.ts`)

All six are checked by the same validator against the same hard constraints.

| # | Scenario | Capacity | Moves allowed | Hiring | Ranking key |
|---|---|---|---|---|---|
| 1 | **Baseline**: original P6 dates (CPM for unscheduled files) | reported, not enforced | none | none | — |
| 2 | **Leveling within each project** | each project limited to its share $R_{kp}$ (user-editable; default proportional to baseline demand, integer largest remainder) | unlimited delay | unavoidable only | $Z$ |
| 3 | **Pooled resources, original dates** | pooled | none | every shortage $\max(0,u_{kt}-R_k)$ | — |
| 4 | **Pooled, flexible within float** | pooled | $S_j\le \max(ES_j, LS_j)$ (no project end moves) | to stay within float | $Z$ |
| 5 | **Cost priority** | pooled | unlimited delay | unavoidable only | $(C, Z)$ |
| 6 | **Deadline priority** | pooled | delay up to $LS^{D}_j$, then hire | to meet deadlines (up to the hire limit) | $(D, Z)$ |

The *recommended* scenario is the one with the lowest $Z$ among those that enforce capacity and pass validation.

## 6. Constraint validator (`src/lib/scheduling/validator.ts`)

The validator is a standalone function. It re-derives everything from the activity dates alone, independently of the optimiser, and lists each violation:

* every relation (type and lag) holds;
* every not-started activity spans exactly $d_j$ working days and starts and ends on working days; milestones have zero span;
* $S_j\ge DD_{p(j)}$;
* fixed activities are where they must be;
* daily usage of every leveled group is at most $R_k+h_{kt}$ (in the scenarios that enforce capacity), with hires non-negative.

The tests feed it deliberately broken schedules (shortened duration, broken FS link, start before the data date, moved completed activity, over-capacity without hires, negative hire) and check that each is caught (`tests/validator.test.ts`). They also run 25 random multi-project networks through every rule, window and scenario and require zero violations (`tests/sgs.test.ts`).

## 7. Evaluation metrics (per scenario)

| Metric | Definition |
|---|---|
| Peak over-allocation | $\max_{k,t}\max(0,u_{kt}-R_k-h_{kt})$ |
| Peak shortage | $\max_{k,t}(u_{kt}-R_k)$ before hiring |
| Average utilisation % | mean over groups of $\sum_{t\in W_k}\min(u_{kt},R_k)\,/\,(R_k|W_k|)$ |
| Total resource cost | $\sum c_k u_{kt}$ (groups with a rate; unpriced groups listed) |
| Transfer cost, count | §2 transfer rule |
| Hired unit-days, hire cost | $\sum h_{kt}$, $\sum c^{hire}_k h_{kt}$ |
| Duration of each project | working days from the earliest start to the finish |
| Deadline violations | count of projects with $F_p > D_p$ and the working days late |
| Idle resource-days | $U$ |
| Optimiser runtime | wall-clock milliseconds for all candidates of the scenario |
| Constraint violations | validator count (0 = feasible) |
| Objective $Z$ | §2 |

Conflict analysis also reports over-allocated periods with their peak excess, idle and under-utilised periods (utilisation below a threshold, default 50 %), and days on which an over-allocation involves an activity with $TF\le 0$ (a critical conflict).

## 8. Role of the language model

Gemini (`api/chat.ts`) receives a server-side system prompt and a JSON summary of at most 30 KB. The summary holds projects, conflicts, scenario metrics, top recommendations and data-quality flags, all produced by the deterministic code. The prompt tells the model to use only those numbers, to say when data is missing and never to compute or invent allocations. The endpoint accepts only `{message, history, summary}`, keeps the last 10 turns and rejects anything else, so it cannot be used as an open proxy. The model therefore acts as an explanation layer and not a decision maker, which keeps every figure reproducible and auditable.

## 9. Limitations

* **Heuristic, not optimal.** The serial SGS with priority rules and one forward-backward pass gives good feasible plans quickly (about 150 ms for six scenarios on the sample portfolio). It gives no optimality guarantee and no bound on the gap to the optimum. An exact MILP or CP model, or a metaheuristic (genetic algorithm, simulated annealing, iterated justification), could be added and compared using the same validator and metrics.
* Discrete whole-day periods: half-day durations are rounded up and P6 timestamps are rounded to day boundaries.
* Not modelled: P6 activity constraints (e.g. start-on-or-after), resource calendars, non-uniform resource curves, time-varying rates or capacities, roles, and P6's own leveling priority lists. Lags are counted on the successor's calendar (P6 offers several options).
* Mobilisation time is costed, not removed from capacity. Transfers are inferred from allocation changes, not decided explicitly.
* In-progress activities are fixed (actual start plus remaining duration from the data date), and their remaining work is not leveled.
* The pooled capacity is constant over time.
* Resource matching is a suggestion based on names; the planner must confirm it.
* The sample XER files contain no resource data, so the demonstration relies on an illustrative CSV. The numbers in `docs/test-report.md` show how the method behaves; they are not findings about the AFS project.

## References

* Blazewicz, J., Lenstra, J. K., & Rinnooy Kan, A. H. G. (1983). Scheduling subject to resource constraints: classification and complexity. *Discrete Applied Mathematics*, 5(1), 11–24.
* Kolisch, R. (1996). Serial and parallel resource-constrained project scheduling methods revisited: Theory and computation. *European Journal of Operational Research*, 90(2), 320–333.
* Kurtulus, I. S., & Davis, E. W. (1982). Multi-project scheduling: Categorization of heuristic rules performance. *Management Science*, 28(2), 161–172.
* Valls, V., Ballestín, F., & Quintanilla, S. (2005). Justification and RCPSP: A technique that pays. *European Journal of Operational Research*, 165(2), 375–386.
* Hartmann, S., & Briskorn, D. (2010). A survey of variants and extensions of the resource-constrained project scheduling problem. *European Journal of Operational Research*, 207(1), 1–14.
