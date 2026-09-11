# JobOps dashboard

Read-only view of the JobOps Google Sheet, plus a button that re-runs the Apps
Script pipeline.

## What it can and cannot trigger

| | |
|---|---|
| Re-run normalize + enrich + gate | yes — the "Run pipeline" button |
| Start a Spark discovery run | **no** — Spark has no API. Use Gemini, or wait for its 4-hour schedule |
| Start the applier | **no** — Playwright runs on your machine, not in a browser |

## Why everything goes through /api

The Apps Script token must never reach the browser. Both routes run server-side on
Vercel, read the token from the environment, and proxy. That also sidesteps CORS.

## Deploy

1. Push this folder to a Git repo
2. Import it in Vercel, root directory `v3/dashboard`
3. Add the two env vars from `.env.example`
4. Deploy

Local: `npm install && npm run dev`, with a `.env.local`.
