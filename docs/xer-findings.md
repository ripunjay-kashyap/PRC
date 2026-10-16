# XER Findings — Phase 0 inspection of the sample files

Files inspected (copied unchanged into `samples/` and `public/samples/`):

| File | Bytes encoding | ERMHDR | Export date | Currency |
|---|---|---|---|---|
| `AFS.xer` | windows-1252 (not valid UTF-8: `£`, `€`, `–` bytes) | P6 version 25.12 | 2026-10-16 | INR |
| `AFS_scheduled.xer` | windows-1252 | P6 version 25.12 | 2026-10-16 | INR |

Both files use CRLF line endings, and the `%T / %F / %R / %E` structure is well formed. The parser
(`src/lib/xer/rawParser.ts`) reads them without warnings.

## 1. Tables present (`%T`), fields (`%F`) and row counts

### AFS.xer

| Table | Rows | Fields |
|---|---:|---|
| CURRTYPE | 19 | `curr_id`, `decimal_digit_cnt`, `curr_symbol`, `decimal_symbol`, `digit_group_symbol`, `pos_curr_fmt_type`, `neg_curr_fmt_type`, `curr_type`, `curr_short_name`, `group_digit_cnt`, `base_exch_rate` |
| FINTMPL | 1 | `fintmpl_id`, `fintmpl_name`, `default_flag` |
| OBS | 2 | `obs_id`, `parent_obs_id`, `guid`, `seq_num`, `obs_name`, `obs_descr` |
| PROJECT | 1 | 74 fields, including `proj_id`, `proj_short_name`, `clndr_id`, `priority_num`, `last_recalc_date`, `plan_start_date`, `plan_end_date`, `scd_end_date`, `def_cost_per_qty`, `critical_path_type`, `last_schedule_date` (full list in the appendix) |
| CALENDAR | 1 | `clndr_id`, `default_flag`, `clndr_name`, `proj_id`, `base_clndr_id`, `last_chng_date`, `clndr_type`, `day_hr_cnt`, `week_hr_cnt`, `month_hr_cnt`, `year_hr_cnt`, `rsrc_private`, `clndr_data` |
| PROJWBS | 8 | `wbs_id`, `proj_id`, `obs_id`, `seq_num`, `est_wt`, `proj_node_flag`, `sum_data_flag`, `status_code`, `wbs_short_name`, `wbs_name`, `phase_id`, `parent_wbs_id`, `ev_user_pct`, `ev_etc_user_value`, `orig_cost`, `indep_remain_total_cost`, `ann_dscnt_rate_pct`, `dscnt_period_type`, `indep_remain_work_qty`, `anticip_start_date`, `anticip_end_date`, `ev_compute_type`, `ev_etc_compute_type`, `guid`, `tmpl_guid`, `plan_open_state` |
| TASK | 35 | 61 fields (full list in the appendix) |
| TASKPRED | 45 | `task_pred_id`, `task_id`, `pred_task_id`, `proj_id`, `pred_proj_id`, `pred_type`, `lag_hr_cnt`, `comments`, `float_path`, `aref`, `arls` |

### AFS_scheduled.xer

The same tables with the same fields and row counts as `AFS.xer`, **plus**:

| Table | Rows | Fields |
|---|---:|---|
| SCHEDOPTIONS | 1 | `schedoptions_id`, `proj_id`, `sched_outer_depend_type`, `sched_open_critical_flag`, `sched_lag_early_start_flag`, `sched_retained_logic`, `sched_setplantoforecast`, `sched_float_type`, `sched_calendar_on_relationship_lag`, `sched_use_expect_end_flag`, `sched_progress_override`, `level_float_thrs_cnt`, `level_outer_assign_flag`, `level_outer_assign_priority`, `level_over_alloc_pct`, `level_within_float_flag`, `level_keep_sched_date_flag`, `level_all_rsrc_flag`, `sched_use_project_end_date_for_float`, `enable_multiple_longest_path_calc`, `limit_multiple_longest_path_calc`, `max_multiple_longest_path`, `use_total_float_multiple_longest_paths`, `key_activity_for_multiple_longest_paths`, `LevelPriorityList` |

