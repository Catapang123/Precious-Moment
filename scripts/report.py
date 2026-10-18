"""Generate the Precious Moments monthly operations CSV from Supabase.

Usage: python scripts/report.py [YYYY-MM-DD YYYY-MM-DD]

Uses only the Python standard library. Requires SUPABASE_URL and
SUPABASE_SERVICE_ROLE_KEY in the environment or in a local .env file.
"""

import csv
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

STATUSES = ["pending", "confirmed", "in_progress", "ready", "completed", "cancelled"]
ACTIVE = {"pending", "confirmed", "in_progress", "ready"}


def load_env(path=".env"):
    if not Path(path).exists():
        return
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def fetch(table, base_url, key):
    query = urllib.parse.urlencode({"select": "*", "limit": "10000"})
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/rest/v1/{table}?{query}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:300]
        raise SystemExit(f"Supabase read of {table} failed ({error.code}): {detail}")


def day(value):
    return str(value or "")[:10]


def in_range(value, start, end):
    return start <= day(value) <= end


def to_number(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0


def previous_month():
    today = date.today().replace(day=1)
    last = today - timedelta(days=1)
    return last.replace(day=1), last


def parse_args():
    start, end = previous_month()
    if len(sys.argv) >= 3:
        try:
            start, end = date.fromisoformat(sys.argv[1]), date.fromisoformat(sys.argv[2])
        except ValueError:
            raise SystemExit("Usage: python scripts/report.py [YYYY-MM-DD YYYY-MM-DD]")
    if start > end:
        raise SystemExit("The report start date must be before the end date.")
    return start.isoformat(), end.isoformat()


def build(bookings, users, start, end):
    user_map = {user["id"]: user for user in users}
    created = [b for b in bookings if in_range(b.get("created_at"), start, end)]
    by_status = {status: 0 for status in STATUSES}
    by_service, by_method = {}, {}

    for booking in bookings:
        status = booking.get("status")
        by_status[status] = by_status.get(status, 0) + 1

    def payment_in_period(booking):
        return (
            booking.get("payment_status") != "refunded"
            and to_number(booking.get("amount_paid")) > 0
            and booking.get("paid_at")
            and in_range(booking.get("paid_at"), start, end)
        )

    revenue = sum(to_number(b.get("amount_paid")) for b in bookings if payment_in_period(b))
    outstanding = sum(
        max(0, to_number(b.get("total")) - to_number(b.get("amount_paid")))
        for b in bookings
        if b.get("status") in ACTIVE
    )

    for booking in created:
        for item in booking.get("items") or []:
            name = item.get("name") or "Service"
            entry = by_service.setdefault(name, {"name": name, "units": 0, "revenue": 0})
            units = item.get("area_sqft") if item.get("pricing_mode") == "area" else item.get("qty")
            entry["units"] += to_number(units)
            entry["revenue"] += to_number(item.get("line_total"))

    for booking in bookings:
        if payment_in_period(booking):
            method = booking.get("payment_method") or "Not recorded"
            by_method[method] = by_method.get(method, 0) + to_number(booking.get("amount_paid"))

    staff = []
    for user in users:
        if user.get("role") != "staff":
            continue
        assigned = [b for b in bookings if b.get("staff_id") == user.get("id")]
        staff.append(
            {
                "name": user.get("name", "Crew"),
                "active": sum(1 for b in assigned if b.get("status") in ACTIVE),
                "completed": sum(1 for b in assigned if b.get("status") == "completed"),
            }
        )

    return {
        "created": created,
        "by_status": by_status,
        "by_service": sorted(by_service.values(), key=lambda row: row["revenue"], reverse=True),
        "by_method": sorted(
            [{"method": key, "amount": value} for key, value in by_method.items()],
            key=lambda row: row["amount"],
            reverse=True,
        ),
        "staff": staff,
        "summary": {
            "bookings": len(created),
            "completed": sum(1 for b in created if b.get("status") == "completed"),
            "revenue_collected": round(revenue),
            "outstanding": round(outstanding),
            "average_booking": round(sum(to_number(b.get("total")) for b in created) / len(created))
            if created
            else 0,
        },
        "user_map": user_map,
    }


def cell(value):
    text = str(value if value is not None else "")
    if text[:1] in ("=", "+", "-", "@"):
        text = "'" + text
    return text


def write_csv(path, report, start, end):
    summary = report["summary"]
    lines = [
        ["Precious Moments operations report"],
        ["From", start, "To", end],
        ["Generated", datetime.now(timezone.utc).isoformat()],
        [],
        ["Bookings created", summary["bookings"]],
        ["Completed", summary["completed"]],
        ["Payments recorded", summary["revenue_collected"]],
        ["Outstanding balance", summary["outstanding"]],
        ["Average booking", summary["average_booking"]],
        [],
        ["Reference", "Event date", "Customer", "Status", "Payment status", "Total", "Paid", "Items"],
    ]
    for booking in report["created"]:
        customer = report["user_map"].get(booking.get("customer_id"), {})
        lines.append(
            [
                booking.get("ref", ""),
                booking.get("event_date", ""),
                customer.get("name", "Customer"),
                booking.get("status", ""),
                booking.get("payment_status", ""),
                round(to_number(booking.get("total"))),
                round(to_number(booking.get("amount_paid"))),
                "; ".join(item.get("name", "") for item in booking.get("items") or []),
            ]
        )

    with open(path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerows([[cell(value) for value in row] for row in lines])


def main():
    load_env()
    base_url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not base_url or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before generating a report.")

    start, end = parse_args()
    bookings = fetch("pm_bookings", base_url, key)
    users = fetch("pm_users", base_url, key)
    report = build(bookings, users, start, end)

    output_dir = Path("reports")
    output_dir.mkdir(exist_ok=True)
    path = output_dir / f"precious-moments-{start}-to-{end}.csv"
    write_csv(path, report, start, end)

    summary = report["summary"]
    print(f"Report written to {path}")
    print(
        f"  {summary['bookings']} bookings created · "
        f"PHP {summary['revenue_collected']:,} recorded · "
        f"PHP {summary['outstanding']:,} outstanding"
    )


if __name__ == "__main__":
    main()
