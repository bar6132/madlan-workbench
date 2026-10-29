# מדלן-בדק: Madlan Dispute Workbench

A Hebrew RTL tool for a Customer Success Manager. They paste a customer's complaint ("this number is wrong"); the app extracts the claim with an LLM, checks it against the deals file with deterministic code, shows the evidence, and drafts a reply that a guard checks against the verified facts. Design: [docs/design.md](docs/design.md). Plan: [docs/plan.md](docs/plan.md). CSM guide: [docs/CSM_GUIDE.md](docs/CSM_GUIDE.md). AI log: [docs/AI_WORK_LOG.md](docs/AI_WORK_LOG.md). Demo script: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

Live URL: _(add after deploy)_

## How it works
1. `scripts/build_dataset.py` (pandas, offline) cleans `data/madlan_deals_sample.csv` into `data/deals.processed.json`. Every raw row is kept inside its deal record; nothing is deleted.
2. The Next.js app loads that JSON (validated with Zod). `lib/resolver.ts` finds the deal (never auto-picks when several match), `lib/verifier.ts` gives a verdict, `lib/market.ts` gives context numbers.
3. Gemini is used twice: `lib/claim.ts` (complaint text to a schema-validated claim) and `lib/reply.ts` (verified facts to a Hebrew reply). The customer's message reaches only the first step. `lib/guards.ts` rejects any reply containing a deal id, number or phrase not in the facts, and `lib/templates.ts` supplies the fallback reply.
4. `app/api/analyze/route.ts` is the one endpoint. Every request has a `trace_id` returned to the client and written as a structured JSON log line (never the customer's text).

## Run locally
```
npm install
pip install -r scripts/requirements.txt
cp .env.example .env.local        # add GEMINI_API_KEY (optional GEMINI_MODEL, default gemini-3.5-flash-lite)
python scripts/build_dataset.py   # only needed if you change a cleaning rule
npm run dev                       # http://localhost:3000   (add ?debug=1 for the failure simulator)
npm test                          # Vitest (includes a check that the processed JSON is not stale)
python -m pytest scripts/tests    # data pipeline tests against the real CSV
```
Without a key the app still works: complaint understanding is replaced by a manual form and replies are templates.

## Assumptions (not given by Madlan)
- The number "the customer saw" is the raw CSV value; we cannot know what a live site displayed.
- Exclude from statistics: price missing/0 or below 250,000 ₪. Price/m² mismatch tolerance 1%. Market window: 24 calendar months ending at the latest deal month (2026-07). Minimum 5 deals for any statistic.
- For two rows with the same id, the primary row is the one whose price ÷ size equals the file's price per m²; only if that cannot decide, Tax Authority > broker > owner (and the UI says so).
- Month-only dates (`Aug 2025`) are month-precise only.
- Timeline contradictions, "new from contractor" with an old build year, and price/m² outliers are flagged, not excluded.

## What the data cannot tell us
Dates and counts below were measured on the file: 530 rows, 520 deals, 18 cities, 29 rows where price per m² contradicts price ÷ size, 6 exact duplicates, 4 conflicting duplicates (2 of them owner vs broker with no Tax Authority row), 2 excluded prices, 5 timeline contradictions, 83 of 100 "new from contractor" deals built before 2015, 74 of 124 city+neighborhood groups with fewer than 5 deals. No house numbers, balcony or garden area, or TAMA 38 status.

## What was cut, and why
Multi-tab workspace, a UI telemetry ring buffer, Python at runtime, buyer-facing "is this price fair" verdicts (too few comparables), and a second LLM provider (Groq failover; the adapter takes one provider function so it can be added).

## Known limits
- The rate limiter (15 requests/min/IP) is in memory per serverless instance: best effort only, it resets on cold start.
- Server logs are visible in the Vercel dashboard; retention depends on the plan.
- Free-tier Gemini content may be used by Google to improve its products. The CSV is non-personal sample data.
- The reply guard checks which numbers and deal ids appear, not what they are attached to; a draft could swap which figure belongs to which source and still pass. The CSM reads and edits the draft before sending.
- Hebrew quality of the real model is checked by hand (see the AI log), not by automated tests; tests mock the model.
