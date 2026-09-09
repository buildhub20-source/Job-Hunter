# Personal Facts

**Subject of this file: Vinoth M.** The agent applies to jobs on his behalf, so every
value here is what goes onto a real application form.

**This file is the only home for personal information.** It is never copied into the
database, not even as a cache. Workers read it at run start and hold it in memory
for the run.

Rules:
- `approved` must be `yes` before the agent may use a value.
- An empty value, `UNKNOWN`, `approved=no`, or a past `expires_at` all mean the same
  thing: **the agent does not know**. It will ask in Google Chat. It will never
  substitute `no`, `0`, or `N/A`.
- `source=resume` means the value was read off Vinoth's own resume. Check those once.
- `expires_at` is for facts that drift (notice period, current CTC, current role).
  The dashboard flags them for reconfirmation once expired.
- Edit this file by hand or from the dashboard. Every change is committed to Git.

## identity

| key | value | source | approved | approved_at | expires_at | sensitivity | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| full_name | Vinoth M | resume | yes | 2026-09-09 |  | normal | as it appears on every resume variant |
| preferred_name | Vinoth | resume | yes | 2026-09-09 |  | normal |  |
| date_of_birth | UNKNOWN | user | no |  |  | high | left unknown on purpose — only if an ATS demands it |

## contact

| key | value | source | approved | approved_at | expires_at | sensitivity | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| primary_email | gopir525@gmail.com | resume | yes | 2026-09-09 |  | normal | address on the resume; also the mailbox the inbox worker must scan |
| phone | +91 93603 79929 | resume | yes | 2026-09-09 |  | normal |  |
| current_city | Coimbatore | resume | yes | 2026-09-09 |  | normal |  |
| current_state | Tamil Nadu | resume | yes | 2026-09-09 |  | normal |  |
| current_country | India | resume | yes | 2026-09-09 |  | normal |  |
| linkedin_url | https://www.linkedin.com/in/vinoth-m-b57441225/ | resume | yes | 2026-09-09 |  | low |  |
| github_url | https://github.com/Vinoth-M-08 | resume | yes | 2026-09-09 |  | low |  |
| portfolio_url | https://vinoth-m-portfolio.netlify.app/ | resume | yes | 2026-09-09 |  | low |  |
| leetcode_url | https://leetcode.com/u/VINOTH_M/ | resume | yes | 2026-09-09 |  | low |  |

## employment

| key | value | source | approved | approved_at | expires_at | sensitivity | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| current_employer | Aptean | resume | yes | 2026-09-09 | 2027-03-31 | normal |  |
| current_title | Associate Software Developer | resume | yes | 2026-09-09 | 2027-03-31 | normal |  |
| employment_start_date | 2024-09 | resume | yes | 2026-09-09 |  | normal | Sep 2024 – present |
| employment_location | Coimbatore, India | resume | yes | 2026-09-09 |  | normal |  |
| total_experience_years | 2 | derived | no |  | 2027-03-31 | normal | Sep 2024 to now. CONFIRM — this field gates eligibility |
| notice_period_days | UNKNOWN | user | no |  | 2027-03-31 | normal | asked by almost every Indian ATS |
| primary_stack | .NET Core, ASP.NET Core, Node.js, React, AWS, microservices | resume | yes | 2026-09-09 |  | normal |  |
| secondary_skills | Azure OpenAI, RAG, multi-agent AI, pgvector, Java, Spring Boot, Python | resume | yes | 2026-09-09 |  | normal |  |
| databases | PostgreSQL, SQL Server, MySQL | resume | yes | 2026-09-09 |  | normal |  |

## education

| key | value | source | approved | approved_at | expires_at | sensitivity | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| highest_qualification | Bachelor of Technology | resume | yes | 2026-09-09 |  | normal |  |
| degree_branch | Information Technology | resume | yes | 2026-09-09 |  | normal |  |
| university | Sri Krishna College of Engineering and Technology | resume | yes | 2026-09-09 |  | normal | Coimbatore, TN |
| education_start | 2021-12 | resume | yes | 2026-09-09 |  | normal |  |
| graduation_year | 2025 | resume | yes | 2026-09-09 |  | normal | May 2025 |
| cgpa_or_percentage | 7.75/10.00 | resume | yes | 2026-09-09 |  | normal | CGPA |

## compensation

| key | value | source | approved | approved_at | expires_at | sensitivity | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| current_ctc | UNKNOWN | user | no |  | 2027-03-31 | high | never auto-filled without an approved value |
| expected_ctc | UNKNOWN | user | no |  | 2027-03-31 | high |  |
| salary_currency | INR | derived | no |  |  | normal | confirm |

## work_authorization

| key | value | source | approved | approved_at | expires_at | sensitivity | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| citizenship | UNKNOWN | user | no |  |  | high | never inferred from location |
| authorized_to_work_india | UNKNOWN | user | no |  |  | high |  |
| requires_sponsorship_india | UNKNOWN | user | no |  |  | high | the classic ATS question — answer once, permanently |
| requires_sponsorship_us | UNKNOWN | user | no |  |  | high |  |
| passport_status | UNKNOWN | user | no |  |  | high |  |
| willing_to_relocate | UNKNOWN | user | no |  |  | normal |  |
| travel_percentage_ok | UNKNOWN | user | no |  |  | normal |  |

## logistics

| key | value | source | approved | approved_at | expires_at | sensitivity | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| earliest_start_date | UNKNOWN | user | no |  |  | normal |  |
| willing_weekend_work | UNKNOWN | user | no |  |  | normal |  |
| background_check_consent | UNKNOWN | user | no |  |  | high | legal declaration — stays approval-gated on purpose |
| how_did_you_hear | UNKNOWN | user | no |  |  | low | varies per application |
