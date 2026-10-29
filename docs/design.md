# Madlan Dispute Workbench — Design

Working name: **מדלן-בדק — שולחן בירור תלונות** (Madlan Dispute Workbench).
Status: draft for approval. Source of truth for all data facts: `madlan_deals_sample.csv` and `madlan_rnd_ops_engineer_challenge .md`. Nothing in this document comes from a Madlan system we cannot see.

---

## 1. Intent and why

The brief says the role "sits between R&D, Customer Success and customers", and the live session includes a "customer moment": a CSM plays an upset customer who complained about something the app showed, and we work through it live.

So the product is the tool a **CSM uses when a customer says "this number is wrong"**. It is not a property-search chatbot and not a buyer-facing market explorer.

A CSM pastes the customer's message (free Hebrew text). The app:

1. uses an LLM to turn the message into a structured **claim** (which deal, which field, what the customer believes),
2. uses deterministic code to **check the claim** against the raw rows and the cleaned data,
3. shows the **evidence** and a **verdict**,
4. uses an LLM to **draft a reply** that may only contain verified facts, with a guard that enforces it,
5. produces an **escalation note** for R&D when the data cannot settle the question.

The CSV is deliberately dirty. Cleaning and explaining that dirt is the product's core value, not hidden plumbing.

## 2. Goals, non-goals, anti-goals

**Goals**
- A CSM, with no engineer present, can go from a pasted complaint to a verified, sendable reply in under two minutes.
- Every claim the app makes is traceable to specific raw rows (deal id, raw value, rule that fired).
- When data is missing, conflicting or too thin, the app says so in plain Hebrew and does not guess.
- Model failure degrades to a still-useful manual path, never a hang or a stack trace.

**Non-goals**
- No buyer/seller-facing product, no property search, no general chat.
- No "is this price fair" verdict from the LLM. Market context is shown as numbers with sample size, not as a judgment.
- No database, no auth, no user accounts.
- No attempt to explain Madlan's internal ingestion pipeline. We only see a CSV.

**Anti-goals (failure even if it technically works)**
- The LLM states a number, id or cause that is not in the verified facts.
- A reply tells a customer something false (e.g. "the Tax Authority figure is authoritative" for a deal with no Tax Authority row).
- The app silently picks one deal when several match the complaint.
- A spinner that never stops, or raw error text shown to the CSM.

## 3. Constraints (from the brief, non-negotiable)

Live public URL; Hebrew RTL; the LLM does real work; says only what data supports and shows its basis; fails gracefully; tested and debuggable; one-page CSM guide; AI work log with at least one real bad-AI catch. Deliver: URL, repo link, CSM guide, AI log. About 5 focused hours of work.

## 4. What the data actually is (verified against the CSV, not against earlier notes)

Earlier prework docs contained errors. These are the numbers from running a script over the CSV; the builder should re-verify them in the test suite rather than trust this list.

