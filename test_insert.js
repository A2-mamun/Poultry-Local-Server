const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function testInsert() {
    try {
        const result = await pool.query(`
            INSERT INTO sensor_data
            (temperature, humidity, gas, feed, water, mist_generator, coop_id)
            VALUES
            (99.9, 99.9, 999, 99, 99, 0, 1)
            RETURNING id, timestamp;
        `);

        console.log("Test insert successful:");
        console.table(result.rows);

        await pool.query(`
            DELETE FROM sensor_data
            WHERE id = $1;
        `, [result.rows[0].id]);

        console.log("Test record removed.");
        console.log("Existing data remains untouched.");

    } catch (error) {
        console.error("ERROR:", error);
    } finally {
        await pool.end();
    }
}

testInsert();
