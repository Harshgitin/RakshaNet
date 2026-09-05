/* =========================================================
   RAKSHANET - MAIN CLIENT ENGINE
   Live weather + risk + GIS + emergency + volunteers
   ========================================================= */


const RN_BACKEND = {
    base: window.location.protocol.startsWith("http") ? "" : "http://localhost:5000",
    async request(path, options = {}) {
        const url = `${RN_BACKEND.base}${path}`;
        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`Backend HTTP ${response.status}`);
        return response.json();
    },
    available: false
};

async function detectBackend() {
    try { await RN_BACKEND.request("/api/health"); RN_BACKEND.available = true; localStorage.setItem("rakshanet_backend", "online"); }
    catch { RN_BACKEND.available = false; localStorage.setItem("rakshanet_backend", "offline"); }
}

const RN_CONFIG = {
    // Official IMD public API endpoints. Access can depend on IMD policy/CORS/network.
    imd: {
        districtWarnings: "https://mausam.imd.gov.in/api/warnings_district_api.php",
        districtRainfall: "https://mausam.imd.gov.in/api/districtwise_rainfall_api.php",
        rss: "https://mausam.imd.gov.in/imd_latest/contents/dist_nowcast_rss.php"
    },
    weather: "https://api.open-meteo.com/v1/forecast",
    geocode: "https://nominatim.openstreetmap.org/search",
    overpass: "https://overpass-api.de/api/interpreter",
    route: "https://router.project-osrm.org/route/v1"
};

const $ = (id) => document.getElementById(id);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c]));
}

async function fetchJSON(url, options = {}, timeout = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } finally { clearTimeout(timer); }
}

async function geocodePlace(query) {
    const url = new URL(RN_CONFIG.geocode);
    url.search = new URLSearchParams({ q: `${query}, India`, format: "jsonv2", limit: "1", addressdetails: "1" });
    const data = await fetchJSON(url.toString());
    if (!data.length) throw new Error("Place not found. Try a city, district or state in India.");
    return { lat: Number(data[0].lat), lon: Number(data[0].lon), name: data[0].display_name };
}

async function getWeather(lat, lon) {
    const url = new URL(RN_CONFIG.weather);
    url.search = new URLSearchParams({
        latitude: String(lat), longitude: String(lon), timezone: "auto",
        current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m,wind_gusts_10m",
        hourly: "precipitation,rain,showers,weather_code,wind_speed_10m,temperature_2m",
        daily: "precipitation_sum,rain_sum,showers_sum,precipitation_probability_max,weather_code,temperature_2m_max,wind_speed_10m_max",
        forecast_days: "5"
    });
    return await fetchJSON(url.toString());
}

function summarizeWeather(data) {
    const current = data.current || {};
    const hourly = data.hourly || {};
    const daily = data.daily || {};
    const precip24 = (hourly.precipitation || []).slice(0, 24).reduce((a,b) => a + Number(b || 0), 0);
    const rain24 = (hourly.rain || []).slice(0, 24).reduce((a,b) => a + Number(b || 0), 0);
    const maxWind = Math.max(...(hourly.wind_speed_10m || []).slice(0, 24).map(Number), Number(current.wind_speed_10m || 0));
    const maxTemp = Math.max(...(daily.temperature_2m_max || []).slice(0, 3).map(Number), Number(current.temperature_2m || 0));
    const maxProb = Math.max(...(daily.precipitation_probability_max || []).slice(0, 3).map(Number), 0);
    const rain3d = (daily.precipitation_sum || []).slice(0, 3).reduce((a,b) => a + Number(b || 0), 0);
    return { temp: Number(current.temperature_2m || 0), humidity: Number(current.relative_humidity_2m || 0), rainNow: Number(current.rain || 0), precip24, rain24, maxWind, maxTemp, maxProb, rain3d, code: Number(current.weather_code || 0) };
}

function weatherCodeText(code) {
    if ([95,96,99].includes(code)) return "Thunderstorm";
    if (code >= 80) return "Rain showers";
    if (code >= 61) return "Rain";
    if (code >= 51) return "Drizzle";
    if (code >= 45) return "Fog";
    if (code >= 1) return "Cloudy";
    return "Clear";
}

