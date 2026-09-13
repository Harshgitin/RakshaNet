/* =========================================================
   RAKSHANET - MAIN CLIENT ENGINE
   Live weather + risk + GIS + emergency + volunteers
   ========================================================= */


/* =========================================================
   BACKEND
========================================================= */

const RN_BACKEND = {

    base:
        window.location.protocol.startsWith("http")
            ? ""
            : "http://localhost:5000",

    async request(path, options = {}) {

        const url =
            `${RN_BACKEND.base}${path}`;

        const response =
            await fetch(url, options);

        if (!response.ok) {

            let message =
                `Backend HTTP ${response.status}`;

            try {

                const data =
                    await response.json();

                if (data?.error) {
                    message +=
                        `: ${data.error}`;
                }

                if (data?.details) {
                    message +=
                        ` (${data.details})`;
                }

            } catch (_) {
                // Non-JSON response
            }

            throw new Error(message);
        }

        return response.json();
    },

    available: false
};


async function detectBackend() {

    try {

        await RN_BACKEND.request(
            "/api/health"
        );

        RN_BACKEND.available = true;

        localStorage.setItem(
            "rakshanet_backend",
            "online"
        );

    } catch {

        RN_BACKEND.available = false;

        localStorage.setItem(
            "rakshanet_backend",
            "offline"
        );
    }
}


/* =========================================================
   CONFIG
========================================================= */

const RN_CONFIG = {

    imd: {

        districtWarnings:
            "https://mausam.imd.gov.in/api/warnings_district_api.php",

        districtRainfall:
            "https://mausam.imd.gov.in/api/districtwise_rainfall_api.php",

        rss:
            "https://mausam.imd.gov.in/imd_latest/contents/dist_nowcast_rss.php"

    },

    weather:
        "https://api.open-meteo.com/v1/forecast",

    geocode:
        "https://nominatim.openstreetmap.org/search",

    overpass:
        "https://overpass-api.de/api/interpreter",

    route:
        "https://router.project-osrm.org/route/v1"
};


/* =========================================================
   HELPERS
========================================================= */

const $ =
    id =>
        document.getElementById(id);


const clamp =
    (n, min, max) =>
        Math.max(
            min,
            Math.min(max, n)
        );


const sleep =
    ms =>
        new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );


function esc(value) {

    return String(
        value ?? ""
    ).replace(
        /[&<>'"]/g,
        c =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                "'": "&#39;",
                "\"": "&quot;"
            }[c])
    );
}


/* =========================================================
   GENERIC FETCH WITH TIMEOUT
========================================================= */

async function fetchJSON(
    url,
    options = {},
    timeout = 12000
) {

    const controller =
        new AbortController();

    const timer =
        setTimeout(
            () =>
                controller.abort(),
            timeout
        );

    try {

        const response =
            await fetch(
                url,
                {
                    ...options,

                    signal:
                        controller.signal,

                    cache:
                        "no-store"
                }
            );

        if (!response.ok) {

            throw new Error(
                `HTTP ${response.status}`
            );
        }

        return await response.json();

    } finally {

        clearTimeout(timer);
    }
}


/* =========================================================
   GEOCODING
========================================================= */

async function geocodePlace(query) {

    const url =
        new URL(
            RN_CONFIG.geocode
        );

    url.search =
        new URLSearchParams({

            q:
                `${query}, India`,

            format:
                "jsonv2",

            limit:
                "1",

            addressdetails:
                "1"

        });


    const data =
        await fetchJSON(
            url.toString()
        );


    if (!data.length) {

        throw new Error(
            "Place not found. Try a city, district or state in India."
        );
    }


    return {

        lat:
            Number(
                data[0].lat
            ),

        lon:
            Number(
                data[0].lon
            ),

        name:
            data[0].display_name
    };
}


/* =========================================================
   WEATHER
========================================================= */

async function getWeather(
    lat,
    lon
) {

    const url =
        new URL(
            RN_CONFIG.weather
        );


    url.search =
        new URLSearchParams({

            latitude:
                String(lat),

            longitude:
                String(lon),

            timezone:
                "auto",

            current:
                "temperature_2m,relative_humidity_2m," +
                "apparent_temperature,precipitation,rain," +
                "weather_code,wind_speed_10m,wind_gusts_10m",

            hourly:
                "precipitation,rain,showers,weather_code," +
                "wind_speed_10m,temperature_2m",

            daily:
                "precipitation_sum,rain_sum," +
                "precipitation_hours," +
                "weather_code,temperature_2m_max," +
                "temperature_2m_min,wind_speed_10m_max",

            past_days:
                "7",

            forecast_days:
                "7"

        });


    return await fetchJSON(
        url.toString()
    );
}


function summarizeWeather(data) {

    const current =
        data.current || {};

    const hourly =
        data.hourly || {};

    const daily =
        data.daily || {};


    const precip24 =
        (hourly.precipitation || [])
            .slice(0, 24)
            .reduce(
                (a, b) =>
                    a + Number(b || 0),
                0
            );


    const rain24 =
        (hourly.rain || [])
            .slice(0, 24)
            .reduce(
                (a, b) =>
                    a + Number(b || 0),
                0
            );


    const maxWind =
        Math.max(
            ...(
                hourly.wind_speed_10m || []
            )
                .slice(0, 24)
                .map(Number),

            Number(
                current.wind_speed_10m || 0
            )
        );


    const maxTemp =
        Math.max(
            ...(
                daily.temperature_2m_max || []
            )
                .slice(0, 3)
                .map(Number),

            Number(
                current.temperature_2m || 0
            )
        );


    const maxProb =
        Math.max(
            ...(
                daily.precipitation_probability_max || []
            )
                .slice(0, 3)
                .map(Number),

            0
        );


    const rain3d =
        (daily.precipitation_sum || [])
            .slice(0, 3)
            .reduce(
                (a, b) =>
                    a + Number(b || 0),
                0
            );


    return {

        temp:
            Number(
                current.temperature_2m || 0
            ),

        humidity:
            Number(
                current.relative_humidity_2m || 0
            ),

        rainNow:
            Number(
                current.rain || 0
            ),

        precip24,

        rain24,

        maxWind,

        maxTemp,

        maxProb,

        rain3d,

        code:
            Number(
                current.weather_code || 0
            )
    };
}


/* =========================================================
   LANDSLIDE FEATURES
========================================================= */

function buildLandslideFeatures(
    data,
    lat,
    lon
) {

    const current =
        data.current || {};

    const daily =
        data.daily || {};


    const rain =
        (daily.rain_sum || [])
            .map(Number);


    const precip =
        (daily.precipitation_sum || [])
            .map(Number);


    const precipHours =
        (daily.precipitation_hours || [])
            .map(Number);


    const clean =
        arr =>
            arr.map(
                v =>
                    Number.isFinite(v)
                        ? v
                        : 0
            );


    const rainValues =
        clean(rain);


    const precipValues =
        clean(precip);


    const hourValues =
        clean(precipHours);


    const sumFirst =
        (arr, count) =>
            arr
                .slice(0, count)
                .reduce(
                    (sum, value) =>
                        sum + value,
                    0
                );


    const tempMaxValues =
        (daily.temperature_2m_max || [])
            .map(Number)
            .filter(Number.isFinite);


    const tempMinValues =
        (daily.temperature_2m_min || [])
            .map(Number)
            .filter(Number.isFinite);


    const windValues =
        (daily.wind_speed_10m_max || [])
            .map(Number)
            .filter(Number.isFinite);


    const tempMean =
        Number(
            current.temperature_2m || 0
        );


    return {

        rain_1d:
            rainValues[0] || 0,

        rain_3d:
            sumFirst(
                rainValues,
                3
            ),

        rain_7d:
            sumFirst(
                rainValues,
                7
            ),

        precip_1d:
            precipValues[0] || 0,

        precip_3d:
            sumFirst(
                precipValues,
                3
            ),

        precip_7d:
            sumFirst(
                precipValues,
                7
            ),

        precip_hours_1d:
            hourValues[0] || 0,

        precip_hours_3d:
            sumFirst(
                hourValues,
                3
            ),

        precip_hours_7d:
            sumFirst(
                hourValues,
                7
            ),

        temp_mean:
            tempMean,

        temp_max:
            tempMaxValues.length
                ? tempMaxValues[0]
                : tempMean,

        temp_min:
            tempMinValues.length
                ? tempMinValues[0]
                : tempMean,

        wind_max:
            windValues.length
                ? windValues[0]
                : Number(
                    current.wind_speed_10m || 0
                ),

        latitude:
            Number(lat),

        longitude:
            Number(lon),

        month:
            new Date().getMonth() + 1
    };
}


/* =========================================================
   ML
========================================================= */

async function predictLandslideML(
    weatherData,
    lat,
    lon
) {

    const features =
        buildLandslideFeatures(
            weatherData,
            lat,
            lon
        );


    const response =
        await RN_BACKEND.request(
            "/api/predict/landslide",
            {

                method:
                    "POST",

                headers: {

                    "Content-Type":
                        "application/json"

                },

                body:
                    JSON.stringify(
                        features
                    )
            }
        );


    return {

        ...response,

        features
    };
}


/* =========================================================
   RISK
========================================================= */

function weatherCodeText(code) {

    if (
        [95, 96, 99]
            .includes(code)
    ) {
        return "Thunderstorm";
    }

    if (code >= 80)
        return "Rain showers";

    if (code >= 61)
        return "Rain";

    if (code >= 51)
        return "Drizzle";

    if (code >= 45)
        return "Fog";

    if (code >= 1)
        return "Cloudy";

    return "Clear";
}


