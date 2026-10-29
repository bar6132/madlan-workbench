import csv
import hashlib
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from apply_corrections import CorrectionError, apply  # noqa: E402

ORIGINAL = ROOT / "data" / "madlan_deals_sample.csv"
# The challenge's CSV, pinned: corrections must only ever reach the v2 copy.
ORIGINAL_SHA256 = "cfe4a245e08a1bda6daf53a0e16c8f745c4b2e154713ce63fee8bca8ab9aac88"


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def write(tmp_path: Path, corrections: list[dict]) -> Path:
    p = tmp_path / "c.json"
    p.write_text(json.dumps({"corrections": corrections}, ensure_ascii=False), encoding="utf-8")
    return p


def run(tmp_path: Path, corrections: list[dict]):
    return apply(str(ORIGINAL), str(write(tmp_path, corrections)), str(tmp_path / "v2.csv"), str(tmp_path / "v2.json"))


GOOD = {"deal_id": "D100313", "row_index": 299, "field": "price_per_sqm", "old_value": 58234, "new_value": 80628,
        "reason": "r", "source_of_info": "s"}


def test_the_original_csv_is_the_known_file():
    assert sha(ORIGINAL) == ORIGINAL_SHA256


def test_original_is_not_modified_by_applying(tmp_path):
    before = sha(ORIGINAL)
    run(tmp_path, [GOOD])
    assert sha(ORIGINAL) == before


def test_only_the_corrected_cell_differs_in_v2(tmp_path):
    run(tmp_path, [GOOD])
    a = list(csv.reader(open(ORIGINAL, encoding="utf-8-sig", newline="")))
    b = list(csv.reader(open(tmp_path / "v2.csv", encoding="utf-8-sig", newline="")))
    assert len(a) == len(b)
    diffs = [(i, j) for i, (x, y) in enumerate(zip(a, b)) for j, (p, q) in enumerate(zip(x, y)) if p != q]
    col = a[0].index("price_per_sqm")
    assert diffs == [(300, col)]                 # row_index 299 is list index 300 (header is index 0)
    assert b[300][col] == "80628"


def test_v2_dataset_reflects_the_correction(tmp_path):
    out = run(tmp_path, [GOOD])
    v2 = {d["deal_id"]: d for d in json.loads((tmp_path / "v2.json").read_text(encoding="utf-8"))["deals"]}
    assert "PPSM_MISMATCH" not in v2["D100313"]["flags"]
    assert out["summary"]["ppsm_mismatch_raw_rows"] == 28


def test_stale_old_value_is_rejected(tmp_path):
    with pytest.raises(CorrectionError, match="expected"):
        run(tmp_path, [{**GOOD, "old_value": 11111}])


def test_wrong_deal_for_that_row_is_rejected(tmp_path):
    with pytest.raises(CorrectionError, match="belongs to"):
        run(tmp_path, [{**GOOD, "deal_id": "D100001"}])


def test_row_out_of_range_and_non_editable_field_are_rejected(tmp_path):
    with pytest.raises(CorrectionError):
        run(tmp_path, [{**GOOD, "row_index": 99999}])
    with pytest.raises(CorrectionError, match="not editable"):
        run(tmp_path, [{**GOOD, "field": "city"}])


def test_refuses_to_overwrite_the_original(tmp_path):
    with pytest.raises(CorrectionError, match="overwrite"):
        apply(str(ORIGINAL), str(write(tmp_path, [GOOD])), str(ORIGINAL), str(tmp_path / "x.json"))
    assert sha(ORIGINAL) == ORIGINAL_SHA256


def test_committed_v2_matches_a_fresh_run_of_the_approved_corrections(tmp_path):
    approved = ROOT / "data" / "corrections.approved.json"
    apply(str(ORIGINAL), str(approved), str(tmp_path / "v2.csv"), str(tmp_path / "v2.json"))
    assert (tmp_path / "v2.csv").read_bytes() == (ROOT / "data" / "madlan_deals_sample_v2.csv").read_bytes()
    assert json.loads((tmp_path / "v2.json").read_text(encoding="utf-8")) == json.loads(
        (ROOT / "data" / "deals.v2.processed.json").read_text(encoding="utf-8"))
