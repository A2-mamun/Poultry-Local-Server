import sqlite3

db = sqlite3.connect("poultry.db")

print("COOPS:")
for row in db.execute("SELECT * FROM coops"):
    print(row)

print("\nUSERS:")
for row in db.execute("SELECT id, username, role, coop_id FROM users"):
    print(row)

print("\nFIRST 5 SENSOR RECORDS:")
for row in db.execute("""
    SELECT id, timestamp, temperature, humidity, gas, feed, water, mist_generator, coop_id
    FROM sensor_data
    ORDER BY id
    LIMIT 5
"""):
    print(row)

print("\nLATEST 5 SENSOR RECORDS:")
for row in db.execute("""
    SELECT id, timestamp, temperature, humidity, gas, feed, water, mist_generator, coop_id
    FROM sensor_data
    ORDER BY id DESC
    LIMIT 5
"""):
    print(row)

db.close()

input("\nPress Enter to close...")