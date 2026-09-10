# Board Registry

Every company whose ATS we poll. Add a line, no code change.

**Finding the tenant:** it's the slug in the company's public board URL.
`boards.greenhouse.io/`**`stripe`** → tenant `stripe`.
`jobs.lever.co/`**`netflix`** → tenant `netflix`.

**Verified 2026-09-10** by probing the real Greenhouse/Lever public APIs directly
(`boards-api.greenhouse.io`, `api.lever.co`), without needing the running app or a
database — see [progress/01-completed.md](../progress/01-completed.md). 7 of the
original 10 guesses were wrong; disabled rather than deleted, with the actual ATS
each company uses today, since some (SmartRecruiters, Workday) are on the step-16
adapter roadmap.

| employer_id | display_name | adapter | tenant | enabled |
| --- | --- | --- | --- | --- |
| postman | Postman | greenhouse | postman | yes |
| razorpay | Razorpay | greenhouse | razorpaysoftwareprivatelimited | yes |
| druva | Druva | greenhouse | druva | yes |
| zerodha | Zerodha | lever | zerodha | no |
| hasura | Hasura | greenhouse | hasura | no |
| chargebee | Chargebee | lever | chargebee | no |
| freshworks | Freshworks | greenhouse | freshworks | no |
| browserstack | BrowserStack | lever | browserstack | no |
| clevertap | CleverTap | lever | clevertap | no |
| innovaccer | Innovaccer | greenhouse | innovaccer | no |

## Disabled: actual ATS platform, not Greenhouse/Lever

| employer_id | real platform | evidence |
| --- | --- | --- |
| zerodha | none — self-hosted page | careers.zerodha.com says "no job openings currently"; no ATS embed at all |
| hasura | Gem | rebranded to PromptQL; `jobs.gem.com/promptql` |
| chargebee | unknown | careers page links only to LinkedIn Jobs, no ATS board found |
| freshworks | SmartRecruiters | `careers.smartrecruiters.com/Freshworks` — on the step-16 roadmap |
| browserstack | Workday | `browserstack.wd3.myworkdayjobs.com/External` — on the step-16 roadmap |
| clevertap | Kula | `careers.kula.ai/clevertap` |
| innovaccer | Workable | `apply.workable.com/j/...`, tenant `innovaccer` |

None of these adapters exist yet (`@jobops/adapters` only implements Greenhouse and
Lever). Re-enabling any of these rows means adding that adapter first, then flipping
`enabled` to `yes` — not changing the tenant guess.
