# AI Work Log & Engineering Verification (`AI_WORK_LOG.md`)

Per the challenge instructions (*"Build it with AI assistance. We do. Keep a short log of how you worked, including at least one time it gave you a bad answer and you caught it"*), this log documents how AI tools were leveraged during the ~5-hour build, how architectural decisions were made, and **three specific instances where AI suggestions were wrong or dangerous and were caught and corrected.**

---

## 1. Workflow Summary: How AI Was Used vs. Human Engineering Judgment

| Phase | How AI Assisted | What I Owned & Verified Manually |
| :--- | :--- | :--- |
| **1. Exploratory Data Audit (CSV)** | Used Python scripting to rapidly scan all 530 rows and 19 columns of `madlan_deals_sample.csv` for schema anomalies, nulls, duplicates, and math discrepancies. | Designed the **Non-Destructive Quarantine Architecture** (`VALID`, `CONFLICT_RESOLVED`, `QUARANTINED`) so that dirty rows aren't silently deleted—allowing CSMs to look up disputed deals during customer escalations. |
| **2. System & Sector Design** | Structured the codebase into 4 strict sectors (**Data & Integration, Backend, LLM & Guardrails, Frontend RTL**) with baseline guarantees for Security, Efficiency, and Accuracy. | Enforced the **Zero-LLM-Math Rule** and built the post-generation regex citation guardrail (`citation-guard.ts`) so the LLM can never hallucinate a `deal_id` or calculate averages on its own. |
| **3. Implementation & Testing** | Accelerated boilerplate generation for Next.js App Router endpoints, Tailwind RTL components, and Vitest unit test cases. | Audited edge cases in date parsing, Israeli city name canonicalization, timeout handling (`AbortController`), and CSM workflow usability. |

---

## 2. Catching Bad AI Answers: 3 Concrete Examples

### Catch #1 (Data Corruption Bug): Naive Date Parsing Swapped Israeli Days and Months (`DD/MM/YYYY` vs. `MM/DD/YYYY`)
* **What Happened:** When generating the initial date-normalization logic for the `deal_date` column, the AI suggested using standard JavaScript `new Date(rawDateString)` (and default `pd.to_datetime()` without `dayfirst=True` in Python) to normalize mixed date strings in the CSV.
* **Why It Was Wrong:** The CSV contains 4 different date formats: ISO (`2025-09-07`), dot-separated (`26.02.2024`), month-name (`Aug 2025`), and slash-separated Israeli dates (`15/06/2025`, `03/02/2026`). Standard JavaScript `new Date("03/02/2026")` parses slash dates as US format (`MM/DD/YYYY` -> **March 2, 2026** instead of **February 3, 2026**), and throws `Invalid Date` on `26.02.2024` or `15/06/2025`!
* **How I Caught & Fixed It:** I inspected the raw `deal_date` distribution in the CSV and wrote a deterministic custom parser (`parseIsraeliDate()`) that explicitly checks the delimiter (`/` or `.`) and enforces `DD/MM/YYYY` (Israeli standard) before constructing an ISO `YYYY-MM-DD` date, backed by a dedicated unit test in `pipeline.test.ts`.

### Catch #2 (Product / CSM Escalation Failure): Silently Dropping Duplicate & Outlier Rows (`df.drop_duplicates()` & `price > 250000`)
* **What Happened:** Initially, the AI suggested cleaning the dataset by running `.drop_duplicates(subset=['deal_id'], keep='first')` and filtering out rows where `price_nis < 250000` (`D100251` with `price=0` and `D100317` with `price=18,000`) so only clean rows remained in the JSON store.
* **Why It Was Wrong:** If we delete those rows or blindly keep the first duplicate:
  1. For conflicting duplicates like `D100124` (where row 1 is `רשות המסים` at 5,727,000 ₪ and row 2 is `מתווך` at 5,429,440 ₪) or `D100017`, `keep='first'` relies on arbitrary CSV row order rather than source authority (`רשות המסים` > `מתווך` > `בעל נכס`), and wipes out the evidence of the conflict!
  2. During **"The Customer Moment"** (when a customer or CSM searches `D100251`, `D100317`, or `D100124` to ask why a number looks wrong), a deleted row would return `"Deal Not Found"`—leaving the CSM completely blind.
* **How I Caught & Fixed It:** I rejected destructive filtering and implemented a **State-Tagged Audit Store**. Every `deal_id` is preserved: clean deals are used for market statistics, while conflicting duplicates and quarantined rows are retained with explicit `anomaly_flags[]` and `conflicting_records[]` metadata so the CSM can search any `deal_id` and immediately see the root cause.

### Catch #3 (Infrastructure & Constraint #5 Trap): Splitting the App onto a Free-Tier Render/Railway Python Backend
* **What Happened:** Early in planning, we considered hosting the Next.js frontend on Vercel and deploying a separate Python FastAPI service on Render's or Railway's free tier to handle data queries and LLM requests.
* **Why It Was Wrong:** Render's free tier spins down containers after 15 minutes of inactivity, causing a **30-to-60-second cold start** on the next HTTP request. When Madlan evaluators open the public URL (Constraint #1), a 55-second hang on the initial API call would either time out the frontend or look like a broken app, directly violating **Constraint #5 ("It fails gracefully")**.
* **How I Caught & Fixed It:** Consolidated the runtime backend into **Next.js App Router Serverless Route Handlers** deployed on Vercel alongside the frontend (0ms cold start, zero cross-origin latency, single atomic deployment), while keeping the Python diagnostic script (`scripts/audit_and_clean.py`) in the repository for offline data auditing and verification.

---

## 3. Documented Assumptions About Data Gaps ("About the Data, and the Gaps")

The prompt notes: *"Some of what you need isn't in the CSV at all. Decide and document your assumptions."* Here are the explicit assumptions built into our system and surfaced to the user:

1. **Missing House Numbers (`street` contains street name only):** Two deals on the same street (e.g., `בן גוריון`) may be at completely different ends of the street (quiet interior vs. main road). The app explicitly informs users that comparisons are at the street/neighborhood level, not building-level.
2. **Missing Balcony / Garden Area (`has_balcony` is boolean only):** In Israeli real estate, `size_sqm` often reflects interior Arnona/Tabu size, whereas penthouses (`פנטהאוז`) and garden apartments (`דירת גן`) command a massive price premium due to large exterior areas not quantified in `size_sqm`. Our AI prompt and UI explicitly warn users when comparing `פנטהאוז`/`דירת גן` price-per-sqm against standard apartments (`דירה`).
3. **Missing TAMA 38 / Pinui-Binui Indicators:** Older buildings (`year_built < 1980`) with unusually high prices per sqm may be pricing in urban renewal (`תמ"א 38` / `פינוי בינוי`) potential, which is not recorded in the CSV. The app flags this possibility as a known data limitation rather than stating it as fact.
4. **Source Authority Hierarchy:** When duplicate `deal_id` records conflict (`D100017`, `D100032`, `D100124`, `D100303`), we assume `רשות המסים` (Israel Tax Authority statutory reporting) is authoritative over `מתווך` (Broker) and `בעל נכס` (Property Owner), while surfacing both values transparently in the UI.