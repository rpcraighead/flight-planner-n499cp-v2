// ── State ──────────────────────────────────────────────────────
let map = null;
let routeLayer = null;
let currentRoute = null;
let tileSources = null;
let planningMode = false;
let drawerOpen = false;
let terrainData = null;
const tileLayers = {};

// Custom select values (used when "Custom..." is picked)
let customAlt     = 6500;
let customRpm     = 2400;
let customReserve = 45;

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/api/tile-sources');
        tileSources = await res.json();
    } catch {
        tileSources = {
            vfr:      'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/{z}/{y}/{x}',
            ifr_low:  'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_AreaLow/MapServer/tile/{z}/{y}/{x}',
            ifr_high: 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_High/MapServer/tile/{z}/{y}/{x}',
        };
    }
    initMap();
    checkDbStatus();

    document.getElementById('route-input').addEventListener('input', e => {
        const pos = e.target.selectionStart;
        e.target.value = e.target.value.toUpperCase();
        e.target.setSelectionRange(pos, pos);
    });
    document.getElementById('route-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') calculateRoute(true);
    });
});

// ── Map ────────────────────────────────────────────────────────
function initMap() {
    map = L.map('main-map', { zoomControl: true }).setView([32.82, -117.0], 9);

    tileLayers.vfr = L.tileLayer(tileSources.vfr, {
        attribution: '© FAA VFR Sectional', maxZoom: 12, minZoom: 5, errorTileUrl: ''
    });
    tileLayers.ifr_low = L.tileLayer(tileSources.ifr_low, {
        attribution: '© FAA IFR Low Enroute', maxZoom: 12, minZoom: 4, errorTileUrl: ''
    });
    tileLayers.ifr_high = L.tileLayer(tileSources.ifr_high || 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_High/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© FAA IFR High Enroute', maxZoom: 9, minZoom: 4, errorTileUrl: ''
    });
    tileLayers.sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri World Imagery', maxZoom: 18
    });
    tileLayers.osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap', maxZoom: 19
    });

    tileLayers.vfr.addTo(map);
    L.control.scale({ imperial: true, metric: false }).addTo(map);

    map.on('click', async (e) => {
        if (!planningMode) return;
        const { lat, lng } = e.latlng;
        let html;
        try {
            const res = await fetch(`/api/nearest-airport?lat=${lat}&lon=${lng}&radius_nm=20`);
            const data = await res.json();
            if (data.found && data.nearest.length > 0) {
                const rows = data.nearest.slice(0, 4).map(a => {
                    const label = a.type === 'airport'
                        ? `${a.ident} — ${a.name} (${a.distance_nm} NM)`
                        : `${a.ident} ${a.type} — ${a.name} (${a.distance_nm} NM)`;
                    return `<div class="map-popup-row">
                        <span class="map-popup-ident">${label}</span>
                        <div class="map-popup-btns">
                            <button onclick="mapInsert('${a.ident}','dep')">Dep</button>
                            <button onclick="mapInsert('${a.ident}','wpt')">Wpt</button>
                            <button onclick="mapInsert('${a.ident}','dest')">Dest</button>
                        </div></div>`;
                }).join('');
                html = `<div class="map-popup"><strong>Nearest Fixes:</strong>${rows}</div>`;
            } else {
                html = `<div class="map-popup">No airports within 20 NM</div>`;
            }
        } catch { html = `<div class="map-popup">Lookup failed</div>`; }
        L.popup({ maxWidth: 320 }).setLatLng(e.latlng).setContent(html).openOn(map);
    });
}

// ── Route string helpers ───────────────────────────────────────
function parseRoute(str) {
    const parts = str.trim().toUpperCase().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return null;
    return { departure: parts[0], destination: parts[parts.length - 1], waypoints: parts.slice(1, -1) };
}

function buildRoute(dep, wpts, dest) {
    return [dep, ...wpts, dest].filter(Boolean).join(' ');
}

// ── Map popup actions (global) ─────────────────────────────────
window.mapInsert = function(ident, role) {
    const input = document.getElementById('route-input');
    const parsed = parseRoute(input.value) || { departure: '', destination: '', waypoints: [] };
    if (role === 'dep')       parsed.departure = ident;
    else if (role === 'dest') parsed.destination = ident;
    else                      parsed.waypoints.push(ident);
    input.value = buildRoute(parsed.departure, parsed.waypoints, parsed.destination);
    map.closePopup();
};