function scoreRisk(
    w,
    hazard = "auto"
) {

    const flood =
        clamp(
            (w.precip24 / 120) * 55 +
            (w.maxProb / 100) * 20 +
            (w.rain3d / 250) * 25,
            0,
            100
        );


    const landslide =
        clamp(
            (w.rain3d / 220) * 50 +
            (w.precip24 / 120) * 35 +
            (w.maxWind / 80) * 15,
            0,
            100
        );


    const heat =
        clamp(
            ((w.maxTemp - 32) / 12) * 100,
            0,
            100
        );


    const severe =
        clamp(
            (w.maxWind / 90) * 55 +
            (w.maxProb / 100) * 20 +
            (
                [95, 96, 99]
                    .includes(w.code)
                    ? 35
                    : 0
            ),
            0,
            100
        );


    let score;


    if (hazard === "flood") {

        score =
            flood;

    } else if (
        hazard === "landslide"
    ) {

        score =
            landslide;

    } else if (
        hazard === "heatwave"
    ) {

        score =
            heat;

    } else if (
        hazard === "severe"
    ) {

        score =
            severe;

    } else {

        score =
            Math.max(
                flood,
                landslide,
                heat,
                severe
            );
    }


    return {

        score:
            Math.round(score),

        flood:
            Math.round(flood),

        landslide:
            Math.round(landslide),

        heat:
            Math.round(heat),

        severe:
            Math.round(severe)
    };
}


function riskBand(score) {

    if (score >= 80) {

        return {

            label:
                "EXTREME",

            cls:
                "rn-risk-extreme",

            priority:
                "P1 Critical"
        };
    }


    if (score >= 60) {

        return {

            label:
                "HIGH",

            cls:
                "rn-risk-high",

            priority:
                "P2 High"
        };
    }


    if (score >= 35) {

        return {

            label:
                "WATCH",

            cls:
                "rn-risk-medium",

            priority:
                "P3 Watch"
        };
    }


    return {

        label:
            "LOW",

        cls:
            "rn-risk-low",

        priority:
            "P4 Normal"
    };
}


function riskColor(score) {

    if (score >= 80)
        return "#ef4444";

    if (score >= 60)
        return "#f97316";

    if (score >= 35)
        return "#f59e0b";

    return "#22c55e";
}


/* =========================================================
   PREDICTION RENDERING
========================================================= */

function renderPrediction(
    target,
    place,
    weather,
    hazard,
    mlResult = null
) {

    let score;
    let band;
    let modelLabel;


    if (
        mlResult &&
        mlResult.prediction
    ) {

        score =
            Number(
                mlResult.prediction.percentage || 0
            );

        band =
            riskBand(score);

        modelLabel =
            "🧠 RakshaNet AI/ML Landslide Model";

    } else {

        const ruleRisk =
            scoreRisk(
                weather,
                hazard
            );

        score =
            ruleRisk.score;

        band =
            riskBand(score);

        modelLabel =
            "Live meteorological risk engine";
    }


    const ruleScores =
        scoreRisk(
            weather,
            hazard
        );


    const weatherText =
        weatherCodeText(
            weather.code
        );


    const mlProbability =
        mlResult?.prediction
            ?.landslideProbability;


    const probabilityPercent =
        mlProbability !== undefined &&
        mlProbability !== null
            ? Math.round(
                Number(
                    mlProbability
                ) * 100
            )
            : null;


    target.innerHTML = `

        <div class="rn-risk-score">

            <div
                class="rn-score-ring"
                style="
                    background:
                    conic-gradient(
                        ${riskColor(score)}
                        ${score * 3.6}deg,
                        rgba(255,255,255,.06) 0deg
                    )
                "
            >

                <strong>
                    ${score}
                </strong>

            </div>


            <div>

                <div
                    class="rn-risk-badge ${band.cls}"
                >
                    ${band.label}
                    ·
                    ${band.priority}
                </div>


                <h3
                    style="margin-top:9px"
                >
                    ${esc(place.name)}
                </h3>


                <div class="rn-muted">
                    Live condition:
                    ${esc(weatherText)}
                </div>


                <div
                    class="rn-small"
                    style="margin-top:6px"
                >
                    ${modelLabel}
                </div>

            </div>

        </div>


        <div class="rn-weather-grid">

            <div class="rn-metric">
                <span>
                    Temperature
                </span>

                <strong>
                    ${weather.temp.toFixed(1)}°C
                </strong>
            </div>


            <div class="rn-metric">
                <span>
                    Humidity
                </span>

                <strong>
                    ${weather.humidity}%
                </strong>
            </div>


            <div class="rn-metric">
                <span>
                    24h Rain
                </span>

                <strong>
                    ${weather.precip24.toFixed(1)} mm
                </strong>
            </div>


            <div class="rn-metric">
                <span>
                    Max Wind
                </span>

                <strong>
                    ${weather.maxWind.toFixed(0)} km/h
                </strong>
            </div>

        </div>


        ${
            mlResult
                ? `

                <div
                    class="rn-result-list"
                    style="margin-top:16px;"
                >

                    <div class="rn-result-item">

                        <strong>
                            🧠 Landslide Probability
                        </strong>

                        <span class="rn-result-meta">
                            ${probabilityPercent}%
                        </span>

                    </div>


                    <div class="rn-result-item">

                        <strong>
                            ⚠️ AI Risk Level
                        </strong>

                        <span class="rn-result-meta">
                            ${band.label}
                            ·
                            ${band.priority}
                        </span>

                    </div>


                    <div class="rn-result-item">

                        <strong>
                            📍 Coordinates
                        </strong>

                        <span class="rn-result-meta">
                            ${Number(place.lat).toFixed(4)},
                            ${Number(place.lon).toFixed(4)}
                        </span>

                    </div>

                </div>

                `
                : ""
        }


        <div
            class="rn-factor-list"
            style="margin-top:16px;"
        >

            <div class="rn-factor">

                <span>
                    Flood
                </span>

                <div class="rn-bar">

                    <span
                        style="
                            width:${ruleScores.flood}%
                        "
                    ></span>

                </div>

                <strong>
                    ${ruleScores.flood}
                </strong>

            </div>


            <div class="rn-factor">

                <span>
                    Landslide
                </span>

                <div class="rn-bar">

                    <span
                        style="
                            width:${score}%
                        "
                    ></span>

                </div>

                <strong>
                    ${score}
                </strong>

            </div>


            <div class="rn-factor">

                <span>
                    Heatwave
                </span>

                <div class="rn-bar">

                    <span
                        style="
                            width:${ruleScores.heat}%
                        "
                    ></span>

                </div>

                <strong>
                    ${ruleScores.heat}
                </strong>

            </div>


            <div class="rn-factor">

                <span>
                    Severe weather
                </span>

                <div class="rn-bar">

                    <span
                        style="
                            width:${ruleScores.severe}%
                        "
                    ></span>

                </div>

                <strong>
                    ${ruleScores.severe}
                </strong>

            </div>

        </div>


        <div class="rn-source-row">

            <span class="rn-source">
                Live Open-Meteo weather
            </span>


            ${
                mlResult
                    ? `
                    <span class="rn-source">
                        RakshaNet ML model
                    </span>
                    `
                    : ""
            }


            <span class="rn-source">
                OpenStreetMap geocoding
            </span>


            <span class="rn-source">
                IMD official warnings should be checked
            </span>

        </div>


        <div class="rn-footer-note">

            ${
                mlResult
                    ? `
                    RakshaNet's preliminary AI/ML
                    landslide risk estimate is based on
                    historical landslide-weather patterns
                    and current/recent meteorological
                    conditions.
                    `
                    : `
                    This is a preliminary
                    data-driven risk estimate.
                    `
            }

            It is not an official IMD warning.
            Follow official warnings and local
            authorities for emergency decisions.

        </div>
    `;


    return {

        score,

        ...ruleScores
    };
}


/* =========================================================
   ANALYZE PLACE
========================================================= */

async function analyzePlace(
    place,
    hazard,
    target
) {

    target.innerHTML = `

        <div class="rn-muted">

            Fetching live weather and
            running AI model for
            ${esc(place.name)}…

        </div>
    `;


    try {

        const raw =
            await getWeather(
                place.lat,
                place.lon
            );


        const summary =
            summarizeWeather(
                raw
            );


        let mlResult =
            null;


        if (
            hazard === "landslide" ||
            hazard === "auto"
        ) {

            mlResult =
                await predictLandslideML(
                    raw,
                    place.lat,
                    place.lon
                );
        }


        const risk =
            renderPrediction(
                target,
                place,
                summary,
                hazard,
                mlResult
            );


        localStorage.setItem(

            "rakshanet_last_prediction",

            JSON.stringify({

                place,

                summary,

                risk,

                ml:
                    mlResult,

                timestamp:
                    Date.now()
            })
        );


        localStorage.setItem(

            "rakshanet_last_risk",

            String(
                risk.score || 0
            )
        );


        return {

            raw,

            summary,

            risk,

            ml:
                mlResult
        };


    } catch (e) {

        console.error(
            "RakshaNet prediction error:",
            e
        );


        target.innerHTML = `

            <div
                class="rn-alert-banner danger"
            >
                Unable to run AI prediction right now.
                ${esc(e.message)}
            </div>

        `;


        throw e;
    }
}


/* =========================================================
   ANALYZE CURRENT LOCATION
========================================================= */

async function analyzeFromLocation(
    target,
    hazard = "auto"
) {

    return new Promise(
        (
            resolve,
            reject
        ) => {

            RakshaLocation.getLocation(

                async loc => {

                    try {

                        const place = {

                            lat:
                                loc.latitude,

                            lon:
                                loc.longitude,

                            name:
                                `Current location (${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)})`
                        };


                        resolve(
                            await analyzePlace(
                                place,
                                hazard,
                                target
                            )
                        );


                    } catch (e) {

                        reject(e);
                    }

                },

                reject
            );
        }
    );
}


/* =========================================================
   HOME
========================================================= */

