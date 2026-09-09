# Targeting Policy

`hard_gate` rows can eliminate a job on their own, in code, before any LLM call.
`ranking_signal` rows only move a job between tiers. The two must never be merged.

| id | rule | value | scope | priority | type | effective_from | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| exp_max | experience_max_years | 3 | global | 10 | hard_gate | 2026-09-09 | reject if the JD floor is above this |
| exp_min | experience_min_years | 0 | global | 10 | hard_gate | 2026-09-09 |  |
| geo | allowed_countries | India | global | 20 | hard_gate | 2026-09-09 | widen when relocation is decided |
| seniority | blocked_title_words | senior, staff, lead, principal, manager, director, architect | global | 15 | hard_gate | 2026-09-09 | title-level gate |
| jobtype | blocked_job_types | internship, contract, freelance | global | 25 | hard_gate | 2026-09-09 |  |
| titles | target_titles | software engineer, backend engineer, sde, .net developer, software developer, associate software engineer | global | 40 | ranking_signal | 2026-09-09 |  |
| stack_core | preferred_stack | c#, .net, .net core, asp.net, aws, sql server, microservices | global | 45 | ranking_signal | 2026-09-09 | strongest positive signal |
| stack_adjacent | acceptable_stack | java, python, node, typescript, azure, postgres | global | 50 | ranking_signal | 2026-09-09 | tier B at best unless the rest fits |
| ai_bonus | bonus_keywords | llm, ai agent, rag, langchain, semantic kernel | global | 55 | ranking_signal | 2026-09-09 |  |
| remote | preferred_remote_type | hybrid, remote, onsite | global | 60 | ranking_signal | 2026-09-09 | listed in order of preference |
| salary_floor | minimum_ctc | UNKNOWN | global | 30 | hard_gate | 2026-09-09 | inactive while UNKNOWN — never gates on a guess |