// ── Layer switcher ─────────────────────────────────────────────
document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const key = btn.dataset.layer;
        Object.values(tileLayers).forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
        tileLayers[key].addTo(map);
        document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
});

// ── Plan mode ──────────────────────────────────────────────────
document.getElementById('plan-mode-btn').addEventListener('click', () => {
    planningMode = !planningMode;
    const btn = document.getElementById('plan-mode-btn');
    btn.classList.toggle('active', planningMode);
    btn.textContent = planningMode ? '✈ Planning' : '✈ Plan';
    map.getContainer().style.cursor = planningMode ? 'crosshair' : '';
});

// ── Fit route ──────────────────────────────────────────────────
document.getElementById('fit-route-btn').addEventListener('click', () => {
    if (!currentRoute) return;
    const lls = currentRoute.route_points.map(p => [p.lat || p.latitude, p.lon || p.longitude]);
    map.fitBounds(L.latLngBounds(lls).pad(0.15));
});

// ── Drawer ─────────────────────────────────────────────────────
function openDrawer() {
    drawerOpen = true;
    document.getElementById('bottom-drawer').classList.add('open');
    document.getElementById('drawer-arrow').textContent = '▼';
    setTimeout(() => map && map.invalidateSize(), 240);
}
function closeDrawer() {
    drawerOpen = false;
    document.getElementById('bottom-drawer').classList.remove('open');
    document.getElementById('drawer-arrow').textContent = '▲';
    setTimeout(() => map && map.invalidateSize(), 240);
}

document.getElementById('drawer-toggle').addEventListener('click', () => {
    drawerOpen ? closeDrawer() : openDrawer();
});

document.querySelectorAll('.drawer-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const pane = tab.dataset.pane;
        document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.drawer-pane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`pane-${pane}`).classList.add('active');
        if (pane === 'terrain' && terrainData) setTimeout(drawTerrainProfile, 50);
    });
});

function switchDrawerTab(name) {
    document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.drawer-pane').forEach(p => p.classList.remove('active'));
    const tab = document.querySelector(`[data-pane="${name}"]`);
    if (tab) tab.classList.add('active');
    const pane = document.getElementById(`pane-${name}`);
    if (pane) pane.classList.add('active');
}

// ── Modals ─────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

document.querySelectorAll('.modal-close').forEach(btn =>
    btn.addEventListener('click', () => closeModal(btn.dataset.modal)));
document.querySelectorAll('.modal-overlay').forEach(overlay =>
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay.id); }));

document.getElementById('btn-perf').addEventListener('click', () => openModal('modal-perf'));
document.getElementById('btn-wb').addEventListener('click',   () => openModal('modal-wb'));
document.getElementById('btn-ref').addEventListener('click',  () => openModal('modal-ref'));

// ── Custom value modal ─────────────────────────────────────────
let pendingCustom = null;

function promptCustom({ title, label, unit, hint, min, max, step, defaultVal, onConfirm, onCancel }) {
    document.getElementById('cv-title').textContent = title;
    document.getElementById('cv-label').textContent = label;
    document.getElementById('cv-unit').textContent  = unit || '';
    document.getElementById('cv-hint').textContent  = hint || '';
    const inp = document.getElementById('cv-input');
    inp.min = min ?? 0; inp.max = max ?? 99999; inp.step = step ?? 1;
    inp.value = defaultVal ?? '';
    pendingCustom = { onConfirm, onCancel };
    openModal('modal-custom-value');
    setTimeout(() => { inp.focus(); inp.select(); }, 80);
}

document.getElementById('cv-confirm').addEventListener('click', () => {
    const val = parseFloat(document.getElementById('cv-input').value);
    if (!isNaN(val) && pendingCustom) {
        pendingCustom.onConfirm(val);
        closeModal('modal-custom-value');
    }
});
function cancelCustom() {
    if (pendingCustom?.onCancel) pendingCustom.onCancel();
    closeModal('modal-custom-value');
}
document.getElementById('cv-cancel').addEventListener('click', cancelCustom);
document.getElementById('modal-custom-value').addEventListener('click', e => {
    if (e.target === e.currentTarget) cancelCustom();
});
document.getElementById('cv-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('cv-confirm').click();
    if (e.key === 'Escape') cancelCustom();
});

