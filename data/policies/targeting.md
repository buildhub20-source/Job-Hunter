# Targeting Policy

Subject: Vinoth M. `hard_gate` rows eliminate a job in code before any model call.
`ranking_signal` rows only move a job between tiers. The two must never be merged.

| id | rule | value | scope | priority | type | effective_from | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| exp_max | experience_max_years | 3 | global | 10 | hard_gate | 2026-09-09 | reject if the JD floor is above this; he is at 2.2 |
| exp_min | experience_min_years | 0 | global | 10 | hard_gate | 2026-09-09 |  |
| geo | allowed_countries | India | global | 20 | hard_gate | 2026-09-09 | location is open within India; see geo_remote before widening abroad |
| geo_remote | allow_remote_anywhere | true | global | 21 | hard_gate | 2026-09-09 | remote roles hiring India-based candidates are eligible regardless of company country |
| seniority | blocked_title_words | senior, staff, lead, principal, manager, director, architect | global | 15 | hard_gate | 2026-09-09 |  |
| jobtype | blocked_job_types | internship, contract, freelance | global | 25 | hard_gate | 2026-09-09 |  |
| salary_floor | minimum_ctc | 600000 | global | 30 | hard_gate | 2026-09-09 | ACTIVE — skips roles disclosing below 6L; floor equals expectation, so no room below |
| titles | target_titles | software engineer, backend engineer, sde, software development engineer, java developer, .net developer, software developer, associate software engineer, full stack developer | global | 40 | ranking_signal | 2026-09-09 |  |
| stack_dotnet | preferred_stack | c#, .net, .net core, asp.net, aws | global | 45 | ranking_signal | 2026-09-09 | equal weight with the three below |
| stack_java | preferred_stack | java, spring boot, maven, hibernate | global | 45 | ranking_signal | 2026-09-09 | equal weight |
| stack_node | preferred_stack | node.js, express, react, redux, typescript | global | 45 | ranking_signal | 2026-09-09 | equal weight |
| stack_ai | preferred_stack | llm, rag, ai agent, azure openai, pgvector, embeddings, vector search | global | 45 | ranking_signal | 2026-09-09 | equal weight |
| stack_adjacent | acceptable_stack | python, azure, postgresql, sql server, mysql, docker, microservices | global | 50 | ranking_signal | 2026-09-09 |  |
| remote | preferred_remote_type | remote, hybrid, onsite | global | 60 | ranking_signal | 2026-09-09 | no preference stated — all three acceptable, listed order is a tie-break only |
| company_type | allowed_company_types | product, service, startup, mnc | global | 65 | ranking_signal | 2026-09-09 | no filter on company type or size |