function scoreRisk(w, hazard = "auto") {
    const flood = clamp((w.precip24 / 120) * 55 + (w.maxProb / 100) * 20 + (w.rain3d / 250) * 25, 0, 100);
    const landslide = clamp((w.rain3d / 220) * 50 + (w.precip24 / 120) * 35 + (w.maxWind / 80) * 15, 0, 100);
    const heat = clamp(((w.maxTemp - 32) / 12) * 100, 0, 100);
    const severe = clamp((w.maxWind / 90) * 55 + (w.maxProb / 100) * 20 + ([95,96,99].includes(w.code) ? 35 : 0), 0, 100);
    let score;
    if (hazard === "flood") score = flood;
    else if (hazard === "landslide") score = landslide;
    else if (hazard === "heatwave") score = heat;
    else if (hazard === "severe") score = severe;
    else score = Math.max(flood, landslide, heat, severe);
    return { score: Math.round(score), flood: Math.round(flood), landslide: Math.round(landslide), heat: Math.round(heat), severe: Math.round(severe) };
}

function riskBand(score) {
    if (score >= 80) return { label: "EXTREME", cls: "rn-risk-extreme", priority: "P1 Critical" };
    if (score >= 60) return { label: "HIGH", cls: "rn-risk-high", priority: "P2 High" };
    if (score >= 35) return { label: "WATCH", cls: "rn-risk-medium", priority: "P3 Watch" };
    return { label: "LOW", cls: "rn-risk-low", priority: "P4 Normal" };
}

function riskColor(score) {
    if (score >= 80) return "#ef4444";
    if (score >= 60) return "#f97316";
    if (score >= 35) return "#f59e0b";
    return "#22c55e";
}

function renderPrediction(target, place, weather, hazard) {
    const s = scoreRisk(weather, hazard);
    const band = riskBand(s.score);
    const weatherText = weatherCodeText(weather.code);
    target.innerHTML = `
        <div class="rn-risk-score">
            <div class="rn-score-ring" style="background:conic-gradient(${riskColor(s.score)} ${s.score * 3.6}deg, rgba(255,255,255,.06) 0deg)"><strong>${s.score}</strong></div>
            <div><div class="rn-risk-badge ${band.cls}">${band.label} · ${band.priority}</div><h3 style="margin-top:9px">${esc(place.name)}</h3><div class="rn-muted">Live condition: ${esc(weatherText)}</div></div>
        </div>
        <div class="rn-weather-grid">
            <div class="rn-metric"><span>Temperature</span><strong>${weather.temp.toFixed(1)}°C</strong></div>
            <div class="rn-metric"><span>Humidity</span><strong>${weather.humidity}%</strong></div>
            <div class="rn-metric"><span>24h Rain</span><strong>${weather.precip24.toFixed(1)} mm</strong></div>
            <div class="rn-metric"><span>Max Wind</span><strong>${weather.maxWind.toFixed(0)} km/h</strong></div>
        </div>
        <div class="rn-factor-list" style="margin-top:16px;">
            ${[["Flood",s.flood],["Landslide",s.landslide],["Heatwave",s.heat],["Severe weather",s.severe]].map(([name,val])=>`<div class="rn-factor"><span>${name}</span><div class="rn-bar"><span style="width:${val}%"></span></div><strong>${val}</strong></div>`).join("")}
        </div>
        <div class="rn-source-row"><span class="rn-source">Live Open-Meteo weather</span><span class="rn-source">OpenStreetMap geocoding</span><span class="rn-source">IMD official warnings should be checked</span></div>
        <div class="rn-footer-note">This is a preliminary data-driven risk estimate using live meteorological variables. It is not an official IMD warning and should not replace local authorities.</div>`;
    return s;
}

async function analyzePlace(place, hazard, target) {
    target.innerHTML = `<div class="rn-muted">Fetching live weather for ${esc(place.name)}…</div>`;
    try {
        const raw = await getWeather(place.lat, place.lon);
        const summary = summarizeWeather(raw);
        const risk = renderPrediction(target, place, summary, hazard);
        localStorage.setItem("rakshanet_last_prediction", JSON.stringify({ place, summary, risk, timestamp: Date.now() }));
        return { raw, summary, risk };
    } catch (e) {
        target.innerHTML = `<div class="rn-alert-banner danger">Unable to fetch live weather right now. ${esc(e.message)}</div>`;
        throw e;
    }
}