// Helper: update a select's "Custom..." option label and keep it selected
function setCustomOption(selectId, displayText, numericValue) {
    const sel = document.getElementById(selectId);
    const opt = sel.querySelector('option[value="custom"]');
    opt.textContent = displayText;
    sel.value = 'custom';
    // store for next time
    sel.dataset.customVal = numericValue;
}

// ── Altitude select ────────────────────────────────────────────
(function() {
    const sel = document.getElementById('alt-select');
    sel.dataset.prev = sel.value;

    sel.addEventListener('change', function() {
        if (this.value !== 'custom') {
            customAlt = parseInt(this.value);
            this.dataset.prev = this.value;
            return;
        }
        const prev = this.dataset.prev;
        promptCustom({
            title:      'Custom Altitude',
            label:      'Cruise altitude',
            unit:       'ft MSL',
            hint:       'VFR hemispheric rule: odd thousands +500 ft eastbound (0°–179°), even thousands +500 ft westbound (180°–359°). Class A starts at FL180.',
            min: 500, max: 17500, step: 100,
            defaultVal: customAlt,
            onConfirm: val => {
                customAlt = Math.round(val);
                setCustomOption('alt-select', `${customAlt.toLocaleString()} ft`, customAlt);
                this.dataset.prev = 'custom';
            },
            onCancel: () => {
                this.value = prev;
            }
        });
    });
})();

// ── RPM select ─────────────────────────────────────────────────
(function() {
    const sel = document.getElementById('rpm-select');
    sel.dataset.prev = sel.value;

    sel.addEventListener('change', function() {
        if (this.value !== 'custom') {
            customRpm = parseInt(this.value);
            this.dataset.prev = this.value;
            return;
        }
        const prev = this.dataset.prev;
        promptCustom({
            title:      'Custom RPM',
            label:      'Engine RPM',
            unit:       'RPM',
            hint:       'C172S normal cruise range: 2200–2700 RPM. Do not exceed 2700 RPM (redline).',
            min: 1500, max: 2700, step: 50,
            defaultVal: customRpm,
            onConfirm: val => {
                customRpm = Math.round(val / 50) * 50;
                setCustomOption('rpm-select', `${customRpm} RPM`, customRpm);
                this.dataset.prev = 'custom';
            },
            onCancel: () => {
                this.value = prev;
            }
        });
    });
})();

// ── Reserve select ─────────────────────────────────────────────
(function() {
    const sel = document.getElementById('reserve-select');
    sel.dataset.prev = sel.value;

    sel.addEventListener('change', function() {
        if (this.value !== 'custom') {
            customReserve = parseInt(this.value);
            this.dataset.prev = this.value;
            return;
        }
        const prev = this.dataset.prev;
        promptCustom({
            title:      'Custom Reserve',
            label:      'Fuel reserve',
            unit:       'min',
            hint:       'FAA minimums: VFR day 30 min, VFR night 45 min. IFR: 45 min at dest alternate. Extra margin recommended.',
            min: 15, max: 120, step: 5,
            defaultVal: customReserve,
            onConfirm: val => {
                customReserve = Math.round(val);
                setCustomOption('reserve-select', `Rsv: ${customReserve} min`, customReserve);
                this.dataset.prev = 'custom';
            },
            onCancel: () => {
                this.value = prev;
            }
        });
    });
})();

// ── Database status ────────────────────────────────────────────
async function checkDbStatus() {
    try {
        const res  = await fetch('/api/update-status');
        const data = await res.json();
        const dot  = document.getElementById('db-dot');
        const lbl  = document.getElementById('db-label');
        if (data.airports > 0) {
            dot.classList.add('ready');
            lbl.textContent = `${data.airports.toLocaleString()} apts`;
        } else {
            dot.classList.remove('ready');
            lbl.textContent = 'No data';
        }
        if (data.in_progress) {
            openModal('modal-db');
            document.getElementById('db-progress-fill').style.width = data.progress + '%';
            document.getElementById('db-progress-msg').textContent  = data.message;
            setTimeout(checkDbStatus, 1000);
        } else {
            closeModal('modal-db');
        }
    } catch {}
}

