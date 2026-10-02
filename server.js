const express = require("express");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");

const app = express();

const PORT = 3000;

const db = new Database("poultry.db");

app.use(express.json());

/* =========================================
   DATABASE
========================================= */

db.prepare(`
    CREATE TABLE IF NOT EXISTS coops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        coop_name TEXT NOT NULL,
        api_key TEXT UNIQUE NOT NULL
    )
`).run();


db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL,
        coop_id INTEGER,
        FOREIGN KEY (coop_id) REFERENCES coops(id)
    )
`).run();


db.prepare(`
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
`).run();


/* Add coop_id to existing sensor table */

const sensorColumns =
    db.prepare(`PRAGMA table_info(sensor_data)`).all();

const hasCoopId =
    sensorColumns.some(
        column => column.name === "coop_id"
    );


if (!hasCoopId) {

    db.prepare(`
        ALTER TABLE sensor_data
        ADD COLUMN coop_id INTEGER NOT NULL DEFAULT 1
    `).run();

    console.log(
        "Added coop_id to sensor_data"
    );
}


/* =========================================
   PASSWORD FUNCTIONS
========================================= */

function hashPassword(password) {

    const salt =
        crypto.randomBytes(16).toString("hex");

    const hash =
        crypto.scryptSync(
            password,
            salt,
            64
        ).toString("hex");

    return `${salt}:${hash}`;
}


function verifyPassword(
    password,
    storedPassword
) {

    const parts =
        storedPassword.split(":");

    if (parts.length !== 2) {
        return false;
    }

    const salt = parts[0];
    const storedHash = parts[1];

    const hash =
        crypto.scryptSync(
            password,
            salt,
            64
        ).toString("hex");

    return crypto.timingSafeEqual(
        Buffer.from(hash, "hex"),
        Buffer.from(storedHash, "hex")
    );
}


/* =========================================
   INITIAL DATA
========================================= */

function createCoop(
    coopName,
    apiKey
) {

    const existing =
        db.prepare(`
            SELECT id
            FROM coops
            WHERE coop_name = ?
        `).get(coopName);

    if (!existing) {

        db.prepare(`
            INSERT INTO coops
            (coop_name, api_key)
            VALUES (?, ?)
        `).run(
            coopName,
            apiKey
        );
    }
}


createCoop(
    "Coop-01",
    "COOP01_KEY_2304031"
);

createCoop(
    "Coop-02",
    "COOP02_KEY_2304031"
);

createCoop(
    "Coop-03",
    "COOP03_KEY_2304031"
);


/* =========================================
   USERS
========================================= */

function createUser(
    username,
    password,
    role,
    coopId
) {

    const existing =
        db.prepare(`
            SELECT id
            FROM users
            WHERE username = ?
        `).get(username);

    if (!existing) {

        db.prepare(`
            INSERT INTO users
            (username, password, role, coop_id)
            VALUES (?, ?, ?, ?)
        `).run(
            username,
            hashPassword(password),
            role,
            coopId
        );
    }
}


/*
   Default accounts
*/

createUser(
    "boss",
    "boss123",
    "boss",
    null
);


createUser(
    "manager1",
    "manager123",
    "manager",
    1
);


createUser(
    "manager2",
    "manager123",
    "manager",
    2
);


createUser(
    "manager3",
    "manager123",
    "manager",
    3
);


/* =========================================
   SESSION FUNCTIONS
========================================= */

function createSession(userId) {

    const token =
        crypto.randomBytes(32).toString("hex");

    const expiresAt =
        Date.now() +
        24 * 60 * 60 * 1000;


    db.prepare(`
        INSERT INTO sessions
        (token, user_id, expires_at)
        VALUES (?, ?, ?)
    `).run(
        token,
        userId,
        expiresAt
    );


    return token;
}


function getCookie(req, name) {

    const cookies =
        req.headers.cookie;

    if (!cookies) {
        return null;
    }


    const parts =
        cookies.split(";");


    for (const part of parts) {

        const [key, ...value] =
            part.trim().split("=");

        if (key === name) {

            return decodeURIComponent(
                value.join("=")
            );
        }
    }

    return null;
}


/* =========================================
   AUTH MIDDLEWARE
========================================= */

function authenticate(
    req,
    res,
    next
) {

    const token =
        getCookie(
            req,
            "session_token"
        );


    if (!token) {

        return res.status(401).json({
            error: "Not logged in"
        });
    }


    const session =
        db.prepare(`
            SELECT
                sessions.token,
                sessions.expires_at,
                users.id,
                users.username,
                users.role,
                users.coop_id
            FROM sessions
            JOIN users
                ON users.id = sessions.user_id
            WHERE sessions.token = ?
        `).get(token);


    if (
        !session ||
        session.expires_at < Date.now()
    ) {

        if (token) {

            db.prepare(`
                DELETE FROM sessions
                WHERE token = ?
            `).run(token);
        }


        return res.status(401).json({
            error: "Session expired"
        });
    }


    req.user = session;

    next();
}


/* =========================================
   LOGIN
========================================= */

app.post(
    "/api/login",
    (req, res) => {

        const {
            username,
            password
        } = req.body;


        if (!username || !password) {

            return res.status(400).json({
                error: "Username and password are required"
            });
        }


        const user =
            db.prepare(`
                SELECT *
                FROM users
                WHERE username = ?
            `).get(username);


        if (
            !user ||
            !verifyPassword(
                password,
                user.password
            )
        ) {

            return res.status(401).json({
                error: "Invalid username or password"
            });
        }


        const token =
            createSession(user.id);


        res.setHeader(
            "Set-Cookie",
            `session_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
        );


        const coop =
            user.coop_id
                ? db.prepare(`
                    SELECT id, coop_name
                    FROM coops
                    WHERE id = ?
                `).get(user.coop_id)
                : null;


        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                coop: coop
            }
        });
    }
);


