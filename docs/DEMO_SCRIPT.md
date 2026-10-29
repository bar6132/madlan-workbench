# Demo script (10 min) and customer moment

Open the public URL. Each example is a chip under the message box, so no typing is needed.

## 1. The five complaints (about 5 min)
1. **Two prices, `D100124`.** Shows `SOURCES_CONFLICT`: Tax Authority 5,727,000 vs broker 5,429,440. Point at the table: the price per m² in the file matches the Tax Authority row, which is why it is shown. Open the escalation note.
2. **Wrong price per m², `D100313`.** The file says 58,234, price ÷ size gives 80,628. Verdict says the file value is inconsistent and the app uses the computed value.
3. **Odd price, `D100317`.** 18,000 is excluded from market numbers; the deal is still searchable and explained. Say what the app does not claim: it does not say "rent".
4. **Address that matches several deals** (Ben-Gurion St., Holon). The app lists candidates and waits for a choice; it never guesses.
5. **Balcony size, `D100313`.** `CANNOT_DETERMINE`: the file has no balcony area. Escalation note says what is unknown.

Also show: market panel with fewer than 5 deals says "not enough deals to compare" instead of a number, and the raw-vs-clean checkbox labelled as an illustration.

## 2. Failure demo (about 2 min)
Add `?debug=1` to the URL. In the Debug panel set "Simulate extraction failure" to TIMEOUT and run any chip: the app shows the manual form, then still verifies and gives a template reply. Set "Simulate reply-model failure" to PROVIDER_ERROR: the reply becomes a template labelled "תבנית מוכנה". Show the `trace_id` and per-stage timings; the same trace id is in the server logs.

## 3. The customer moment (10 min live)
1. Paste the customer's message; confirm what the app understood (claim card). Fix the topic if needed.
2. Read the verdict and the evidence table aloud: which rows exist, which is shown, why.
3. Decide what to tell the customer from the verdict table in the CSM guide. State what we know (the file values) and what we do not (what the site showed, why the data is that way).
4. Send the guarded reply; if the verdict is a conflict or cannot-determine, send the escalation note with the trace id.

## Questions to be ready for
- Why Python for cleaning and TypeScript for the app? One source of truth for the rules; the app only reads the produced file; a test fails if that file is stale.
- Why not let the LLM judge "is this price fair"? 74 of 124 city+neighborhood groups have fewer than 5 deals; any verdict would be unsupported.
- What did you cut? See README.