document.getElementById('btn-update-db').addEventListener('click', async () => {
    await fetch('/api/update-database', { method: 'POST' });
    openModal('modal-db');
    setTimeout(checkDbStatus, 500);
});

// ── Snap scoring ───────────────────────────────────────────────
const SNAP_WEIGHT = {
    'VORTAC': 0.30, 'VOR-DME': 0.30, 'VOR': 0.30,
    'NDB-DME': 0.45, 'TACAN': 0.45, 'NDB': 0.60, 'DME': 0.60
};
function snapScore(r) {
    const w = SNAP_WEIGHT[r.type];
    if (w) return r.distance_nm * w;
    return r.distance_nm * (/^K[A-Z]{3}$/.test(r.ident) ? 0.80 : 1.30);
}
async function snapToNearest(lat, lon) {
    try {
        const res  = await fetch(`/api/nearest-airport?lat=${lat}&lon=${lon}&radius_nm=25`);
        const data = await res.json();
        if (!data.found || !data.nearest.length) return null;
        return [...data.nearest].sort((a, b) => snapScore(a) - snapScore(b))[0].ident;
    } catch { return null; }
}

function insertWptAtIndex(ident, segIdx) {
    const input  = document.getElementById('route-input');
    const parsed = parseRoute(input.value) || { departure: '', destination: '', waypoints: [] };
    parsed.waypoints.splice(segIdx, 0, ident);
    input.value = buildRoute(parsed.departure, parsed.waypoints, parsed.destination);
}

// ── Route calculation ──────────────────────────────────────────
async function calculateRoute(alertOnError = true) {
    const input  = document.getElementById('route-input');
    const parsed = parseRoute(input.value);
    if (!parsed) {
        if (alertOnError) alert('Enter a route: KSEE OCN KMYF');
        return false;
    }
    const { departure, destination, waypoints } = parsed;
    const altVal  = document.getElementById('alt-select').value;
    const rpmVal  = document.getElementById('rpm-select').value;
    const resVal  = document.getElementById('reserve-select').value;
    const cruiseAlt      = altVal === 'custom' ? customAlt      : parseInt(altVal);
    const rpm            = rpmVal === 'custom' ? customRpm      : parseInt(rpmVal);
    const reserveMinutes = resVal === 'custom' ? customReserve  : parseInt(resVal);

    try {
        const res  = await fetch('/api/calculate-route', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ departure, destination, waypoints, cruise_altitude: cruiseAlt, rpm, reserve_minutes: reserveMinutes })
        });
        const data = await res.json();
        if (!data.success) {
            if (alertOnError) alert('Error: ' + data.error);
            return false;
        }
        currentRoute = data;

        // Summary bar
        const w = data.winds_aloft;
        document.getElementById('s-dist').textContent  = data.totals.distance_nm;
        document.getElementById('s-time').textContent  = data.totals.time_minutes;
        document.getElementById('s-fuel').textContent  = data.totals.total_fuel;
        document.getElementById('s-winds').textContent = `${w.direction}°/${w.speed}kt`;

        // Segment table
        document.getElementById('log-tbody').innerHTML = data.segments.map(s => `
            <tr>
              <td>${s.from}</td><td>${s.to}</td><td>${s.distance_nm}</td>
              <td>${s.true_course}°</td>
              <td>${s.wind_correction > 0 ? '+' : ''}${s.wind_correction}°</td>
              <td>${s.magnetic_heading}°</td><td>${s.ground_speed}</td>
              <td>${s.time_minutes}</td><td>${s.fuel_gallons}</td>
            </tr>`).join('');

        // Fuel summary
        document.getElementById('ft-taxi').textContent    = data.totals.taxi_fuel    + ' gal';
        document.getElementById('ft-climb').textContent   = data.totals.climb_fuel   + ' gal';
        document.getElementById('ft-cruise').textContent  = data.totals.cruise_fuel  + ' gal';
        document.getElementById('ft-reserve').textContent = data.totals.reserve_fuel + ' gal';
        document.getElementById('ft-total').textContent   = data.totals.total_fuel   + ' gal';

        document.getElementById('log-empty').style.display   = 'none';
        document.getElementById('log-content').style.display = 'block';

        drawRouteOnMap();
        openDrawer();
        switchDrawerTab('log');

        // Async: weather, airports, terrain
        fetchWeatherBriefing(departure, destination, waypoints).catch(() => {});
        fetchAirportDetails().catch(() => {});
        fetchTerrainProfile().catch(() => {});

        return true;
    } catch (e) {
        if (alertOnError) alert('Error: ' + e.message);
        return false;
    }
}

