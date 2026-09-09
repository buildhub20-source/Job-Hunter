# Exclusions and Caps

| id | rule | value | scope | priority | type | effective_from | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| excl_companies | excluded_companies |  | global | 5 | hard_gate | 2026-09-09 | comma-separated canonical employer ids |
| excl_staffing | excluded_company_kinds | staffing, consultancy_bench | global | 6 | hard_gate | 2026-09-09 |  |
| cap_daily | max_applications_per_day | 15 | global | 70 | ranking_signal | 2026-09-09 | orchestrator gives scarce slots to A tier first |
| cap_company | max_open_applications_per_company | 3 | global | 71 | ranking_signal | 2026-09-09 | different requisitions still count separately |
| cooldown | reapply_cooldown_days | 90 | global | 72 | ranking_signal | 2026-09-09 | same company, same family, new requisition |
