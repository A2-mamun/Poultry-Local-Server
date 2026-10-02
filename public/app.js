let historyRange = 6; // hours

let chartData = {
    temperature: [],
    humidity: [],
    gas: [],
    feed: [],
    water: []
};

async function getLatestData() {
    try {
        const response = await fetch(
            "/api/sensor-data/latest",
            { cache: "no-store" }
        );

        if (!response.ok) {
            throw new Error("Server error");
        }

        return await response.json();

    } catch (error) {
        console.error("Dashboard error:", error);
        return null;
    }
}


async function getHistoricalData() {
    try {
        const response = await fetch(
            "/api/sensor-data",
            { cache: "no-store" }
        );

        if (!response.ok) {
            throw new Error("History request failed");
        }

        return await response.json();

    } catch (error) {
        console.error("History error:", error);
        return [];
    }
}


function setCardStatus(
    valueId,
    numValue,
    safeLimit,
    warningLimit,
    isInverse = false
) {
    const element = document.getElementById(valueId);

    if (!element) return;

    const card = element.closest(".card");

    if (!card) return;

    card.classList.remove(
        "status-safe",
        "status-warning",
        "status-danger"
    );

    if (numValue === null || isNaN(numValue)) {
        return;
    }

    if (!isInverse) {

        if (numValue <= safeLimit) {
            card.classList.add("status-safe");

        } else if (numValue <= warningLimit) {
            card.classList.add("status-warning");

        } else {
            card.classList.add("status-danger");
        }

    } else {

        if (numValue >= safeLimit) {
            card.classList.add("status-safe");

        } else if (numValue >= warningLimit) {
            card.classList.add("status-warning");

        } else {
            card.classList.add("status-danger");
        }
    }
}


function clearDashboard() {

    const ids = [
        "val-temp",
        "val-hum",
        "val-gas",
        "val-feed",
        "val-water"
    ];

    ids.forEach(id => {

        const element = document.getElementById(id);

        if (element) {

            element.innerText = "--";

            const card = element.closest(".card");

            if (card) {
                card.classList.remove(
                    "status-safe",
                    "status-warning",
                    "status-danger"
                );
            }
        }
    });


    const mistElement =
        document.getElementById("val-mist");

    if (mistElement) {
        mistElement.innerText = "--";
    }
}


async function updateDashboard() {

    const statusBadge =
        document.getElementById("status-badge");

    const data = await getLatestData();

    if (!data) {

        statusBadge.textContent = "OFFLINE";
        statusBadge.className = "badge offline";

        clearDashboard();

        return;
    }


    const recordTime =
        new Date(
            data.timestamp.replace(" ", "T") + "Z"
        ).getTime();

    const age =
        Date.now() - recordTime;


    if (age > 15000) {

        statusBadge.textContent = "OFFLINE";
        statusBadge.className = "badge offline";

        clearDashboard();

        return;
    }


    statusBadge.textContent = "ONLINE";
    statusBadge.className = "badge online";


    // Temperature

    const tempVal =
        Number(data.temperature);

    document.getElementById(
        "val-temp"
    ).innerText =
        !isNaN(tempVal)
            ? tempVal.toFixed(1)
            : "--";

    setCardStatus(
        "val-temp",
        tempVal,
        28,
        32
    );


    // Humidity

    const humVal =
        Number(data.humidity);

    document.getElementById(
        "val-hum"
    ).innerText =
        !isNaN(humVal)
            ? humVal.toFixed(1)
            : "--";

    setCardStatus(
        "val-hum",
        humVal,
        65,
        75
    );


    // Gas

    const gasVal =
        Number(data.gas);

    document.getElementById(
        "val-gas"
    ).innerText =
        !isNaN(gasVal)
            ? Math.round(gasVal)
            : "--";

    setCardStatus(
        "val-gas",
        gasVal,
        400,
        600
    );


    // Feed

    const feedVal =
        Number(data.feed);

    document.getElementById(
        "val-feed"
    ).innerText =
        !isNaN(feedVal)
            ? Math.round(feedVal)
            : "--";

    setCardStatus(
        "val-feed",
        feedVal,
        70,
        30,
        true
    );


    // Water

    const waterVal =
        Number(data.water);

    document.getElementById(
        "val-water"
    ).innerText =
        !isNaN(waterVal)
            ? Math.round(waterVal)
            : "--";

    setCardStatus(
        "val-water",
        waterVal,
        70,
        30,
        true
    );


    // Mist Generator

    const mistElement =
        document.getElementById("val-mist");

    if (mistElement) {

        if (Number(data.mist_generator) === 1) {

            mistElement.innerText = "ON";
            mistElement.className = "device-on";

        } else {

            mistElement.innerText = "OFF";
            mistElement.className = "device-off";
        }
    }


    // Cooling Fan

    const fanElement =
        document.getElementById("val-fan");

    if (fanElement) {

        fanElement.innerText = "ON";
        fanElement.className = "device-on";
    }


    // Last update

    const lastUpdate =
        document.getElementById("last-update");

    if (lastUpdate) {

        lastUpdate.innerText =
            "Last update: " +
            new Date(
                data.timestamp.replace(" ", "T") + "Z"
            ).toLocaleString();
    }
}