document.getElementById('calc-btn').addEventListener('click', () => calculateRoute(true));

// ── Route drawing ──────────────────────────────────────────────
function drawRouteOnMap() {
    if (!map || !currentRoute) return;
    if (routeLayer) map.removeLayer(routeLayer);

    const layer  = L.layerGroup().addTo(map);
    routeLayer   = layer;
    const points = currentRoute.route_points;
    const lls    = points.map(p => [p.lat || p.latitude, p.lon || p.longitude]);

    // Halo + route line
    L.polyline(lls, { color: '#ffffff', weight: 7, opacity: 0.5 }).addTo(layer);
    L.polyline(lls, { color: '#bf0a30', weight: 3, opacity: 1   }).addTo(layer);

    // Rubber-band midpoint handles
    for (let i = 0; i < lls.length - 1; i++) {
        const midLat = (lls[i][0] + lls[i+1][0]) / 2;
        const midLng = (lls[i][1] + lls[i+1][1]) / 2;
        const handle = L.marker([midLat, midLng], {
            icon: L.divIcon({
                className: 'rb-handle-icon',
                html: '<div class="rb-dot"></div>',
                iconSize: [13, 13], iconAnchor: [6, 6]
            }),
            draggable: true, zIndexOffset: -200
        });
        const segIdx = i;
        handle.on('dragend', async e => {
            const { lat, lng } = e.target.getLatLng();
            const ident = await snapToNearest(lat, lng);
            if (!ident) { e.target.setLatLng([midLat, midLng]); return; }
            insertWptAtIndex(ident, segIdx);
            await calculateRoute(false);
        });
        handle.addTo(layer);
    }

    // Waypoint markers (draggable)
    points.forEach((pt, idx) => {
        const ll = [pt.lat || pt.latitude, pt.lon || pt.longitude];
        let fill = '#3b82f6', r = 7;
        if (idx === 0)                      { fill = '#28a745'; r = 10; }
        else if (idx === points.length - 1) { fill = '#bf0a30'; r = 10; }

        const marker = L.marker(ll, {
            icon: L.divIcon({
                className: 'wpt-drag-icon',
                html: `<div style="background:${fill};width:${r*2}px;height:${r*2}px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.5);margin-left:${-r}px;margin-top:${-r}px;cursor:grab"></div>`,
                iconSize: [r*2, r*2], iconAnchor: [r, r]
            }),
            draggable: true, zIndexOffset: 100
        });
        marker.bindTooltip(pt.identifier, {
            permanent: true, direction: 'top', offset: [0, -r-3], className: 'map-label'
        });
        marker.on('dragend', async e => {
            const { lat, lng } = e.target.getLatLng();
            const ident = await snapToNearest(lat, lng);
            if (!ident) { e.target.setLatLng(ll); return; }
            const parsed = parseRoute(document.getElementById('route-input').value) || { departure:'', destination:'', waypoints:[] };
            if      (idx === 0)                      parsed.departure  = ident;
            else if (idx === points.length - 1)      parsed.destination = ident;
            else                                     parsed.waypoints[idx - 1] = ident;
            document.getElementById('route-input').value = buildRoute(parsed.departure, parsed.waypoints, parsed.destination);
            await calculateRoute(false);
        });
        marker.addTo(layer);
    });

    map.fitBounds(L.latLngBounds(lls).pad(0.15));
}

