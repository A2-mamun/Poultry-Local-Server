const express = require("express");
const { Pool, types } = require("pg");

types.setTypeParser(1114, value => value);
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);

if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

app.set("trust proxy", 1);
app.use(express.json());

async function query(text, params = []) {
    return pool.query(text, params);
}

async function initDatabase() {
    await query(`
        CREATE TABLE IF NOT EXISTS coops (
            id INTEGER PRIMARY KEY,
            coop_name TEXT NOT NULL,
            api_key TEXT UNIQUE NOT NULL
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL,
            coop_id INTEGER REFERENCES coops(id)
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            expires_at BIGINT NOT NULL
        )
    `);

    await query(`
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
        await query(`
        CREATE SEQUENCE IF NOT EXISTS sensor_data_id_seq;
    `);

    await query(`
        SELECT setval(
            'sensor_data_id_seq',
            COALESCE((SELECT MAX(id) FROM sensor_data), 0) + 1,
            false
        );
    `);

    await query(`
        ALTER TABLE sensor_data
        ALTER COLUMN id
        SET DEFAULT nextval('sensor_data_id_seq');
    `);

    await query(`
        ALTER SEQUENCE sensor_data_id_seq
        OWNED BY sensor_data.id;
    `);
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
    try {
        const parts = String(storedPassword).split(":");
        if (parts.length !== 2) return false;
        const hash = crypto.scryptSync(password, parts[0], 64).toString("hex");
        const a = Buffer.from(hash, "hex");
        const b = Buffer.from(parts[1], "hex");
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (_) {
        return false;
    }
}

async function seedDefaults() {
    const coops = [
        [1, "Coop-01", process.env.COOP01_API_KEY || "COOP01_KEY_2304031"],
        [2, "Coop-02", process.env.COOP02_API_KEY || "COOP02_KEY_2304031"],
        [3, "Coop-03", process.env.COOP03_API_KEY || "COOP03_KEY_2304031"]
    ];

    for (const [id, name, key] of coops) {
        await query(`
            INSERT INTO coops (id, coop_name, api_key)
            VALUES ($1, $2, $3)
            ON CONFLICT (id) DO NOTHING
        `, [id, name, key]);
    }

    const users = [
        [1, process.env.BOSS_USERNAME || "boss", process.env.BOSS_PASSWORD || "boss123", "boss", null],
        [2, process.env.MANAGER1_USERNAME || "manager1", process.env.MANAGER1_PASSWORD || "manager123", "manager", 1],
        [3, process.env.MANAGER2_USERNAME || "manager2", process.env.MANAGER2_PASSWORD || "manager123", "manager", 2],
        [4, process.env.MANAGER3_USERNAME || "manager3", process.env.MANAGER3_PASSWORD || "manager123", "manager", 3]
    ];

    for (const [id, username, password, role, coopId] of users) {
        const existing = await query("SELECT id FROM users WHERE username = $1", [username]);
        if (existing.rowCount === 0) {
            await query(`
                INSERT INTO users (id, username, password, role, coop_id)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (id) DO NOTHING
            `, [id, username, hashPassword(password), role, coopId]);
        }
    }
}

function getCookie(req, name) {
    const cookies = req.headers.cookie;
    if (!cookies) return null;
    for (const part of cookies.split(";")) {
        const [key, ...value] = part.trim().split("=");
        if (key === name) return decodeURIComponent(value.join("="));
    }
    return null;
}

async function getSession(token) {
    if (!token) return null;
    const result = await query(`
        SELECT sessions.token, sessions.expires_at,
               users.id, users.username, users.role, users.coop_id
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token = $1
    `, [token]);

    if (result.rowCount === 0) return null;
    const session = result.rows[0];
    if (Number(session.expires_at) < Date.now()) {
        await query("DELETE FROM sessions WHERE token = $1", [token]);
        return null;
    }
    return session;
}

async function authenticate(req, res, next) {
    try {
        const token = getCookie(req, "session_token");
        if (!token) return res.status(401).json({ error: "Not logged in" });
        const session = await getSession(token);
        if (!session) return res.status(401).json({ error: "Session expired" });
        req.user = session;
        next();
    } catch (error) {
        console.error("Authentication error:", error);
        res.status(500).json({ error: "Authentication failed" });
    }
}

async function createSession(userId) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    await query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [token, userId, expiresAt]);
    return token;
}

function setSessionCookie(res, token) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader("Set-Cookie", `session_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure}`);
}

app.post("/api/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: "Username and password are required" });

        const result = await query("SELECT * FROM users WHERE username = $1", [username]);
        const user = result.rows[0];
        if (!user || !verifyPassword(password, user.password)) {
            return res.status(401).json({ error: "Invalid username or password" });
        }

        const token = await createSession(user.id);
        setSessionCookie(res, token);
        const coop = user.coop_id
            ? (await query("SELECT id, coop_name FROM coops WHERE id = $1", [user.coop_id])).rows[0]
            : null;

        res.json({ success: true, user: { id: user.id, username: user.username, role: user.role, coop } });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Login failed" });
    }
});

app.post("/api/logout", authenticate, async (req, res) => {
    try {
        const token = getCookie(req, "session_token");
        await query("DELETE FROM sessions WHERE token = $1", [token]);
        res.setHeader("Set-Cookie", "session_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Logout failed" });
    }
});

app.get("/api/me", authenticate, async (req, res) => {
    try {
        const coop = req.user.coop_id
            ? (await query("SELECT id, coop_name FROM coops WHERE id = $1", [req.user.coop_id])).rows[0]
            : null;
        res.json({ id: req.user.id, username: req.user.username, role: req.user.role, coop: coop || null });
    } catch (error) {
        res.status(500).json({ error: "Failed to load user" });
    }
});

/* ESP32 endpoint: API key is now required. Send X-ESP32-API-Key. */
app.post("/api/sensor-data", async (req, res) => {
    try {
        const { coopId, temperature, humidity, gas, feed, water, mistGenerator } = req.body;
        const selectedCoop = Number(coopId);
        if (!Number.isInteger(selectedCoop) || selectedCoop < 1) {
            return res.status(400).json({ success: false, error: "Valid coopId is required" });
        }

        const coopResult = await query("SELECT id, coop_name, api_key FROM coops WHERE id = $1", [selectedCoop]);
        const coop = coopResult.rows[0];
        if (!coop) return res.status(400).json({ success: false, error: "Invalid coop" });

        const suppliedKey = req.get("X-ESP32-API-Key");
        if (!suppliedKey || suppliedKey !== coop.api_key) {
            return res.status(401).json({ success: false, error: "Invalid ESP32 API key" });
        }

        await query(`
            INSERT INTO sensor_data
            (timestamp, coop_id, temperature, humidity, gas, feed, water, mist_generator)
            VALUES (CURRENT_TIMESTAMP, $1, $2, $3, $4, $5, $6, $7)
        `, [selectedCoop, temperature ?? null, humidity ?? null, gas ?? null, feed ?? null, water ?? null, mistGenerator ? 1 : 0]);

        res.json({ success: true, message: "Sensor data stored", coopId: selectedCoop, coopName: coop.coop_name });
    } catch (error) {
        console.error("Sensor data insert error:", error);
        res.status(500).json({ success: false, error: "Failed to store sensor data", details: error.message });
    }
});

app.get("/api/sensor-data/latest", authenticate, async (req, res) => {
    try {
        let result;
        if (req.user.role === "manager") {
            result = await query(`
                SELECT sensor_data.*, coops.coop_name
                FROM sensor_data JOIN coops ON coops.id = sensor_data.coop_id
                WHERE sensor_data.coop_id = $1
                ORDER BY sensor_data.id DESC LIMIT 1
            `, [req.user.coop_id]);
        } else {
            result = await query(`
                SELECT sensor_data.*, coops.coop_name
                FROM sensor_data JOIN coops ON coops.id = sensor_data.coop_id
                ORDER BY sensor_data.id DESC LIMIT 1
            `);
        }
        res.json(result.rows[0] || null);
    } catch (error) {
        res.status(500).json({ error: "Failed to load latest data" });
    }
});

app.get("/api/manager/history", authenticate, async (req, res) => {
    try {
        if (req.user.role !== "manager") return res.status(403).json({ error: "Manager access required" });
        const result = await query(`
            SELECT * FROM sensor_data WHERE coop_id = $1 ORDER BY id DESC LIMIT 10000
        `, [req.user.coop_id]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: "Failed to load history" });
    }
});

app.get("/api/boss/overview", authenticate, async (req, res) => {
    try {
        if (req.user.role !== "boss") return res.status(403).json({ error: "Boss access required" });
        const coops = (await query("SELECT id, coop_name FROM coops ORDER BY id")).rows;
        const results = [];

        for (const coop of coops) {
            const latestResult = await query(`
                SELECT sensor_data.*, users.username AS manager_name
                FROM sensor_data
                JOIN coops ON coops.id = sensor_data.coop_id
                LEFT JOIN users ON users.coop_id = coops.id AND users.role = 'manager'
                WHERE sensor_data.coop_id = $1
                ORDER BY sensor_data.id DESC LIMIT 1
            `, [coop.id]);
            const latest = latestResult.rows[0] || null;
            let online = false;
            if (latest) {
                const ts = new Date(String(latest.timestamp).replace(" ", "T") + "Z").getTime();
                online = Date.now() - ts <= 15000;
            }
            results.push({ coop, manager: latest ? latest.manager_name : "Not available", online, data: latest });
        }

        const active = results.filter(item => item.data);
        const avg = field => active.length ? active.reduce((sum, item) => sum + Number(item.data[field] ?? 0), 0) / active.length : null;
        res.json({
            totalCoops: results.length,
            onlineCoops: results.filter(item => item.online).length,
            offlineCoops: results.filter(item => !item.online).length,
            average: { temperature: avg("temperature"), humidity: avg("humidity"), gas: avg("gas"), feed: avg("feed"), water: avg("water") },
            coops: results
        });
    } catch (error) {
        console.error("Boss overview error:", error);
        res.status(500).json({ error: "Failed to load overview" });
    }
});

app.get("/api/boss/coop/:id", authenticate, async (req, res) => {
    try {
        if (req.user.role !== "boss") return res.status(403).json({ error: "Boss access required" });
        const coopId = Number(req.params.id);
        const coop = (await query("SELECT * FROM coops WHERE id = $1", [coopId])).rows[0];
        if (!coop) return res.status(404).json({ error: "Coop not found" });
        const manager = (await query(`SELECT id, username FROM users WHERE role = 'manager' AND coop_id = $1`, [coopId])).rows[0] || null;
        const history = (await query(`SELECT * FROM sensor_data WHERE coop_id = $1 ORDER BY id DESC LIMIT 10000`, [coopId])).rows;
        res.json({ coop, manager, history });
    } catch (error) {
        res.status(500).json({ error: "Failed to load coop" });
    }
});

app.get("/api/boss/history", authenticate, async (req, res) => {
    try {
        if (req.user.role !== "boss") return res.status(403).json({ success: false, error: "Boss access required" });
        const coopId = req.query.coopId && req.query.coopId !== "all" ? Number(req.query.coopId) : null;
        const date = req.query.date && String(req.query.date).trim() ? String(req.query.date).trim() : null;
        const conditions = [];
        const params = [];

        if (Number.isInteger(coopId)) {
            params.push(coopId);
            conditions.push(`sensor_data.coop_id = $${params.length}`);
        }
        if (date) {
            params.push(date);
            conditions.push(`DATE(sensor_data.timestamp) = $${params.length}`);
        }

        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const records = (await query(`
            SELECT sensor_data.id, sensor_data.timestamp, sensor_data.temperature,
                   sensor_data.humidity, sensor_data.gas, sensor_data.feed,
                   sensor_data.water, sensor_data.mist_generator, sensor_data.coop_id,
                   coops.coop_name
            FROM sensor_data LEFT JOIN coops ON coops.id = sensor_data.coop_id
            ${where} ORDER BY sensor_data.timestamp DESC LIMIT 5000
        `, params)).rows;
        const count = (await query(`SELECT COUNT(*) AS total FROM sensor_data ${where}`, params)).rows[0];
        res.json({ success: true, records, total: Number(count.total), returned: records.length });
    } catch (error) {
        console.error("Boss history error:", error);
        res.status(500).json({ success: false, error: "Failed to load historical data", details: error.message });
    }
});

async function pageSession(req) {
    return getSession(getCookie(req, "session_token"));
}

async function redirectForUser(req, res) {
    const session = await pageSession(req);
    if (!session) return res.redirect("/login.html");
    return res.redirect(session.role === "boss" ? "/boss.html" : "/manager.html");
}

app.get("/", async (req, res) => {
    try { await redirectForUser(req, res); } catch (_) { res.redirect("/login.html"); }
});
app.get("/index.html", async (req, res) => {
    try { await redirectForUser(req, res); } catch (_) { res.redirect("/login.html"); }
});

async function protectPage(role, req, res, next) {
    try {
        const session = await pageSession(req);
        if (!session) return res.redirect("/login.html");
        if (role && session.role !== role) return res.redirect(session.role === "boss" ? "/boss.html" : "/manager.html");
        next();
    } catch (_) {
        res.redirect("/login.html");
    }
}

app.get("/login.html", async (req, res, next) => {
    const session = await pageSession(req);
    if (!session) return next();
    return res.redirect(session.role === "boss" ? "/boss.html" : "/manager.html");
});
app.get("/manager.html", (req, res, next) => protectPage("manager", req, res, next));
app.get("/boss.html", (req, res, next) => protectPage("boss", req, res, next));

app.use(express.static(path.join(__dirname, "public")));

async function start() {
    await initDatabase();
    await seedDefaults();
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`Poultry PostgreSQL server running on port ${PORT}`);
    });
}

start().catch(error => {
    console.error("Server startup failed:", error);
    process.exit(1);
});
