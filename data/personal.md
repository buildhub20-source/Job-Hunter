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
| gender | Male | user | yes | 2026-09-15 |  | normal | for voluntary self-identification questions; given by the operator |
| date_of_birth | 2003-12-08 | user | yes | 2026-09-09 |  | high | given as 08/12/2003, read as 8 December — CONFIRM the day/month order |

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
| total_experience_years | 2.2 | user | yes | 2026-09-09 | 2027-03-31 | normal | as of Sep 2026 |
| notice_period_days | 30 | user | yes | 2026-09-09 | 2027-03-31 | normal | asked by almost every Indian ATS |
| primary_stack | .NET Core, ASP.NET Core, Node.js, React, AWS, microservices | resume | yes | 2026-09-09 |  | normal |  |
| secondary_skills | Azure OpenAI, RAG, multi-agent AI, pgvector, Java, Spring Boot, Python | resume | yes | 2026-09-09 |  | normal |  |
| databases | PostgreSQL, SQL Server, MySQL | resume | yes | 2026-09-09 |  | normal |  |
| resume_highlights | At Aptean: built the microservice orchestrating all carrier API requests and responses across the logistics platform, serving 50K+ daily requests, and defined its system design, data flow and integration contracts for 15+ carriers; architected and shipped a RAG system on Azure OpenAI and pgvector that answers questions over carrier documentation, cutting engineer lookup time by about 60%; designed multi-agent AI workflows that parse carrier specs, generate mapping configs and trigger validation, cutting manual integration effort by about 70% per onboarding; led a metadata-driven carrier mapping system that removed about 40 hours a month of manual configuration and let non-engineers onboard carriers without code changes; delivered serverless carrier integrations on AWS Lambda (Node.js) with auto-scaling across regions; improved React Time-to-Interactive by 40% with code-splitting, memoization and lazy loading; resolved 20+ customer-reported issues across .NET Core, Node.js and React, wrote design docs and mentored new engineers on a 10+ engineer team. Projects: LinkedIn Content Agent, a 3-agent Planner, Writer and Reviewer pipeline on the Gemini API with LinkedIn OAuth publishing and approval gates; JobNest, a Spring Boot microservices job portal with React and Redux, JWT and RBAC, and indexed MySQL queries that cut search latency by about 35%; encrypted document storage on IPFS with AES-256 and Solidity hash verification behind an ASP.NET Core backend. Smart India Hackathon 2023 internal round qualifier; 400+ LeetCode problems; AWS Academy Cloud Foundations. | resume | yes | 2026-09-15 |  | normal | copied from base.pdf, nothing added — the only material generated answers may draw on (D20) |

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
| current_ctc | 500000 | user | yes | 2026-09-09 | 2027-03-31 | high | INR per annum (5.0 LPA) |
| expected_ctc | 800000 | user | yes | 2026-09-09 | 2027-03-31 | high | 8 LPA ask (~60% hike on 5 LPA); walk-away floor is separate, see salary_floor policy |
| salary_currency | INR | user | yes | 2026-09-09 |  | normal | INR per annum |

## work_authorization

| key | value | source | approved | approved_at | expires_at | sensitivity | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| citizenship | Indian | user | yes | 2026-09-09 |  | high |  |
| authorized_to_work_india | yes | user | yes | 2026-09-09 |  | high |  |
| requires_sponsorship_india | no | user | yes | 2026-09-09 |  | high | Indian citizen, no sponsorship needed to work in India |
| requires_sponsorship_us | yes | user | yes | 2026-09-13 |  | high | Indian citizen, requires visa sponsorship for US roles; confirmed via Discord |
| authorized_to_work_us | no | user | yes | 2026-09-13 |  | high | Indian citizen, not authorized to work in US without visa/sponsorship |
| passport_status | holds a valid passport | user | yes | 2026-09-09 |  | high |  |
| willing_to_relocate | yes | user | yes | 2026-09-09 |  | normal | scope not specified — within India assumed by the geo policy |
| travel_percentage_ok | 25 | default | yes | 2026-09-09 |  | normal | my default, not his answer — a real commitment if asked at interview |

## logistics

| key | value | source | approved | approved_at | expires_at | sensitivity | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| earliest_start_date | 30 days from offer | user | yes | 2026-09-09 |  | normal | matches the 30-day notice period |
| willing_weekend_work | yes | user | yes | 2026-09-09 |  | normal |  |
| background_check_consent | yes | user | yes | 2026-09-09 |  | high | blanket consent given; standard pre-employment check |
| how_did_you_hear | Company Website | user | yes | 2026-09-13 |  | low | standard answer selected by user |
| hard_technical_problem_essay | At Aptean, engineers were spending a lot of time searching carrier documentation and feature specs by hand. I architected and shipped a RAG system on Azure OpenAI and pgvector (PostgreSQL) that answers questions over that documentation with context-aware responses, which reduced engineer lookup time by about 60%. I then built multi-agent AI workflows on Azure OpenAI in which agents parse carrier specs, generate mapping configurations and trigger validation, cutting manual integration effort by about 70% per carrier onboarding. | resume | no |  |  | normal | rewritten 2026-09-15 from resume facts only; the earlier draft claimed BM25 hybrid retrieval, a reranking layer and a 40% latency cut, none of which are on the resume. Vinoth to read and approve |
| why_speechify_essay | I am deeply excited about Speechify's mission to make reading, learning, and information accessible through state-of-the-art voice and platform technology. With my background in backend microservices (.NET Core, Node.js), API design, and AI/RAG integrations, I thrive on building scalable, reliable distributed systems that power seamless user experiences. I want to bring my backend and platform engineering expertise to Speechify to help scale its services for millions of users worldwide. | user | yes | 2026-09-13 |  | normal | tailored for Speechify application |
| why_company_generic | I am drawn to the opportunity to build robust, scalable backend systems that solve complex engineering challenges and deliver tangible user impact. With hands-on experience developing microservices, high-throughput APIs, and AI integrations in .NET and Node.js on cloud infrastructure, I take pride in writing resilient, maintainable code. I am excited to collaborate with your team to enhance platform reliability, optimize performance, and drive engineering excellence. | user | yes | 2026-09-13 |  | normal | generic company motivation essay |

