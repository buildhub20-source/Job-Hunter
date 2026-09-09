# Personal Facts

**This file is the only home for personal information.** It is never copied into the
database, not even as a cache. Workers read it at run start and hold it in memory
for the run.

Rules:
- `approved` must be `yes` before the agent may use a value.
- An empty value, `UNKNOWN`, `approved=no`, or a past `expires_at` all mean the same
  thing: **the agent does not know**. It will ask in Google Chat. It will never
  substitute `no`, `0`, or `N/A`.
- `expires_at` is for facts that drift (notice period, current CTC, current role).
  The dashboard flags them for reconfirmation once expired.
- Edit this file by hand or from the dashboard. Every change is committed to Git.

## identity

| key | value | source | approved | approved_at | expires_at | sensitivity | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| full_name | Prasath | user | yes | 2026-09-09 |  | normal | legal name for applications — confirm full form |
| preferred_name | Prasath | user | yes | 2026-09-09 |  | normal |  |
| date_of_birth | UNKNOWN | user | no |  |  | high | only if an ATS requires it |

## contact

| key | value | source | approved | approved_at | expires_at | sensitivity | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| primary_email | prasath.hub@gmail.com | user | yes | 2026-09-09 |  | normal | application email, also scanned by the inbox worker |
| alt_email | share2prasath@gmail.com | user | yes | 2026-09-09 |  | normal |  |
| phone | UNKNOWN | user | no |  |  | normal | include country code |
| linkedin_url | UNKNOWN | user | no |  |  | low |  |
| github_url | UNKNOWN | user | no |  |  | low |  |
| current_city | UNKNOWN | user | no |  |  | normal |  |
| current_country | UNKNOWN | user | no |  |  | normal |  |

## employment

| key | value | source | approved | approved_at | expires_at | sensitivity | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| total_experience_years | UNKNOWN | user | no |  |  | normal | targets the 0–3 band |
| current_employer | UNKNOWN | user | no |  | 2027-03-31 | normal | reconfirm each quarter |
| current_title | UNKNOWN | user | no |  | 2027-03-31 | normal |  |
| employment_start_date | UNKNOWN | user | no |  |  | normal |  |
| notice_period_days | UNKNOWN | user | no |  | 2027-03-31 | normal | asked by almost every Indian ATS |
| primary_stack | C#, .NET Core, AWS, SQL Server, microservices | user | yes | 2026-09-09 |  | normal |  |
| secondary_skills | AI agents | user | yes | 2026-09-09 |  | normal |  |

## education

| key | value | source | approved | approved_at | expires_at | sensitivity | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| highest_qualification | UNKNOWN | user | no |  |  | normal |  |
| degree_branch | UNKNOWN | user | no |  |  | normal |  |
| university | UNKNOWN | user | no |  |  | normal |  |
| graduation_year | UNKNOWN | user | no |  |  | normal |  |
| cgpa_or_percentage | UNKNOWN | user | no |  |  | normal |  |

## compensation

| key | value | source | approved | approved_at | expires_at | sensitivity | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| current_ctc | UNKNOWN | user | no |  | 2027-03-31 | high | never auto-filled without an approved value |
| expected_ctc | UNKNOWN | user | no |  | 2027-03-31 | high |  |
| salary_currency | UNKNOWN | user | no |  |  | normal |  |

## work_authorization

| key | value | source | approved | approved_at | expires_at | sensitivity | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| citizenship | UNKNOWN | user | no |  |  | high | never inferred from location |
| requires_sponsorship_india | UNKNOWN | user | no |  |  | high | the classic ATS question — answer once, permanently |
| requires_sponsorship_us | UNKNOWN | user | no |  |  | high |  |
| authorized_to_work_india | UNKNOWN | user | no |  |  | high |  |
| passport_status | UNKNOWN | user | no |  |  | high |  |
| willing_to_relocate | UNKNOWN | user | no |  |  | normal |  |
| travel_percentage_ok | UNKNOWN | user | no |  |  | normal |  |

## logistics

| key | value | source | approved | approved_at | expires_at | sensitivity | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| earliest_start_date | UNKNOWN | user | no |  |  | normal |  |
| willing_weekend_work | UNKNOWN | user | no |  |  | normal |  |
| background_check_consent | UNKNOWN | user | no |  |  | high | legal declaration — always approval-gated |
| how_did_you_hear | UNKNOWN | user | no |  |  | low | common free-text field |
