require("dotenv").config({ path: ".env.local" });

const fs = require("fs");
const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is missing from .env.local");
  process.exit(1);
}

const rows = JSON.parse(
  fs.readFileSync("sqlite_export.json", "utf8")
).sensor_data || [];

console.log(`SQLite historical records available: ${rows.length}`);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

pool.on("error", (err) => {
  console.log(`Pool connection error: ${err.code || err.message}`);
});

async function queryWithRetry(sql, params = [], attempts = 8) {
  let lastError;

  for (let i = 1; i <= attempts; i++) {
    try {
      return await pool.query(sql, params);
    } catch (err) {
      lastError = err;

      const retryable = [
        "ECONNRESET",
        "ECONNREFUSED",
        "ETIMEDOUT",
        "57P01",
        "08001",
        "08003",
        "08006",
        "08007"
      ].includes(err.code);

      if (!retryable || i === attempts) {
        throw err;
      }

      console.log(
        `Database connection reset. Retrying ${i}/${attempts}...`
      );

      await new Promise(resolve =>
        setTimeout(resolve, Math.min(i * 3000, 15000))
      );
    }
  }

  throw lastError;
}

async function main() {
  await queryWithRetry("SELECT 1");

  console.log("Connected to Neon PostgreSQL.");

  await queryWithRetry(`
    CREATE TABLE IF NOT EXISTS poultry_legacy_sensor_map (
      legacy_id INTEGER PRIMARY KEY,
      sensor_id INTEGER UNIQUE NOT NULL
    )
  `);

  const maxResult = await queryWithRetry(`
    SELECT COALESCE(MAX(id), 0) AS max_id
    FROM sensor_data
  `);

  let nextId = Number(maxResult.rows[0].max_id) + 1;

  let inserted = 0;
  let mapped = 0;
  let matched = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const map = await queryWithRetry(
      `SELECT sensor_id
       FROM poultry_legacy_sensor_map
       WHERE legacy_id = $1`,
      [row.id]
    );

    if (map.rows.length > 0) {
      mapped++;
      continue;
    }

    const existing = await queryWithRetry(
      `SELECT id
       FROM sensor_data
       WHERE timestamp = $1
         AND coop_id = $2
         AND temperature = $3
         AND humidity = $4
         AND gas = $5
         AND feed = $6
         AND water = $7
         AND mist_generator = $8
       LIMIT 1`,
      [
        row.timestamp,
        row.coop_id,
        row.temperature,
        row.humidity,
        row.gas,
        row.feed,
        row.water,
        row.mist_generator
      ]
    );

    let sensorId;

    if (existing.rows.length > 0) {
      sensorId = existing.rows[0].id;
      matched++;
    } else {
      sensorId = nextId++;

      await queryWithRetry(
        `INSERT INTO sensor_data
        (id, timestamp, temperature, humidity, gas, feed, water,
         mist_generator, coop_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          sensorId,
          row.timestamp,
          row.temperature,
          row.humidity,
          row.gas,
          row.feed,
          row.water,
          row.mist_generator,
          row.coop_id
        ]
      );

      inserted++;
    }

    await queryWithRetry(
      `INSERT INTO poultry_legacy_sensor_map
       (legacy_id, sensor_id)
       VALUES ($1, $2)
       ON CONFLICT (legacy_id) DO NOTHING`,
      [row.id, sensorId]
    );

    if ((i + 1) % 100 === 0 || i + 1 === rows.length) {
      console.log(`Processed ${i + 1}/${rows.length}`);
    }
  }

  const sequence = await queryWithRetry(`
    SELECT pg_get_serial_sequence('sensor_data', 'id') AS seq
  `);

  if (sequence.rows[0].seq) {
    await queryWithRetry(
      `SELECT setval(
        $1::regclass,
        (SELECT COALESCE(MAX(id), 1) FROM sensor_data),
        true
      )`,
      [sequence.rows[0].seq]
    );
  }

  const count = await queryWithRetry(`
    SELECT COUNT(*)::bigint AS count
    FROM sensor_data
  `);

  const coop1 = await queryWithRetry(`
    SELECT COUNT(*)::bigint AS count
    FROM sensor_data
    WHERE coop_id = 1
  `);

  const dates = await queryWithRetry(`
    SELECT MIN(timestamp) AS oldest,
           MAX(timestamp) AS newest
    FROM sensor_data
  `);

  console.log("");
  console.log("========================================");
  console.log("       MIGRATION COMPLETE");
  console.log("========================================");
  console.log(`Historical records: ${rows.length}`);
  console.log(`New records inserted: ${inserted}`);
  console.log(`Already mapped: ${mapped}`);
  console.log(`Matched existing: ${matched}`);
  console.log(`Final sensor_data count: ${count.rows[0].count}`);
  console.log(`Final Coop-01 count: ${coop1.rows[0].count}`);
  console.log(`Oldest: ${dates.rows[0].oldest}`);
  console.log(`Newest: ${dates.rows[0].newest}`);
  console.log("========================================");

  await pool.end();
}

main().catch(async (err) => {
  console.error("");
  console.error("MIGRATION STOPPED:");
  console.error(err);

  try {
    await pool.end();
  } catch {}

  process.exit(1);
});