/* =========================================
   LOGOUT
========================================= */

app.post(
    "/api/logout",
    authenticate,
    (req, res) => {

        const token =
            getCookie(
                req,
                "session_token"
            );


        db.prepare(`
            DELETE FROM sessions
            WHERE token = ?
        `).run(token);


        res.setHeader(
            "Set-Cookie",
            "session_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
        );


        res.json({
            success: true
        });
    }
);


/* =========================================
   CURRENT USER
========================================= */

app.get(
    "/api/me",
    authenticate,
    (req, res) => {

        const coop =
            req.user.coop_id
                ? db.prepare(`
                    SELECT id, coop_name
                    FROM coops
                    WHERE id = ?
                `).get(req.user.coop_id)
                : null;


        res.json({
            id: req.user.id,
            username: req.user.username,
            role: req.user.role,
            coop: coop
        });
    }
);


/* =========================================
   SENSOR DATA
========================================= */

app.post(
    "/api/sensor-data",
    (req, res) => {

        const {
            coopId,
            temperature,
            humidity,
            gas,
            feed,
            water,
            mistGenerator
        } = req.body;


        /* =========================================
           VALIDATE COOP ID
        ========================================= */

        const selectedCoop =
            Number(coopId);


        if (
            !Number.isInteger(selectedCoop) ||
            selectedCoop < 1
        ) {

            return res.status(400).json({
                success: false,
                error: "Valid coopId is required"
            });
        }


        /* =========================================
           CHECK COOP EXISTS
        ========================================= */

        const coop =
            db.prepare(`
                SELECT
                    id,
                    coop_name
                FROM coops
                WHERE id = ?
            `).get(selectedCoop);


        if (!coop) {

            return res.status(400).json({
                success: false,
                error: "Invalid coop"
            });
        }


        /* =========================================
           INSERT SENSOR DATA
        ========================================= */

        try {

            const stmt =
                db.prepare(`
                    INSERT INTO sensor_data
                    (
                        coop_id,
                        temperature,
                        humidity,
                        gas,
                        feed,
                        water,
                        mist_generator
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `);


            stmt.run(
                selectedCoop,
                temperature ?? null,
                humidity ?? null,
                gas ?? null,
                feed ?? null,
                water ?? null,
                mistGenerator ? 1 : 0
            );


            /* =====================================
               SUCCESS RESPONSE
            ===================================== */

            res.json({

                success: true,

                message:
                    "Sensor data stored",

                coopId:
                    selectedCoop,

                coopName:
                    coop.coop_name
            });


        } catch (error) {

            console.error(
                "Sensor data insert error:",
                error
            );


            res.status(500).json({

                success: false,

                error:
                    "Failed to store sensor data",

                details:
                    error.message
            });
        }
    }
);

