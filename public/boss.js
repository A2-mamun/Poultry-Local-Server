async function getCurrentUser() {

    try {

        const response = await fetch(
            "/api/me",
            {
                cache: "no-store",
                credentials: "same-origin"
            }
        );

        if (!response.ok) {

            window.location.href = "/login.html";

            return null;
        }

        return await response.json();

    } catch (error) {

        console.error("User check error:", error);

        window.location.href = "/login.html";

        return null;
    }
}


/* =========================================
   GENERAL VALUE FORMAT
========================================= */

function value(number, decimals = 0) {

    if (
        number === null ||
        number === undefined ||
        number === "" ||
        isNaN(Number(number))
    ) {
        return "--";
    }

    return Number(number).toFixed(decimals);
}


/* =========================================
   ESCAPE HTML
========================================= */

function escapeHtml(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/* =========================================
   OVERVIEW API
========================================= */

async function getOverview() {

    const response = await fetch(
        "/api/boss/overview",
        {
            cache: "no-store",
            credentials: "same-origin"
        }
    );

    if (!response.ok) {

        throw new Error(
            "Unable to load overview. HTTP " +
            response.status
        );
    }

    return await response.json();
}


/* =========================================
   CREATE COOP CARD
========================================= */

function createCoopCard(item) {

    const data = item.data;


    if (!data) {

        return `
            <div class="coop-card">

                <h2>
                    ${escapeHtml(item.coop.coop_name)}
                </h2>

                <div class="coop-manager">
                    Manager:
                    ${escapeHtml(item.manager || "--")}
                </div>

                <div class="coop-status offline-text">
                    NO DATA
                </div>

            </div>
        `;
    }


    return `
        <div class="coop-card">

            <h2>
                ${escapeHtml(item.coop.coop_name)}
            </h2>

            <div class="coop-manager">
                Manager:
                ${escapeHtml(item.manager || "--")}
            </div>


            <div class="coop-data">

                <div>
                    Temperature<br>
                    <strong>
                        ${value(data.temperature, 1)} °C
                    </strong>
                </div>


                <div>
                    Humidity<br>
                    <strong>
                        ${value(data.humidity, 1)} %
                    </strong>
                </div>


                <div>
                    Gas<br>
                    <strong>
                        ${value(data.gas)}
                    </strong>
                </div>


                <div>
                    Feed<br>
                    <strong>
                        ${value(data.feed)} %
                    </strong>
                </div>


                <div>
                    Water<br>
                    <strong>
                        ${value(data.water)} %
                    </strong>
                </div>


                <div>
                    Mist<br>
                    <strong>
                        ${
                            Number(data.mist_generator) === 1
                                ? "ON"
                                : "OFF"
                        }
                    </strong>
                </div>

            </div>


            <div
                class="coop-status ${
                    item.online
                        ? "online-text"
                        : "offline-text"
                }"
            >

                ${
                    item.online
                        ? "● ONLINE"
                        : "● OFFLINE"
                }

            </div>

        </div>
    `;
}


/* =========================================
   UPDATE BOSS OVERVIEW
========================================= */

async function updateOverview() {

    try {

        const data = await getOverview();


        const totalCoops =
            document.getElementById("totalCoops");

        const onlineCoops =
            document.getElementById("onlineCoops");

        const offlineCoops =
            document.getElementById("offlineCoops");

        const managerCount =
            document.getElementById("managerCount");

        const avgTemperature =
            document.getElementById("avgTemperature");

        const avgHumidity =
            document.getElementById("avgHumidity");

        const avgGas =
            document.getElementById("avgGas");

        const avgFeed =
            document.getElementById("avgFeed");

        const avgWater =
            document.getElementById("avgWater");

        const coopGrid =
            document.getElementById("coopGrid");


        if (totalCoops) {
            totalCoops.innerText =
                data.totalCoops ?? "--";
        }


        if (onlineCoops) {
            onlineCoops.innerText =
                data.onlineCoops ?? "--";
        }


        if (offlineCoops) {
            offlineCoops.innerText =
                data.offlineCoops ?? "--";
        }


        if (managerCount) {
            managerCount.innerText =
                data.totalCoops ?? "--";
        }


        if (avgTemperature) {
            avgTemperature.innerText =
                value(
                    data.average?.temperature,
                    1
                );
        }


        if (avgHumidity) {
            avgHumidity.innerText =
                value(
                    data.average?.humidity,
                    1
                );
        }


        if (avgGas) {
            avgGas.innerText =
                value(
                    data.average?.gas
                );
        }


        if (avgFeed) {
            avgFeed.innerText =
                value(
                    data.average?.feed
                );
        }


        if (avgWater) {
            avgWater.innerText =
                value(
                    data.average?.water
                );
        }


        if (coopGrid && Array.isArray(data.coops)) {

            coopGrid.innerHTML =
                data.coops
                    .map(createCoopCard)
                    .join("");
        }


    } catch (error) {

        console.error(
            "Overview error:",
            error
        );
    }
}


/* =========================================
   HISTORY NUMBER FORMAT
========================================= */

function historyNumber(
    number,
    decimals = 0
) {

    if (
        number === null ||
        number === undefined ||
        number === "" ||
        isNaN(Number(number))
    ) {
        return "--";
    }

    return Number(number).toFixed(decimals);
}


/* =========================================
   LOAD BOSS HISTORY
========================================= */

async function loadBossHistory() {

    const body =
        document.getElementById(
            "historyTableBody"
        );

    const summary =
        document.getElementById(
            "historySummary"
        );

    const coopElement =
        document.getElementById(
            "historyCoop"
        );

    const dateElement =
        document.getElementById(
            "historyDate"
        );


    if (!body || !summary) {

        console.error(
            "History HTML elements are missing."
        );

        return;
    }


    const coop =
        coopElement
            ? coopElement.value
            : "all";


    const date =
        dateElement
            ? dateElement.value
            : "";


    const params =
        new URLSearchParams();


    if (
        coop &&
        coop !== "all"
    ) {

        params.set(
            "coopId",
            coop
        );
    }


    if (date) {

        params.set(
            "date",
            date
        );
    }


    params.set(
        "limit",
        "5000"
    );


    console.log(
        "Loading history with:",
        params.toString()
    );


    body.innerHTML = `
        <tr>
            <td
                colspan="8"
                class="history-empty"
            >
                Loading historical data...
            </td>
        </tr>
    `;


    summary.innerText =
        "Loading historical data...";


    try {

        const response =
            await fetch(
                "/api/boss/history?" +
                params.toString(),
                {
                    method: "GET",
                    cache: "no-store",
                    credentials: "same-origin"
                }
            );


        const responseText =
            await response.text();


        console.log(
            "History API status:",
            response.status
        );

        console.log(
            "History API response:",
            responseText
        );


        if (!response.ok) {

            throw new Error(
                "History API returned HTTP " +
                response.status +
                ": " +
                responseText
            );
        }


        let result;


        try {

            result =
                JSON.parse(responseText);

        } catch (jsonError) {

            throw new Error(
                "Server returned invalid JSON."
            );
        }


        console.log(
            "History result:",
            result
        );


        const records =
            Array.isArray(result.records)
                ? result.records
                : [];


        summary.innerText =
            `Showing ${records.length} of ${
                result.total ?? records.length
            } historical record(s).`;


        if (records.length === 0) {

            body.innerHTML = `
                <tr>
                    <td
                        colspan="8"
                        class="history-empty"
                    >
                        No historical sensor data found
                        for the selected filters.
                    </td>
                </tr>
            `;

            return;
        }


        body.innerHTML =
            records
                .map(
                    row => {

                        const timestamp =
                            row.timestamp ??
                            row.created_at ??
                            row.date ??
                            "--";


                        const coopName =
                            row.coop_name ??
                            (
                                row.coop_id
                                    ? "Coop-" +
                                      String(
                                          row.coop_id
                                      ).padStart(
                                          2,
                                          "0"
                                      )
                                    : "--"
                            );


                        const temperature =
                            row.temperature;


                        const humidity =
                            row.humidity;


                        const gas =
                            row.gas;


                        const feed =
                            row.feed;


                        const water =
                            row.water;


                        const mist =
                            row.mist_generator;


                        return `
                            <tr>

                                <td>
                                    ${escapeHtml(
                                        timestamp
                                    )}
                                </td>

                                <td>
                                    ${escapeHtml(
                                        coopName
                                    )}
                                </td>

                                <td>
                                    ${historyNumber(
                                        temperature,
                                        1
                                    )} °C
                                </td>

                                <td>
                                    ${historyNumber(
                                        humidity,
                                        1
                                    )} %
                                </td>

                                <td>
                                    ${historyNumber(
                                        gas
                                    )}
                                </td>

                                <td>
                                    ${historyNumber(
                                        feed
                                    )} %
                                </td>

                                <td>
                                    ${historyNumber(
                                        water
                                    )} %
                                </td>

                                <td>
                                    ${
                                        Number(
                                            mist
                                        ) === 1
                                            ? "ON"
                                            : "OFF"
                                    }
                                </td>

                            </tr>
                        `;
                    }
                )
                .join("");


    } catch (error) {

        console.error(
            "HISTORICAL DATA ERROR:",
            error
        );


        summary.innerText =
            "Error loading historical data.";


        body.innerHTML = `
            <tr>
                <td
                    colspan="8"
                    class="history-empty"
                >
                    Error loading historical data.
                    Open F12 → Console for details.
                </td>
            </tr>
        `;
    }
}


/* =========================================
   HISTORY SEARCH BUTTON
========================================= */

function setupHistorySearch() {

    const button =
        document.getElementById(
            "historySearch"
        );


    if (!button) {

        console.error(
            "historySearch button not found."
        );

        return;
    }


    button.addEventListener(
        "click",
        async () => {

            await loadBossHistory();

        }
    );
}


/* =========================================
   HISTORY CLEAR BUTTON
========================================= */

function setupHistoryClear() {

    const button =
        document.getElementById(
            "historyClear"
        );


    if (!button) {

        console.error(
            "historyClear button not found."
        );

        return;
    }


    button.addEventListener(
        "click",
        async () => {

            const coop =
                document.getElementById(
                    "historyCoop"
                );


            const date =
                document.getElementById(
                    "historyDate"
                );


            if (coop) {

                coop.value =
                    "all";
            }


            if (date) {

                date.value =
                    "";
            }


            await loadBossHistory();

        }
    );
}


/* =========================================
   LOGOUT
========================================= */

function setupLogout() {

    const button =
        document.getElementById(
            "logoutBtn"
        );


    if (!button) {

        console.error(
            "logoutBtn not found."
        );

        return;
    }


    button.addEventListener(
        "click",
        async () => {

            try {

                await fetch(
                    "/api/logout",
                    {
                        method: "POST",
                        credentials: "same-origin"
                    }
                );

            } catch (error) {

                console.error(
                    "Logout error:",
                    error
                );
            }


            window.location.href =
                "/login.html";
        }
    );
}


/* =========================================
   START
========================================= */

async function start() {

    console.log(
        "Boss dashboard starting..."
    );


    const user =
        await getCurrentUser();


    if (!user) {

        return;
    }


    console.log(
        "Logged in user:",
        user
    );


    if (
        user.role !== "boss"
    ) {

        window.location.href =
            "/manager.html";

        return;
    }


    const bossName =
        document.getElementById(
            "bossName"
        );


    if (bossName) {

        bossName.innerText =
            "Boss: " +
            user.username;
    }


    setupHistorySearch();

    setupHistoryClear();

    setupLogout();


    await updateOverview();


    /*
       Load all historical data
       automatically when Boss opens
       the dashboard.
    */

    await loadBossHistory();


    setInterval(
        updateOverview,
        5000
    );
}


/* =========================================
   START AFTER PAGE LOAD
========================================= */

if (
    document.readyState === "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        start
    );

} else {

    start();
}