function initHome() {

    const status =
        $("homeLiveStatus");


    if (!status)
        return;


    const stamp =
        $("homeLiveTime");


    status.textContent =
        "LIVE";


    status.style.color =
        "#25d6a2";


    stamp.textContent =
        `Weather engine ready · ${new Date().toLocaleTimeString()}`;


    const analyzeBtn =
        $("analyzeRegionBtn");


    const myBtn =
        $("analyzeMyLocationBtn");


    const target =
        $("predictionResult");


    const hazard =
        () =>
            $("predictionHazard")
                ?.value ||
            "auto";


    analyzeBtn?.addEventListener(
        "click",
        async () => {

            const q =
                $("predictionPlace")
                    ?.value
                    .trim();


            if (!q) {

                alert(
                    "Enter a place such as Guwahati, Assam."
                );

                return;
            }


            analyzeBtn.disabled =
                true;


            try {

                const place =
                    await geocodePlace(
                        q
                    );


                await analyzePlace(
                    place,
                    hazard(),
                    target
                );


            } catch (e) {

                target.innerHTML = `

                    <div
                        class="rn-alert-banner danger"
                    >
                        ${esc(e.message)}
                    </div>

                `;

            } finally {

                analyzeBtn.disabled =
                    false;
            }
        }
    );


    myBtn?.addEventListener(
        "click",
        async () => {

            myBtn.disabled =
                true;


            try {

                await analyzeFromLocation(
                    target,
                    hazard()
                );


            } catch (e) {

                target.innerHTML = `

                    <div
                        class="rn-alert-banner danger"
                    >
                        ${esc(e.message)}
                    </div>

                `;

            } finally {

                myBtn.disabled =
                    false;
            }
        }
    );
}


/* =========================================================
   EMERGENCY PRIORITY
========================================================= */

function calculatePriority(
    report,
    liveRisk = 0
) {

    let score =
        0;


    const typeWeights = {

        "Building Collapse":
            35,

        Fire:
            32,

        Landslide:
            30,

        Flood:
            28,

        "Road Blockage":
            15,

        Other:
            10
    };


    score +=
        typeWeights[
            report.incidentType
        ] || 10;


    score +=
        clamp(
            Number(
                report.peopleAffected
            ) * 2,
            0,
            20
        );


    score +=
        clamp(
            Number(
                report.injured
            ) * 8,
            0,
            24
        );


    score +=
        clamp(
            Number(
                report.trapped
            ) * 10,
            0,
            30
        );


    score +=
        clamp(
            liveRisk * 0.25,
            0,
            25
        );


    if (score >= 85) {

        return {

            label:
                "P1 Critical",

            score:
                Math.round(score),

            cls:
                "rn-risk-extreme"
        };
    }


    if (score >= 60) {

        return {

            label:
                "P2 High",

            score:
                Math.round(score),

            cls:
                "rn-risk-high"
        };
    }


    if (score >= 35) {

        return {

            label:
                "P3 Watch",

            score:
                Math.round(score),

            cls:
                "rn-risk-medium"
        };
    }


    return {

        label:
            "P4 Normal",

        score:
            Math.round(score),

        cls:
            "rn-risk-low"
    };
}


/* =========================================================
   FILE DATA URL
========================================================= */

function fileToDataURL(file) {

    return new Promise(
        (resolve, reject) => {

            if (!file)
                return resolve(null);


            if (
                file.size >
                4 * 1024 * 1024
            ) {

                return reject(
                    new Error(
                        "Selected file is over 4 MB for the offline browser queue."
                    )
                );
            }


            const reader =
                new FileReader();


            reader.onload =
                () =>
                    resolve({

                        name:
                            file.name,

                        type:
                            file.type,

                        size:
                            file.size,

                        dataUrl:
                            reader.result
                    });


            reader.onerror =
                reject;


            reader.readAsDataURL(
                file
            );
        }
    );
}


/* =========================================================
   EMERGENCY PAGE
========================================================= */

