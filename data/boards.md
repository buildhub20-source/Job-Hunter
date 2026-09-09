# Board Registry

Every company whose ATS we poll. Add a line, no code change.

**Finding the tenant:** it's the slug in the company's public board URL.
`boards.greenhouse.io/`**`stripe`** → tenant `stripe`.
`jobs.lever.co/`**`netflix`** → tenant `netflix`.

**The tokens below are unverified guesses.** A wrong one returns HTTP 404 and shows up
in the run's failure list and on the Adapter Health page — that's the cheapest way to
check them, so the first run is also the verification pass. Correct or delete the
failures, and add the companies Vinoth actually cares about.

| employer_id | display_name | adapter | tenant | enabled |
| --- | --- | --- | --- | --- |
| postman | Postman | greenhouse | postman | yes |
| razorpay | Razorpay | lever | razorpay | yes |
| zerodha | Zerodha | lever | zerodha | yes |
| hasura | Hasura | greenhouse | hasura | yes |
| chargebee | Chargebee | lever | chargebee | yes |
| freshworks | Freshworks | greenhouse | freshworks | yes |
| browserstack | BrowserStack | lever | browserstack | yes |
| clevertap | CleverTap | lever | clevertap | yes |
| druva | Druva | greenhouse | druva | yes |
| innovaccer | Innovaccer | greenhouse | innovaccer | yes |
