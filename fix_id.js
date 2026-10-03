const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function fixId() {
    try {
        await pool.query(`
            CREATE SEQUENCE IF NOT EXISTS sensor_data_id_seq;
        `);

        await pool.query(`
            SELECT setval(
                'sensor_data_id_seq',
                COALESCE(MAX(id), 0) + 1,
                false
            )
            FROM sensor_data;
        `);

        await pool.query(`
            ALTER TABLE sensor_data
            ALTER COLUMN id
            SET DEFAULT nextval('sensor_data_id_seq');
        `);

        await pool.query(`
            ALTER SEQUENCE sensor_data_id_seq
            OWNED BY sensor_data.id;
        `);

        const result = await pool.query(`
            SELECT
                MAX(id) AS max_id,
                COUNT(*) AS total_records
            FROM sensor_data;
        `);

        const defaultResult = await pool.query(`
            SELECT column_default
            FROM information_schema.columns
            WHERE table_name = 'sensor_data'
              AND column_name = 'id';
        `);

        console.log("ID configuration fixed successfully.");
        console.table(result.rows);
        console.table(defaultResult.rows);

    } catch (error) {
        console.error("ERROR:", error);
    } finally {
        await pool.end();
    }
}

fixId();