// ── Weather ────────────────────────────────────────────────────
async function fetchWeatherBriefing(departure, destination, waypoints) {
    const res = await fetch('/api/weather-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departure, destination, waypoints })
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success) return;
    const b = data.briefing;

    const metHtml = b.metars?.length
        ? `<h5>METARs</h5>` + b.metars.map(m =>
            `<div class="wx-item"><span class="wx-id">${m.icaoId||'?'}</span>` +
            `<span class="fltcat ${(m.fltcat||'vfr').toLowerCase()}">${(m.fltcat||'VFR').toUpperCase()}</span>` +
            `${m.simulated ? ' <span style="color:#bf0a30;font-size:0.65rem">(sim)</span>' : ''}<br>${m.rawOb||'No data'}</div>`
          ).join('')
        : '';

    const tafHtml = b.tafs?.length
        ? `<h5>TAFs</h5>` + b.tafs.map(t =>
            `<div class="wx-item"><span class="wx-id">${t.icaoId||'?'}</span>` +
            `${t.simulated ? ' <span style="color:#bf0a30;font-size:0.65rem">(sim)</span>' : ''}<br>${t.rawTAF||'No data'}</div>`
          ).join('')
        : '';

    let windsHtml = '';
    if (b.winds_aloft?.levels) {
        windsHtml = `<h5>Winds Aloft</h5><table class="winds-table"><thead><tr><th>ALT</th><th>DIR</th><th>SPD</th><th>TEMP</th></tr></thead><tbody>`;
        for (const [alt, d] of Object.entries(b.winds_aloft.levels))
            windsHtml += `<tr><td>${alt}'</td><td>${d.direction}°</td><td>${d.speed}kt</td><td>${d.temp}°C</td></tr>`;
        windsHtml += '</tbody></table>';
    }

    const notamHtml = b.notams?.length
        ? `<h5>NOTAMs</h5>` + b.notams.map(n => `<div class="wx-item"><strong>${n.airport}</strong>: ${n.text}</div>`).join('')
        : '';

    document.getElementById('wx-metars').innerHTML = metHtml;
    document.getElementById('wx-tafs').innerHTML   = tafHtml;
    document.getElementById('wx-winds').innerHTML  = windsHtml;
    document.getElementById('wx-notams').innerHTML = notamHtml;
    document.getElementById('wx-empty').style.display   = 'none';
    document.getElementById('wx-content').style.display = 'block';
}

// ── Airport details ────────────────────────────────────────────
async function fetchAirportDetails() {
    if (!currentRoute?.route_points) return;
    const airports = currentRoute.route_points.filter(p => p.type === 'airport').map(p => p.identifier);
    if (!airports.length) return;

    let html = '';
    for (const icao of airports) {
        try {
            const res  = await fetch(`/api/airport-detail/${icao}`);
            const data = await res.json();
            if (!data.success) continue;
            const apt    = data.airport;
            const fltcat = (data.metar?.fltcat || 'vfr').toLowerCase();
            html += `<div class="apt-card">
                <h3>${icao} <span class="fltcat ${fltcat}">${fltcat.toUpperCase()}</span></h3>
                <div class="apt-name">${apt.name} — ${apt.city}, ${apt.state}</div>
                <div class="apt-grid">
                  <div>
                    <div class="apt-info-row"><span class="lbl">Elevation</span><span class="val">${apt.elevation}' MSL</span></div>
                    <div class="apt-info-row"><span class="lbl">Lat / Lon</span><span class="val">${apt.latitude.toFixed(3)}° / ${apt.longitude.toFixed(3)}°</span></div>
                    <div class="metar-raw">${data.metar?.rawOb || 'No METAR available'}</div>
                  </div>
                  <div>
                    ${data.runways.length ? `<table class="rwy-table">
                      <thead><tr><th>Runway</th><th>Length</th><th>Surface</th></tr></thead>
                      <tbody>${data.runways.map(r => `<tr><td>${r.runway_id}</td><td>${r.length.toLocaleString()}'</td><td>${r.surface}</td></tr>`).join('')}</tbody>
                    </table>` : '<p style="color:var(--text-dim);font-size:0.75rem">No runway data</p>'}
                  </div>
                </div>
            </div>`;
        } catch {}
    }
    const el = document.getElementById('apt-content');
    el.innerHTML = html || '<p style="color:var(--text-dim);padding:1rem">No airport data available</p>';
    document.getElementById('apt-empty').style.display  = 'none';
    el.style.display = 'block';
}