/* =========================================
   LATEST DATA
========================================= */

app.get(
    "/api/sensor-data/latest",
    authenticate,
    (req, res) => {

        let data;


        if (req.user.role === "manager") {

            data =
                db.prepare(`
                    SELECT
                        sensor_data.*,
                        coops.coop_name
                    FROM sensor_data
                    JOIN coops
                        ON coops.id = sensor_data.coop_id
                    WHERE sensor_data.coop_id = ?
                    ORDER BY sensor_data.id DESC
                    LIMIT 1
                `).get(
                    req.user.coop_id
                );

        } else {

            data =
                db.prepare(`
                    SELECT
                        sensor_data.*,
                        coops.coop_name
                    FROM sensor_data
                    JOIN coops
                        ON coops.id = sensor_data.coop_id
                    ORDER BY sensor_data.id DESC
                    LIMIT 1
                `).get();
        }


        res.json(
            data || null
        );
    }
);


/* =========================================
   MANAGER HISTORY
========================================= */

app.get(
    "/api/manager/history",
    authenticate,
    (req, res) => {

        if (req.user.role !== "manager") {

            return res.status(403).json({
                error: "Manager access required"
            });
        }


        const data =
            db.prepare(`
                SELECT *
                FROM sensor_data
                WHERE coop_id = ?
                ORDER BY id DESC
                LIMIT 10000
            `).all(
                req.user.coop_id
            );


        res.json(data);
    }
);


/* =========================================
   BOSS OVERVIEW
========================================= */

app.get(
    "/api/boss/overview",
    authenticate,
    (req, res) => {

        if (req.user.role !== "boss") {

            return res.status(403).json({
                error: "Boss access required"
            });
        }


        const coops =
            db.prepare(`
                SELECT
                    id,
                    coop_name
                FROM coops
                ORDER BY id
            `).all();


        const results =
            coops.map(coop => {

                const latest =
                    db.prepare(`
                        SELECT
                            sensor_data.*,
                            users.username AS manager_name
                        FROM sensor_data
                        JOIN coops
                            ON coops.id =
                               sensor_data.coop_id
                        LEFT JOIN users
                            ON users.coop_id =
                               coops.id
                            AND users.role =
                               'manager'
                        WHERE sensor_data.coop_id = ?
                        ORDER BY sensor_data.id DESC
                        LIMIT 1
                    `).get(coop.id);


                let online = false;


                if (latest) {

                    const timestamp =
                        new Date(
                            latest.timestamp
                                .replace(" ", "T") +
                            "Z"
                        ).getTime();


                    online =
                        Date.now() -
                        timestamp <= 15000;
                }


                return {
                    coop: coop,
                    manager:
                        latest
                            ? latest.manager_name
                            : "Not available",
                    online: online,
                    data: latest || null
                };
            });


        const active =
            results.filter(
                item => item.data
            );


        const average = {

            temperature:
                active.length
                    ? active.reduce(
                        (sum, item) =>
                            sum +
                            Number(
                                item.data.temperature
                            ),
                        0
                    ) / active.length
                    : null,

            humidity:
                active.length
                    ? active.reduce(
                        (sum, item) =>
                            sum +
                            Number(
                                item.data.humidity
                            ),
                        0
                    ) / active.length
                    : null,

            gas:
                active.length
                    ? active.reduce(
                        (sum, item) =>
                            sum +
                            Number(
                                item.data.gas
                            ),
                        0
                    ) / active.length
                    : null,

            feed:
                active.length
                    ? active.reduce(
                        (sum, item) =>
                            sum +
                            Number(
                                item.data.feed
                            ),
                        0
                    ) / active.length
                    : null,

            water:
                active.length
                    ? active.reduce(
                        (sum, item) =>
                            sum +
                            Number(
                                item.data.water
                            ),
                        0
                    ) / active.length
                    : null
        };


        res.json({
            totalCoops: results.length,

            onlineCoops:
                results.filter(
                    item => item.online
                ).length,

            offlineCoops:
                results.filter(
                    item => !item.online
                ).length,

            average: average,

            coops: results
        });
    }
);