/* =========================================
   CHART HELPERS
========================================= */


function getDecimals(field, min, max) {

    const range = max - min;

    if (
        field === "temperature" ||
        field === "humidity"
    ) {
        return range < 5 ? 1 : 0;
    }

    return 0;
}


function getChartRange(values, field) {

    let min =
        Math.min(...values);

    let max =
        Math.max(...values);

    let range =
        max - min;


    // If values barely change

    if (range === 0) {

        if (
            field === "temperature" ||
            field === "humidity"
        ) {
            range = 1;
        } else {
            range = 10;
        }
    }


    // Add padding

    let padding =
        range * 0.20;


    // Minimum padding

    if (
        field === "temperature" ||
        field === "humidity"
    ) {
        padding =
            Math.max(padding, 0.5);
    } else {
        padding =
            Math.max(padding, 2);
    }


    return {
        min: min - padding,
        max: max + padding
    };
}


function formatTime(timestamp) {

    const date =
        new Date(
            timestamp.replace(" ", "T") + "Z"
        );

    return date.toLocaleTimeString(
        [],
        {
            hour: "2-digit",
            minute: "2-digit"
        }
    );
}


/* =========================================
   DRAW CHART
========================================= */


function drawChart(
    canvasId,
    data,
    field,
    unit
) {

    const canvas =
        document.getElementById(canvasId);

    if (!canvas) return;


    const ctx =
        canvas.getContext("2d");


    const width =
        canvas.clientWidth;

    const height =
        canvas.clientHeight;


    const dpr =
        window.devicePixelRatio || 1;


    canvas.width =
        width * dpr;

    canvas.height =
        height * dpr;


    ctx.setTransform(
        dpr,
        0,
        0,
        dpr,
        0,
        0
    );


    const paddingLeft = 55;
    const paddingRight = 20;
    const paddingTop = 30;
    const paddingBottom = 35;


    const chartWidth =
        width -
        paddingLeft -
        paddingRight;


    const chartHeight =
        height -
        paddingTop -
        paddingBottom;


    const validData =
        data.filter(item => {

            const value =
                Number(item[field]);

            return !isNaN(value);
        });


    if (validData.length === 0) {
        return;
    }


    const values =
        validData.map(
            item => Number(item[field])
        );


    const range =
        getChartRange(
            values,
            field
        );


    const minValue =
        range.min;

    const maxValue =
        range.max;


    const decimals =
        getDecimals(
            field,
            minValue,
            maxValue
        );


    ctx.clearRect(
        0,
        0,
        width,
        height
    );


    /* Grid */

    ctx.strokeStyle =
        "rgba(255,255,255,0.20)";

    ctx.lineWidth = 1;


    for (let i = 0; i <= 4; i++) {

        const y =
            paddingTop +
            (chartHeight / 4) * i;


        ctx.beginPath();

        ctx.moveTo(
            paddingLeft,
            y
        );

        ctx.lineTo(
            width - paddingRight,
            y
        );

        ctx.stroke();


        const value =
            maxValue -
            (
                (maxValue - minValue) /
                4
            ) * i;


        ctx.fillStyle =
            "#ffffff";

        ctx.font =
            "11px Arial";

        ctx.textAlign =
            "right";


        ctx.fillText(
            value.toFixed(decimals),
            paddingLeft - 8,
            y + 4
        );
    }


    /* Axis */

    ctx.strokeStyle =
        "rgba(255,255,255,0.6)";

    ctx.lineWidth = 1;


    ctx.beginPath();

    ctx.moveTo(
        paddingLeft,
        paddingTop
    );

    ctx.lineTo(
        paddingLeft,
        height - paddingBottom
    );

    ctx.lineTo(
        width - paddingRight,
        height - paddingBottom
    );

    ctx.stroke();


    /* Unit */

    ctx.fillStyle =
        "#ffffff";

    ctx.font =
        "12px Arial";

    ctx.textAlign =
        "left";


    ctx.fillText(
        unit,
        paddingLeft,
        18
    );


    /* X-axis time labels */

    const labelCount =
        Math.min(5, validData.length);


    for (
        let i = 0;
        i < labelCount;
        i++
    ) {

        const index =
            Math.floor(
                i *
                (
                    (validData.length - 1) /
                    Math.max(labelCount - 1, 1)
                )
            );


        const x =
            paddingLeft +
            (
                index /
                Math.max(validData.length - 1, 1)
            ) *
            chartWidth;


        ctx.fillStyle =
            "#ffffff";

        ctx.font =
            "10px Arial";

        ctx.textAlign =
            "center";


        ctx.fillText(
            formatTime(
                validData[index].timestamp
            ),
            x,
            height - 12
        );
    }


    /* Line */

    ctx.beginPath();


    validData.forEach(
        (item, index) => {

            const value =
                Number(item[field]);


            const x =
                paddingLeft +
                (
                    index /
                    Math.max(
                        validData.length - 1,
                        1
                    )
                ) *
                chartWidth;


            const y =
                height -
                paddingBottom -
                (
                    (value - minValue) /
                    (maxValue - minValue)
                ) *
                chartHeight;


            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
    );


    ctx.strokeStyle =
        "#ffffff";

    ctx.lineWidth = 2.5;

    ctx.stroke();


    /* Points */

    validData.forEach(
        (item, index) => {

            const value =
                Number(item[field]);


            const x =
                paddingLeft +
                (
                    index /
                    Math.max(
                        validData.length - 1,
                        1
                    )
                ) *
                chartWidth;


            const y =
                height -
                paddingBottom -
                (
                    (value - minValue) /
                    (maxValue - minValue)
                ) *
                chartHeight;


            ctx.beginPath();

            ctx.arc(
                x,
                y,
                3,
                0,
                Math.PI * 2
            );


            ctx.fillStyle =
                "#ffffff";

            ctx.fill();
        }
    );


    /*
       Save chart data for hover
    */

    chartData[field] =
        validData.map(item => {

            const value =
                Number(item[field]);

            return {
                x:
                    paddingLeft +
                    (
                        validData.indexOf(item) /
                        Math.max(
                            validData.length - 1,
                            1
                        )
                    ) *
                    chartWidth,

                y:
                    height -
                    paddingBottom -
                    (
                        (value - minValue) /
                        (maxValue - minValue)
                    ) *
                    chartHeight,

                value: value,

                timestamp:
                    item.timestamp
            };
        });
}


/* =========================================
   HISTORICAL DATA
========================================= */


async function updateCharts() {

    const data =
        await getHistoricalData();


    if (!data || data.length === 0) {
        return;
    }


    /*
       Convert database timestamps
       to actual Date objects.
    */

    const now =
        Date.now();


    const cutoff =
        now -
        historyRange *
        60 *
        60 *
        1000;


    const history =
        [...data]
            .reverse()
            .filter(item => {

                const time =
                    new Date(
                        item.timestamp
                            .replace(" ", "T") +
                        "Z"
                    ).getTime();

                return time >= cutoff;
            });


    /*
       If there are not enough records
       within the selected period,
       show available records.
    */

    const finalData =
        history.length > 1
            ? history
            : [...data].reverse();


    drawChart(
        "temperatureChart",
        finalData,
        "temperature",
        "°C"
    );


    drawChart(
        "humidityChart",
        finalData,
        "humidity",
        "%"
    );


    drawChart(
        "gasChart",
        finalData,
        "gas",
        "Raw"
    );


    drawChart(
        "feedChart",
        finalData,
        "feed",
        "%"
    );


    drawChart(
        "waterChart",
        finalData,
        "water",
        "%"
    );
}


/* =========================================
   CHART HOVER
========================================= */


function setupChartHover(
    canvasId,
    field
) {

    const canvas =
        document.getElementById(canvasId);

    if (!canvas) return;


    canvas.addEventListener(
        "mousemove",
        event => {

            const rect =
                canvas.getBoundingClientRect();


            const mouseX =
                event.clientX -
                rect.left;


            const mouseY =
                event.clientY -
                rect.top;


            const points =
                chartData[field];


            if (!points) return;


            let closest = null;
            let distance = Infinity;


            points.forEach(point => {

                const dx =
                    point.x - mouseX;

                const dy =
                    point.y - mouseY;


                const d =
                    Math.sqrt(
                        dx * dx +
                        dy * dy
                    );


                if (d < distance) {

                    distance = d;
                    closest = point;
                }
            });


            if (
                closest &&
                distance < 15
            ) {

                canvas.title =
                    `${closest.value} | ${new Date(
                        closest.timestamp
                            .replace(" ", "T") +
                        "Z"
                    ).toLocaleString()}`;

            } else {

                canvas.title = "";
            }
        }
    );
}


/* =========================================
   RANGE SELECTOR
========================================= */


function createRangeSelector() {

    const section =
        document.querySelector(
            ".history-section"
        );


    if (!section) return;


    const title =
        section.querySelector("h2");


    if (!title) return;


    const selector =
        document.createElement("div");


    selector.className =
        "history-controls";


    selector.innerHTML = `
        <label for="historyRange">
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


    title.insertAdjacentElement(
        "afterend",
        selector
    );


    const select =
        document.getElementById(
            "historyRange"
        );


    select.addEventListener(
        "change",
        () => {

            historyRange =
                Number(select.value);

            updateCharts();
        }
    );
}


/* =========================================
   START
========================================= */


updateDashboard();

updateCharts();

createRangeSelector();


setInterval(
    updateDashboard,
    3000
);


setInterval(
    updateCharts,
    10000
);


window.addEventListener(
    "resize",
    updateCharts
);


/* Hover */

setupChartHover(
    "temperatureChart",
    "temperature"
);

setupChartHover(
    "humidityChart",
    "humidity"
);

setupChartHover(
    "gasChart",
    "gas"
);

setupChartHover(
    "feedChart",
    "feed"
);

setupChartHover(
    "waterChart",
    "water"
);