# AI work log

How AI was used, and the times it gave a bad answer that was caught. Events are listed in the order they happened; nothing here is hypothetical.

## How I worked
- **Planning (earlier session, another AI model):** explored the CSV with Python scripts, proposed an architecture, drafted design docs and four sector roadmaps.
- **Review and redesign (this session, Claude Code):** re-audited the CSV independently, checked the earlier docs against it, and changed the product from a market-explorer chatbot to a dispute workbench (see `docs/design.md`).
- **Build (this session):** brainstorming, a written design, a task plan, then test-first implementation with the test run after every step. One reviewer pass at the end.

## Bad AI answers I caught
1. **Date parsing (earlier session).** The AI suggested `new Date(rawString)` / `pd.to_datetime` without day-first for the mixed date column. That reads `03/02/2026` as March 2 and fails on `26.02.2024`. I checked the raw values, wrote an explicit parser, and in this build confirmed day-first from the data itself: in 75 slash/dot dates the first number is above 12, the second never is.
2. **Silent deletion (earlier session).** The AI suggested `drop_duplicates(keep='first')` and dropping prices under 250,000. That would make `D100124`/`D100251`/`D100317` return "not found" exactly when a CSM needs them. I chose a non-destructive record that keeps every raw row with flags.
3. **Hosting split (earlier session).** The AI proposed a separate Python API on a free tier that sleeps. A 30 to 60 second first call would look broken to a reviewer, so everything runs in one Next.js deployment on Vercel.
4. **The earlier design docs were wrong about the data (this session).** A script run showed 18 real cities, not 15 (the city map would have dropped כפר סבא, רעננה, גבעתיים, בת ים), property types that don't exist in the file (קוטג', סטודיו), and that two of the four conflicting duplicates (`D100032`, `D100303`) are owner vs broker with **no Tax Authority row**, so the planned "Tax Authority > broker > owner" rule would have picked the wrong row and a CSM template would have told customers something false. Fix: the row whose price ÷ size matches the file's price per m² is the original (true for all four).
5. **My own audit undercounted (this session).** The first count of timeline contradictions was 4. The pipeline test failed with a fifth deal, `D100244`: my audit script had dropped month-only dates like `Sep 2022`. Corrected the test and the design doc.
6. **Windows path (this session).** The plan scaffolded the app inside a folder whose name contains `&`; npm's Windows shims broke (`'D' is not recognized`). Moved the project to a path without `&`.
7. **Package conflict (this session).** `vitest` refused to install because of a peer-dependency conflict on `@types/node`; bumped it to match Node 24 instead of forcing the install.

## Decisions I made against the AI's first proposal
- No LLM "is this price fair" verdict: 74 of 124 city+neighborhood groups have fewer than 5 deals.
- The reply step never sees the customer's message (prompt-injection defense by construction, tested with a canary string).
- Outlier rule tuned on the data (k = 2.5): k = 3 missed `D100193`, k ≤ 2 flagged 10 to 14 deals.

## Still to do
- Run the real Gemini model on the five demo complaints plus unscripted Hebrew and record any bad extraction or rejected reply here.