- 530 rows, 19 columns, **520 unique `deal_id`** (D100001–D100520).
- **29 distinct city strings → 18 real cities** (not 15): אשדוד, באר שבע, בית שמש, בת ים, גבעתיים, הרצליה, חולון, חיפה, ירושלים, כפר סבא, מודיעין(-מכבים-רעות), נתניה, פתח תקווה, ראשון לציון, רחובות, רמת גן, רעננה, תל אביב(-יפו). Variants include trailing spaces, hyphen vs space, `ב"ש`, `ת"א`, English names.
- **Property types:** דירה, דופלקס, פנטהאוז, דירת גן, דירת גג, בית פרטי. Padded with spaces in some rows (also `condition`, neighborhood, street).
- **Prices** appear as `5,727,000`, `"4,331,000"`, plain digits. `D100251` = 0; `D100317` = 18,000 (the only two below 250,000).
- **`price_per_sqm` in the CSV disagrees with `price_nis ÷ size_sqm` by more than 1% in 29 rows** (23 of them by more than 5%).
- **Dates:** ISO (373), `DD/MM/YYYY` (76), `DD.MM.YYYY` (55), and month-name only like `Aug 2025` (26, no day). Day-first is confirmed: in 75 slash/dot dates the first number exceeds 12; the second never does. Range 2021-01 to 2026-07.
- **Duplicates:** 6 exact (`D100025, D100099, D100196, D100215, D100311, D100416`) and 4 conflicting: `D100017`, `D100124` (Tax Authority vs broker), `D100032`, `D100303` (**property owner vs broker — no Tax Authority row**).
- **For all 4 conflicting ids, the row whose `price ÷ size` equals the CSV `price_per_sqm` is the original and the other row's price was altered afterwards.** (D100124 Tax 5,727,000 and D100017 Tax 1,919,000; D100032 owner 5,141,000 and D100303 owner 6,064,000.) This is stronger evidence than any assumed source ranking.
- **Missing values:** `year_built` 35, `floor` 24, `has_parking` 20, `condition` 16, `neighborhood` 11, `size_sqm` 10, `price_per_sqm` 10. Booleans are a mix of כן/לא/yes/no/TRUE/FALSE/1/0; empty must stay *unknown*, never false.
- **Timeline contradictions:** only 4 rows have `year_built` after the deal year and condition ≠ חדש מקבלן (`D100056, D100415, D100212, D100378`). A larger oddity: **83 of 100 "חדש מקבלן" rows have `year_built` before 2015** (54 before 2000), so that label is unreliable.
- **Statistical outliers:** `D100001` (רמת גן, 145,283/m²) and `D100193` (ירושלים, 141,935/m²).
- **Thin samples:** 124 city+neighborhood groups, 74 with fewer than 5 valid deals; e.g. חולון 4 rooms has 6 deals.
- **Not in the CSV at all:** house numbers, balcony/garden area, urban-renewal (TAMA 38) status, view/noise, and **what any Madlan website actually displayed to a customer.**

## 5. Product behavior

### 5.1 The main flow

**Input:** a text box for the customer's message (max 800 characters), plus an optional "deal id" field. A few example complaints are one click away (they double as the demo script).

**Step 1 — Claim extraction (LLM, structured output).** The model returns JSON validated by Zod:
`mentioned_deal_ids[]`, `city`, `neighborhood`, `street`, `field` (one of: `price`, `price_per_sqm`, `size`, `date`, `rooms`, `two_prices`, `other`), `customer_stated_value` (number or null), `tone` (calm / upset / angry), `confidence`. The raw customer message goes to this step only.

**Step 2 — Resolve to a deal (deterministic).** Look up by id; else by city + street (+ neighborhood, rooms, stated value if given). If zero match: "deal not found" state. If several match: **show the candidates and make the CSM choose.** Never auto-pick.

**Step 3 — Verify (deterministic, no LLM).** Rules per `field` examine the raw rows and cleaned record and produce a **verdict**:

| Verdict | Meaning (Hebrew label in UI) |
|---|---|
| `RAW_VALUE_WRONG` | The raw value is internally inconsistent or invalid (e.g. wrong price/m², price 0 or rent-like). The customer is right about the raw figure. |
| `RAW_VALUE_OK` | Raw value is consistent; nothing in the data supports the complaint. |
| `SOURCES_CONFLICT` | Two rows with the same id disagree; shows both and which one the consistency check supports. |
| `CANNOT_DETERMINE` | The data cannot settle it (missing field, thin sample, field not in CSV). Goes to escalation. |
| `DEAL_NOT_FOUND` | No such id/address in the file. |

**Output of this step is a `VerifiedFacts` object**: the only thing later steps may quote. It contains deal ids, raw values, corrected values, rule ids, and Hebrew explanation strings written by us.

**Step 4 — Evidence panel (UI).** Raw row(s) next to cleaned values, the rule that fired, source badges, and the verdict. Anything inferred is labeled "הנחה" (assumption); anything computed is labeled "חושב".

**Step 5 — Reply draft (LLM, constrained).** The model receives `VerifiedFacts` and the `tone` label, **not the raw customer message**, and writes a short Hebrew reply (polite, specific, no blame, no promises beyond the facts). A deterministic **reply guard** then checks the draft (see 6.3). If the guard fails twice, or the model is unavailable, a **template reply** keyed on verdict is used.