async function analyzeFromLocation(target, hazard = "auto") {
    return new Promise((resolve, reject) => {
        RakshaLocation.getLocation(async (loc) => {
            try {
                const place = { lat: loc.latitude, lon: loc.longitude, name: `Current location (${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)})` };
                resolve(await analyzePlace(place, hazard, target));
            } catch (e) { reject(e); }
        }, reject);
    });
}

function initHome() {
    const status = $("homeLiveStatus");
    if (!status) return;
    const stamp = $("homeLiveTime");
    status.textContent = "LIVE";
    status.style.color = "#25d6a2";
    stamp.textContent = `Weather engine ready · ${new Date().toLocaleTimeString()}`;
    const analyzeBtn = $("analyzeRegionBtn");
    const myBtn = $("analyzeMyLocationBtn");
    const target = $("predictionResult");
    const hazard = () => $("predictionHazard")?.value || "auto";
    analyzeBtn?.addEventListener("click", async () => {
        const q = $("predictionPlace")?.value.trim();
        if (!q) { alert("Enter a place such as Guwahati, Assam."); return; }
        analyzeBtn.disabled = true;
        try { const place = await geocodePlace(q); await analyzePlace(place, hazard(), target); }
        catch (e) { target.innerHTML = `<div class="rn-alert-banner danger">${esc(e.message)}</div>`; }
        finally { analyzeBtn.disabled = false; }
    });
    myBtn?.addEventListener("click", async () => {
        myBtn.disabled = true;
        try { await analyzeFromLocation(target, hazard()); }
        catch (e) { target.innerHTML = `<div class="rn-alert-banner danger">${esc(e.message)}</div>`; }
        finally { myBtn.disabled = false; }
    });
}

