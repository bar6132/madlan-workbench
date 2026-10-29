"""Apply APPROVED data corrections to a COPY of the deals CSV (v2) and rebuild a v2 dataset.

The original CSV is never written. Each correction names a CSV row, the column, the value it expects to find
there (old_value) and the new value; a mismatch aborts, so a stale or mistyped correction cannot change the
wrong cell. Run: python scripts/apply_corrections.py
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_dataset import DEFAULT_CSV, ROOT, build, parse_int  # noqa: E402

DEFAULT_CORRECTIONS = ROOT / "data" / "corrections.approved.json"
DEFAULT_OUT_CSV = ROOT / "data" / "madlan_deals_sample_v2.csv"
DEFAULT_OUT_JSON = ROOT / "data" / "deals.v2.processed.json"
EDITABLE = {"price_nis", "size_sqm", "price_per_sqm"}


class CorrectionError(Exception):
    pass


def apply(csv_path: str, corrections_path: str, out_csv: str, out_json: str) -> dict:
    if Path(out_csv).resolve() == Path(csv_path).resolve():
        raise CorrectionError("refusing to overwrite the original CSV")
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    header, body = rows[0], rows[1:]
    col = {name: i for i, name in enumerate(header)}
    corrections = json.loads(Path(corrections_path).read_text(encoding="utf-8"))["corrections"]

    changed = []
    for c in corrections:
        if c["field"] not in EDITABLE:
            raise CorrectionError(f"field not editable: {c['field']}")
        i = c["row_index"]
        if not 0 <= i < len(body):
            raise CorrectionError(f"{c['deal_id']}: row_index {i} out of range")
        row = body[i]
        if row[col["deal_id"]].strip() != c["deal_id"]:
            raise CorrectionError(f"{c['deal_id']}: row {i} belongs to {row[col['deal_id']].strip()}")
        cell = col[c["field"]]
        if parse_int(row[cell]) != c["old_value"]:
            raise CorrectionError(
                f"{c['deal_id']}: expected {c['field']}={c['old_value']} in row {i}, file has {row[cell]!r}")
        changed.append({"deal_id": c["deal_id"], "csv_line": i + 2, "column": c["field"],
                        "old": row[cell], "new": str(c["new_value"])})
        row[cell] = str(c["new_value"])

    Path(out_csv).parent.mkdir(parents=True, exist_ok=True)
    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
        csv.writer(f).writerows([header, *body])
    summary = build(out_csv, out_json)["summary"]
    return {"changed": changed, "summary": summary}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=str(DEFAULT_CSV))
    ap.add_argument("--corrections", default=str(DEFAULT_CORRECTIONS))
    ap.add_argument("--out-csv", default=str(DEFAULT_OUT_CSV))
    ap.add_argument("--out-json", default=str(DEFAULT_OUT_JSON))
    a = ap.parse_args()
    try:
        print(json.dumps(apply(a.csv, a.corrections, a.out_csv, a.out_json), ensure_ascii=False, indent=1))
    except CorrectionError as e:
        sys.exit(f"correction rejected: {e}")