/* =========================================
   BOSS COOP DETAILS
========================================= */

app.get(
    "/api/boss/coop/:id",
    authenticate,
    (req, res) => {

        if (req.user.role !== "boss") {

            return res.status(403).json({
                error: "Boss access required"
            });
        }


        const coopId =
            Number(req.params.id);


        const coop =
            db.prepare(`
                SELECT *
                FROM coops
                WHERE id = ?
            `).get(coopId);


        if (!coop) {

            return res.status(404).json({
                error: "Coop not found"
            });
        }


        const manager =
            db.prepare(`
                SELECT
                    id,
                    username
                FROM users
                WHERE role = 'manager'
                AND coop_id = ?
            `).get(coopId);


        const history =
            db.prepare(`
                SELECT *
                FROM sensor_data
                WHERE coop_id = ?
                ORDER BY id DESC
                LIMIT 10000
            `).all(coopId);


        res.json({
            coop: coop,
            manager: manager || null,
            history: history
        });
    }
);

/* =========================================
   BOSS - HISTORICAL SENSOR DATA
========================================= */

app.get(
    "/api/boss/history",
    authenticate,
    (req, res) => {

        try {

            /* Only Boss can access history */

            if (!req.user || req.user.role !== "boss") {

                return res.status(403).json({
                    success: false,
                    error: "Boss access required"
                });
            }


            /* =====================================
               GET FILTERS
            ===================================== */

            const coopId =
                req.query.coopId &&
                req.query.coopId !== "all"
                    ? Number(req.query.coopId)
                    : null;


            const date =
                req.query.date &&
                req.query.date.trim() !== ""
                    ? req.query.date.trim()
                    : null;


            /* =====================================
               BUILD QUERY
            ===================================== */

            let query = `
                SELECT
                    sensor_data.id,
                    sensor_data.timestamp,
                    sensor_data.temperature,
                    sensor_data.humidity,
                    sensor_data.gas,
                    sensor_data.feed,
                    sensor_data.water,
                    sensor_data.mist_generator,
                    sensor_data.coop_id,
                    coops.coop_name
                FROM sensor_data
                LEFT JOIN coops
                    ON coops.id = sensor_data.coop_id
            `;


            const conditions = [];
            const parameters = [];


            /* Coop filter */

            if (
                coopId !== null &&
                Number.isInteger(coopId)
            ) {

                conditions.push(
                    "sensor_data.coop_id = ?"
                );

                parameters.push(coopId);
            }


            /* Date filter */

            if (date) {

                conditions.push(
                    "date(sensor_data.timestamp) = ?"
                );

                parameters.push(date);
            }


            /* WHERE */

            if (conditions.length > 0) {

                query +=
                    " WHERE " +
                    conditions.join(" AND ");
            }


            /* Newest first */

            query += `
                ORDER BY
                    sensor_data.timestamp DESC
            `;


            /* Limit */

            query += `
                LIMIT 5000
            `;


            /* =====================================
               GET RECORDS
            ===================================== */

            const records =
                db.prepare(query).all(
                    ...parameters
                );


            /* =====================================
               TOTAL
            ===================================== */

            let countQuery = `
                SELECT COUNT(*) AS total
                FROM sensor_data
            `;


            if (conditions.length > 0) {

                countQuery +=
                    " WHERE " +
                    conditions.join(" AND ");
            }


            const count =
                db.prepare(countQuery).get(
                    ...parameters
                );


            /* =====================================
               SEND RESPONSE
            ===================================== */

            res.json({

                success: true,

                records: records,

                total:
                    Number(count.total),

                returned:
                    records.length

            });


        } catch (error) {

            console.error(
                "Boss history error:",
                error
            );


            res.status(500).json({

                success: false,

                error:
                    "Failed to load historical data",

                details:
                    error.message

            });
        }
    }
);