### Tables that are **not** present in either file

`RSRC`, `TASKRSRC`, `RSRCRATE`, `ROLES`, `RSRCROLE`, `ACTVCODE`, `TASKACTV`, `UDFVALUE`, `PROJCOST`.

## 2. Projects in each file

| File | proj_id | Short name | WBS root name | Data date (`last_recalc_date`) | `plan_start_date` | `plan_end_date` | `scd_end_date` | `priority_num` |
|---|---|---|---|---|---|---|---|---|
| AFS.xer | 4518 | AFS | AFS Tambaram – Plumbing, Sanitary & Building Repairs (2026–27). | 2026-10-16 00:00 | 2026-08-27 | *(empty)* | *(empty)* | 10 |
| AFS_scheduled.xer | 4518 | AFS | (same) | 2026-08-27 00:00 | 2026-08-27 | *(empty)* | 2026-12-24 18:00 | 10 |

**Both files contain the same project** (the same `proj_id` 4518, short name and GUID `Sb/ehFmXbkiRVzOdiO3oEg`).
`AFS.xer` is the unscheduled version and `AFS_scheduled.xer` is the version after an F9 schedule run
(`last_schedule_date` 2026-10-16 03:13). The app keys every project by `file + proj_id`, so both load
as two separate projects named `AFS [AFS]` and `AFS [AFS_scheduled]`. It also shows a warning that
they may be two versions of one project. For the demo this gives two overlapping projects that compete
for one resource pool.

Each project has 35 activities: 1 start milestone (`TT_Mile`), 32 tasks (`TT_Task`) and 2 finish milestones
(`TT_FinMile`). They sit under 7 WBS elements (controls/mobilisation, surveys & access, plumbing,
sunken floors & finishes, roof, metalwork, testing & handover). All 35 are `TK_NotStart`, so neither
file has any actual dates or progress.

## 3. Resource types present

**None.** Neither file has `RSRC`, `TASKRSRC` or `RSRCRATE`, and `TASK.rsrc_id` is empty in every row.
The `target_work_qty`, `remain_work_qty`, `target_equip_qty` and similar fields on TASK are all `0`.
There is no labour, equipment or material loading at all.

## 4. Resource limits (`RSRCRATE.max_qty_per_hr`)

**Not available.** There is no RSRCRATE table, so neither file holds any resource capacity or cost rate.
`PROJECT.def_cost_per_qty` = `0.0000`.

## 5. Calendar data

One calendar per file, identical in both:

* `clndr_id` 6590, "CR Cal", `CA_Base`, default calendar, `day_hr_cnt` = 8, `week_hr_cnt` = 40.
* Workweek parsed from `clndr_data` (P6 numbers days 1 = Sunday … 7 = Saturday):
  * Monday to Friday: 09:00–13:00 and 14:00–18:00 (8 h)
  * Saturday and Sunday: non-working
* 33 holiday exceptions (Excel serial dates). The ones inside the project window are **2026-10-02**
  (Gandhi Jayanti) and **2026-12-25**, then 2027-01-26 and later years. The rest are 2010–2013.
* Verification: in `AFS_scheduled.xer`, every activity's early-start/early-finish span holds exactly
  `remain_drtn_hr_cnt / 8` working days on this calendar, including A220 (40 h, 29 Sep → 6 Oct) which
  spans the 2 Oct holiday. The calendar parser and working-day arithmetic therefore reproduce P6's calendar.

## 6. Relationship types and lags

* 45 relationships per file, **all `PR_FS` with `lag_hr_cnt` = 0**. There are no SS, FF or SF links and
  no lags. (The engine still supports all four types and lags, and the unit tests cover them.)
