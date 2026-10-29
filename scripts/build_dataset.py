"""Offline data pipeline: raw Madlan CSV -> data/deals.processed.json.

Non-destructive: every raw row is kept inside its deal record. Rules and
thresholds follow docs/design.md section 6.1. Run: python scripts/build_dataset.py
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CSV = ROOT / "data" / "madlan_deals_sample.csv"
DEFAULT_OUT = ROOT / "data" / "deals.processed.json"

MIN_PRICE = 250_000
PPSM_TOLERANCE = 0.01
OUTLIER_K = 2.5
NEW_BUILD = "חדש מקבלן"
SOURCE_ORDER = ["רשות המסים", "מתווך", "בעל נכס"]

CITY_MAP = {
    "תל אביב": "תל אביב-יפו", "תל אביב-יפו": "תל אביב-יפו", "תל אביב יפו": "תל אביב-יפו",
    'ת"א': "תל אביב-יפו", "Tel Aviv-Yafo": "תל אביב-יפו",
    "ירושלים": "ירושלים", "Jerusalem": "ירושלים",
    "באר שבע": "באר שבע", "באר-שבע": "באר שבע", 'ב"ש': "באר שבע",
    "מודיעין": "מודיעין-מכבים-רעות", "מודיעין מכבים רעות": "מודיעין-מכבים-רעות",
    "מודיעין-מכבים-רעות": "מודיעין-מכבים-רעות",
    "בית שמש": "בית שמש", "בית-שמש": "בית שמש",
    **{c: c for c in ["אשדוד", "בת ים", "גבעתיים", "הרצליה", "חולון", "חיפה", "כפר סבא",
                      "נתניה", "פתח תקווה", "ראשון לציון", "רחובות", "רמת גן", "רעננה"]},
}
MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}
TRUE_SET = {"כן", "yes", "true", "1"}
FALSE_SET = {"לא", "no", "false", "0"}


def _s(v) -> str:
    return str(v).strip()


def parse_int(raw: str) -> int | None:
    t = re.sub(r"[₪,\s\"]", "", raw)
    if not t:
        return None
    try:
        return int(round(float(t)))
    except ValueError:
        return None


def parse_rooms(raw: str) -> float | None:
    m = re.search(r"\d+(?:\.\d+)?", raw)
    return float(m.group()) if m else None


def parse_bool(raw: str) -> bool | None:
    t = raw.strip().lower()
    if t in TRUE_SET:
        return True
    if t in FALSE_SET:
        return False
    return None


def parse_date(raw: str) -> tuple[str | None, str]:
    """Day-first. Month-name dates keep month precision (YYYY-MM)."""
    t = raw.strip()
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        return t, "day"
    m = re.fullmatch(r"(\d{1,2})[/.](\d{1,2})[/.](\d{4})", t)
    if m:
        d, mo, y = (int(x) for x in m.groups())
        return f"{y:04d}-{mo:02d}-{d:02d}", "day"
    m = re.fullmatch(r"([A-Za-z]{3})[a-z]*\s+(\d{4})", t)
    if m and m.group(1).title() in MONTHS:
        return f"{int(m.group(2)):04d}-{MONTHS[m.group(1).title()]:02d}", "month"
    return None, "day"


def ppsm_of(price: int | None, size: int | float | None) -> int | None:
    if price and size and price > 0 and size > 0:
        return int(round(price / size))
    return None


def mismatch(calc: int | None, csv: int | None) -> bool:
    return calc is not None and csv is not None and abs(calc - csv) / calc > PPSM_TOLERANCE


def parse_row(idx: int, r: dict) -> dict:
    price = parse_int(r["price_nis"])
    size = parse_int(r["size_sqm"])
    date, precision = parse_date(r["deal_date"])
    return {
        "row_index": idx,
        "source": _s(r["source"]),
        "price_nis_raw": r["price_nis"],
        "price_nis": price,
        "csv_price_per_sqm": parse_int(r["price_per_sqm"]),
        "deal_date_raw": r["deal_date"],
        "_size": size, "_date": date, "_precision": precision,
        "_fields": {k: _s(v) for k, v in r.items() if k not in ("price_nis", "source")},
    }


def choose_primary(rows: list[dict]) -> tuple[int, str]:
    if len(rows) == 1:
        return 0, "SINGLE"
    if all(r["_fields"] == rows[0]["_fields"] and r["price_nis"] == rows[0]["price_nis"]
           and r["source"] == rows[0]["source"] for r in rows):
        return 0, "EXACT_DUP"
    matching = [i for i, r in enumerate(rows)
                if (c := ppsm_of(r["price_nis"], r["_size"])) is not None
                and r["csv_price_per_sqm"] is not None and abs(c - r["csv_price_per_sqm"]) <= 1]
    if len(matching) == 1:
        return matching[0], "PPSM_MATCH"
    order = sorted(range(len(rows)),
                   key=lambda i: SOURCE_ORDER.index(rows[i]["source"])
                   if rows[i]["source"] in SOURCE_ORDER else len(SOURCE_ORDER))
    return order[0], "SOURCE_ORDER"


def fmt(n: int | None) -> str:
    return f"{n:,}" if n is not None else "?"


def build_deal(group: list[tuple[int, dict]]) -> dict:
    rows = [parse_row(i, r) for i, r in group]
    p_idx, reason = choose_primary(rows)
    p, f = rows[p_idx], rows[p_idx]["_fields"]
    raw_city = group[p_idx][1]["city"]
    city = CITY_MAP.get(_s(raw_city), _s(raw_city))
    price, size = p["price_nis"], p["_size"]
    calc = ppsm_of(price, size)
    year = int(p["_date"][:4]) if p["_date"] else None
    yb = parse_int(f["year_built"])
    cond = f["condition"] or None
    flags: list[str] = []
    ex: list[str] = []

    def flag(name: str, text: str) -> None:
        flags.append(name)
        ex.append(text)

    if reason == "EXACT_DUP":
        flag("EXACT_DUPLICATE", "הרשומה הופיעה בקובץ יותר מפעם אחת בדיוק באותם נתונים; נספרה פעם אחת.")
    if reason in ("PPSM_MATCH", "SOURCE_ORDER"):
        o = next(r for i, r in enumerate(rows) if i != p_idx)
        why = ("המחיר למ\"ר שנרשם בקובץ תואם לרשומה זו" if reason == "PPSM_MATCH"
               else "לפי סדר עדיפות המקורות (רשות המסים, מתווך, בעל נכס) — זו הנחה של המערכת ולא נתון מהקובץ")
        flag("SOURCE_CONFLICT",
             f"לעסקה זו שתי רשומות בקובץ עם מחירים שונים: {p['source']} ₪{fmt(price)} ו-{o['source']} ₪{fmt(o['price_nis'])}. "
             f"המערכת מציגה את רשומת {p['source']} כי {why}.")
    if _s(raw_city) != city or raw_city != city:
        flag("CITY_NORMALIZED", f"שם העיר בקובץ ('{raw_city}') אוחד לשם '{city}'.")
    if p["_precision"] == "month":
        flag("MONTH_ONLY_DATE", f"בקובץ מצוין חודש ושנה בלבד ({p['deal_date_raw']}); היום בחודש אינו ידוע.")
    if size is None:
        flag("MISSING_SIZE", "שטח הדירה חסר בקובץ; לא ניתן לחשב מחיר למ\"ר.")
    if mismatch(calc, p["csv_price_per_sqm"]):
        flag("PPSM_MISMATCH",
             f"המחיר למ\"ר שנרשם בקובץ (₪{fmt(p['csv_price_per_sqm'])}) אינו תואם למחיר חלקי שטח (₪{fmt(calc)}). "
             "המערכת משתמשת בערך המחושב.")
    excluded = False
    if not price:
        excluded = True
        flag("PRICE_INVALID", "מחיר העסקה חסר או אפס; העסקה אינה נכללת בחישובי שוק.")
    elif price < MIN_PRICE:
        excluded = True
        flag("PRICE_BELOW_THRESHOLD",
             f"מחיר העסקה (₪{fmt(price)}) נמוך מ-₪{fmt(MIN_PRICE)}, נמוך מכדי להיות מחיר רכישה אופייני; העסקה אינה נכללת בחישובי שוק.")
    if yb and year and yb > year and cond != NEW_BUILD:
        flag("TIMELINE_CONTRADICTION",
             f"שנת הבנייה הרשומה ({yb}) מאוחרת משנת העסקה ({year}) והמצב אינו '{NEW_BUILD}'. הנתון סומן לבדיקה ולא הוחרג.")
    if cond == NEW_BUILD and yb and yb < 2015:
        flag("NEW_BUILD_OLD_YEAR", f"המצב הרשום '{NEW_BUILD}' אך שנת הבנייה היא {yb}. סומן לבדיקה.")

    status = "EXCLUDED" if excluded else ("CONFLICT" if "SOURCE_CONFLICT" in flags else "VALID")
    return {
        "deal_id": f["deal_id"],
        "status": status,
        "include_in_stats": not excluded,
        "city": city, "raw_city": raw_city,
        "neighborhood": f["neighborhood"] or None,
        "street": f["street"] or None,
        "property_type": f["property_type"],
        "rooms": parse_rooms(f["rooms"]),
        "size_sqm": size,
        "floor": parse_int(f["floor"]),
        "total_floors": parse_int(f["total_floors"]),
        "year_built": yb,
        "condition": cond,
        "has_elevator": parse_bool(f["has_elevator"]),
        "has_parking": parse_bool(f["has_parking"]),
        "has_balcony": parse_bool(f["has_balcony"]),
        "has_safe_room": parse_bool(f["has_safe_room"]),
        "deal_date": p["_date"], "date_precision": p["_precision"],
        "price_nis": price,
        "csv_price_per_sqm": p["csv_price_per_sqm"],
        "calculated_ppsm": calc,
        "source": p["source"],
        "flags": flags, "explanations_he": ex,
        "raw_rows": [{k: v for k, v in r.items() if not k.startswith("_") and k != "_fields"} for r in rows],
        "primary_row_index": p_idx,
        "primary_reason": reason,
    }


def flag_outliers(deals: list[dict]) -> None:
    frame = pd.DataFrame([{"i": i, "city": d["city"], "ppsm": d["calculated_ppsm"]}
                          for i, d in enumerate(deals)
                          if d["include_in_stats"] and d["calculated_ppsm"]])
    for _, g in frame.groupby("city"):
        q1, q3 = g["ppsm"].quantile(0.25), g["ppsm"].quantile(0.75)
        lo, hi = q1 - OUTLIER_K * (q3 - q1), q3 + OUTLIER_K * (q3 - q1)
        for _, row in g[(g["ppsm"] < lo) | (g["ppsm"] > hi)].iterrows():
            d = deals[int(row["i"])]
            d["flags"].append("PPSM_OUTLIER")
            d["explanations_he"].append(
                f"המחיר למ\"ר (₪{fmt(int(row['ppsm']))}) חריג ביחס לעסקאות אחרות ב{d['city']}. סומן לבדיקה ולא הוחרג.")


def build(csv_path: str, out_path: str) -> dict:
    df = pd.read_csv(csv_path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    records = df.to_dict("records")
    groups: dict[str, list[tuple[int, dict]]] = {}
    for i, r in enumerate(records):
        groups.setdefault(_s(r["deal_id"]), []).append((i, r))
    deals = [build_deal(g) for _, g in sorted(groups.items())]
    flag_outliers(deals)

    mismatch_rows = 0
    for r in records:
        price, size = parse_int(r["price_nis"]), parse_int(r["size_sqm"])
        if mismatch(ppsm_of(price, size), parse_int(r["price_per_sqm"])):
            mismatch_rows += 1
    day_dates = [d["deal_date"] for d in deals if d["date_precision"] == "day" and d["deal_date"]]
    summary = {
        "raw_rows": len(records),
        "deals": len(deals),
        "cities": len({d["city"] for d in deals}),
        "exact_duplicates": sum(d["primary_reason"] == "EXACT_DUP" for d in deals),
        "conflicts": sum("SOURCE_CONFLICT" in d["flags"] for d in deals),
        "excluded": sum(d["status"] == "EXCLUDED" for d in deals),
        "ppsm_mismatch_raw_rows": mismatch_rows,
        "month_only_dates": sum(1 for r in records if parse_date(r["deal_date"])[1] == "month"),
        "latest_deal_date": max(day_dates),
    }
    out = {"summary": summary, "deals": deals}
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=str(DEFAULT_CSV))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    args = ap.parse_args()
    print(json.dumps(build(args.csv, args.out)["summary"], ensure_ascii=False, indent=1))