function calculatePriority(report, liveRisk = 0) {
    let score = 0;
    const typeWeights = { "Building Collapse": 35, Fire: 32, Landslide: 30, Flood: 28, "Road Blockage": 15, Other: 10 };
    score += typeWeights[report.incidentType] || 10;
    score += clamp(Number(report.peopleAffected) * 2, 0, 20);
    score += clamp(Number(report.injured) * 8, 0, 24);
    score += clamp(Number(report.trapped) * 10, 0, 30);
    score += clamp(liveRisk * 0.25, 0, 25);
    if (score >= 85) return { label:"P1 Critical", score:Math.round(score), cls:"rn-risk-extreme" };
    if (score >= 60) return { label:"P2 High", score:Math.round(score), cls:"rn-risk-high" };
    if (score >= 35) return { label:"P3 Watch", score:Math.round(score), cls:"rn-risk-medium" };
    return { label:"P4 Normal", score:Math.round(score), cls:"rn-risk-low" };
}

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        if (!file) return resolve(null);
        // Keep local queue manageable.
        if (file.size > 4 * 1024 * 1024) return reject(new Error("Selected file is over 4 MB for the offline browser queue."));
        const reader = new FileReader();
        reader.onload = () => resolve({ name:file.name, type:file.type, size:file.size, dataUrl:reader.result });
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function initEmergencyPage() {
    const form = $("emergencyForm");
    if (!form) return;
    const incidentButtons = document.querySelectorAll(".incident-option");
    incidentButtons.forEach(btn => btn.addEventListener("click", () => {
        incidentButtons.forEach(b => b.classList.remove("selected","active"));
        btn.classList.add("selected","active");
        $("incidentType").value = btn.dataset.type;
        updatePriorityPreview();
    }));
    $("locationBtn")?.addEventListener("click", () => {
        $("locationStatus").textContent = "Detecting location…";
        $("locationText").textContent = "Please allow GPS access.";
        RakshaLocation.getLocation((loc) => {
            $("latitude").value = loc.latitude;
            $("longitude").value = loc.longitude;
            $("locationStatus").textContent = "Location detected successfully";
            $("locationText").textContent = `Lat ${loc.latitude.toFixed(6)} · Lng ${loc.longitude.toFixed(6)} · ±${Math.round(loc.accuracy)}m`;
        }, msg => { $("locationStatus").textContent = "Location unavailable"; $("locationText").textContent = msg; });
    });
    ["peopleCount","injuredCount","trappedCount"].forEach(id => $(id)?.addEventListener("input", updatePriorityPreview));
    $("evidence")?.addEventListener("change", () => {
        const file = $("evidence").files?.[0];
        const box = $("evidencePreview");
        if (!file) { box.innerHTML = ""; return; }
        box.innerHTML = file.type.startsWith("image/") ? `<img class="rn-upload-preview" src="${URL.createObjectURL(file)}" alt="Selected evidence">` : `<div class="rn-small">Queued file: ${esc(file.name)}</div>`;
    });
    form.addEventListener("submit", async e => {
        e.preventDefault();
        const report = {
            id:`RN-${Date.now()}`,
            reporterName:$("reporterName").value.trim(), contact:$("contact").value.trim(),
            incidentType:$("incidentType").value, latitude:$("latitude").value, longitude:$("longitude").value,
            peopleAffected:Number($("peopleCount").value || 0), injured:Number($("injuredCount").value || 0), trapped:Number($("trappedCount").value || 0),
            description:$("description").value.trim(), timestamp:new Date().toISOString(), status:"NEW", synced:false
        };
        if (!report.incidentType) return alert("Please select the emergency type.");
        if (!report.latitude || !report.longitude) return alert("Please use your current location first.");
        if (report.peopleAffected < 1) return alert("Enter at least 1 person affected.");
        if (!report.description) return alert("Describe the emergency.");
        try { report.evidence = await fileToDataURL($("evidence").files?.[0]); }
        catch (err) { return alert(err.message); }
        const previewRisk = Number(localStorage.getItem("rakshanet_last_risk") || 0);
        report.priority = calculatePriority(report, previewRisk);
        const queue = JSON.parse(localStorage.getItem("rakshanet_reports") || "[]");
        queue.unshift(report); localStorage.setItem("rakshanet_reports", JSON.stringify(queue.slice(0, 100)));
        localStorage.setItem("rakshanet_last_risk", String(Math.max(previewRisk, report.priority.score)));

        let backendSaved = false;
        if (RN_BACKEND.available) {
            try {
                const fd = new FormData();
                Object.entries(report).forEach(([k,v]) => {
                    if (k === "evidence") return;
                    fd.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
                });
                const file = $("evidence")?.files?.[0];
                if (file) fd.append("evidence", file);
                const saved = await RN_BACKEND.request("/api/reports", { method:"POST", body:fd });
                report.synced = true; report.backendId = saved.id; backendSaved = true;
            } catch (err) { console.warn("Backend save failed; keeping offline copy.", err); }
        }
        $("reportPriorityPreview").innerHTML = `<div class="rn-risk-badge ${report.priority.cls}">${report.priority.label} · Score ${report.priority.score}</div>`;
        alert(`Emergency report ${backendSaved ? "saved to RakshaNet backend" : "queued locally"}.\n\nEmergency ID: ${report.id}\nPriority: ${report.priority.label}`);
        form.reset(); incidentButtons.forEach(b=>b.classList.remove("selected","active"));
        $("incidentType").value = ""; $("latitude").value = ""; $("longitude").value = "";
        $("locationStatus").textContent = "Location not detected"; $("locationText").textContent = "Use My Location to attach GPS.";
        $("evidencePreview").innerHTML = "";
        renderMapReportsIfAvailable();
    });
}

function updatePriorityPreview() {
    const box = $("reportPriorityPreview"); if (!box) return;
    const incidentType = $("incidentType")?.value || "Other";
    const r = { incidentType, peopleAffected:Number($("peopleCount")?.value||0), injured:Number($("injuredCount")?.value||0), trapped:Number($("trappedCount")?.value||0) };
    const p = calculatePriority(r, Number(localStorage.getItem("rakshanet_last_risk")||0));
    box.innerHTML = `<div class="rn-risk-badge ${p.cls}">${p.label} · Score ${p.score}</div>`;
}