* All relationships stay within project 4518 (`pred_proj_id` = `proj_id`).
* `AFS_scheduled.xer` SCHEDOPTIONS: `sched_calendar_on_relationship_lag` = `rcal_Predecessor`,
  `sched_float_type` = `FT_FF`, `sched_retained_logic` = Y, `level_within_float_flag` = N,
  `level_over_alloc_pct` = 25.

## 7. Data date and progress status

| | AFS.xer | AFS_scheduled.xer |
|---|---|---|
| Data date | 2026-10-16 | 2026-08-27 |
| Scheduled? | **No.** `early_*`, `late_*` and `total_float_hr_cnt` are empty for every activity. `target_*` dates are stacked on the data date and ignore the logic (e.g. A130 starts 16 Oct although its predecessor A120 finishes 20 Oct). A110's target dates (24–28 Aug) fall before the data date. | **Yes.** Early/late dates and total float are filled in. The early dates satisfy all 45 relationships (checked by the app's validator). The project finishes **2026-12-24 18:00**. |
| Status | 35 × Not Started | 35 × Not Started |
| Constraints | none | M100 has `CS_MSOA` (start on or after) 2026-08-27 |
| Critical path | n/a | A120 → A130 → A160 → A170 → A210 → A220 → A230 → A260 → A270 → A340 → A350 → A360 → A370 → A610 → A620 → A630 → M199 (total float 0) |

## 8. What the optimizer needs that is missing, and how the app handles each gap

| Needed for | Missing in the files | Handling in the app (never silently guessed) |
|---|---|---|
| Resource demand | RSRC, TASKRSRC (no assignments at all) | The **Upload** page flags "No resource data". Assignments can be imported from a CSV (`project, activity_code, resource_name, resource_type, units_per_day, max_units, cost_per_unit_day`). The **Load sample data** button also loads `public/samples/afs-demo-resources.csv`, which is clearly labelled everywhere (UI, Excel *Assumptions* sheet, chat summary) as **illustrative demo loading that does not come from the XER**. |
| Capacity | RSRCRATE `max_qty_per_hr` | Taken from the CSV `max_units` column when provided. Otherwise the user must enter it in **Optimization Settings**; until they do, the group is flagged and excluded from leveling. |
| Costs | RSRCRATE `cost_per_qty`, `def_cost_per_qty` = 0 | User-entered cost per unit-day per resource group (or from the CSV). A group without a rate is excluded from cost totals and listed as "unpriced". A rate of 0 is never assumed. |
| Deadlines | `plan_end_date` empty in both files | The deadline defaults to `plan_end_date`. If that is empty it falls back to `scd_end_date` (AFS_scheduled → 2026-12-24) and is flagged. AFS.xer has neither, so it has **no deadline** until the user sets one; until then no deadline penalty applies, and the UI says so. |
| Baseline dates | AFS.xer is unscheduled (no early dates) | The app runs its own CPM forward/backward pass from the data date and uses those dates as that project's baseline. The project is flagged "not scheduled in P6, baseline computed by CPM". The P6 `target_*` dates are kept for reference only. |
| Total float | Empty in AFS.xer | Computed by the app's CPM backward pass. For AFS_scheduled.xer the computed float matches P6's `total_float_hr_cnt / 8`, and the early and late dates match too, for all 35 activities (see `tests/cpm.test.ts`). |
| Calendars | none missing | Parsed from `clndr_data`. A Mon–Fri 8 h default is applied and flagged only when a calendar can't be read. |
| Transfer / mobilisation costs | not a P6 concept | User settings per resource group (defaults: 0 cost and 0 mobilisation days, visible in Settings). |

## Appendix — full field lists