**Step 6 — Escalation note (deterministic template).** For `CANNOT_DETERMINE` and `SOURCES_CONFLICT`: a copyable note for R&D with trace id, deal ids, rows, rule ids, and what is unknown. No LLM, so it cannot be wrong.

### 5.2 Market context panel (secondary)

For the resolved deal's city/neighborhood/rooms, show median price, median price/m², IQR and **N**, from valid deals only, in a **recent window** (default: the 24 months ending at the latest deal date in the file — the dataset's "now", not the wall clock). If N < 5, show "אין מספיק עסקאות להשוואה" instead of a statistic. A toggle shows the same numbers computed on the raw uncleaned rows to show the effect of cleaning; it is labeled as an illustration, not a claim about Madlan's live numbers. No LLM involvement.

### 5.3 Debug (`?debug=1`)
A collapsed panel showing the last request's `trace_id`, per-stage latency, which provider answered, guard results, and a **failure simulator** (timeout / provider error / hallucinated id / invalid JSON). Hidden by default so a CSM does not see it. The CSM guide tells them to copy the trace id into an escalation.

## 6. Engineering rules

### 6.1 Data layer — non-destructive (implemented in Python, `scripts/build_dataset.py`)
Every raw row is kept. The pipeline produces, per `deal_id`, a record with `raw` values, `clean` values, `status` (`VALID`, `CONFLICT`, `EXCLUDED`), `flags[]` (rule ids) and Hebrew explanations. Excluded rows are still searchable and explained; they just do not enter statistics.

