import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from build_dataset import build  # noqa: E402

CITIES = {
    "אשדוד", "באר שבע", "בית שמש", "בת ים", "גבעתיים", "הרצליה", "חולון", "חיפה",
    "ירושלים", "כפר סבא", "מודיעין-מכבים-רעות", "נתניה", "פתח תקווה", "ראשון לציון",
    "רחובות", "רמת גן", "רעננה", "תל אביב-יפו",
}
TYPES = {"דירה", "דופלקס", "פנטהאוז", "דירת גן", "דירת גג", "בית פרטי"}
SOURCE_TAX, SOURCE_OWNER = "רשות המסים", "בעל נכס"


@pytest.fixture(scope="module")
def data(tmp_path_factory):
    out = tmp_path_factory.mktemp("out") / "deals.json"
    build(str(ROOT / "data" / "madlan_deals_sample.csv"), str(out))
    return json.loads(out.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def deals(data):
    return {d["deal_id"]: d for d in data["deals"]}


def test_summary_counts(data):
    s = data["summary"]
    assert s["raw_rows"] == 530
    assert s["deals"] == 520
    assert s["cities"] == 18
    assert s["exact_duplicates"] == 6
    assert s["conflicts"] == 4
    assert s["excluded"] == 2
    assert s["ppsm_mismatch_raw_rows"] == 29
    assert s["month_only_dates"] == 26


def test_cities_and_types_are_canonical(data):
    assert {d["city"] for d in data["deals"]} == CITIES
    assert {d["property_type"] for d in data["deals"]} == TYPES


def test_conflicts_pick_row_matching_ppsm(deals):
    d = deals["D100124"]
    primary = d["raw_rows"][d["primary_row_index"]]
    other = [r for i, r in enumerate(d["raw_rows"]) if i != d["primary_row_index"]][0]
    assert d["primary_reason"] == "PPSM_MATCH"
    assert primary["price_nis"] == 5727000 and primary["source"] == SOURCE_TAX
    assert other["price_nis"] == 5429440
    assert d["status"] == "CONFLICT" and "SOURCE_CONFLICT" in d["flags"]
    assert d["price_nis"] == 5727000
    for did, price, src in [("D100017", 1919000, SOURCE_TAX),
                            ("D100032", 5141000, SOURCE_OWNER),
                            ("D100303", 6064000, SOURCE_OWNER)]:
        x = deals[did]
        assert x["price_nis"] == price and x["source"] == src
        assert x["primary_reason"] == "PPSM_MATCH"


def test_exact_duplicates_collapse(deals):
    d = deals["D100025"]
    assert "EXACT_DUPLICATE" in d["flags"] and d["primary_reason"] == "EXACT_DUP"
    assert len(d["raw_rows"]) == 2 and d["status"] != "CONFLICT"


def test_ppsm_recomputed_and_flagged(deals):
    d = deals["D100313"]
    assert d["calculated_ppsm"] == 80628
    assert d["csv_price_per_sqm"] == 58234
    assert "PPSM_MISMATCH" in d["flags"]


def test_bad_prices_excluded(deals):
    for did in ("D100251", "D100317"):
        d = deals[did]
        assert d["status"] == "EXCLUDED" and d["include_in_stats"] is False
    assert "PRICE_INVALID" in deals["D100251"]["flags"]
    assert "PRICE_BELOW_THRESHOLD" in deals["D100317"]["flags"]


def test_timeline_and_new_build_flags(data):
    tl = {d["deal_id"] for d in data["deals"] if "TIMELINE_CONTRADICTION" in d["flags"]}
    assert tl == {"D100056", "D100415", "D100212", "D100378", "D100244"}
    assert sum("NEW_BUILD_OLD_YEAR" in d["flags"] for d in data["deals"]) == 83
    assert all(d["status"] != "EXCLUDED" for d in data["deals"] if d["deal_id"] in tl)


def test_outliers_flagged_not_excluded(data, deals):
    flagged = {d["deal_id"] for d in data["deals"] if "PPSM_OUTLIER" in d["flags"]}
    assert {"D100001", "D100193"} <= flagged
    assert len(flagged) <= 10
    assert deals["D100001"]["include_in_stats"] is True


def test_dates_day_first(data, deals):
    assert deals["D100017"]["deal_date"] == "2025-06-15"
    assert deals["D100303"]["deal_date"] == "2024-02-26"
    month_only = [d for d in data["deals"] if d["date_precision"] == "month"]
    assert month_only and all(len(d["deal_date"]) == 7 for d in month_only)
    assert all(int(d["deal_date"][5:7]) <= 12 for d in data["deals"])
    assert data["summary"]["latest_deal_date"] >= "2026-07"


def test_booleans_three_state(data, deals):
    assert deals["D100311"]["has_parking"] is None
    for d in data["deals"]:
        for k in ("has_elevator", "has_parking", "has_balcony", "has_safe_room"):
            assert d[k] in (True, False, None)
    assert {type(d["rooms"]).__name__ for d in data["deals"]} <= {"float", "int", "NoneType"}


def test_missing_size_flag(deals):
    assert "MISSING_SIZE" in deals["D100223"]["flags"]
    assert deals["D100223"]["calculated_ppsm"] is None


def test_every_flag_has_hebrew_explanation(data):
    for d in data["deals"]:
        if d["flags"]:
            assert d["explanations_he"], d["deal_id"]