**PROJECT (74 fields):** `proj_id`, `fy_start_month_num`, `rsrc_self_add_flag`, `allow_complete_flag`, `rsrc_multi_assign_flag`, `checkout_flag`, `project_flag`, `step_complete_flag`, `cost_qty_recalc_flag`, `batch_sum_flag`, `name_sep_char`, `def_complete_pct_type`, `proj_short_name`, `acct_id`, `orig_proj_id`, `source_proj_id`, `base_type_id`, `clndr_id`, `sum_base_proj_id`, `task_code_base`, `task_code_step`, `priority_num`, `wbs_max_sum_level`, `strgy_priority_num`, `last_checksum`, `critical_drtn_hr_cnt`, `def_cost_per_qty`, `last_recalc_date`, `plan_start_date`, `plan_end_date`, `scd_end_date`, `add_date`, `last_tasksum_date`, `fcst_start_date`, `def_duration_type`, `task_code_prefix`, `guid`, `def_qty_type`, `add_by_name`, `web_local_root_path`, `proj_url`, `def_rate_type`, `add_act_remain_flag`, `act_this_per_link_flag`, `def_task_type`, `act_pct_link_flag`, `critical_path_type`, `task_code_prefix_flag`, `def_rollup_dates_flag`, `use_project_baseline_flag`, `rem_target_link_flag`, `reset_planned_flag`, `allow_neg_act_flag`, `sum_assign_level`, `last_fin_dates_id`, `fintmpl_id`, `last_baseline_update_date`, `cr_external_key`, `apply_actuals_date`, `location_id`, `last_schedule_date`, `loaded_scope_level`, `export_flag`, `new_fin_dates_id`, `baselines_to_export`, `baseline_names_to_export`, `next_data_date`, `base_proj_id`, `base_proj_id1`, `base_proj_id2`, `close_period_flag`, `sum_refresh_date`, `trsrcsum_loaded`, `sumtask_loaded`

**TASK (61 fields):** `task_id`, `proj_id`, `wbs_id`, `clndr_id`, `phys_complete_pct`, `rev_fdbk_flag`, `est_wt`, `lock_plan_flag`, `auto_compute_act_flag`, `complete_pct_type`, `task_type`, `duration_type`, `status_code`, `task_code`, `task_name`, `rsrc_id`, `total_float_hr_cnt`, `free_float_hr_cnt`, `remain_drtn_hr_cnt`, `act_work_qty`, `remain_work_qty`, `target_work_qty`, `target_drtn_hr_cnt`, `target_equip_qty`, `act_equip_qty`, `remain_equip_qty`, `cstr_date`, `act_start_date`, `act_end_date`, `late_start_date`, `late_end_date`, `expect_end_date`, `early_start_date`, `early_end_date`, `restart_date`, `reend_date`, `target_start_date`, `target_end_date`, `rem_late_start_date`, `rem_late_end_date`, `cstr_type`, `priority_type`, `suspend_date`, `resume_date`, `float_path`, `float_path_order`, `guid`, `tmpl_guid`, `cstr_date2`, `cstr_type2`, `driving_path_flag`, `act_this_per_work_qty`, `act_this_per_equip_qty`, `external_early_start_date`, `external_late_end_date`, `create_date`, `update_date`, `create_user`, `update_user`, `location_id`, `crt_path_num`

TASK fields that are empty in **every** row:

* AFS.xer: `rsrc_id`, `total_float_hr_cnt`, `free_float_hr_cnt`, `cstr_date`, `act_start_date`, `act_end_date`, `late_start_date`, `late_end_date`, `expect_end_date`, `early_start_date`, `early_end_date`, `rem_late_start_date`, `rem_late_end_date`, `cstr_type`, `suspend_date`, `resume_date`, `float_path`, `float_path_order`, `tmpl_guid`, `cstr_date2`, `cstr_type2`, `external_early_start_date`, `external_late_end_date`, `location_id`, `crt_path_num`
* AFS_scheduled.xer: `rsrc_id`, `act_start_date`, `act_end_date`, `expect_end_date`, `suspend_date`, `resume_date`, `float_path`, `float_path_order`, `tmpl_guid`, `cstr_date2`, `cstr_type2`, `external_early_start_date`, `external_late_end_date`, `location_id`, `crt_path_num`