async function searchNearby(lat, lon, kind) {
    const tag = { hospital:'amenity=hospital', shelter:'amenity=shelter', relief:'amenity=social_centre|amenity=community_centre', rescue:'emergency=fire_hydrant|emergency=ambulance_station|amenity=fire_station' }[kind];
    if (!tag) return [];
    const parts = tag.split("|").map(t => { const [k,v] = t.split("="); return `nwr[${k}=${JSON.stringify(v)}](around:15000,${lat},${lon});`; }).join("\n");
    const query = `[out:json][timeout:20];(${parts});out center tags;`;
    const data = await fetchJSON(RN_CONFIG.overpass, { method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"}, body:query }, 25000);
    return (data.elements || []).map(el => {
        const c = el.center || el; const t = el.tags || {};
        return { name:t.name || "Unnamed facility", lat:Number(c.lat), lon:Number(c.lon), phone:t.phone || t["contact:phone"] || "", address:[t["addr:street"],t["addr:city"],t["addr:state"]].filter(Boolean).join(", ") };
    }).slice(0, 12);
}

function renderNearby(items, kind, lat, lon) {
    const box = $("nearbyResult"); if (!box) return;
    const icon = {hospital:"🏥",shelter:"🏠",relief:"📦",rescue:"🚒"}[kind];
    if (!items.length) { box.innerHTML = `<div class="rn-result-item"><strong>${icon} No mapped facilities found nearby</strong><span class="rn-result-meta">Try OpenStreetMap directly or call 112 for immediate help.</span></div>`; return; }
    box.innerHTML = items.map(x => `<div class="rn-result-item"><strong>${icon} ${esc(x.name)}</strong><span class="rn-result-meta">${esc(x.address || "Nearby facility")} · ${Math.round(haversine(lat,lon,x.lat,x.lon)*100)/100} km away ${x.phone ? `· ${esc(x.phone)}` : ""}</span><div class="rn-actions" style="margin-top:7px;"><button class="rn-btn ghost" onclick="window.open('https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lon}#map=18/${x.lat}/${x.lon}','_blank')">View map</button>${x.phone?`<a class="rn-btn" href="tel:${encodeURIComponent(x.phone)}">Call</a>`:""}</div></div>`).join("");
}

function haversine(a,b,c,d){ const R=6371; const p=Math.PI/180; const dLat=(c-a)*p,dLon=(d-b)*p; const x=Math.sin(dLat/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin(dLon/2)**2; return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)); }

function initHelpPage() {
    const btn = $("getHelpLocation"); if (!btn) return;
    const text = $("helpLocationText");
    const getLoc = () => new Promise((resolve,reject)=>RakshaLocation.getLocation(resolve,reject));
    btn.addEventListener("click", async ()=>{
        btn.disabled=true; text.innerHTML="Detecting…";
        try { const l=await getLoc(); text.innerHTML=`<strong>Location detected</strong><br>Lat ${l.latitude.toFixed(6)} · Lng ${l.longitude.toFixed(6)} · ±${Math.round(l.accuracy)}m`; }
        catch(e){ text.textContent=e.message; } finally { btn.disabled=false; }
    });
    ["findHospital","findShelter","findRelief","findRescue"].forEach(id=>$(id)?.addEventListener("click", async()=>{
        const loc = RakshaLocation.getSavedLocation(); if(!loc){ text.textContent="Detect your location first."; return; }
        const kind = id.replace("find","").toLowerCase(); const box=$("nearbyResult"); box.innerHTML=`<div class="rn-result-item"><strong>Searching…</strong><span class="rn-result-meta">OpenStreetMap/Overpass nearby resources</span></div>`;
        try { const items=await searchNearby(loc.latitude,loc.longitude,kind); renderNearby(items,kind,loc.latitude,loc.longitude); }
        catch(e){ box.innerHTML=`<div class="rn-result-item"><strong>Live search unavailable</strong><span class="rn-result-meta">${esc(e.message)} · You can still use the map or call 112.</span></div>`; }
    }));
    $("sendSos")?.addEventListener("click", async()=>{
        const description=$("sosDescription").value.trim(); const loc=RakshaLocation.getSavedLocation();
        if(!loc){ alert("Detect your location first."); return; }
        const sos={ id:`SOS-${Date.now()}`, latitude:loc.latitude, longitude:loc.longitude, description:description||"Immediate rescue requested.", timestamp:new Date().toISOString(), priority:"P1 Critical", status:"NEW" };
        const q=JSON.parse(localStorage.getItem("rakshanet_sos")||"[]"); q.unshift(sos); localStorage.setItem("rakshanet_sos",JSON.stringify(q.slice(0,100)));
        let backendSaved = false;
        if (RN_BACKEND.available) { try { await RN_BACKEND.request("/api/sos", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(sos)}); backendSaved = true; } catch(e) { console.warn("SOS backend save failed", e); } }
        $("sosResult").innerHTML=`<div class="rn-alert-banner danger"><strong>${sos.id}</strong><br>SOS ${backendSaved ? "sent to backend" : "queued locally"} at ${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}. Call 112 for immediate national emergency response.</div>`;
    });
    initVolunteers();
}

