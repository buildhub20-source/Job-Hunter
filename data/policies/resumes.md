# Resume Variants

Variants must use verified content only. A variant never invents experience.
Put the actual files in `data/resumes/` and record the version here.

| id | rule | value | scope | priority | type | effective_from | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| var_dotnet | resume_variant | dotnet-backend | global | 80 | ranking_signal | 2026-09-09 | default for C#/.NET roles |
| var_cloud | resume_variant | platform-cloud | global | 81 | ranking_signal | 2026-09-09 | AWS / microservices heavy JDs |
| var_ai | resume_variant | ai-agents | global | 82 | ranking_signal | 2026-09-09 | LLM / agent roles |
| var_default | default_variant | dotnet-backend | global | 83 | ranking_signal | 2026-09-09 | used when the evaluator is unsure |