// ── Terrain profile ────────────────────────────────────────────
async function fetchTerrainProfile() {
    if (!currentRoute?.route_points) return;
    const res  = await fetch('/api/terrain-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            route_points:    currentRoute.route_points.map(p => ({ lat: p.latitude || p.lat, lon: p.longitude || p.lon, identifier: p.identifier })),
            cruise_altitude: currentRoute.cruise?.altitude || 6000
        })
    });
    const data = await res.json();
    if (!data.success) return;
    terrainData = data;

    document.getElementById('trn-max').textContent = data.max_terrain.toLocaleString();
    document.getElementById('trn-clr').textContent = data.min_clearance.toLocaleString();

    const badge = document.getElementById('trn-status-badge');
    if      (data.min_clearance >= 2000) { badge.textContent = 'ADEQUATE';    badge.className = 'ok';     }
    else if (data.min_clearance >= 1000) { badge.textContent = 'MIN VFR CLR'; badge.className = 'warn';   }
    else                                 { badge.textContent = 'INSUFFICIENT'; badge.className = 'danger'; }

    document.getElementById('trn-empty').style.display   = 'none';
    document.getElementById('trn-content').style.display = 'block';

    if (document.getElementById('pane-terrain').classList.contains('active'))
        drawTerrainProfile();
}

function drawTerrainProfile() {
    if (!terrainData) return;
    const canvas    = document.getElementById('terrain-canvas');
    const container = canvas.parentElement;
    const dpr       = window.devicePixelRatio || 1;
    const rect      = container.getBoundingClientRect();
    const W         = rect.width - 24;
    const H         = 150;

    canvas.width  = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const { profile, cruise_altitude: cruiseAlt, total_distance: totalDist, max_terrain: maxTerrain } = terrainData;
    const yMax = Math.max(cruiseAlt + 800, maxTerrain + 1500);
    const mg   = { top: 18, right: 10, bottom: 28, left: 42 };
    const cW   = W - mg.left - mg.right;
    const cH   = H - mg.top  - mg.bottom;

    const xS = d => mg.left + (d / totalDist) * cW;
    const yS = a => mg.top  + cH - (a / yMax) * cH;

    ctx.fillStyle = '#0a1628';
    ctx.fillRect(0, 0, W, H);

    // Y grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    const yStep = yMax > 10000 ? 2000 : 1000;
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '9px JetBrains Mono, monospace';
    for (let alt = 0; alt <= yMax; alt += yStep) {
        const y = yS(alt);
        ctx.beginPath(); ctx.moveTo(mg.left, y); ctx.lineTo(W - mg.right, y); ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillText(alt >= 1000 ? (alt/1000).toFixed(0) + 'k' : alt, mg.left - 4, y + 3);
    }

    // Terrain fill
    const grad = ctx.createLinearGradient(0, yS(maxTerrain), 0, yS(0));
    grad.addColorStop(0, '#4a7a49'); grad.addColorStop(1, '#1e3a1e');
    ctx.beginPath();
    ctx.moveTo(xS(profile[0].dist_nm), yS(0));
    for (const pt of profile) ctx.lineTo(xS(pt.dist_nm), yS(pt.elevation_ft));
    ctx.lineTo(xS(profile[profile.length-1].dist_nm), yS(0));
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Terrain outline
    ctx.beginPath();
    for (let i = 0; i < profile.length; i++) {
        const x = xS(profile[i].dist_nm), y = yS(profile[i].elevation_ft);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#7ec87e'; ctx.lineWidth = 1; ctx.stroke();

    // Flight path
    ctx.beginPath();
    for (let i = 0; i < profile.length; i++) {
        const x = xS(profile[i].dist_nm), y = yS(profile[i].flight_alt ?? cruiseAlt);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#bf0a30'; ctx.lineWidth = 2; ctx.stroke();

    // Cruise reference line
    ctx.save(); ctx.setLineDash([4,5]);
    ctx.beginPath(); ctx.moveTo(mg.left, yS(cruiseAlt)); ctx.lineTo(W - mg.right, yS(cruiseAlt));
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();

    // Cruise label
    ctx.fillStyle = 'rgba(191,10,48,0.9)'; ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(cruiseAlt.toLocaleString() + "'", mg.left + 3, yS(cruiseAlt) - 4);

    // X distance labels
    const xStep = totalDist > 100 ? 20 : totalDist > 50 ? 10 : 5;
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    for (let d = 0; d <= totalDist; d += xStep)
        ctx.fillText(d, xS(d), H - mg.bottom + 14);

    // Waypoint markers on profile
    for (const pt of profile) {
        if (!pt.waypoint) continue;
        const x = xS(pt.dist_nm);
        ctx.save(); ctx.setLineDash([2,3]);
        ctx.beginPath(); ctx.moveTo(x, mg.top); ctx.lineTo(x, H - mg.bottom);
        ctx.strokeStyle = 'rgba(255,215,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#ffd700'; ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(pt.waypoint, x, mg.top - 3);
    }

    // Hover
    canvas.onmousemove = e => {
        const r    = canvas.getBoundingClientRect();
        const dist = ((e.clientX - r.left - mg.left) / cW) * totalDist;
        if (dist < 0 || dist > totalDist) { document.getElementById('trn-hover').textContent = ''; return; }
        let nearest = profile[0], minD = Infinity;
        for (const pt of profile) { const d = Math.abs(pt.dist_nm - dist); if (d < minD) { minD = d; nearest = pt; } }
        const fAlt = nearest.flight_alt ?? cruiseAlt;
        document.getElementById('trn-hover').textContent =
            `${nearest.dist_nm} NM | Alt: ${fAlt.toLocaleString()}' | Terrain: ${nearest.elevation_ft.toLocaleString()}' | Clearance: ${(fAlt - nearest.elevation_ft).toLocaleString()}' AGL`;
    };
    canvas.onmouseleave = () => { document.getElementById('trn-hover').textContent = ''; };
}

window.addEventListener('resize', () => { if (terrainData) drawTerrainProfile(); });

// ── Performance ────────────────────────────────────────────────
document.getElementById('calc-takeoff').addEventListener('click', async () => {
    try {
        const res = await fetch('/api/performance/takeoff', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                weight:            document.getElementById('to-weight').value,
                pressure_altitude: document.getElementById('to-altitude').value,
                temperature:       document.getElementById('to-temp').value,
                headwind:          document.getElementById('to-wind').value
            })
        });
        const r = await res.json();
        document.getElementById('to-ground-roll').textContent = r.ground_roll;
        document.getElementById('to-total').textContent       = r.total_over_50ft;
        document.getElementById('takeoff-results').style.display = 'block';
    } catch (e) { alert(e.message); }
});