function initVolunteers(){
    const list=$("taskList"); if(list){
        const sample=["Check nearby shelter capacity","Assist transport to nearest hospital","Distribute food/water","Relay local road blockage information"];
        list.innerHTML=sample.map((x,i)=>`<div class="rn-result-item"><strong>Task ${i+1}</strong><span class="rn-result-meta">${x}</span></div>`).join("");
    }
    $("registerVolunteer")?.addEventListener("click",async ()=>{
        const v={id:`VOL-${Date.now()}`,name:$("volName").value.trim(),phone:$("volPhone").value.trim(),skill:$("volSkill").value,availability:$("volAvailability").value,timestamp:new Date().toISOString()};
        if(!v.name||!v.phone) return alert("Enter volunteer name and phone.");
        const arr=JSON.parse(localStorage.getItem("rakshanet_volunteers")||"[]"); arr.unshift(v); localStorage.setItem("rakshanet_volunteers",JSON.stringify(arr.slice(0,200)));
        if (RN_BACKEND.available) { try { const saved=await RN_BACKEND.request("/api/volunteers", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(v)}); v.id=saved.id; } catch(e) { console.warn("Volunteer backend save failed", e); } }
        $("volunteerStatus").innerHTML=`<span class="rn-volunteer-status">✅ Registered ${esc(v.id)} · ${esc(v.skill)} · ${esc(v.availability)}</span>`;
        $("volName").value=""; $("volPhone").value="";
    });
}

function createLayerMarker(layer, item, emoji) {
    const marker=L.circleMarker([item.lat,item.lon],{radius:8,weight:2,fillOpacity:.8});
    marker.bindPopup(`<strong>${emoji} ${esc(item.name)}</strong><br>${esc(item.address||"Nearby facility")}${item.phone?`<br>📞 ${esc(item.phone)}`:""}`); marker.addTo(layer); return marker;
}

function renderMapReportsIfAvailable(){ if(window.__rnMapAPI?.renderReports) window.__rnMapAPI.renderReports(); }