function initEmergencyPage() {

    const form =
        $("emergencyForm");


    if (!form)
        return;


    const submitButton =
        $("submitReportBtn");


    const incidentButtons =
        document.querySelectorAll(
            ".incident-option"
        );


    incidentButtons.forEach(
        btn => {

            btn.addEventListener(
                "click",
                () => {

                    incidentButtons.forEach(
                        b =>
                            b.classList.remove(
                                "selected",
                                "active"
                            )
                    );


                    btn.classList.add(
                        "selected",
                        "active"
                    );


                    $("incidentType").value =
                        btn.dataset.type;


                    updatePriorityPreview();
                }
            );
        }
    );


    $("locationBtn")?.addEventListener(
        "click",
        () => {

            $("locationStatus").textContent =
                "Detecting location…";


            $("locationText").textContent =
                "Please allow GPS access.";


            RakshaLocation.getLocation(

                loc => {

                    $("latitude").value =
                        loc.latitude;


                    $("longitude").value =
                        loc.longitude;


                    $("locationStatus").textContent =
                        "Location detected successfully";


                    $("locationText").textContent =
                        `Lat ${loc.latitude.toFixed(6)} · ` +
                        `Lng ${loc.longitude.toFixed(6)} · ` +
                        `±${Math.round(loc.accuracy)}m`;

                },


                msg => {

                    $("locationStatus").textContent =
                        "Location unavailable";


                    $("locationText").textContent =
                        msg;
                }
            );
        }
    );


    [
        "peopleCount",
        "injuredCount",
        "trappedCount"
    ].forEach(
        id => {

            $(id)?.addEventListener(
                "input",
                updatePriorityPreview
            );
        }
    );


    $("evidence")?.addEventListener(
        "change",
        () => {

            const file =
                $("evidence")
                    .files?.[0];


            const box =
                $("evidencePreview");


            if (!box)
                return;


            if (!file) {

                box.innerHTML =
                    "";

                return;
            }


            if (
                file.size >
                15 * 1024 * 1024
            ) {

                box.innerHTML = `

                    <div
                        class="rn-alert-banner danger"
                    >
                        Selected file is larger than 15 MB.
                    </div>

                `;

                return;
            }


            if (
                file.type.startsWith(
                    "image/"
                )
            ) {

                const url =
                    URL.createObjectURL(
                        file
                    );


                box.innerHTML = `

                    <img
                        class="rn-upload-preview"
                        src="${url}"
                        alt="Selected evidence"
                    >

                `;

            } else {

                box.innerHTML = `

                    <div class="rn-small">

                        📎 Selected file:
                        ${esc(file.name)}
                        ·
                        ${(file.size / 1024).toFixed(0)}
                        KB

                    </div>

                `;
            }
        }
    );


    form.addEventListener(
        "submit",
        async event => {

            event.preventDefault();


            if (
                submitButton?.disabled
            ) {
                return;
            }


            const report = {

                id:
                    `RN-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,

                reporterName:
                    $("reporterName")
                        ?.value
                        .trim() ||
                    "Anonymous",

                contact:
                    $("contact")
                        ?.value
                        .trim() ||
                    "",

                incidentType:
                    $("incidentType")
                        ?.value ||
                    "",

                latitude:
                    Number(
                        $("latitude")
                            ?.value
                    ),

                longitude:
                    Number(
                        $("longitude")
                            ?.value
                    ),

                peopleAffected:
                    Number(
                        $("peopleCount")
                            ?.value ||
                        0
                    ),

                injured:
                    Number(
                        $("injuredCount")
                            ?.value ||
                        0
                    ),

                trapped:
                    Number(
                        $("trappedCount")
                            ?.value ||
                        0
                    ),

                description:
                    $("description")
                        ?.value
                        .trim() ||
                    "",

                timestamp:
                    new Date()
                        .toISOString(),

                status:
                    "NEW",

                synced:
                    false
            };


            if (
                !report.incidentType
            ) {

                alert(
                    "Please select the emergency type."
                );

                return;
            }


            if (
                !Number.isFinite(
                    report.latitude
                ) ||
                !Number.isFinite(
                    report.longitude
                )
            ) {

                alert(
                    "Please use your current location first."
                );

                return;
            }


            if (
                report.peopleAffected < 1
            ) {

                alert(
                    "Enter at least 1 person affected."
                );

                return;
            }


            if (
                !report.description
            ) {

                alert(
                    "Describe the emergency."
                );

                return;
            }


            const file =
                $("evidence")
                    ?.files?.[0] ||
                null;


            if (
                file &&
                file.size >
                15 * 1024 * 1024
            ) {

                alert(
                    "Selected file is larger than 15 MB."
                );

                return;
            }


            const previewRisk =
                Number(
                    localStorage.getItem(
                        "rakshanet_last_risk"
                    ) ||
                    0
                );


            report.priority =
                calculatePriority(
                    report,
                    previewRisk
                );


            localStorage.setItem(

                "rakshanet_last_risk",

                String(
                    Math.max(
                        previewRisk,
                        report.priority.score
                    )
                )
            );


            if (
                !RN_BACKEND.available
            ) {

                alert(
                    "RakshaNet backend is currently unavailable. Please try again."
                );

                return;
            }


            if (submitButton) {

                submitButton.disabled =
                    true;

                submitButton.textContent =
                    "⏳ SENDING REPORT...";
            }


            try {

                const fd =
                    new FormData();


                fd.append(
                    "id",
                    report.id
                );


                fd.append(
                    "reporterName",
                    report.reporterName
                );


                fd.append(
                    "contact",
                    report.contact
                );


                fd.append(
                    "incidentType",
                    report.incidentType
                );


                fd.append(
                    "latitude",
                    String(
                        report.latitude
                    )
                );


                fd.append(
                    "longitude",
                    String(
                        report.longitude
                    )
                );


                fd.append(
                    "peopleAffected",
                    String(
                        report.peopleAffected
                    )
                );


                fd.append(
                    "injured",
                    String(
                        report.injured
                    )
                );


                fd.append(
                    "trapped",
                    String(
                        report.trapped
                    )
                );


                fd.append(
                    "description",
                    report.description
                );


                fd.append(
                    "timestamp",
                    report.timestamp
                );


                fd.append(
                    "status",
                    report.status
                );


                fd.append(
                    "synced",
                    "true"
                );


                fd.append(
                    "priority",
                    JSON.stringify(
                        report.priority
                    )
                );


                if (file) {

                    fd.append(
                        "evidence",
                        file
                    );
                }


                const saved =
                    await RN_BACKEND.request(
                        "/api/reports",
                        {
                            method:
                                "POST",

                            body:
                                fd
                        }
                    );


                report.synced =
                    true;


                report.backendId =
                    saved.id;


                const lightweightReport = {

                    ...report,

                    evidence:
                        saved.evidence ||
                        null
                };


                let localReports =
                    [];


                try {

                    localReports =
                        JSON.parse(
                            localStorage.getItem(
                                "rakshanet_reports"
                            ) ||
                            "[]"
                        );


                    if (
                        !Array.isArray(
                            localReports
                        )
                    ) {

                        localReports =
                            [];
                    }

                } catch (_) {

                    localReports =
                        [];
                }


                localReports.unshift(
                    lightweightReport
                );


                localStorage.setItem(

                    "rakshanet_reports",

                    JSON.stringify(
                        localReports.slice(
                            0,
                            100
                        )
                    )
                );


                $("reportPriorityPreview")
                    .innerHTML = `

                        <div
                            class="rn-risk-badge ${report.priority.cls}"
                        >
                            ${report.priority.label}
                            · Score
                            ${report.priority.score}
                        </div>

                    `;


                alert(

                    `Emergency report sent successfully!\n\n` +

                    `Emergency ID: ${report.id}\n` +

                    `Priority: ${report.priority.label}\n\n` +

                    `The report has been saved to RakshaNet.`

                );


                form.reset();


                incidentButtons.forEach(
                    button =>
                        button.classList.remove(
                            "selected",
                            "active"
                        )
                );


                $("incidentType").value =
                    "";


                $("latitude").value =
                    "";


                $("longitude").value =
                    "";


                $("locationStatus").textContent =
                    "Location not detected";


                $("locationText").textContent =
                    "Use My Location to attach GPS.";


                $("evidencePreview").innerHTML =
                    "";


                renderMapReportsIfAvailable();


            } catch (error) {

                console.error(
                    "Emergency report submission failed:",
                    error
                );


                alert(

                    `Emergency report could not be sent.\n\n${error.message}`

                );


            } finally {

                if (submitButton) {

                    submitButton.disabled =
                        false;

                    submitButton.textContent =
                        "🚨 SEND EMERGENCY REPORT";
                }
            }
        }
    );
}


/* =========================================================
   PRIORITY PREVIEW
========================================================= */

function updatePriorityPreview() {

    const box =
        $("reportPriorityPreview");


    if (!box)
        return;


    const incidentType =
        $("incidentType")
            ?.value ||
        "Other";


    const r = {

        incidentType,

        peopleAffected:
            Number(
                $("peopleCount")
                    ?.value ||
                0
            ),

        injured:
            Number(
                $("injuredCount")
                    ?.value ||
                0
            ),

        trapped:
            Number(
                $("trappedCount")
                    ?.value ||
                0
            )
    };


    const p =
        calculatePriority(
            r,
            Number(
                localStorage.getItem(
                    "rakshanet_last_risk"
                ) ||
                0
            )
        );


    box.innerHTML = `

        <div
            class="rn-risk-badge ${p.cls}"
        >
            ${p.label}
            · Score
            ${p.score}
        </div>

    `;
}


/* =========================================================
   GIS - NEARBY SEARCH
========================================================= */

async function searchNearby(
    lat,
    lon,
    kind
) {

    const tag = {

        hospital:
            "amenity=hospital",

        shelter:
            "amenity=shelter",

        relief:
            "amenity=social_centre|amenity=community_centre",

        rescue:
            "emergency=ambulance_station|amenity=fire_station"

    }[kind];


    if (!tag)
        return [];


    const parts =
        tag
            .split("|")
            .map(
                t => {

                    const [
                        k,
                        v
                    ] =
                        t.split("=");


                    return `nwr[${k}=${JSON.stringify(v)}](around:10000,${lat},${lon});`;
                }
            )
            .join("\n");


    /*
        Smaller search area + shorter Overpass
        query timeout keeps GIS requests lighter.
    */

    const query =
        `[out:json][timeout:8];(${parts});out center tags;`;


    const data =
        await RN_BACKEND.request(
            "/api/gis/nearby",
            {

                method:
                    "POST",

                headers: {

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        query
                    })
            }
        );


    return (

        data.elements || []

    )

        .map(
            el => {

                const c =
                    el.center ||
                    el;


                const t =
                    el.tags ||
                    {};


                return {

                    name:
                        t.name ||
                        "Unnamed facility",

                    lat:
                        Number(
                            c.lat
                        ),

                    lon:
                        Number(
                            c.lon
                        ),

                    phone:
                        t.phone ||
                        t["contact:phone"] ||
                        "",

                    address: [

                        t["addr:street"],

                        t["addr:city"],

                        t["addr:state"]

                    ]
                        .filter(Boolean)
                        .join(", ")
                };
            }
        )

        .filter(
            item =>
                Number.isFinite(
                    item.lat
                ) &&
                Number.isFinite(
                    item.lon
                )
        )

        .slice(
            0,
            12
        );
}


/* =========================================================
   DISTANCE
========================================================= */

function haversine(
    a,
    b,
    c,
    d
) {

    const R =
        6371;


    const p =
        Math.PI / 180;


    const dLat =
        (c - a) * p;


    const dLon =
        (d - b) * p;


    const x =

        Math.sin(
            dLat / 2
        ) ** 2

        +

        Math.cos(
            a * p
        )

        *

        Math.cos(
            c * p
        )

        *

        Math.sin(
            dLon / 2
        ) ** 2;


    return (

        R *

        2 *

        Math.atan2(
            Math.sqrt(x),
            Math.sqrt(1 - x)
        )

    );
}


/* =========================================================
   RENDER NEARBY RESULTS
========================================================= */

function renderNearby(
    items,
    kind,
    lat,
    lon
) {

    const box =
        $("nearbyResult");


    if (!box)
        return;


    const icon = {

        hospital:
            "🏥",

        shelter:
            "🏠",

        relief:
            "📦",

        rescue:
            "🚒"

    }[kind];


    if (!items.length) {

        box.innerHTML = `

            <div class="rn-result-item">

                <strong>
                    ${icon}
                    No mapped facilities found nearby
                </strong>

                <span class="rn-result-meta">

                    Try again or use 112
                    for immediate emergency help.

                </span>

            </div>

        `;

        return;
    }


    box.innerHTML =

        items
            .map(
                x => `

                    <div class="rn-result-item">

                        <strong>
                            ${icon}
                            ${esc(x.name)}
                        </strong>

                        <span class="rn-result-meta">

                            ${esc(
                                x.address ||
                                "Nearby facility"
                            )}

                            ·

                            ${Math.round(
                                haversine(
                                    lat,
                                    lon,
                                    x.lat,
                                    x.lon
                                ) * 100
                            ) / 100}

                            km away

                            ${
                                x.phone
                                    ? ` · ${esc(x.phone)}`
                                    : ""
                            }

                        </span>


                        <div
                            class="rn-actions"
                            style="margin-top:7px;"
                        >

                            <button
                                class="rn-btn ghost"
                                type="button"
                                onclick="
                                    window.open(
                                        'https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lon}#map=18/${x.lat}/${x.lon}',
                                        '_blank'
                                    )
                                "
                            >
                                View map
                            </button>


                            ${
                                x.phone

                                    ?

                                    `
                                    <a
                                        class="rn-btn"
                                        href="tel:${encodeURIComponent(x.phone)}"
                                    >
                                        Call
                                    </a>
                                    `

                                    :

                                    ""
                            }

                        </div>

                    </div>

                `
            )
            .join("");
}


/* =========================================================
   HELP PAGE
========================================================= */

function initHelpPage() {

    const btn =
        $("getHelpLocation");


    if (!btn)
        return;


    const text =
        $("helpLocationText");


    const getLoc =
        () =>
            new Promise(
                (
                    resolve,
                    reject
                ) =>
                    RakshaLocation.getLocation(
                        resolve,
                        reject
                    )
            );


    btn.addEventListener(
        "click",
        async () => {

            btn.disabled =
                true;


            text.innerHTML =
                "Detecting…";


            try {

                const l =
                    await getLoc();


                text.innerHTML = `

                    <strong>
                        Location detected
                    </strong>

                    <br>

                    Lat ${l.latitude.toFixed(6)}

                    ·

                    Lng ${l.longitude.toFixed(6)}

                    ·

                    ±${Math.round(
                        l.accuracy
                    )}m

                `;

            } catch (e) {

                text.textContent =
                    e.message;

            } finally {

                btn.disabled =
                    false;
            }
        }
    );


    [
        "findHospital",
        "findShelter",
        "findRelief",
        "findRescue"

    ].forEach(
        id => {

            $(id)?.addEventListener(
                "click",
                async () => {

                    const loc =
                        RakshaLocation
                            .getSavedLocation();


                    if (!loc) {

                        text.textContent =
                            "Detect your location first.";

                        return;
                    }


                    const kind =
                        id
                            .replace(
                                "find",
                                ""
                            )
                            .toLowerCase();


                    const box =
                        $("nearbyResult");


                    if (box) {

                        box.innerHTML = `

                            <div
                                class="rn-result-item"
                            >

                                <strong>
                                    ⏳ Searching nearby ${esc(kind)}...
                                </strong>

                                <span
                                    class="rn-result-meta"
                                >
                                    OpenStreetMap / Overpass
                                </span>

                            </div>

                        `;
                    }


                    try {

                        const items =
                            await searchNearby(
                                loc.latitude,
                                loc.longitude,
                                kind
                            );


                        renderNearby(
                            items,
                            kind,
                            loc.latitude,
                            loc.longitude
                        );


                    } catch (e) {

                        if (box) {

                            box.innerHTML = `

                                <div
                                    class="rn-result-item"
                                >

                                    <strong>
                                        ⚠️ Live search temporarily unavailable
                                    </strong>

                                    <span
                                        class="rn-result-meta"
                                    >
                                        Please try again.
                                        You can still use the map
                                        or call 112.
                                    </span>

                                </div>

                            `;
                        }


                        console.warn(
                            `${kind} search error:`,
                            e
                        );
                    }
                }
            );
        }
    );


    $("sendSos")?.addEventListener(
        "click",
        async () => {

            const description =
                $("sosDescription")
                    .value
                    .trim();


            const loc =
                RakshaLocation
                    .getSavedLocation();


            if (!loc) {

                alert(
                    "Detect your location first."
                );

                return;
            }


            const sos = {

                id:
                    `SOS-${Date.now()}`,

                latitude:
                    loc.latitude,

                longitude:
                    loc.longitude,

                description:
                    description ||
                    "Immediate rescue requested.",

                timestamp:
                    new Date()
                        .toISOString(),

                priority:
                    "P1 Critical",

                status:
                    "NEW"
            };


            const q =
                JSON.parse(
                    localStorage.getItem(
                        "rakshanet_sos"
                    ) ||
                    "[]"
                );


            q.unshift(
                sos
            );


            localStorage.setItem(

                "rakshanet_sos",

                JSON.stringify(
                    q.slice(
                        0,
                        100
                    )
                )
            );


            let backendSaved =
                false;


            if (
                RN_BACKEND.available
            ) {

                try {

                    await RN_BACKEND.request(
                        "/api/sos",
                        {

                            method:
                                "POST",

                            headers: {

                                "Content-Type":
                                    "application/json"
                            },

                            body:
                                JSON.stringify(
                                    sos
                                )
                        }
                    );


                    backendSaved =
                        true;

                } catch (e) {

                    console.warn(
                        "SOS backend save failed",
                        e
                    );
                }
            }


            $("sosResult").innerHTML = `

                <div
                    class="rn-alert-banner danger"
                >

                    <strong>
                        ${sos.id}
                    </strong>

                    <br>

                    SOS ${
                        backendSaved
                            ? "sent to backend"
                            : "queued locally"
                    }

                    at

                    ${loc.latitude.toFixed(5)},
                    ${loc.longitude.toFixed(5)}.

                    <br>

                    Call 112 for immediate
                    national emergency response.

                </div>

            `;
        }
    );


    initVolunteers();
}


/* =========================================================
   VOLUNTEERS
========================================================= */

function initVolunteers() {

    const list =
        $("taskList");


    if (list) {

        const sample = [

            "Check nearby shelter capacity",

            "Assist transport to nearest hospital",

            "Distribute food/water",

            "Relay local road blockage information"

        ];


        list.innerHTML =

            sample
                .map(
                    (x, i) => `

                        <div
                            class="rn-result-item"
                        >

                            <strong>
                                Task ${i + 1}
                            </strong>

                            <span
                                class="rn-result-meta"
                            >
                                ${esc(x)}
                            </span>

                        </div>

                    `
                )
                .join("");
    }


    $("registerVolunteer")?.addEventListener(
        "click",
        async () => {

            const v = {

                id:
                    `VOL-${Date.now()}`,

                name:
                    $("volName")
                        .value
                        .trim(),

                phone:
                    $("volPhone")
                        .value
                        .trim(),

                skill:
                    $("volSkill")
                        .value,

                availability:
                    $("volAvailability")
                        .value,

                timestamp:
                    new Date()
                        .toISOString()
            };


            if (
                !v.name ||
                !v.phone
            ) {

                alert(
                    "Enter volunteer name and phone."
                );

                return;
            }


            const arr =
                JSON.parse(
                    localStorage.getItem(
                        "rakshanet_volunteers"
                    ) ||
                    "[]"
                );


            arr.unshift(
                v
            );


            localStorage.setItem(

                "rakshanet_volunteers",

                JSON.stringify(
                    arr.slice(
                        0,
                        200
                    )
                )
            );


            if (
                RN_BACKEND.available
            ) {

                try {

                    const saved =
                        await RN_BACKEND.request(
                            "/api/volunteers",
                            {

                                method:
                                    "POST",

                                headers: {

                                    "Content-Type":
                                        "application/json"
                                },

                                body:
                                    JSON.stringify(v)
                            }
                        );


                    v.id =
                        saved.id;

                } catch (e) {

                    console.warn(
                        "Volunteer backend save failed",
                        e
                    );
                }
            }


            $("volunteerStatus").innerHTML = `

                <span
                    class="rn-volunteer-status"
                >
                    ✅ Registered
                    ${esc(v.id)}
                    ·
                    ${esc(v.skill)}
                    ·
                    ${esc(v.availability)}
                </span>

            `;


            $("volName").value =
                "";


            $("volPhone").value =
                "";
        }
    );
}


/* =========================================================
   MAP MARKERS
========================================================= */

function createLayerMarker(
    layer,
    item,
    emoji
) {

    const marker =
        L.circleMarker(
            [
                item.lat,
                item.lon
            ],
            {

                radius:
                    8,

                weight:
                    2,

                fillOpacity:
                    .8
            }
        );


    marker.bindPopup(`

        <strong>
            ${emoji}
            ${esc(item.name)}
        </strong>

        <br>

        ${esc(
            item.address ||
            "Nearby facility"
        )}

        ${
            item.phone
                ? `
                    <br>
                    📞
                    ${esc(item.phone)}
                `
                : ""
        }

    `);


    marker.addTo(
        layer
    );


    return marker;
}


function renderMapReportsIfAvailable() {

    if (
        window.__rnMapAPI?.renderReports
    ) {

        window.__rnMapAPI.renderReports();
    }
}


/* =========================================================
   MAP
========================================================= */

async function initMap() {

    const mapElement =
        $("disasterMap");


    if (
        !mapElement ||
        typeof L === "undefined"
    ) {

        return;
    }


    const map =
        L.map(
            mapElement
        )
        .setView(
            [26.3, 92.0],
            6
        );


    L.tileLayer(

        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",

        {

            maxZoom:
                19,

            attribution:
                "&copy; OpenStreetMap contributors"

        }

    ).addTo(
        map
    );


    const layers = {

        weather:
            L.layerGroup()
                .addTo(map),

        risk:
            L.layerGroup()
                .addTo(map),

        reports:
            L.layerGroup()
                .addTo(map),

        hospitals:
            L.layerGroup(),

        shelters:
            L.layerGroup(),

        resources:
            L.layerGroup()
    };


    let userMarker =
        null;


    let routeControl =
        null;


    let weatherCache =
        new Map();


    let destinationData =
        [];


    const weatherStatus =
        $("weatherStatus");


    const imdStatus =
        $("imdStatus");


    const gpsStatus =
        $("gpsStatus");


    const osmStatus =
        $("osmStatus");


    const summary =
        $("mapWeatherSummary");


    const routeStatus =
        $("routeStatus");


    const destinationSelect =
        $("destinationSelect");


    const searchInput =
        $("mapLocationSearch");


    const searchButton =
        $("mapLocationSearchBtn");


    const suggestionsBox =
        $("mapLocationSuggestions");


    const searchStatus =
        $("mapSearchStatus");


    const nearbyResult =
        $("nearbyResult");


    let searchTimer =
        null;


    let latestSearchRequest =
        0;


/* =========================================================
   SMART LOCATION SEARCH
========================================================= */

    function hideLocationSuggestions() {

        if (!suggestionsBox)
            return;


        suggestionsBox.style.display =
            "none";


        suggestionsBox.innerHTML =
            "";
    }


    function showLocationSearchLoading() {

        if (!suggestionsBox)
            return;


        suggestionsBox.innerHTML = `

            <div
                class="rn-location-result"
                style="cursor:default;"
            >

                <span
                    class="rn-location-result-title"
                >
                    🔎 Searching locations...
                </span>

                <span
                    class="rn-location-result-address"
                >
                    Looking for matching places in India
                </span>

            </div>

        `;


        suggestionsBox.style.display =
            "block";
    }


    function showLocationSearchMessage(
        title,
        description
    ) {

        if (!suggestionsBox)
            return;


        suggestionsBox.innerHTML = `

            <div
                class="rn-location-result"
                style="cursor:default;"
            >

                <span
                    class="rn-location-result-title"
                >
                    ${esc(title)}
                </span>

                <span
                    class="rn-location-result-address"
                >
                    ${esc(description)}
                </span>

            </div>

        `;


        suggestionsBox.style.display =
            "block";
    }


    function formatLocationResult(
        item
    ) {

        const address =
            item.address ||
            {};


        const parts = [

            address.suburb,

            address.neighbourhood,

            address.village,

            address.town,

            address.city,

            address.district,

            address.state

        ]
            .filter(Boolean);


        return {

            title:
                parts.length

                    ?

                    parts
                        .slice(
                            0,
                            2
                        )
                        .join(", ")

                    :

                    (
                        item.display_name ||
                        "Selected location"
                    ),


            address:
                parts.length

                    ?

                    parts
                        .slice(2)
                        .join(", ")

                    :

                    (
                        item.display_name ||
                        ""
                    )
        };
    }


    function showLocationSuggestions(
        results
    ) {

        if (!suggestionsBox)
            return;


        if (!results.length) {

            showLocationSearchMessage(

                "📍 No matching places found",

                "Try adding a city, district, village or nearby area."

            );

            return;
        }


        suggestionsBox.innerHTML =

            results

                .map(
                    (item, index) => {

                        const formatted =
                            formatLocationResult(
                                item
                            );


                        return `

                            <button
                                type="button"
                                class="rn-location-result"
                                data-index="${index}"
                            >

                                <span
                                    class="rn-location-result-title"
                                >
                                    📍
                                    ${esc(
                                        formatted.title
                                    )}
                                </span>

                                <span
                                    class="rn-location-result-address"
                                >
                                    ${esc(
                                        formatted.address
                                    )}
                                </span>

                            </button>

                        `;
                    }
                )
                .join("");


        suggestionsBox.style.display =
            "block";


        suggestionsBox
            .querySelectorAll(
                ".rn-location-result"
            )
            .forEach(
                button => {

                    button.addEventListener(
                        "click",
                        async () => {

                            const index =
                                Number(
                                    button.dataset.index
                                );


                            const selected =
                                results[index];


                            if (!selected)
                                return;


                            await selectMapLocation(
                                selected
                            );
                        }
                    );
                }
            );
    }


    async function searchMapLocations(
        query
    ) {

        const cleanQuery =
            String(
                query || ""
            )
                .trim();


        if (
            cleanQuery.length < 2
        ) {

            hideLocationSuggestions();


            if (searchStatus) {

                searchStatus.textContent =
                    "Type at least 2 characters to search.";
            }


            return;
        }


        const requestId =
            ++latestSearchRequest;


        showLocationSearchLoading();


        if (searchStatus) {

            searchStatus.textContent =
                "Searching...";
        }


        try {

            const url =
                new URL(
                    RN_CONFIG.geocode
                );


            url.search =
                new URLSearchParams({

                    q:
                        `${cleanQuery}, India`,

                    format:
                        "jsonv2",

                    addressdetails:
                        "1",

                    limit:
                        "10",

                    countrycodes:
                        "in"

                });


            const results =
                await fetchJSON(

                    url.toString(),

                    {},

                    12000

                );


            if (
                requestId !==
                latestSearchRequest
            ) {

                return;
            }


            showLocationSuggestions(
                results
            );


            if (searchStatus) {

                searchStatus.textContent =
                    results.length

                        ?

                        `${results.length} places found`

                        :

                        "No matching places found.";
            }


        } catch (error) {

            if (
                requestId !==
                latestSearchRequest
            ) {

                return;
            }


            showLocationSearchMessage(

                "⚠️ Search unavailable",

                "Check your internet connection and try again."

            );


            if (searchStatus) {

                searchStatus.textContent =
                    "Location search unavailable.";
            }


            console.warn(
                "Smart location search error:",
                error
            );
        }
    }


/* =========================================================
   SELECT MAP LOCATION
========================================================= */

    async function selectMapLocation(
        item
    ) {

        const lat =
            Number(
                item.lat
            );


        const lon =
            Number(
                item.lon
            );


        const name =
            item.display_name ||
            "Selected location";


        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lon)
        ) {

            return;
        }


        hideLocationSuggestions();


        if (searchInput) {

            searchInput.value =
                name
                    .split(",")
                    .slice(
                        0,
                        2
                    )
                    .join(", ");
        }


        if (searchStatus) {

            searchStatus.textContent =
                "Location selected.";
        }


        map.setView(
            [lat, lon],
            13,
            {
                animate:
                    true
            }
        );


        if (
            window.__rnSelectedMapLocation
        ) {

            map.removeLayer(
                window.__rnSelectedMapLocation
            );
        }


        window.__rnSelectedMapLocation =

            L.marker(
                [lat, lon]
            )

                .addTo(
                    map
                )

                .bindPopup(`

                    <strong>
                        📍 Selected Location
                    </strong>

                    <br>

                    ${esc(name)}

                `)

                .openPopup();


        localStorage.setItem(

            "rakshanet_map_location",

            JSON.stringify({

                latitude:
                    lat,

                longitude:
                    lon,

                name:
                    name

            })

        );


        try {

            summary.innerHTML = `

                <strong>
                    📍 Loading location intelligence...
                </strong>

                <br>

                <span class="rn-small">
                    ${esc(name)}
                </span>

            `;


            const raw =
                await getWeather(
                    lat,
                    lon
                );


            const weather =
                summarizeWeather(
                    raw
                );


            const weatherRisk =
                scoreRisk(
                    weather,
                    "auto"
                ).score;


            let mlResult =
                null;


            try {

                mlResult =
                    await predictLandslideML(
                        raw,
                        lat,
                        lon
                    );

            } catch (mlError) {

                console.warn(
                    "ML prediction unavailable:",
                    mlError
                );
            }


            const risk =
                mlResult?.prediction?.percentage ??
                weatherRisk;


            const riskLabel =
                mlResult?.prediction?.risk ||
                riskBand(risk).label;


            const priority =
                mlResult?.prediction?.priority ||
                riskBand(risk).priority;


            let intelligenceBlock;


            if (mlResult) {

                intelligenceBlock = `

                    <div
                        style="
                            margin-bottom:12px;
                            padding:12px;
                            border-radius:10px;
                            background:rgba(255,255,255,.04);
                        "
                    >

                        <strong>
                            🧠 AI Risk Score
                        </strong>


                        <div
                            style="
                                font-size:1.7rem;
                                font-weight:800;
                                margin-top:4px;
                            "
                        >
                            ${risk}/100
                        </div>


                        <div
                            class="rn-risk-badge ${riskBand(risk).cls}"
                            style="
                                display:inline-block;
                                margin-top:6px;
                            "
                        >

                            ${esc(riskLabel)}
                            ·
                            ${esc(priority)}

                        </div>


                        <div
                            class="rn-small"
                            style="margin-top:7px;"
                        >
                            Preliminary ML estimate
                        </div>

                    </div>

                `;

            } else {

                intelligenceBlock = `

                    <div
                        style="
                            margin-bottom:12px;
                            padding:12px;
                            border-radius:10px;
                            background:rgba(255,255,255,.04);
                        "
                    >

                        <strong>
                            🌦️ Weather Risk Score
                        </strong>


                        <div
                            style="
                                font-size:1.7rem;
                                font-weight:800;
                                margin-top:4px;
                            "
                        >
                            ${risk}/100
                        </div>


                        <div
                            class="rn-risk-badge ${riskBand(risk).cls}"
                            style="
                                display:inline-block;
                                margin-top:6px;
                            "
                        >

                            ${esc(riskLabel)}

                        </div>

                    </div>

                `;
            }


            summary.innerHTML = `

                <strong>
                    📍 ${esc(
                        name
                            .split(",")
                            .slice(
                                0,
                                2
                            )
                            .join(", ")
                    )}
                </strong>


                <br>


                <span class="rn-small">
                    ${lat.toFixed(5)},
                    ${lon.toFixed(5)}
                </span>


                <br><br>


                ${intelligenceBlock}


                <div
                    class="rn-result-item"
                    style="margin-top:10px;"
                >

                    <strong>
                        🌡️ Temperature
                    </strong>

                    <span class="rn-result-meta">
                        ${weather.temp.toFixed(1)}°C
                    </span>

                </div>


                <div
                    class="rn-result-item"
                    style="margin-top:7px;"
                >

                    <strong>
                        💧 Humidity
                    </strong>

                    <span class="rn-result-meta">
                        ${weather.humidity}%
                    </span>

                </div>


                <div
                    class="rn-result-item"
                    style="margin-top:7px;"
                >

                    <strong>
                        🌧️ 24h precipitation
                    </strong>

                    <span class="rn-result-meta">
                        ${weather.precip24.toFixed(1)} mm
                    </span>

                </div>


                <div
                    class="rn-result-item"
                    style="margin-top:7px;"
                >

                    <strong>
                        💨 Max wind
                    </strong>

                    <span class="rn-result-meta">
                        ${weather.maxWind.toFixed(0)} km/h
                    </span>

                </div>


                <div
                    class="rn-small"
                    style="margin-top:10px;"
                >

                    ${esc(
                        weatherCodeText(
                            weather.code
                        )
                    )}

                </div>


                <div
                    class="rn-footer-note"
                    style="margin-top:12px;"
                >

                    AI result is a preliminary risk
                    estimate and is not an official
                    disaster warning.

                    Follow official IMD/GSI advisories.

                </div>

            `;


            await loadWeatherGrid(
                lat,
                lon
            );


        } catch (error) {

            summary.innerHTML = `

                <strong>
                    📍 ${esc(name)}
                </strong>

                <br><br>

                <span
                    class="rn-alert-banner danger"
                >
                    Unable to load live
                    location intelligence.
                </span>

                <br><br>

                <span class="rn-small">
                    ${esc(error.message)}
                </span>

            `;


            console.warn(
                "Selected location intelligence error:",
                error
            );
        }
    }


/* =========================================================
   SEARCH EVENTS
========================================================= */

    if (searchInput) {

        searchInput.addEventListener(
            "input",
            () => {

                clearTimeout(
                    searchTimer
                );


                const query =
                    searchInput.value.trim();


                if (
                    query.length < 2
                ) {

                    hideLocationSuggestions();


                    if (searchStatus) {

                        searchStatus.textContent =
                            "Start typing to search for a location.";
                    }


                    return;
                }


                searchTimer =
                    setTimeout(
                        () => {

                            searchMapLocations(
                                query
                            );

                        },
                        700
                    );
            }
        );


        searchInput.addEventListener(
            "keydown",
            event => {

                if (
                    event.key === "Enter"
                ) {

                    event.preventDefault();


                    clearTimeout(
                        searchTimer
                    );


                    searchMapLocations(
                        searchInput.value
                    );
                }


                if (
                    event.key === "Escape"
                ) {

                    hideLocationSuggestions();
                }
            }
        );
    }


    searchButton?.addEventListener(
        "click",
        () => {

            clearTimeout(
                searchTimer
            );


            searchMapLocations(
                searchInput?.value ||
                ""
            );
        }
    );


    document.addEventListener(
        "click",
        event => {

            if (

                suggestionsBox &&

                searchInput &&

                !suggestionsBox.contains(
                    event.target
                ) &&

                event.target !==
                    searchInput

            ) {

                hideLocationSuggestions();
            }
        }
    );


/* =========================================================
   WEATHER GRID
========================================================= */

    async function loadWeatherGrid(
        centerLat = 26.3,
        centerLon = 92.0
    ) {

        const pts =
            [];


        for (
            let dy = -2;
            dy <= 2;
            dy += 1
        ) {

            for (
                let dx = -2;
                dx <= 2;
                dx += 1
            ) {

                pts.push([
                    clamp(
                        centerLat +
                        dy * 1.2,
                        18,
                        33
                    ),

                    centerLon +
                    dx * 1.2
                ]);
            }
        }


        const url =
            new URL(
                RN_CONFIG.weather
            );


        url.search =
            new URLSearchParams({

                latitude:
                    pts
                        .map(
                            p => p[0]
                        )
                        .join(","),

                longitude:
                    pts
                        .map(
                            p => p[1]
                        )
                        .join(","),

                timezone:
                    "auto",

                current:
                    "temperature_2m,relative_humidity_2m,rain,precipitation,weather_code,wind_speed_10m",

                hourly:
                    "precipitation,rain,wind_speed_10m",

                daily:
                    "precipitation_sum,precipitation_probability_max,temperature_2m_max,wind_speed_10m_max",

                forecast_days:
                    "3"
            });


        try {

            const data =
                await fetchJSON(
                    url.toString()
                );


            const arr =
                Array.isArray(data)
                    ? data
                    : [data];


            layers.weather.clearLayers();

            layers.risk.clearLayers();

            weatherCache.clear();


            arr.forEach(
                (d, i) => {

                    const lat =
                        Number(
                            d.latitude ??
                            pts[i][0]
                        );


                    const lon =
                        Number(
                            d.longitude ??
                            pts[i][1]
                        );


                    const w =
                        summarizeWeather(
                            d
                        );


                    const risk =
                        scoreRisk(
                            w,
                            "auto"
                        ).score;


                    weatherCache.set(

                        `${lat.toFixed(2)},${lon.toFixed(2)}`,

                        {

                            lat,

                            lon,

                            w,

                            risk

                        }

                    );


                    const marker =
                        L.circleMarker(
                            [
                                lat,
                                lon
                            ],
                            {

                                radius:
                                    8,

                                weight:
                                    1,

                                fillColor:
                                    riskColor(
                                        risk
                                    ),

                                color:
                                    riskColor(
                                        risk
                                    ),

                                fillOpacity:
                                    .75
                            }
                        );


                    marker.bindPopup(`

                        <strong>
                            🌦️ Live weather
                        </strong>

                        <br>

                        Risk:
                        ${riskBand(risk).label}
                        (${risk}/100)

                        <br>

                        Temp:
                        ${w.temp.toFixed(1)}°C

                        <br>

                        24h precipitation:
                        ${w.precip24.toFixed(1)} mm

                        <br>

                        Max wind:
                        ${w.maxWind.toFixed(0)} km/h

                        <br>

                        ${weatherCodeText(w.code)}

                    `).addTo(
                        layers.weather
                    );


                    L.circle(
                        [
                            lat,
                            lon
                        ],
                        {

                            radius:
                                120000,

                            stroke:
                                false,

                            fillColor:
                                riskColor(
                                    risk
                                ),

                            fillOpacity:
                                Math.max(
                                    .05,
                                    Math.min(
                                        .18,
                                        risk / 600
                                    )
                                )

                        }
                    )

                        .bindPopup(
                            `Risk estimate: ${riskBand(risk).label} (${risk}/100)`
                        )

                        .addTo(
                            layers.risk
                        );

                }
            );


            if (weatherStatus) {

                weatherStatus.textContent =
                    "LIVE";


                weatherStatus.className =
                    "rn-status-ok";
            }


        } catch (error) {

            console.warn(
                "Weather grid unavailable:",
                error
            );


            if (weatherStatus) {

                weatherStatus.textContent =
                    "Unavailable";


                weatherStatus.className =
                    "rn-status-warn";
            }
        }
    }


/* =========================================================
   IMD
========================================================= */

    async function checkIMD() {

        if (!imdStatus)
            return;


        try {

            const data =
                await RN_BACKEND.request(
                    "/api/imd/district-warnings"
                );


            if (data) {

                imdStatus.textContent =
                    "LIVE";


                imdStatus.className =
                    "rn-status-ok";

            } else {

                throw new Error(
                    "No IMD data"
                );
            }


        } catch (e) {

            console.warn(
                "IMD warnings temporarily unavailable:",
                e
            );


            imdStatus.textContent =
                "Temporarily unavailable";


            imdStatus.className =
                "rn-status-warn";
        }
    }


/* =========================================================
   REPORTS
========================================================= */

    function populateReports() {

        layers.reports.clearLayers();


        const reports =
            JSON.parse(

                localStorage.getItem(
                    "rakshanet_reports"
                ) ||
                "[]"

            );


        reports.forEach(
            r => {

                if (
                    !r.latitude ||
                    !r.longitude
                ) {

                    return;
                }


                const m =
                    L.circleMarker(

                        [
                            Number(
                                r.latitude
                            ),

                            Number(
                                r.longitude
                            )
                        ],

                        {

                            radius:
                                9,

                            color:
                                r.priority?.label
                                    ?.includes("P1")
                                    ? "#ef4444"
                                    : "#f59e0b",

                            fillOpacity:
                                .85
                        }
                    );


                m.bindPopup(`

                    <strong>
                        🚨
                        ${esc(
                            r.incidentType
                        )}
                    </strong>

                    <br>

                    Priority:
                    ${esc(
                        r.priority?.label ||
                        "NEW"
                    )}

                    <br>

                    People:
                    ${r.peopleAffected}

                    <br>

                    Injured:
                    ${r.injured}

                    <br>

                    Trapped:
                    ${r.trapped}

                    <br>

                    ${esc(
                        r.description
                    )}

                    <br>

                    <small>
                        ${new Date(
                            r.timestamp
                        ).toLocaleString()}
                    </small>

                `).addTo(
                    layers.reports
                );
            }
        );
    }


/* =========================================================
   ACTIVE MAP LOCATION
========================================================= */

    function getActiveMapLocation() {

        try {

            const selected =
                JSON.parse(

                    localStorage.getItem(
                        "rakshanet_map_location"
                    ) ||
                    "null"

                );


            if (

                selected &&

                Number.isFinite(
                    Number(
                        selected.latitude
                    )
                ) &&

                Number.isFinite(
                    Number(
                        selected.longitude
                    )
                )

            ) {

                return {

                    latitude:
                        Number(
                            selected.latitude
                        ),

                    longitude:
                        Number(
                            selected.longitude
                        ),

                    name:
                        selected.name ||
                        "Selected location",

                    source:
                        "search"
                };
            }

        } catch (error) {

            console.warn(
                "Unable to read selected map location:",
                error
            );
        }


        const gps =
            RakshaLocation
                .getSavedLocation();


        if (

            gps &&

            Number.isFinite(
                Number(
                    gps.latitude
                )
            ) &&

            Number.isFinite(
                Number(
                    gps.longitude
                )
            )

        ) {

            return {

                latitude:
                    Number(
                        gps.latitude
                    ),

                longitude:
                    Number(
                        gps.longitude
                    ),

                name:
                    "My current location",

                source:
                    "gps"
            };
        }


        const center =
            map.getCenter();


        return {

            latitude:
                center.lat,

            longitude:
                center.lng,

            name:
                "Current map area",

            source:
                "map"
        };
    }


/* =========================================================
   LOAD MAP FACILITIES
========================================================= */

    async function loadFacilities(
        kind,
        layer
    ) {

        const location =
            getActiveMapLocation();


        if (!location) {

            throw new Error(
                "Please select a location first."
            );
        }


        if (searchStatus) {

            searchStatus.textContent =
                `Searching ${kind} near ${location.name}...`;
        }


        if (nearbyResult) {

            nearbyResult.innerHTML = `

                <div
                    class="rn-result-item"
                >

                    <strong>
                        ⏳ Searching nearby ${esc(kind)}...
                    </strong>

                    <span
                        class="rn-result-meta"
                    >
                        OpenStreetMap / Overpass
                    </span>

                </div>

            `;
        }


        layer.clearLayers();


        const items =
            await searchNearby(

                location.latitude,

                location.longitude,

                kind

            );


        const icon =
            kind === "hospital"

                ?

                "🏥"

                :

                kind === "shelter"

                    ?

                    "🏠"

                    :

                    kind === "rescue"

                        ?

                        "🚒"

                        :

                        "📦";


        items.forEach(
            item => {

                createLayerMarker(
                    layer,
                    item,
                    icon
                );


                destinationData.push(
                    item
                );
            }
        );


        refreshDestinations();


        /*
            Show the actual nearby results
            in the Help & Safety card too.
        */

        if (nearbyResult) {

            renderNearby(

                items,

                kind,

                location.latitude,

                location.longitude

            );
        }


        if (searchStatus) {

            searchStatus.textContent =
                `${items.length} ${kind} locations found near ${location.name}.`;
        }


        if (osmStatus) {

            osmStatus.textContent =
                items.length
                    ? "LIVE"
                    : "No results";


            osmStatus.className =
                items.length
                    ? "rn-status-ok"
                    : "rn-status-warn";
        }


        return items;
    }


/* =========================================================
   ROUTE DESTINATIONS
========================================================= */

    function refreshDestinations() {

        const unique =
            destinationData.filter(
                (x, i, a) =>
                    i ===
                    a.findIndex(
                        y =>
                            y.name === x.name &&

                            Math.abs(
                                y.lat - x.lat
                            ) < .0001 &&

                            Math.abs(
                                y.lon - x.lon
                            ) < .0001
                    )
            )
            .slice(
                0,
                30
            );


        if (!destinationSelect)
            return;


        destinationSelect.innerHTML =

            '<option value="">Choose hospital / shelter</option>' +

            unique
                .map(
                    x => `

                        <option
                            value="${x.lat},${x.lon}"
                        >
                            ${esc(x.name)}
                        </option>

                    `
                )
                .join("");


        destinationSelect.dataset.locations =
            JSON.stringify(
                unique
            );
    }


/* =========================================================
   MY LOCATION
========================================================= */

    $("locateUser")?.addEventListener(
        "click",
        () => {

            RakshaLocation.getLocation(

                async loc => {

                    if (userMarker) {

                        map.removeLayer(
                            userMarker
                        );
                    }


                    userMarker =
                        L.circleMarker(
                            [
                                loc.latitude,
                                loc.longitude
                            ],
                            {

                                radius:
                                    10,

                                color:
                                    "#25d6a2",

                                fillColor:
                                    "#25d6a2",

                                fillOpacity:
                                    .9
                            }
                        )

                            .addTo(
                                map
                            )

                            .bindPopup(
                                "📍 You are here"
                            )

                            .openPopup();


                    map.setView(

                        [
                            loc.latitude,
                            loc.longitude
                        ],

                        12

                    );


                    if (gpsStatus) {

                        gpsStatus.textContent =
                            `±${Math.round(
                                loc.accuracy
                            )}m`;


                        gpsStatus.className =
                            "rn-status-ok";
                    }


                    localStorage.setItem(

                        "rakshanet_map_location",

                        JSON.stringify({

                            latitude:
                                loc.latitude,

                            longitude:
                                loc.longitude,

                            name:
                                "My current location"
                        })
                    );


                    if (searchInput) {

                        searchInput.value =
                            "";
                    }


                    try {

                        const raw =
                            await getWeather(
                                loc.latitude,
                                loc.longitude
                            );


                        const weather =
                            summarizeWeather(
                                raw
                            );


                        const weatherRisk =
                            scoreRisk(
                                weather,
                                "auto"
                            ).score;


                        let mlResult =
                            null;


                        try {

                            mlResult =
                                await predictLandslideML(
                                    raw,
                                    loc.latitude,
                                    loc.longitude
                                );

                        } catch (mlError) {

                            console.warn(
                                "ML prediction unavailable:",
                                mlError
                            );
                        }


                        const risk =
                            mlResult?.prediction?.percentage ??
                            weatherRisk;


                        summary.innerHTML = `

                            <strong>
                                📍 My current location
                            </strong>

                            <br>

                            <span
                                class="rn-small"
                            >
                                ${loc.latitude.toFixed(5)},
                                ${loc.longitude.toFixed(5)}
                            </span>

                            <br><br>

                            <strong>
                                ${riskBand(risk).label}
                                ·
                                ${risk}/100
                            </strong>


                            ${
                                mlResult

                                    ?

                                    `

                                    <br>

                                    🧠 AI Risk Score:
                                    ${risk}/100

                                    `

                                    :

                                    ""
                            }


                            <br>

                            🌡️
                            ${weather.temp.toFixed(1)}°C

                            ·

                            💧
                            ${weather.humidity}%


                            <br>

                            🌧️ 24h precipitation:
                            ${weather.precip24.toFixed(1)} mm


                            <br>

                            💨 Wind:
                            ${weather.maxWind.toFixed(0)} km/h


                            <br>

                            <span
                                class="rn-small"
                            >
                                ${esc(
                                    weatherCodeText(
                                        weather.code
                                    )
                                )}
                            </span>

                        `;


                        await loadWeatherGrid(
                            loc.latitude,
                            loc.longitude
                        );


                    } catch (e) {

                        summary.textContent =
                            e.message;
                    }

                },


                msg => {

                    if (gpsStatus) {

                        gpsStatus.textContent =
                            "Unavailable";


                        gpsStatus.className =
                            "rn-status-bad";
                    }


                    alert(
                        msg
                    );
                }
            );
        }
    );


/* =========================================================
   MAP LAYERS
========================================================= */

    $("showWeather")?.addEventListener(
        "click",
        () => {

            layers.weather.addTo(
                map
            );


            layers.risk.removeFrom(
                map
            );


            layers.reports.removeFrom(
                map
            );
        }
    );


    $("showRiskZones")?.addEventListener(
        "click",
        () => {

            layers.risk.addTo(
                map
            );


            layers.weather.removeFrom(
                map
            );
        }
    );


    $("showDisasters")?.addEventListener(
        "click",
        () => {

            populateReports();


            layers.reports.addTo(
                map
            );


            layers.weather.removeFrom(
                map
            );


            layers.risk.removeFrom(
                map
            );
        }
    );


/* =========================================================
   FACILITY SEARCH BUTTONS
========================================================= */

    async function handleFacilitySearch(
        kind,
        layer,
        button
    ) {

        if (
            !button ||
            button.disabled
        ) {

            return;
        }


        const originalText =
            button.textContent;


        try {

            button.disabled =
                true;


            button.textContent =
                "⏳ Searching...";


            if (searchStatus) {

                searchStatus.textContent =
                    `Searching nearby ${kind}...`;
            }


            if (nearbyResult) {

                nearbyResult.innerHTML = `

                    <div
                        class="rn-result-item"
                    >

                        <strong>
                            ⏳ Searching nearby ${esc(kind)}...
                        </strong>

                        <span
                            class="rn-result-meta"
                        >
                            OpenStreetMap / Overpass
                        </span>

                    </div>

                `;
            }


            const items =
                await loadFacilities(
                    kind,
                    layer
                );


            layer.addTo(
                map
            );


            if (searchStatus) {

                searchStatus.textContent =

                    items.length

                        ?

                        `${items.length} ${kind} locations found.`

                        :

                        `No nearby ${kind} locations found.`;
            }


        } catch (e) {

            console.warn(
                `${kind} GIS search failed:`,
                e
            );


            if (nearbyResult) {

                nearbyResult.innerHTML = `

                    <div
                        class="rn-result-item"
                    >

                        <strong>
                            ⚠️
                            ${esc(
                                kind.charAt(0).toUpperCase() +
                                kind.slice(1)
                            )}
                            search temporarily unavailable
                        </strong>

                        <span
                            class="rn-result-meta"
                        >
                            Please try again in a moment.
                            The rest of the map remains available.
                        </span>

                    </div>

                `;
            }


            if (searchStatus) {

                searchStatus.textContent =
                    `⚠️ ${kind} search temporarily unavailable. Please try again.`;
            }


            if (osmStatus) {

                osmStatus.textContent =
                    "Temporarily unavailable";


                osmStatus.className =
                    "rn-status-warn";
            }


        } finally {

            button.disabled =
                false;


            button.textContent =
                originalText;
        }
    }


    $("showHospitals")?.addEventListener(

        "click",

        () =>
            handleFacilitySearch(

                "hospital",

                layers.hospitals,

                $("showHospitals")

            )
    );


    $("showShelters")?.addEventListener(

        "click",

        () =>
            handleFacilitySearch(

                "shelter",

                layers.shelters,

                $("showShelters")

            )
    );


    $("showResources")?.addEventListener(

        "click",

        () =>
            handleFacilitySearch(

                "rescue",

                layers.resources,

                $("showResources")

            )
    );


/* =========================================================
   EVACUATION ROUTE
========================================================= */

    $("safeRouteButton")?.addEventListener(

        "click",

        () => {

            const loc =
                RakshaLocation
                    .getSavedLocation();


            if (!loc) {

                alert(
                    "Click My Location first."
                );

                return;
            }


            if (
                !destinationSelect?.value
            ) {

                alert(
                    "Choose a destination."
                );

                return;
            }


            const [
                lat,
                lon
            ] =
                destinationSelect
                    .value
                    .split(",")
                    .map(Number);


            if (routeControl) {

                map.removeControl(
                    routeControl
                );

                routeControl =
                    null;
            }


            if (routeStatus) {

                routeStatus.textContent =
                    "Calculating road route…";
            }


            routeControl =
                L.Routing.control({

                    router:
                        L.Routing.osrmv1({

                            serviceUrl:
                                RN_CONFIG.route
                        }),


                    waypoints: [

                        L.latLng(
                            loc.latitude,
                            loc.longitude
                        ),

                        L.latLng(
                            lat,
                            lon
                        )

                    ],


                    addWaypoints:
                        false,

                    draggableWaypoints:
                        false,

                    routeWhileDragging:
                        false,

                    showAlternatives:
                        true,

                    createMarker:
                        () => null,

                    fitSelectedRoutes:
                        true

                })

                    .addTo(
                        map
                    );


            routeControl.on(

                "routesfound",

                ev => {

                    const r =
                        ev.routes[0];


                    if (routeStatus) {

                        routeStatus.innerHTML = `

                            <strong>
                                ✅ Route found
                            </strong>

                            <br>

                            ${(
                                r.summary.totalDistance /
                                1000
                            ).toFixed(1)}

                            km

                            ·

                            ${Math.round(
                                r.summary.totalTime /
                                60
                            )}

                            min

                        `;
                    }
                }
            );


            routeControl.on(

                "routingerror",

                () => {

                    if (routeStatus) {

                        routeStatus.innerHTML = `

                            <strong>
                                ⚠️ Route failed
                            </strong>

                            <br>

                            Check internet/routing availability.

                        `;
                    }
                }
            );
        }
    );


/* =========================================================
   CLEAR ROUTE
========================================================= */

    $("clearRouteButton")?.addEventListener(

        "click",

        () => {

            if (routeControl) {

                map.removeControl(
                    routeControl
                );

                routeControl =
                    null;
            }


            if (routeStatus) {

                routeStatus.textContent =
                    "Route cleared.";
            }
        }
    );


/* =========================================================
   SEE ON MAP
========================================================= */

    $("seeOnMapButton")?.addEventListener(

        "click",

        () => {

            const mapTarget =
                $("disasterMap");


            if (!mapTarget)
                return;


            mapTarget.scrollIntoView({

                behavior:
                    "smooth",

                block:
                    "center"
            });


            /*
                If a route already exists,
                the map keeps it visible.
            */
        }
    );


/* =========================================================
   MAP API
========================================================= */

    window.__rnMapAPI = {

        renderReports:
            populateReports
    };


    populateReports();


    await loadWeatherGrid();


    await checkIMD();
}


/* =========================================================
   DOM READY
========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        console.log(
            "RakshaNet upgraded client loaded"
        );


        await detectBackend();


        initHome();

        initEmergencyPage();

        initHelpPage();

        initMap();
    }
);


/* =========================================================
   AUTHENTICATION NAVBAR
========================================================= */

function updateAuthNavbar() {

    const user =
        localStorage.getItem(
            "rakshanet_user"
        );


    const authButtons =
        document.querySelectorAll(
            ".rn-auth-btn"
        );


    authButtons.forEach(
        button => {

            const isPagesFolder =
                window.location.pathname.includes(
                    "/pages/"
                ) ||

                window.location.pathname.includes(
                    "\\pages\\"
                );


            if (user) {

                button.textContent =
                    "👤 My Profile";


                button.href =
                    isPagesFolder

                        ?

                        "profile.html"

                        :

                        "pages/profile.html";


            } else {

                button.textContent =
                    "🔐 Register / Login";


                button.href =
                    isPagesFolder

                        ?

                        "login.html"

                        :

                        "pages/login.html";
            }
        }
    );
}


document.addEventListener(
    "DOMContentLoaded",
    updateAuthNavbar
);