Rules (all deterministic, each with a stable id for tests and evidence):
- Trim every string; map city variants to one of 18 canonical names; also normalize padded `property_type`, `condition`, neighborhood, street.
- Parse prices (`₪`, commas, quotes), rooms (`"4 חדרים"`), booleans (three-state), dates (day-first; month-name dates keep month precision, not a invented day).
- Recompute `price ÷ size`; flag when the CSV value differs by more than 1%. The recomputed value is what the app uses.
- Exact duplicates: keep one, flag.
- Conflicting duplicates: keep both. **Primary row = the one whose `price ÷ size` matches the CSV `price_per_sqm`**; if neither or both match, fall back to source order Tax Authority > broker > owner and say that this fallback was used. (The ordering is our assumption, not Madlan's; the UI says so.)
- Exclude from stats: price missing/0 or below 250,000 (documented threshold, our assumption).
- **Flag but do not exclude:** timeline contradictions, "חדש מקבלן" with an old `year_built`, per-city price/m² outliers (IQR rule). A wrong build year does not make the price wrong.

### 6.2 LLM layer
- Providers: Gemini Flash-Lite family (free tier) as primary; Groq as optional failover only if time allows. Model ids must be verified against provider docs at build time (they were checked on 2026-10-28: Gemini 3.5 / 3.1 Flash-Lite are free-tier; Groq `llama-3.3-70b-versatile` supports JSON-object mode only, strict schema needs `openai/gpt-oss-120b`/`20b` or `qwen/qwen3.8-27b`). Free-tier Gemini content may be used by Google to improve products; the CSV is non-personal sample data; state this in the README.
- Hard timeout per call; one retry at most; all outputs parsed with Zod; invalid JSON counts as failure.
- Temperature low. The model never computes anything; every number it needs is in `VerifiedFacts`.
- Customer text is untrusted. It enters only the claim-extraction step, whose output is a schema-validated object. The reply step never sees it. Pre-flight pattern blocking is a courtesy, not the defense.

### 6.3 Guards
- **Claim guard:** extracted ids must exist in the file or be reported as not found; extracted enums must be valid.
- **Reply guard:** extract every deal id and every numeral from the Hebrew draft (handling `5,727,000`, `5.7 מיליון`, `₪`, percentages, Hebrew number words are out of scope — reject drafts that use them). Each must appear in `VerifiedFacts` (after normalization). Any miss ⇒ reject draft ⇒ one regeneration ⇒ template reply.
- **No hedging by invention:** the draft must not contain causes or promises (e.g. "we will fix it by tomorrow") — enforced by prompt and by a small banned-phrase list; the template is the safe fallback.

### 6.4 Graceful failure (user-visible)
| Failure | What the CSM sees |
|---|---|
| Extraction model down/slow/invalid | Message "הבנת התלונה אוטומטית לא זמינה כרגע" + a manual form (deal id or city/street/field). Steps 2–4 and 6 still work. |
| Reply model down/slow/guard fails | Template reply for the verdict, labeled as template. |
| Deal not found / ambiguous | Explicit state, candidates listed. |
| Unexpected server error | Short Hebrew message + trace id. Never a stack trace. |

### 6.5 Observability
Every request has a `trace_id`, returned in the response and written as structured JSON to server logs (visible in the Vercel dashboard). Logged: stage timings, provider, outcome per stage, guard decisions, verdict, deal ids — never full customer message text. A per-instance rate limiter protects the public URL on a best-effort basis; the README states that it resets on serverless cold starts. No in-memory trace store.

### 6.6 Hosting
Next.js (App Router, TypeScript) on Vercel, reading the pre-built `data/deals.processed.json` that the offline Python pipeline produced (no Python at runtime). Serverless function timeout must be checked and set explicitly (`maxDuration`) so the model timeout always fires before the platform kills the function.

## 7. Interface
Hebrew, RTL (`lang="he" dir="rtl"`), one main page. Order top to bottom: complaint input → extracted claim (editable) → candidate picker (when needed) → verdict + evidence → reply (with copy button, labeled AI-drafted or template) → escalation note → market context. Every state above has a designed screen: loading with elapsed time, not found, ambiguous, cannot-determine, model-down. Phone-width usable. Citations of deal ids are chips that jump to the evidence row. No `dangerouslySetInnerHTML`.

## 8. Tests that matter most
1. Data rules against the real CSV: 18 cities; 530→520 ids; 29 price/m² mismatches; the 4 conflicts resolve as in §4; D100251 and D100317 excluded; slash and dot dates parse day-first.
2. Verifier: one test per verdict, including `D100032`/`D100303` (no Tax Authority row) and `CANNOT_DETERMINE` for a field not in the CSV.
3. Resolver: ambiguous address returns candidates and never picks one.
4. Reply guard: invented id, wrong number, number formatted differently (`5.7 מיליון`), banned promise — each rejected.
5. Claim extraction output validation: invalid JSON, unknown enum, injection text in the message.
6. Failure simulation end to end: timeout, provider error, invalid JSON ⇒ correct degraded UI state and template reply. LLM calls are mocked in tests; a small manual checklist covers real-model Hebrew quality.

## 9. Deliverables
Public URL; repo with README (setup, assumptions, what was cut and why); **one-page Hebrew CSM guide** (what the app does, what it cannot do, how to read each verdict, what to say to a customer, when and how to escalate with a trace id) — written after the app works, from its real behavior, and replacing the existing prework guide; AI work log (real events only, including the earlier-found documentation errors and the three prior catches); demo script that follows the customer moment.

## 10. Cut for time (say so in the README)
Multi-tab workspace, telemetry ring buffer in the UI, Python at runtime (Python runs only offline to build the dataset), second-provider failover unless time remains, a buyer-facing fair-price verdict.

## 11. Assumptions made by this document (not given by Madlan)
- The "number the customer saw" is the raw CSV value; we cannot know what a live site showed.
- 250,000 ₪ exclusion threshold; 1% price/m² tolerance; 24-month window; N ≥ 5 minimum for statistics.
- Source authority fallback ordering Tax Authority > broker > owner, used only when the consistency check cannot decide.
- Month-name dates are month-precise only.

## 12. Left to the builder
Component library and styling, exact prompt wording, test framework, file layout, choice of Zod/Vitest equivalents, exact UI copy (subject to Hebrew review), and the number-normalization implementation for the reply guard.

## 13. Tech stack (author's proposal, Python pipeline approved by the user; versions pinned and verified at scaffold time)
| Area | Choice | Why |
|---|---|---|
| App | Next.js App Router, TypeScript (strict) | One deployable on Vercel for UI and API routes; no separate backend or cold-start problem. |
| Styling | Tailwind CSS with logical (RTL-safe) utilities; Heebo font via `next/font` | Fast to build, native Hebrew RTL. |
| Validation | Zod | Runtime schemas for LLM output, API input and the `VerifiedFacts` contract. |
| Data pipeline | **Python (pandas), offline.** `scripts/build_dataset.py` reads `data/madlan_deals_sample.csv`, applies every §6.1 rule, and writes `data/deals.processed.json` (raw values, clean values, status, flags, Hebrew explanations, conflicting rows). Committed to the repo. | Single source of truth for cleaning; pandas suits dirty CSV work; nothing Python runs live. |
| Data at runtime | TypeScript loads `deals.processed.json` and validates it with Zod; it does not reimplement cleaning. | No duplicated logic, no drift. |
| LLM | Official Google GenAI SDK, Gemini Flash-Lite (free tier), structured JSON output. Optional Groq failover over plain `fetch` using `openai/gpt-oss-120b` with strict schema. Cloudflare Workers AI not used. | Matches the free models the user has keys for; keys live in `.env.local` locally and in Vercel env vars when deployed, never in the repo. |
| Tests | `pytest` for the Python pipeline (the §4 numbers and §6.1 rules, run against the real CSV); Vitest for verifier, resolver, guards, API routes and failure paths (LLM mocked); a Vitest check that fails if `deals.processed.json` is stale versus a fresh pipeline run; one small Playwright smoke test of the Hebrew page only if time remains | Covers §8. |
| Hosting | Vercel (GitHub repo connected), `maxDuration` set explicitly | Public URL. |
| Local flow | `npm run dev` and `npm test` first with the real Gemini key on a handful of Hebrew prompts, then deploy | The user's chosen order. |

## 14. Calls made after the builder check (author's decisions, not user-confirmed)
- **Verdict rules per field.** `price` / `price_per_sqm`: apply the §6.1 rules; if nothing is flagged the verdict is `RAW_VALUE_OK` with the text "הנתון תואם לדיווח במקור; הנתונים אינם מאפשרים לקבוע אם המחיר סביר". `size` / `rooms` / `date`: the verifier only checks that the value is present, parsed cleanly and consistent (e.g. month-only date, missing size); present and clean ⇒ `RAW_VALUE_OK`, missing ⇒ `CANNOT_DETERMINE`. `other`: `CANNOT_DETERMINE`.
- **`customer_stated_value`.** Compared with a 1% tolerance. Matches the primary value ⇒ no extra effect. Matches the non-primary row of a conflicting pair ⇒ verdict `SOURCES_CONFLICT`, evidence names that row. Matches neither ⇒ shown as "הערך שצוין אינו מופיע בנתונים", verdict unchanged.
- **Customer-facing wording on conflicts.** The reply may state both figures, which one the app uses, and the reason "המחיר ליחידת שטח בקובץ תואם לדיווח הזה". It must not say a figure was "altered", "wrong" or "corrected by someone", and must not name a cause. The CSM evidence panel may say "המחיר אינו תואם את המחיר למ"ר שנרשם". Banned-phrase list includes these words.
- **Market window.** Month-only dates count by calendar month. A CONFLICT deal contributes its primary row only.
- **Demo script (also the example chips):** (1) `D100124` two different prices; (2) `D100313` price per m² doesn't match; (3) `D100251` or `D100317` odd price; (4) an address that matches several deals; (5) a complaint about balcony size or house number, which is not in the CSV.
- **Logs.** Vercel log retention depends on the account plan; accepted limitation, stated in the README.
- **Confirmed by the user:** the project starts from scratch and is built and tested locally first, then deployed. The user reviews all Hebrew copy at the end; the whole product is Hebrew as in the brief. Build effort is about 5 ±2 hours spread over up to 3 days. Short Vercel log retention is accepted.
- **If time is short, cut in this order:** raw-vs-clean toggle, debug failure simulator (keep unit-test coverage of failures), Groq failover, escalation note styling.
