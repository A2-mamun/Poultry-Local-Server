import sqlite3

db = sqlite3.connect("poultry.db")

print("TABLES:")
print(db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall())

print("\nSENSOR_DATA COLUMNS:")
print(db.execute("PRAGMA table_info(sensor_data)").fetchall())

print("\nSENSOR_DATA ROW COUNT:")
print(db.execute("SELECT COUNT(*) FROM sensor_data").fetchone())

db.close()

input("\nPress Enter to close...")