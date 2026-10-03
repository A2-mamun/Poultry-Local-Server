require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is missing. Put your Neon connection string in .env.local.");
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync("sqlite_export.json", "utf8")).sensor_data || [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function connectWithRetry() {
  let last;
  for (let attempt = 1; attempt <= 8; attempt++) {
    const c = new Client({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 20000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000
    });
    try {
      await c.connect();
      console.log(`Connected to Neon PostgreSQL (attempt ${attempt}).`);
      return c;
    } catch (e) {
      last = e;
      try { await c.end(); } catch {}
      console.log(`Connection attempt ${attempt} failed: ${e.code || e.message}`);
      if (attempt < 8) await sleep(Math.min(3000 * attempt, 15000));
    }
  }
  throw last;
}

async function main() {
  console.log(`SQLite historical records available: ${rows.length}`);
  let client = await connectWithRetry();

  try {
    await client.query(`CREATE TABLE IF NOT EXISTS poultry_legacy_sensor_map (
      legacy_id INTEGER PRIMARY KEY, sensor_id INTEGER UNIQUE NOT NULL
    )`);

    const max = await client.query(`SELECT COALESCE(MAX(id),0) AS max_id FROM sensor_data`);
    let nextId = Number(max.rows[0].max_id) + 1;
    let inserted = 0, mapped = 0, matched = 0, processed = 0;

    for (const row of rows) {
      let done = false;

      for (let attempt = 1; attempt <= 8 && !done; attempt++) {
        try {
          const map = await client.query(
            `SELECT sensor_id FROM poultry_legacy_sensor_map WHERE legacy_id=$1`, [row.id]
          );

          if (map.rows.length) {
            mapped++; done = true; processed++; break;
          }

          const existing = await client.query(
            `SELECT id FROM sensor_data
             WHERE timestamp=$1 AND coop_id=$2 AND temperature=$3 AND humidity=$4
             AND gas=$5 AND feed=$6 AND water=$7 AND mist_generator=$8 LIMIT 1`,
            [row.timestamp,row.coop_id,row.temperature,row.humidity,row.gas,row.feed,row.water,row.mist_generator]
          );

          let sensorId;
          if (existing.rows.length) {
            sensorId = existing.rows[0].id;
            matched++;
          } else {
            sensorId = nextId++;
            await client.query(
              `INSERT INTO sensor_data
               (id,timestamp,temperature,humidity,gas,feed,water,mist_generator,coop_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [sensorId,row.timestamp,row.temperature,row.humidity,row.gas,row.feed,row.water,row.mist_generator,row.coop_id]
            );
            inserted++;
          }

          await client.query(
            `INSERT INTO poultry_legacy_sensor_map(legacy_id,sensor_id)
             VALUES($1,$2) ON CONFLICT(legacy_id) DO NOTHING`, [row.id,sensorId]
          );

          done = true; processed++;
          if (processed % 100 === 0 || processed === rows.length)
            console.log(`Processed ${processed}/${rows.length}`);
        } catch (e) {
          const transient = ["ECONNRESET","ECONNREFUSED","ETIMEDOUT","57P01","08006","08001","08003","08004","08007"].includes(e.code)
            || /Connection terminated|connection.*closed|socket.*closed/i.test(e.message || "");
          if (!transient || attempt === 8) throw e;
          console.log(`Connection interrupted. Reconnecting (attempt ${attempt + 1}/8)...`);
          try { await client.end(); } catch {}
          await sleep(Math.min(2000 * attempt, 12000));
          client = await connectWithRetry();
        }
      }
    }

    const seq = await client.query(`SELECT pg_get_serial_sequence('sensor_data','id') AS seq`);
    if (seq.rows[0].seq) {
      await client.query(
        `SELECT setval($1::regclass,(SELECT COALESCE(MAX(id),1) FROM sensor_data),true)`,
        [seq.rows[0].seq]
      );
    }

    const count = await client.query(`SELECT COUNT(*)::bigint AS count FROM sensor_data`);
    const coop1 = await client.query(`SELECT COUNT(*)::bigint AS count FROM sensor_data WHERE coop_id=1`);
    const range = await client.query(`SELECT MIN(timestamp) AS oldest,MAX(timestamp) AS newest FROM sensor_data`);

    console.log("");
    console.log("========== MIGRATION COMPLETE ==========");
    console.log(`Historical rows available: ${rows.length}`);
    console.log(`New historical rows inserted: ${inserted}`);
    console.log(`Already mapped on previous run: ${mapped}`);
    console.log(`Matched existing rows: ${matched}`);
    console.log(`Final sensor_data count: ${count.rows[0].count}`);
    console.log(`Final Coop-01 count: ${coop1.rows[0].count}`);
    console.log(`Oldest timestamp: ${range.rows[0].oldest}`);
    console.log(`Newest timestamp: ${range.rows[0].newest}`);
    console.log("========================================");
  } finally {
    try { await client.end(); } catch {}
  }
}

main().catch(e => {
  console.error("");
  console.error("MIGRATION STOPPED:");
  console.error(e);
  process.exit(1);
});
