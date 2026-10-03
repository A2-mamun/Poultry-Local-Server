const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config({ path: path.join(__dirname, ".env.local") });

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
    console.error("DATABASE_URL was not found.");
    console.error("Make sure .env.local exists in this project folder.");
    process.exit(1);
}

const exportPath = path.join(__dirname, "sqlite_export.json");
if (!fs.existsSync(exportPath)) {
    console.error("sqlite_export.json was not found.");
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(exportPath, "utf8"));
const historical = Array.isArray(data.sensor_data) ? data.sensor_data : [];

const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000
});

function normalizeTimestamp(value) {
    // SQLite CURRENT_TIMESTAMP is UTC and has no timezone suffix.
    // Make that explicit when inserting into PostgreSQL TIMESTAMPTZ.
    const text = String(value).trim();
    if (/[zZ]$|[+-]\d\d:\d\d$/.test(text)) return text;
    return text.replace(" ", "T") + "Z";
}

async function run() {
    const client = await pool.connect();

    try {
        console.log("Connected to Neon PostgreSQL.");
        console.log(`SQLite historical records available: ${historical.length}`);

        await client.query("BEGIN");

        // Prevent live ESP32 inserts while the historical rows are being assigned IDs.
        // The lock is released automatically when this transaction commits.
        await client.query("LOCK TABLE sensor_data IN ACCESS EXCLUSIVE MODE");

        // Track which SQLite IDs have already been migrated so this script is safe to run again.
        await client.query(`
            CREATE TABLE IF NOT EXISTS poultry_legacy_sensor_map (
                legacy_id INTEGER PRIMARY KEY,
                sensor_id INTEGER NOT NULL UNIQUE
            )
        `);

        const maxResult = await client.query(`
            SELECT COALESCE(MAX(id), 0)::bigint AS max_id
            FROM sensor_data
        `);

        let nextId = Number(maxResult.rows[0].max_id) + 1;

        let inserted = 0;
        let alreadyMapped = 0;
        let matchedExisting = 0;

        for (const row of historical) {
            const legacyId = Number(row.id);

            const mapped = await client.query(
                `SELECT sensor_id
                 FROM poultry_legacy_sensor_map
                 WHERE legacy_id = $1`,
                [legacyId]
            );

            if (mapped.rowCount > 0) {
                alreadyMapped++;
                continue;
            }

            const timestamp = normalizeTimestamp(row.timestamp);

            // If the same historical row is already present (for example after
            // a previous manual migration), reuse it instead of creating a duplicate.
            const existing = await client.query(
                `SELECT id
                 FROM sensor_data
                 WHERE timestamp = $1::timestamptz
                   AND coop_id = $2
                   AND temperature IS NOT DISTINCT FROM $3
                   AND humidity IS NOT DISTINCT FROM $4
                   AND gas IS NOT DISTINCT FROM $5
                   AND feed IS NOT DISTINCT FROM $6
                   AND water IS NOT DISTINCT FROM $7
                   AND mist_generator IS NOT DISTINCT FROM $8
                 ORDER BY id
                 LIMIT 1`,
                [
                    timestamp,
                    Number(row.coop_id),
                    row.temperature ?? null,
                    row.humidity ?? null,
                    row.gas ?? null,
                    row.feed ?? null,
                    row.water ?? null,
                    row.mist_generator ?? 0
                ]
            );

            let sensorId;

            if (existing.rowCount > 0) {
                sensorId = Number(existing.rows[0].id);
                matchedExisting++;
            } else {
                sensorId = nextId++;

                await client.query(
                    `INSERT INTO sensor_data
                        (id, timestamp, coop_id, temperature, humidity,
                         gas, feed, water, mist_generator)
                     VALUES
                        ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9)`,
                    [
                        sensorId,
                        timestamp,
                        Number(row.coop_id),
                        row.temperature ?? null,
                        row.humidity ?? null,
                        row.gas ?? null,
                        row.feed ?? null,
                        row.water ?? null,
                        row.mist_generator ?? 0
                    ]
                );

                inserted++;
            }

            await client.query(
                `INSERT INTO poultry_legacy_sensor_map (legacy_id, sensor_id)
                 VALUES ($1, $2)
                 ON CONFLICT (legacy_id) DO NOTHING`,
                [legacyId, sensorId]
            );

            if ((inserted + matchedExisting + alreadyMapped) % 100 === 0) {
                console.log(
                    `Processed ${inserted + matchedExisting + alreadyMapped}/${historical.length}`
                );
            }
        }

        // Reset the actual SERIAL sequence used by sensor_data.id.
        const sequenceResult = await client.query(`
            SELECT pg_get_serial_sequence('sensor_data', 'id') AS sequence_name
        `);

        const sequenceName = sequenceResult.rows[0].sequence_name;

        if (sequenceName) {
            const safeSequenceName = sequenceName
                .split(".")
                .map(part => `"${part.replace(/"/g, '""')}"`)
                .join(".");

            await client.query(`
                SELECT setval(
                    '${safeSequenceName}',
                    COALESCE((SELECT MAX(id) FROM sensor_data), 1),
                    true
                )
            `);
        }

        const finalCount = await client.query(`
            SELECT COUNT(*)::int AS count
            FROM sensor_data
        `);

        const coop1Count = await client.query(`
            SELECT COUNT(*)::int AS count
            FROM sensor_data
            WHERE coop_id = 1
        `);

        const oldestNewest = await client.query(`
            SELECT MIN(timestamp) AS oldest,
                   MAX(timestamp) AS newest
            FROM sensor_data
        `);

        await client.query("COMMIT");

        console.log("");
        console.log("==============================================");
        console.log("HISTORICAL DATA MERGE COMPLETED");
        console.log("==============================================");
        console.log(`Inserted historical rows: ${inserted}`);
        console.log(`Already mapped: ${alreadyMapped}`);
        console.log(`Matched existing rows: ${matchedExisting}`);
        console.log(`Final sensor records: ${finalCount.rows[0].count}`);
        console.log(`Coop-01 records: ${coop1Count.rows[0].count}`);
        console.log(`Oldest: ${oldestNewest.rows[0].oldest}`);
        console.log(`Newest: ${oldestNewest.rows[0].newest}`);
        console.log("");
        console.log("The live ESP32 records were preserved.");
        console.log("The sensor ID sequence was reset to continue after the highest ID.");
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (_) {}
        console.error("");
        console.error("MERGE FAILED — transaction rolled back.");
        console.error(error.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

run();
