let historyRange = 6;

let chartData = {};


/* =========================================
   CHECK LOGIN
========================================= */

async function getCurrentUser() {

    const response =
        await fetch("/api/me");

    if (!response.ok) {

        window.location.href =
            "/login.html";

        return null;
    }

    return await response.json();
}


/* =========================================
   LATEST DATA
========================================= */

async function getLatest() {

    const response =
        await fetch(
            "/api/sensor-data/latest",
            {
                cache: "no-store"
            }
        );


    if (!response.ok) {

        throw new Error(
            "Unable to get latest data"
        );
    }


    return await response.json();
}


/* =========================================
   HISTORY
========================================= */

async function getHistory() {

    const response =
        await fetch(
            "/api/manager/history",
            {
                cache: "no-store"
            }
        );


    if (!response.ok) {

        throw new Error(
            "Unable to get history"
        );
    }


    return await response.json();
}


/* =========================================
   UPDATE LIVE DATA
========================================= */

async function updateDashboard() {
    try {
        const data = await getLatest();
        if (!data) return;

        document.getElementById("val-temp").innerText = Number(data.temperature).toFixed(1);
        document.getElementById("val-hum").innerText = Number(data.humidity).toFixed(1);
        document.getElementById("val-gas").innerText = Math.round(Number(data.gas));
        document.getElementById("val-feed").innerText = Math.round(Number(data.feed));
        document.getElementById("val-water").innerText = Math.round(Number(data.water));

        const isMistOn = Number(data.mist_generator) === 1;
        const mistElem = document.getElementById("val-mist");
        mistElem.innerText = isMistOn ? "ON" : "OFF";
        mistElem.className = isMistOn ? "device-value device-on" : "device-value device-off";

        // Parse date properly at the top of the function
        const rawTimestamp = typeof data.timestamp === "string" 
            ? data.timestamp.replace(" ", "T") 
            : data.timestamp;
        const timestamp = new Date(rawTimestamp);

        // Alternatively, use backend epoch calculation:
        // const age = Date.now() - Number(data.epoch_ms);
        const age = Date.now() - timestamp.getTime();

        const badge = document.getElementById("status-badge");
        if (!isNaN(age) && age <= 120000) { // 120 sec match backend timeout window
            badge.innerText = "ONLINE";
            badge.className = "badge online";
        } else {
            badge.innerText = "OFFLINE";
            badge.className = "badge offline";
        }

        document.getElementById("last-update").innerText =
            "Last update: " + (isNaN(timestamp.getTime()) ? "N/A" : timestamp.toLocaleString());

    } catch (error) {
        console.error(error);
    }
}


/* =========================================
   SIMPLE CHART
========================================= */

function drawChart(canvasId, data, field, unit) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const left = 55;
    const right = 20;
    const top = 30;
    const bottom = 35;

    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;

    const values = data
        .map(item => Number(item[field]))
        .filter(value => !isNaN(value));

    if (!values.length) return;

    let min = Math.min(...values);
    let max = Math.max(...values);
    let range = max - min;
    if (range === 0) range = 1;

    const padding = range * 0.2;
    min -= padding;
    max += padding;

    ctx.clearRect(0, 0, width, height);

    /* Grid */
    ctx.strokeStyle = "rgba(255,255,255,0.2)";

    for (let i = 0; i <= 4; i++) {
        const y = top + (chartHeight * i) / 4;

        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(width - right, y);
        ctx.stroke();

        const value = max - ((max - min) * i) / 4;

        ctx.fillStyle = "#fff";
        ctx.font = "11px Arial";
        ctx.textAlign = "right";
        ctx.fillText(
            value.toFixed(field === "temperature" || field === "humidity" ? 1 : 0),
            left - 8,
            y + 4
        );
    }

    /* Line */
    ctx.beginPath();

    data.forEach((item, index) => {
        const value = Number(item[field]);
        if (isNaN(value)) return;

        const x = left + (index / Math.max(data.length - 1, 1)) * chartWidth;
        const y = height - bottom - ((value - min) / (max - min)) * chartHeight;

        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    /* Points */
    data.forEach((item, index) => {
        const value = Number(item[field]);
        if (isNaN(value)) return;

        const x = left + (index / Math.max(data.length - 1, 1)) * chartWidth;
        const y = height - bottom - ((value - min) / (max - min)) * chartHeight;

        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
    });

    ctx.fillStyle = "#ffffff";
    ctx.font = "12px Arial";
    ctx.textAlign = "left";
    ctx.fillText(unit, left, 18);
}


/* =========================================
   UPDATE CHARTS
========================================= */

async function updateCharts() {
    try {
        const data = await getHistory();
        if (!data || !data.length) return;

        const cutoff = Date.now() - historyRange * 60 * 60 * 1000;

        const filtered = [...data]
            .reverse()
            .filter(item => {
                const rawTime = typeof item.timestamp === "string"
                    ? item.timestamp.replace(" ", "T")
                    : item.timestamp;
                const time = new Date(rawTime).getTime();
                return time >= cutoff;
            });

        const history = filtered.length > 0 ? filtered : [...data].reverse();

        drawChart("temperatureChart", history, "temperature", "°C");
        drawChart("humidityChart", history, "humidity", "%");
        drawChart("gasChart", history, "gas", "Raw");
        drawChart("feedChart", history, "feed", "%");
        drawChart("waterChart", history, "water", "%");

    } catch (error) {
        console.error(error);
    }
}

/* =========================================
   RANGE SELECTOR
========================================= */

function createRangeSelector() {

    const section =
        document.querySelector(
            ".history-section"
        );


    const title =
        section.querySelector("h2");


    const controls =
        document.createElement(
            "div"
        );


    controls.className =
        "history-controls";


    controls.innerHTML = `
        <label>
            History:
        </label>

        <select id="historyRange">

            <option value="1">
                Last 1 Hour
            </option>

            <option value="6" selected>
                Last 6 Hours
            </option>

            <option value="24">
                Last 24 Hours
            </option>

        </select>
    `;


    title.after(controls);


    document.getElementById(
        "historyRange"
    ).addEventListener(
        "change",
        event => {

            historyRange =
                Number(
                    event.target.value
                );

            updateCharts();
        }
    );
}


/* =========================================
   LOGOUT
========================================= */

document.getElementById(
    "logoutBtn"
).addEventListener(
    "click",
    async () => {

        await fetch(
            "/api/logout",
            {
                method: "POST"
            }
        );


        window.location.href =
            "/login.html";
    }
);


/* =========================================
   START
========================================= */

async function start() {

    const user =
        await getCurrentUser();


    if (!user) return;


    if (user.role !== "manager") {

        window.location.href =
            "/boss.html";

        return;
    }


    document.getElementById(
        "coopName"
    ).innerText =
        user.coop
            ? user.coop.coop_name
            : "Poultry Coop";


    document.getElementById(
        "managerName"
    ).innerText =
        "Manager: " +
        user.username;


    createRangeSelector();

    updateDashboard();

    updateCharts();


    setInterval(
        updateDashboard,
        3000
    );


    setInterval(
        updateCharts,
        10000
    );
}


start();