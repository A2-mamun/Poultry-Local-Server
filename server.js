const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================================
   DATABASE CONNECTION (NEON POSTGRESQL)
========================================= */

const dbUrl = process.env.DATABASE_URL || "";
const connectionString = dbUrl.includes("sslmode=")
  ? dbUrl
  : `${dbUrl}${dbUrl.includes("?") ? "&" : "?"}sslmode=require`;

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================================
   DATABASE INITIALIZATION
========================================= */

async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coops (
        id SERIAL PRIMARY KEY,
        coop_name VARCHAR(255) NOT NULL,
        api_key VARCHAR(255) UNIQUE NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        coop_id INT REFERENCES coops(id) ON DELETE SET NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        token VARCHAR(255) PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at BIGINT NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sensor_data (
        id SERIAL PRIMARY KEY,
        coop_id INT NOT NULL REFERENCES coops(id),
        temperature NUMERIC,
        humidity NUMERIC,
        gas NUMERIC,
        feed NUMERIC,
        water NUMERIC,
        mist_generator INT DEFAULT 0,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await seedInitialData();
    console.log("Database schema initialized successfully.");
  } catch (err) {
    console.error("Database initialization error:", err);
  }
}

/* =========================================
   PASSWORD FUNCTIONS
========================================= */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
  const parts = storedPassword.split(":");
  if (parts.length !== 2) return false;

  const salt = parts[0];
  const storedHash = parts[1];
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");

  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(storedHash, "hex")
  );
}

/* =========================================
   INITIAL SEED DATA
========================================= */

async function createCoopIfNotExists(coopName, apiKey) {
  const existing = await pool.query(
    `SELECT id FROM coops WHERE coop_name = $1`,
    [coopName]
  );
  if (existing.rowCount === 0) {
    await pool.query(
      `INSERT INTO coops (coop_name, api_key) VALUES ($1, $2)`,
      [coopName, apiKey]
    );
  }
}

async function createUserIfNotExists(username, password, role, coopId) {
  const existing = await pool.query(
    `SELECT id FROM users WHERE username = $1`,
    [username]
  );
  if (existing.rowCount === 0) {
    await pool.query(
      `INSERT INTO users (username, password, role, coop_id) VALUES ($1, $2, $3, $4)`,
      [username, hashPassword(password), role, coopId]
    );
  }
}

async function seedInitialData() {
  await createCoopIfNotExists("Coop-01", "COOP01_KEY_2304031");
  await createCoopIfNotExists("Coop-02", "COOP02_KEY_2304031");
  await createCoopIfNotExists("Coop-03", "COOP03_KEY_2304031");

  await createUserIfNotExists("boss", "boss123", "boss", null);
  await createUserIfNotExists("manager1", "manager123", "manager", 1);
  await createUserIfNotExists("manager2", "manager123", "manager", 2);
  await createUserIfNotExists("manager3", "manager123", "manager", 3);
}

/* =========================================
   SESSION FUNCTIONS
========================================= */

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

  await pool.query(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)`,
    [token, userId, expiresAt]
  );

  return token;
}

function getCookie(req, name) {
  const cookies = req.headers.cookie;
  if (!cookies) return null;

  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(value.join("="));
    }
  }
  return null;
}

/* =========================================
   AUTH MIDDLEWARE
========================================= */

async function authenticate(req, res, next) {
  const token = getCookie(req, "session_token");
  if (!token) {
    return res.status(401).json({ error: "Not logged in" });
  }

  try {
    const result = await pool.query(
      `SELECT
          sessions.token,
          sessions.expires_at,
          users.id,
          users.username,
          users.role,
          users.coop_id
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = $1`,
      [token]
    );

    const session = result.rows[0];

    if (!session || Number(session.expires_at) < Date.now()) {
      if (token) {
        await pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);
      }
      return res.status(401).json({ error: "Session expired" });
    }

    req.user = session;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Authentication error" });
  }
}

/* =========================================
   LOGIN & LOGOUT
========================================= */

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  const userRes = await pool.query(`SELECT * FROM users WHERE username = $1`, [username]);
  const user = userRes.rows[0];

  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const token = await createSession(user.id);

  res.setHeader(
    "Set-Cookie",
    `session_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
  );

  let coop = null;
  if (user.coop_id) {
    const coopRes = await pool.query(`SELECT id, coop_name FROM coops WHERE id = $1`, [user.coop_id]);
    coop = coopRes.rows[0] || null;
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      coop: coop
    }
  });
});

app.post("/api/logout", authenticate, async (req, res) => {
  const token = getCookie(req, "session_token");
  await pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);

  res.setHeader(
    "Set-Cookie",
    "session_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
  );

  res.json({ success: true });
});