async function initMap(){
    const mapElement=$("disasterMap"); if(!mapElement || typeof L === "undefined") return;
    const map=L.map(mapElement).setView([26.3,92.0],6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OpenStreetMap contributors"}).addTo(map);
    const layers={weather:L.layerGroup().addTo(map),risk:L.layerGroup().addTo(map),reports:L.layerGroup().addTo(map),hospitals:L.layerGroup(),shelters:L.layerGroup(),resources:L.layerGroup()};
    let userMarker=null, routeControl=null, weatherCache=new Map(), destinationData=[];
    const weatherStatus=$("weatherStatus"), imdStatus=$("imdStatus"), gpsStatus=$("gpsStatus"), summary=$("mapWeatherSummary"), routeStatus=$("routeStatus"), destinationSelect=$("destinationSelect");

    async function loadWeatherGrid(centerLat=26.3,centerLon=92.0){
        const pts=[]; for(let dy=-2;dy<=2;dy+=1) for(let dx=-2;dx<=2;dx+=1) pts.push([clamp(centerLat+dy*1.2,18,33),centerLon+dx*1.2]);
        const url=new URL(RN_CONFIG.weather); url.search=new URLSearchParams({latitude:pts.map(p=>p[0]).join(","),longitude:pts.map(p=>p[1]).join(","),timezone:"auto",current:"temperature_2m,relative_humidity_2m,rain,precipitation,weather_code,wind_speed_10m",hourly:"precipitation,rain,wind_speed_10m",daily:"precipitation_sum,precipitation_probability_max,temperature_2m_max,wind_speed_10m_max",forecast_days:"3"});
        const data=await fetchJSON(url.toString()); const arr=Array.isArray(data)?data:[data];
        layers.weather.clearLayers(); layers.risk.clearLayers(); weatherCache.clear();
        arr.forEach((d,i)=>{ const lat=Number(d.latitude ?? pts[i][0]),lon=Number(d.longitude ?? pts[i][1]); const w=summarizeWeather(d); const risk=scoreRisk(w,"auto").score; weatherCache.set(`${lat.toFixed(2)},${lon.toFixed(2)}`,{lat,lon,w,risk});
            const marker=L.circleMarker([lat,lon],{radius:8,weight:1,fillColor:riskColor(risk),color:riskColor(risk),fillOpacity:.75});
            marker.bindPopup(`<strong>🌦️ Live weather</strong><br>Risk: ${riskBand(risk).label} (${risk}/100)<br>Temp: ${w.temp.toFixed(1)}°C<br>24h precipitation: ${w.precip24.toFixed(1)} mm<br>Max wind: ${w.maxWind.toFixed(0)} km/h<br>${weatherCodeText(w.code)}`).addTo(layers.weather);
            L.circle([lat,lon],{radius:120000,stroke:false,fillColor:riskColor(risk),fillOpacity:Math.max(.05, Math.min(.18,risk/600))}).bindPopup(`Risk estimate: ${riskBand(risk).label} (${risk}/100)`).addTo(layers.risk);
        });
        weatherStatus.textContent="LIVE"; weatherStatus.className="rn-status-ok";
    }

    async function checkIMD(){
        try { await fetchJSON(RN_CONFIG.imd.districtWarnings,{},10000); imdStatus.textContent="Reachable"; imdStatus.className="rn-status-ok"; }
        catch(_){ imdStatus.textContent="Endpoint unavailable"; imdStatus.className="rn-status-warn"; }
    }

    function populateReports(){
        layers.reports.clearLayers();
        const reports=JSON.parse(localStorage.getItem("rakshanet_reports")||"[]");
        reports.forEach(r=>{ if(!r.latitude||!r.longitude) return; const m=L.circleMarker([Number(r.latitude),Number(r.longitude)],{radius:9,color:r.priority?.label?.includes("P1")?"#ef4444":"#f59e0b",fillOpacity:.85}); m.bindPopup(`<strong>🚨 ${esc(r.incidentType)}</strong><br>Priority: ${esc(r.priority?.label||"NEW")}<br>People: ${r.peopleAffected}<br>Injured: ${r.injured}<br>Trapped: ${r.trapped}<br>${esc(r.description)}<br><small>${new Date(r.timestamp).toLocaleString()}</small>`).addTo(layers.reports); });
    }

    async function loadFacilities(kind, layer){
        const loc=RakshaLocation.getSavedLocation(); const c=loc||{latitude:26.3,longitude:92};
        const items=await searchNearby(c.latitude,c.longitude,kind); layer.clearLayers(); items.forEach(i=>{createLayerMarker(layer,i,kind==='hospital'?"🏥":kind==='shelter'?"🏠":kind==='rescue'?"🚒":"📦"); destinationData.push(i);});
        refreshDestinations();
    }
    function refreshDestinations(){
        const unique=destinationData.filter((x,i,a)=>i===a.findIndex(y=>y.name===x.name&&Math.abs(y.lat-x.lat)<.0001&&Math.abs(y.lon-x.lon)<.0001)).slice(0,30);
        destinationSelect.innerHTML='<option value="">Choose hospital / shelter</option>'+unique.map((x,i)=>`<option value="${x.lat},${x.lon}">${esc(x.name)}</option>`).join("");
        destinationSelect.dataset.locations=JSON.stringify(unique);
    }

    $("locateUser")?.addEventListener("click",()=>RakshaLocation.getLocation(async loc=>{ if(userMarker) map.removeLayer(userMarker); userMarker=L.circleMarker([loc.latitude,loc.longitude],{radius:10,color:"#25d6a2",fillColor:"#25d6a2",fillOpacity:.9}).addTo(map).bindPopup("📍 You are here").openPopup(); map.setView([loc.latitude,loc.longitude],12); gpsStatus.textContent=`±${Math.round(loc.accuracy)}m`; gpsStatus.className="rn-status-ok"; try {const raw=await getWeather(loc.latitude,loc.longitude); const w=summarizeWeather(raw); const s=scoreRisk(w,"auto").score; summary.innerHTML=`<strong>${riskBand(s).label} · ${s}/100</strong><br>${w.temp.toFixed(1)}°C · ${w.humidity}% humidity · 24h precipitation ${w.precip24.toFixed(1)} mm<br><span class="rn-small">${weatherCodeText(w.code)}</span>`; await loadWeatherGrid(loc.latitude,loc.longitude);}catch(e){summary.textContent=e.message;}},msg=>{gpsStatus.textContent="Unavailable";gpsStatus.className="rn-status-bad";alert(msg);}));
    $("showWeather")?.addEventListener("click",()=>{ layers.weather.addTo(map); layers.risk.removeFrom(map); layers.reports.removeFrom(map); });
    $("showRiskZones")?.addEventListener("click",()=>{ layers.risk.addTo(map); layers.weather.removeFrom(map); });
    $("showDisasters")?.addEventListener("click",()=>{ populateReports(); layers.reports.addTo(map); layers.weather.removeFrom(map); layers.risk.removeFrom(map); });
    $("showHospitals")?.addEventListener("click",async()=>{ try{await loadFacilities("hospital",layers.hospitals); layers.hospitals.addTo(map);}catch(e){alert(e.message);} });
    $("showShelters")?.addEventListener("click",async()=>{ try{await loadFacilities("shelter",layers.shelters); layers.shelters.addTo(map);}catch(e){alert(e.message);} });
    $("showResources")?.addEventListener("click",async()=>{ try{await loadFacilities("rescue",layers.resources); layers.resources.addTo(map);}catch(e){alert(e.message);} });
    $("safeRouteButton")?.addEventListener("click",()=>{
        const loc=RakshaLocation.getSavedLocation(); if(!loc)return alert("Click My Location first."); if(!destinationSelect.value)return alert("Choose a destination.");
        const [lat,lon]=destinationSelect.value.split(",").map(Number); if(routeControl){map.removeControl(routeControl);routeControl=null;}
        routeStatus.textContent="Calculating road route…";
        routeControl=L.Routing.control({router:L.Routing.osrmv1({serviceUrl:RN_CONFIG.route}),waypoints:[L.latLng(loc.latitude,loc.longitude),L.latLng(lat,lon)],addWaypoints:false,draggableWaypoints:false,routeWhileDragging:false,showAlternatives:true,createMarker:()=>null,fitSelectedRoutes:true}).addTo(map);
        routeControl.on("routesfound",ev=>{const r=ev.routes[0];routeStatus.innerHTML=`<strong>✅ Route found</strong><br>${(r.summary.totalDistance/1000).toFixed(1)} km · ${Math.round(r.summary.totalTime/60)} min`});
        routeControl.on("routingerror",()=>routeStatus.innerHTML=`<strong>⚠️ Route failed</strong><br>Check internet/routing availability.`);
    });
    $("clearRouteButton")?.addEventListener("click",()=>{if(routeControl){map.removeControl(routeControl);routeControl=null;}routeStatus.textContent="Route cleared.";});
    window.__rnMapAPI={renderReports:populateReports};
    populateReports();
    await loadWeatherGrid();
    await checkIMD();
}

document.addEventListener("DOMContentLoaded", async ()=>{
    console.log("RakshaNet upgraded client loaded");
    await detectBackend();
    initHome(); initEmergencyPage(); initHelpPage(); initMap();
});
