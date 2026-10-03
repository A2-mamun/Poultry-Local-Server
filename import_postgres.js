const fs = require("fs");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
}

if (!fs.existsSync("sqlite_export.json")) {
    console.error("sqlite_export.json was not found.");
    process.exit(1);
}

const data = JSON.parse(
    fs.readFileSync("sqlite_export.json", "utf8")
);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
    connectionTimeoutMillis: 10000
});

async function insertBatch(client, table, columns, rows, batchSize = 200) {
    for (let start = 0; start < rows.length; start += batchSize) {
        const batch = rows.slice(start, start + batchSize);

        const values = [];
        const placeholders = [];

        batch.forEach((row, rowIndex) => {
            const rowPlaceholders = [];

            row.forEach((value, columnIndex) => {
                values.push(value);
                rowPlaceholders.push(
                    `$${rowIndex * row.length + columnIndex + 1}`
                );
            });

            placeholders.push(`(${rowPlaceholders.join(",")})`);
        });

        await client.query(
            `INSERT INTO ${table} (${columns.join(",")})
             VALUES ${placeholders.join(",")}`,
            values
        );

        console.log(
            `${table}: ${Math.min(start + batch.length, rows.length)}/${rows.length}`
        );
    }
}

async function run() {
    const client = await pool.connect();

    try {
        console.log("Connected to Railway PostgreSQL.");
        console.log("Starting migration...");

        await client.query("BEGIN");

        await client.query(`
            CREATE TABLE IF NOT EXISTS coops (
                id INTEGER PRIMARY KEY,
                coop_name TEXT NOT NULL,
                api_key TEXT UNIQUE NOT NULL
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL,
                coop_id INTEGER REFERENCES coops(id)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                expires_at BIGINT NOT NULL
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS sensor_data (
                id INTEGER PRIMARY KEY,
                timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                temperature DOUBLE PRECISION,
                humidity DOUBLE PRECISION,
                gas INTEGER,
                feed INTEGER,
                water INTEGER,
                mist_generator INTEGER DEFAULT 0,
                coop_id INTEGER NOT NULL DEFAULT 1 REFERENCES coops(id)
            )
        `);

        console.log("Tables ready.");

        await insertBatch(
            client,
            "coops",
            ["id", "coop_name", "api_key"],
            data.coops.map(r => [
                r.id,
                r.coop_name,
                r.api_key
            ])
        );

        await insertBatch(
            client,
            "users",
            ["id", "username", "password", "role", "coop_id"],
            data.users.map(r => [
                r.id,
                r.username,
                r.password,
                r.role,
                r.coop_id
            ])
        );

        await insertBatch(
            client,
            "sessions",
            ["token", "user_id", "expires_at"],
            data.sessions.map(r => [
                r.token,
                r.user_id,
                r.expires_at
            ])
        );

        await insertBatch(
            client,
            "sensor_data",
            [
                "id",
                "timestamp",
                "temperature",
                "humidity",
                "gas",
                "feed",
                "water",
                "mist_generator",
                "coop_id"
            ],
            data.sensor_data.map(r => [
                r.id,
                r.timestamp,
                r.temperature,
                r.humidity,
                r.gas,
                r.feed,
                r.water,
                r.mist_generator,
                r.coop_id
            ])
        );

        console.log("Checking imported data...");

        const coopCount = await client.query(
            "SELECT COUNT(*)::int AS count FROM coops"
        );

        const userCount = await client.query(
            "SELECT COUNT(*)::int AS count FROM users"
        );

        const sessionCount = await client.query(
            "SELECT COUNT(*)::int AS count FROM sessions"
        );

        const sensorCount = await client.query(
            "SELECT COUNT(*)::int AS count FROM sensor_data"
        );

        console.log(`Coops: ${coopCount.rows[0].count}`);
        console.log(`Users: ${userCount.rows[0].count}`);
        console.log(`Sessions: ${sessionCount.rows[0].count}`);
        console.log(`Sensor records: ${sensorCount.rows[0].count}`);

        if (
            coopCount.rows[0].count !== data.coops.length ||
            userCount.rows[0].count !== data.users.length ||
            sessionCount.rows[0].count !== data.sessions.length ||
            sensorCount.rows[0].count !== data.sensor_data.length
        ) {
            throw new Error("Verification failed. Counts do not match.");
        }

        await client.query("COMMIT");

        console.log("");
        console.log("======================================");
        console.log("MIGRATION COMPLETED SUCCESSFULLY");
        console.log("======================================");
        console.log(`Coops: ${data.coops.length}`);
        console.log(`Users: ${data.users.length}`);
        console.log(`Sessions: ${data.sessions.length}`);
        console.log(`Sensor records: ${data.sensor_data.length}`);
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("");
        console.error("Migration failed.");
        console.error("Transaction rolled back.");
        console.error(error);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

run();