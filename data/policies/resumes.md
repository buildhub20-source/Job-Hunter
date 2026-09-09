# Resume Policy — base plus per-employer override

Vinoth tailors his resume per target company rather than keeping fixed variants,
so that is what the selector does: use the employer's own file when one exists,
otherwise fall back to the default.

Files live in `data/resumes/<employer_id>.pdf`. The selector never edits a resume
and never invents experience — it only chooses a file.

| id | rule | value | scope | priority | type | effective_from | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| resume_strategy | selection_strategy | employer_override_then_default | global | 80 | ranking_signal | 2026-09-09 |  |
| resume_default | default_resume | amazon | global | 81 | ranking_signal | 2026-09-09 | used when the employer has no tailored file — leads with Java, drops frontend framing |
| resume_generic | generic_resume | base | global | 82 | ranking_signal | 2026-09-09 | the untargeted original; kept for reference |

## Per-employer files

| id | rule | value | scope | priority | type | effective_from | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| r_amazon | employer_resume | amazon | amazon | 90 | ranking_signal | 2026-09-09 | Java-first, no frontend section |
| r_amex | employer_resume | amex | amex | 90 | ranking_signal | 2026-09-09 |  |
| r_angelone | employer_resume | angelone | angelone | 90 | ranking_signal | 2026-09-09 |  |
| r_barclays | employer_resume | barclays | barclays | 90 | ranking_signal | 2026-09-09 | Java-first |
| r_blueyonder | employer_resume | blueyonder | blueyonder | 90 | ranking_signal | 2026-09-09 | supply chain / logistics angle |
| r_fedex | employer_resume | fedex | fedex | 90 | ranking_signal | 2026-09-09 | logistics angle |
| r_gbt | employer_resume | gbt | gbt | 90 | ranking_signal | 2026-09-09 |  |
| r_p44 | employer_resume | p44 | project44 | 90 | ranking_signal | 2026-09-09 | logistics angle |
| r_paypal | employer_resume | paypal | paypal | 90 | ranking_signal | 2026-09-09 | adds GraphQL and accessibility |