document.getElementById('calc-landing').addEventListener('click', async () => {
    try {
        const res = await fetch('/api/performance/landing', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pressure_altitude: document.getElementById('land-altitude').value,
                temperature:       document.getElementById('land-temp').value,
                headwind:          document.getElementById('land-wind').value
            })
        });
        const r = await res.json();
        document.getElementById('land-ground-roll').textContent = r.ground_roll;
        document.getElementById('land-total').textContent       = r.total_over_50ft;
        document.getElementById('landing-results').style.display = 'block';
    } catch (e) { alert(e.message); }
});

// ── Weight & Balance ───────────────────────────────────────────
document.getElementById('calc-wb').addEventListener('click', async () => {
    try {
        const res = await fetch('/api/weight-balance', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                empty_weight:            document.getElementById('wb-empty-weight').value,
                empty_moment:            document.getElementById('wb-empty-moment').value,
                pilot_weight:            document.getElementById('wb-pilot').value,
                front_passenger_weight:  document.getElementById('wb-front-pax').value,
                rear_passenger_weight:   document.getElementById('wb-rear-pax').value,
                baggage_weight:          document.getElementById('wb-baggage').value,
                fuel_gallons:            document.getElementById('wb-fuel').value
            })
        });
        const r = await res.json();
        document.getElementById('wb-total-weight').textContent = r.total_weight;
        document.getElementById('wb-cg').textContent           = r.cg;
        document.getElementById('wb-moment').textContent       = r.moment_1000;

        const msg = document.getElementById('wb-status-msg');
        if (r.within_all_limits) {
            msg.className = 'ok';
            msg.textContent = '✓ Within all limits';
        } else {
            msg.className = 'danger';
            msg.textContent = (!r.within_weight_limits ? `OVERWEIGHT by ${Math.abs(r.weight_margin)} lbs ` : '') +
                              (!r.within_cg_limits     ? 'CG OUT OF LIMITS' : '');
        }
        document.getElementById('wb-results').style.display = 'block';
    } catch (e) { alert(e.message); }
});
