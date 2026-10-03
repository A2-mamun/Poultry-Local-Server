import sqlite3
import json
from pathlib import Path

DB = Path("poultry.db")
OUT = Path("sqlite_export.json")

if not DB.exists():
    raise SystemExit("poultry.db was not found.")

db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row

payload = {}
for table in ["coops", "users", "sessions", "sensor_data"]:
    rows = db.execute(f"SELECT * FROM {table}").fetchall()
    payload[table] = [dict(row) for row in rows]

db.close()
OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")

print("SQLite export completed.")
for table, rows in payload.items():
    print(f"{table}: {len(rows)} records")
print(f"Created: {OUT}")
input("Press Enter to close...")