/* =========================================
   PAGE ROUTING / AUTHENTICATION
========================================= */

/*
   Keep the dashboard pages behind the login screen.

   The old version exposed index.html directly through
   express.static(), which meant visiting http://localhost:3000
   opened the dashboard without showing the login page.
*/

function redirectForUser(req, res) {

    const token = getCookie(req, "session_token");

    if (!token) {
        return res.redirect("/login.html");
    }

    const session = db.prepare(`
        SELECT
            sessions.expires_at,
            users.username,
            users.role,
            users.coop_id
        FROM sessions
        JOIN users
            ON users.id = sessions.user_id
        WHERE sessions.token = ?
    `).get(token);

    if (!session || session.expires_at < Date.now()) {

        if (token) {
            db.prepare(`
                DELETE FROM sessions
                WHERE token = ?
            `).run(token);
        }

        return res.redirect("/login.html");
    }

    if (session.role === "boss") {
        return res.redirect("/boss.html");
    }

    return res.redirect("/manager.html");
}


/* Home page: always decide where the user belongs. */
app.get("/", (req, res) => {
    redirectForUser(req, res);
});


/* The old dashboard is kept for compatibility, but it is no longer
   the public landing page. */
app.get("/index.html", (req, res) => {
    redirectForUser(req, res);
});


/* Login page. If already logged in, go directly to the correct dashboard. */
app.get("/login.html", (req, res, next) => {

    const token = getCookie(req, "session_token");

    if (!token) {
        return next();
    }

    const session = db.prepare(`
        SELECT
            sessions.expires_at,
            users.role
        FROM sessions
        JOIN users
            ON users.id = sessions.user_id
        WHERE sessions.token = ?
    `).get(token);

    if (!session || session.expires_at < Date.now()) {

        if (token) {
            db.prepare(`
                DELETE FROM sessions
                WHERE token = ?
            `).run(token);
        }

        return next();
    }

    if (session.role === "boss") {
        return res.redirect("/boss.html");
    }

    return res.redirect("/manager.html");
});


/* Protect the actual dashboard HTML files as well as their API calls. */
app.get("/manager.html", (req, res, next) => {

    const token = getCookie(req, "session_token");

    if (!token) {
        return res.redirect("/login.html");
    }

    const session = db.prepare(`
        SELECT
            sessions.expires_at,
            users.role
        FROM sessions
        JOIN users
            ON users.id = sessions.user_id
        WHERE sessions.token = ?
    `).get(token);

    if (!session || session.expires_at < Date.now()) {

        if (token) {
            db.prepare(`
                DELETE FROM sessions
                WHERE token = ?
            `).run(token);
        }

        return res.redirect("/login.html");
    }

    if (session.role !== "manager") {
        return res.redirect("/boss.html");
    }

    next();
});


app.get("/boss.html", (req, res, next) => {

    const token = getCookie(req, "session_token");

    if (!token) {
        return res.redirect("/login.html");
    }

    const session = db.prepare(`
        SELECT
            sessions.expires_at,
            users.role
        FROM sessions
        JOIN users
            ON users.id = sessions.user_id
        WHERE sessions.token = ?
    `).get(token);

    if (!session || session.expires_at < Date.now()) {

        if (token) {
            db.prepare(`
                DELETE FROM sessions
                WHERE token = ?
            `).run(token);
        }

        return res.redirect("/login.html");
    }

    if (session.role !== "boss") {
        return res.redirect("/manager.html");
    }

    next();
});


/* =========================================
   STATIC WEBSITE
========================================= */


app.use(
    express.static(
        path.join(
            __dirname,
            "public"
        )
    )
);


/* =========================================
   START SERVER
========================================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Poultry server running at http://localhost:${PORT}`
        );

        console.log(
            `LAN: http://192.168.10.76:${PORT}`
        );
    }
);