app.get("/api/me", authenticate, async (req, res) => {
  let coop = null;
  if (req.user.coop_id) {
    const coopRes = await pool.query(`SELECT id, coop_name FROM coops WHERE id = $1`, [req.user.coop_id]);
    coop = coopRes.rows[0] || null;
  }

  res.json({
    id: req.user.id,
    username: req.user.username,
    role: req.user.role,
    coop: coop
  });
});

/* =========================================
   SENSOR DATA INGESTION
========================================= */

app.post("/api/sensor-data", async (req, res) => {
  const {
    coopId,
    temperature,
    humidity,
    gas,
    feed,
    water,
    mistGenerator
  } = req.body;

  const selectedCoop = Number(coopId);
  if (!Number.isInteger(selectedCoop) || selectedCoop < 1) {
    return res.status(400).json({ success: false, error: "Valid coopId is required" });
  }

  try {
    const coopRes = await pool.query(
      `SELECT id, coop_name FROM coops WHERE id = $1`,
      [selectedCoop]
    );

    if (coopRes.rowCount === 0) {
      return res.status(400).json({ success: false, error: "Invalid coop" });
    }

    await pool.query(
      `INSERT INTO sensor_data 
        (coop_id, temperature, humidity, gas, feed, water, mist_generator)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        selectedCoop,
        temperature ?? null,
        humidity ?? null,
        gas ?? null,
        feed ?? null,
        water ?? null,
        mistGenerator ? 1 : 0
      ]
    );

    res.json({
      success: true,
      message: "Sensor data stored",
      coopId: selectedCoop,
      coopName: coopRes.rows[0].coop_name
    });
  } catch (error) {
    console.error("Sensor data insert error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to store sensor data",
      details: error.message
    });
  }
});

/* =========================================
   DASHBOARD APIS
========================================= */

app.get("/api/sensor-data/latest", authenticate, async (req, res) => {
  try {
    let query, params;

    if (req.user.role === "manager") {
      query = `
        SELECT sensor_data.*, coops.coop_name,
               EXTRACT(EPOCH FROM sensor_data.timestamp) * 1000 AS epoch_ms
        FROM sensor_data
        JOIN coops ON coops.id = sensor_data.coop_id
        WHERE sensor_data.coop_id = $1
        ORDER BY sensor_data.id DESC LIMIT 1`;
      params = [req.user.coop_id];
    } else {
      query = `
        SELECT sensor_data.*, coops.coop_name,
               EXTRACT(EPOCH FROM sensor_data.timestamp) * 1000 AS epoch_ms
        FROM sensor_data
        JOIN coops ON coops.id = sensor_data.coop_id
        ORDER BY sensor_data.id DESC LIMIT 1`;
      params = [];
    }

    const result = await pool.query(query, params);
    const latest = result.rows[0] || null;

    if (latest) {
      const dbMs = Number(latest.epoch_ms);
      const diffSeconds = (Date.now() - dbMs) / 1000;
      // 120-second timeout window
      latest.online = diffSeconds <= 120;
    }

    res.json(latest);
  } catch (err) {
    console.error("Error fetching latest sensor data:", err);
    res.status(500).json({ error: "Failed to fetch sensor data" });
  }
});

app.get("/api/manager/history", authenticate, async (req, res) => {
  if (req.user.role !== "manager") {
    return res.status(403).json({ error: "Manager access required" });
  }

  const hours = Number(req.query.hours) || 24;

  try {
    const result = await pool.query(
      `SELECT 
        id,
        coop_id,
        temperature,
        humidity,
        gas,
        feed,
        water,
        mist_generator,
        timestamp
       FROM sensor_data 
       WHERE coop_id = $1 
         AND timestamp >= NOW() - ($2 || ' hours')::INTERVAL 
       ORDER BY timestamp ASC`,
      [req.user.coop_id, hours]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching manager history:", error);
    res.status(500).json({ error: "Failed to fetch historical data" });
  }
});

app.get("/api/boss/overview", authenticate, async (req, res) => {
  if (req.user.role !== "boss") {
    return res.status(403).json({ error: "Boss access required" });
  }

  try {
    const coopsRes = await pool.query(`SELECT id, coop_name FROM coops ORDER BY id`);
    const coops = coopsRes.rows;

    const results = await Promise.all(
      coops.map(async (coop) => {
        const latestRes = await pool.query(
          `SELECT
              sensor_data.*,
              users.username AS manager_name,
              EXTRACT(EPOCH FROM sensor_data.timestamp) * 1000 AS epoch_ms
           FROM sensor_data
           JOIN coops ON coops.id = sensor_data.coop_id
           LEFT JOIN users ON users.coop_id = coops.id AND users.role = 'manager'
           WHERE sensor_data.coop_id = $1
           ORDER BY sensor_data.id DESC LIMIT 1`,
          [coop.id]
        );

        const latest = latestRes.rows[0] || null;
        let online = false;

        if (latest) {
          const dbMs = Number(latest.epoch_ms);
          const diffSeconds = (Date.now() - dbMs) / 1000;
          // 120-second timeout window
          online = diffSeconds <= 120;
        }

        return {
          coop: coop,
          manager: latest ? latest.manager_name : "Not available",
          online: online,
          data: latest
        };
      })
    );

    const active = results.filter((item) => item.data);

    const average = {
      temperature: active.length ? active.reduce((s, i) => s + Number(i.data.temperature), 0) / active.length : null,
      humidity: active.length ? active.reduce((s, i) => s + Number(i.data.humidity), 0) / active.length : null,
      gas: active.length ? active.reduce((s, i) => s + Number(i.data.gas), 0) / active.length : null,
      feed: active.length ? active.reduce((s, i) => s + Number(i.data.feed), 0) / active.length : null,
      water: active.length ? active.reduce((s, i) => s + Number(i.data.water), 0) / active.length : null
    };

    res.json({
      totalCoops: results.length,
      onlineCoops: results.filter((item) => item.online).length,
      offlineCoops: results.filter((item) => !item.online).length,
      average: average,
      coops: results
    });
  } catch (error) {
    console.error("Error fetching boss overview:", error);
    res.status(500).json({ error: "Failed to fetch boss overview" });
  }
});

app.get("/api/boss/coop/:id", authenticate, async (req, res) => {
  if (req.user.role !== "boss") {
    return res.status(403).json({ error: "Boss access required" });
  }

  const coopId = Number(req.params.id);

  try {
    const coopRes = await pool.query(`SELECT * FROM coops WHERE id = $1`, [coopId]);
    if (coopRes.rowCount === 0) {
      return res.status(404).json({ error: "Coop not found" });
    }

    const managerRes = await pool.query(
      `SELECT id, username FROM users WHERE role = 'manager' AND coop_id = $1`,
      [coopId]
    );

    const historyRes = await pool.query(
      `SELECT * FROM sensor_data WHERE coop_id = $1 ORDER BY id DESC LIMIT 10000`,
      [coopId]
    );

    res.json({
      coop: coopRes.rows[0],
      manager: managerRes.rows[0] || null,
      history: historyRes.rows
    });
  } catch (error) {
    console.error("Error fetching boss coop detail:", error);
    res.status(500).json({ error: "Failed to fetch coop detail" });
  }
});

app.get("/api/boss/history", authenticate, async (req, res) => {
  if (req.user.role !== "boss") {
    return res.status(403).json({ error: "Boss access required" });
  }

  const { coopId, date } = req.query;
  let query = `
    SELECT sensor_data.*, coops.coop_name
    FROM sensor_data
    JOIN coops ON coops.id = sensor_data.coop_id
  `;
  const conditions = [];
  const params = [];

  if (coopId && coopId !== "all" && coopId !== "ALL") {
    const parsedId = Number(coopId);
    if (!isNaN(parsedId)) {
      params.push(parsedId);
      conditions.push(`sensor_data.coop_id = $${params.length}`);
    } else {
      params.push(coopId);
      conditions.push(`coops.coop_name = $${params.length}`);
    }
  }

  if (date) {
    params.push(date);
    conditions.push(`
      sensor_data.timestamp >= TO_DATE($${params.length}, 'YYYY-MM-DD')
      AND sensor_data.timestamp < TO_DATE($${params.length}, 'YYYY-MM-DD') + INTERVAL '1 day'
    `);
  }

  if (conditions.length > 0) {
    query += ` WHERE ` + conditions.join(" AND ");
  }

  query += ` ORDER BY sensor_data.id DESC LIMIT 10000`;

  try {
    const result = await pool.query(query, params);
    res.json({
      success: true,
      records: result.rows,
      total: result.rowCount,
      returned: result.rowCount
    });
  } catch (error) {
    console.error("Error fetching boss history:", error);
    res.status(500).json({ error: "Failed to fetch historical data" });
  }
});

/* =========================================
   PAGE ROUTING (BEFORE STATIC MIDDLEWARE)
========================================= */

app.get("/", async (req, res) => {
  const token = getCookie(req, "session_token");
  if (!token) return res.redirect("/login.html");

  try {
    const result = await pool.query(
      `SELECT sessions.expires_at, users.role FROM sessions 
       JOIN users ON users.id = sessions.user_id WHERE sessions.token = $1`,
      [token]
    );
    const session = result.rows[0];

    if (!session || Number(session.expires_at) < Date.now()) {
      return res.redirect("/login.html");
    }

    return res.redirect(session.role === "boss" ? "/boss.html" : "/manager.html");
  } catch (err) {
    return res.redirect("/login.html");
  }
});

/* =========================================
   STATIC FRONTEND
========================================= */

app.use(express.static(path.join(__dirname, "public")));

/* =========================================
   START SERVER
========================================= */

initDb().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Poultry server running live on port ${PORT}`);
  });
});
