const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function check() {
    try {
        const result = await pool.query(`
            SELECT column_name, column_default
            FROM information_schema.columns
            WHERE table_name = 'sensor_data'
            ORDER BY ordinal_position
        `);

        console.table(result.rows);
    } catch (error) {
        console.error(error);
    } finally {
        await pool.end();
    }
}

check();
