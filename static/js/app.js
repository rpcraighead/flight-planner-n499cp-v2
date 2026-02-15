// Global state
let currentRoute = null;
let vfrMap = null;
let ifrMap = null;
let vfrRouteLayer = null;
let ifrRouteLayer = null;
let tileSources = null;

// Check startup/loading status
async function checkStartupStatus() {
    // Skip chart pre-loading, go directly to app (uses online tiles)
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'block';
    initializeApp();
}

// Initialize the main application
async function initializeApp() {
    // Load tile sources
    try {
        const res = await fetch('/api/charts/tile-sources');
        const data = await res.json();
        tileSources = data.tile_sources || data;
    } catch (e) {
        console.error('Failed to load tile sources:', e);
        // Fallback (Updated January 2026)
        tileSources = {
            vfr: 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/{z}/{y}/{x}',
            ifr_low: 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_AreaLow/MapServer/tile/{z}/{y}/{x}'
        };
    }
    
    // Check database status
    checkDbStatus();
}

// Tab switching
document.querySelectorAll('.tab-button').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`${tab}-tab`).classList.add('active');
        
        if (tab === 'vfr-chart') {
            setTimeout(() => initVfrMap(), 100);
        } else if (tab === 'ifr-chart') {
            setTimeout(() => initIfrMap(), 100);
        }
    });
});

// Initialize VFR Map
function initVfrMap() {
    const container = document.getElementById('vfr-map');
    if (!container) return;
    
    if (vfrMap) {
        vfrMap.invalidateSize();
        return;
    }
    
    vfrMap = L.map('vfr-map').setView([32.82, -117.0], 9);

    // Use online FAA tiles directly
    const vfrTiles = L.tileLayer(tileSources?.vfr || 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© FAA VFR Sectional',
        maxZoom: 12,
        minZoom: 5,
        errorTileUrl: ''
    });

    // Satellite
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri',
        maxZoom: 18
    });

    // OSM
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
    });

    vfrTiles.addTo(vfrMap);

    L.control.layers({
        'VFR Sectional': vfrTiles,
        'Satellite': satellite,
        'Street Map': osm
    }, {}, { position: 'topright' }).addTo(vfrMap);
    
    L.control.scale({ imperial: true, metric: false }).addTo(vfrMap);
    
    if (currentRoute) updateVfrRoute();
}

// Initialize IFR Map
function initIfrMap() {
    const container = document.getElementById('ifr-map');
    if (!container) return;
    
    if (ifrMap) {
        ifrMap.invalidateSize();
        return;
    }
    
    ifrMap = L.map('ifr-map').setView([32.82, -117.0], 8);

    // Use online FAA tiles directly (Updated January 2026)
    const ifrTiles = L.tileLayer(tileSources?.ifr_low || 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_AreaLow/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© FAA IFR Low Enroute',
        maxZoom: 12,  // Service supports 7-12
        minZoom: 7,
        errorTileUrl: ''
    });

    const ifrHighTiles = L.tileLayer('https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_AreaHigh/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© FAA IFR High Enroute',
        maxZoom: 9,
        minZoom: 4,
        errorTileUrl: ''
    });

    // Dark base
    const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB',
        maxZoom: 19
    });

    ifrTiles.addTo(ifrMap);

    L.control.layers({
        'IFR Low Enroute': ifrTiles,
        'IFR High Enroute': ifrHighTiles,
        'Dark Map': dark
    }, {}, { position: 'topright' }).addTo(ifrMap);
    
    L.control.scale({ imperial: true, metric: false }).addTo(ifrMap);
    
    if (currentRoute) updateIfrRoute();
}

// Update VFR map with route
function updateVfrRoute() {
    if (!vfrMap || !currentRoute) return;

    if (vfrRouteLayer) vfrMap.removeLayer(vfrRouteLayer);
    vfrRouteLayer = L.layerGroup().addTo(vfrMap);

    const points = currentRoute.route_points;
    const latlngs = points.map(p => [p.latitude, p.longitude]);
    
    // Route line with white outline
    L.polyline(latlngs, { color: '#ffffff', weight: 8, opacity: 0.9 }).addTo(vfrRouteLayer);
    L.polyline(latlngs, { color: '#bf0a30', weight: 4, opacity: 1 }).addTo(vfrRouteLayer);
    
    // Markers
    points.forEach((pt, idx) => {
        let color = '#1e3a5f', radius = 8;
        if (idx === 0) { color = '#28a745'; radius = 12; }
        else if (idx === points.length - 1) { color = '#bf0a30'; radius = 12; }

        L.circleMarker([pt.latitude, pt.longitude], {
            radius, fillColor: color, color: '#ffffff', weight: 3, fillOpacity: 1
        }).bindTooltip(pt.identifier, {
            permanent: true, direction: 'top', offset: [0, -12], className: 'map-label'
        }).addTo(vfrRouteLayer);
    });

    vfrMap.fitBounds(L.latLngBounds(latlngs).pad(0.15));
}

// Update IFR map with route
function updateIfrRoute() {
    if (!ifrMap || !currentRoute) return;

    if (ifrRouteLayer) ifrMap.removeLayer(ifrRouteLayer);
    ifrRouteLayer = L.layerGroup().addTo(ifrMap);

    const points = currentRoute.route_points;
    const latlngs = points.map(p => [p.latitude, p.longitude]);
    
    // Magenta for IFR
    L.polyline(latlngs, { color: '#ffffff', weight: 8, opacity: 0.9 }).addTo(ifrRouteLayer);
    L.polyline(latlngs, { color: '#ff00ff', weight: 4, opacity: 1 }).addTo(ifrRouteLayer);

    points.forEach((pt, idx) => {
        let color = '#1e3a5f', radius = 8;
        if (idx === 0) { color = '#28a745'; radius = 12; }
        else if (idx === points.length - 1) { color = '#bf0a30'; radius = 12; }

        L.circleMarker([pt.latitude, pt.longitude], {
            radius, fillColor: color, color: '#ffffff', weight: 3, fillOpacity: 1
        }).bindTooltip(pt.identifier, {
            permanent: true, direction: 'top', offset: [0, -12], className: 'map-label'
        }).addTo(ifrRouteLayer);
    });

    ifrMap.fitBounds(L.latLngBounds(latlngs).pad(0.15));
}

// Airport inputs
document.querySelectorAll('.airport-input').forEach(input => {
    input.addEventListener('input', e => e.target.value = e.target.value.toUpperCase());
    input.addEventListener('blur', async e => {
        const icao = e.target.value.trim();
        const infoDiv = e.target.parentElement.querySelector('.airport-info');
        if (icao.length >= 3 && infoDiv) {
            try {
                const res = await fetch(`/api/airports/${icao}`);
                const data = await res.json();
                if (data.success) {
                    const apt = data.airport;
                    const rwy = data.runways[0];
                    infoDiv.innerHTML = `${apt.name}<br>Elev: ${apt.elevation}' ${rwy ? `• Rwy: ${rwy.length}'` : ''}`;
                } else {
                    infoDiv.innerHTML = '<span style="color:#bf0a30;">Not found</span>';
                }
            } catch { infoDiv.innerHTML = ''; }
        }
    });
});

// Waypoints
document.getElementById('add-waypoint').addEventListener('click', () => {
    const container = document.getElementById('waypoints-container');
    const div = document.createElement('div');
    div.className = 'waypoint-item';
    div.innerHTML = `<input type="text" class="waypoint-input" placeholder="FIX" maxlength="5"><button class="remove-waypoint">×</button>`;
    container.appendChild(div);
    div.querySelector('input').addEventListener('input', e => e.target.value = e.target.value.toUpperCase());
    div.querySelector('.remove-waypoint').addEventListener('click', () => div.remove());
});

function getWaypoints() {
    return Array.from(document.querySelectorAll('.waypoint-input'))
        .map(input => input.value.trim().toUpperCase())
        .filter(v => v.length > 0);
}

// Database status
async function checkDbStatus() {
    try {
        const res = await fetch('/api/update-status');
        const data = await res.json();
        
        const indicator = document.getElementById('db-indicator');
        const countEl = document.getElementById('db-count');
        
        if (data.airports > 0) {
            indicator.classList.add('ready');
            countEl.textContent = `${data.airports.toLocaleString()} airports`;
        } else {
            indicator.classList.remove('ready');
            countEl.textContent = 'No data - click Update';
        }
        
        if (data.in_progress) {
            document.getElementById('update-modal').style.display = 'flex';
            document.getElementById('progress-fill').style.width = `${data.progress}%`;
            document.getElementById('update-message').textContent = data.message;
            setTimeout(checkDbStatus, 1000);
        } else {
            document.getElementById('update-modal').style.display = 'none';
        }
    } catch (e) { console.error(e); }
}

document.getElementById('update-db-btn').addEventListener('click', async () => {
    await fetch('/api/update-database', { method: 'POST' });
    document.getElementById('update-modal').style.display = 'flex';
    setTimeout(checkDbStatus, 500);
});

// Route calculation
document.getElementById('calculate-route').addEventListener('click', async () => {
    const departure = document.getElementById('departure').value.trim().toUpperCase();
    const destination = document.getElementById('destination').value.trim().toUpperCase();
    const waypoints = getWaypoints();
    const cruiseAlt = document.getElementById('cruise-altitude').value;
    const rpm = document.getElementById('cruise-rpm').value;
    
    if (!departure || !destination) {
        alert('Please enter departure and destination');
        return;
    }
    
    try {
        const res = await fetch('/api/flight-planning/calculate-route', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ departure, destination, waypoints, cruise_altitude: cruiseAlt, rpm })
        });
        
        const data = await res.json();
        if (!data.success) { alert('Error: ' + data.error); return; }
        
        currentRoute = data;
        
        document.getElementById('route-string').textContent = data.route_points.map(p => p.identifier).join(' → ');
        document.getElementById('total-distance').textContent = data.totals.distance_nm;
        document.getElementById('total-time').textContent = data.totals.time_minutes;
        document.getElementById('total-fuel').textContent = data.totals.total_fuel;
        
        const winds = data.winds_aloft;
        document.getElementById('winds-data').textContent = `${winds.altitude}': ${winds.direction}° @ ${winds.speed}kt`;
        
        document.getElementById('route-segments').innerHTML = data.segments.map(seg => `
            <tr><td>${seg.from}</td><td>${seg.to}</td><td>${seg.distance_nm}</td>
            <td>${seg.true_course}°</td><td>${seg.wind_correction > 0 ? '+' : ''}${seg.wind_correction}°</td>
            <td>${seg.magnetic_heading}°</td><td>${seg.ground_speed}</td>
            <td>${seg.time_minutes}</td><td>${seg.fuel_gallons}</td></tr>
        `).join('');
        
        document.getElementById('fuel-taxi').textContent = data.totals.taxi_fuel + ' gal';
        document.getElementById('fuel-climb').textContent = data.totals.climb_fuel + ' gal';
        document.getElementById('fuel-cruise').textContent = data.totals.cruise_fuel + ' gal';
        document.getElementById('fuel-reserve').textContent = data.totals.reserve_fuel + ' gal';
        document.getElementById('fuel-total-req').innerHTML = `<strong>${data.totals.total_fuel} gal</strong>`;
        
        document.getElementById('route-results').style.display = 'block';

        if (vfrMap) updateVfrRoute();
        if (ifrMap) updateIfrRoute();

        // Automatically fetch weather briefing after successful route calculation
        // Wrapped in try-catch so it doesn't break route calculation if it fails
        try {
            await fetchWeatherBriefing(departure, destination, waypoints, false);
        } catch (briefingError) {
            console.error('Weather briefing failed, but route calculation succeeded:', briefingError);
        }

    } catch (e) { alert('Error: ' + e.message); }
});

// Weather briefing function (reusable) - v3.2 with fixed route plotting coordinates
async function fetchWeatherBriefing(departure, destination, waypoints, autoSwitch = false) {
    try {
        const res = await fetch('/api/weather/briefing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ departure, destination, waypoints })
        });

        // Check if response is ok before parsing
        if (!res.ok) {
            console.error('Weather briefing request failed:', res.status, res.statusText);
            return false;
        }

        // Check content type to ensure we're getting JSON
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            console.error('Weather briefing returned non-JSON response');
            return false;
        }

        // Safely parse JSON with additional error handling
        let data;
        try {
            data = await res.json();
        } catch (jsonError) {
            console.error('Failed to parse weather briefing response as JSON:', jsonError);
            return false;
        }

        if (!data.success) {
            console.error('Error fetching briefing');
            return false;
        }

        const b = data.briefing;
        document.getElementById('briefing-time').textContent = b.generated_at;
        document.getElementById('briefing-route').textContent = b.route;

        document.getElementById('metars-content').innerHTML = b.metars?.length > 0
            ? b.metars.map(m => `<div class="metar-item"><span class="station">${m.icaoId||'N/A'}</span>
                <span class="flight-cat ${(m.fltcat||'VFR').toLowerCase()}">${m.fltcat||'VFR'}</span>
                ${m.simulated?'<span style="color:#bf0a30;"> (sim)</span>':''}<br>${m.rawOb||'No data'}</div>`).join('')
            : '<p class="no-data">No METAR data</p>';

        document.getElementById('tafs-content').innerHTML = b.tafs?.length > 0
            ? b.tafs.map(t => `<div class="taf-item"><span class="station">${t.icaoId||'N/A'}</span>
                ${t.simulated?'<span style="color:#bf0a30;"> (sim)</span>':''}<br>${t.rawTAF||'No data'}</div>`).join('')
            : '<p class="no-data">No TAF data</p>';

        if (b.winds_aloft?.levels) {
            let html = '<table class="winds-table"><tr><th>Alt</th><th>Dir</th><th>Spd</th><th>Temp</th></tr>';
            for (const [alt, d] of Object.entries(b.winds_aloft.levels)) {
                html += `<tr><td>${alt}'</td><td>${d.direction}°</td><td>${d.speed}kt</td><td>${d.temp}°C</td></tr>`;
            }
            document.getElementById('winds-content').innerHTML = html + '</table>';
        } else {
            document.getElementById('winds-content').innerHTML = '<p class="no-data">No winds data</p>';
        }

        document.getElementById('pireps-content').innerHTML = '<p class="no-data">No PIREPs</p>';
        document.getElementById('sigmets-content').innerHTML = '<p class="no-data">No AIRMETs/SIGMETs</p>';
        document.getElementById('tfrs-content').innerHTML = '<p class="no-data">Check tfr.faa.gov</p>';
        document.getElementById('notams-content').innerHTML = b.notams?.length > 0
            ? b.notams.map(n => `<div class="notam-item"><strong>${n.airport}</strong>: ${n.text}</div>`).join('')
            : '<p class="no-data">No NOTAMs</p>';

        document.getElementById('no-briefing').style.display = 'none';
        document.getElementById('briefing-content').style.display = 'block';

        // Only auto-switch to briefing tab if requested
        if (autoSwitch) {
            document.querySelector('[data-tab="briefing"]').click();
        }

        return true;
    } catch (e) {
        console.error('Error fetching briefing:', e);
        return false;
    }
}

// Performance
document.getElementById('calc-takeoff').addEventListener('click', async () => {
    try {
        const res = await fetch('/api/flight-planning/performance/takeoff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                weight: document.getElementById('to-weight').value,
                pressure_altitude: document.getElementById('to-altitude').value,
                temperature: document.getElementById('to-temp').value,
                headwind: document.getElementById('to-wind').value
            })
        });
        const r = await res.json();
        document.getElementById('to-ground-roll').textContent = r.ground_roll;
        document.getElementById('to-total').textContent = r.total_over_50ft;
        document.getElementById('takeoff-results').style.display = 'block';
    } catch (e) { alert('Error: ' + e.message); }
});

document.getElementById('calc-landing').addEventListener('click', async () => {
    try {
        const res = await fetch('/api/flight-planning/performance/landing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pressure_altitude: document.getElementById('land-altitude').value,
                temperature: document.getElementById('land-temp').value,
                headwind: document.getElementById('land-wind').value
            })
        });
        const r = await res.json();
        document.getElementById('land-ground-roll').textContent = r.ground_roll;
        document.getElementById('land-total').textContent = r.total_over_50ft;
        document.getElementById('landing-results').style.display = 'block';
    } catch (e) { alert('Error: ' + e.message); }
});

// W&B
document.getElementById('calc-wb').addEventListener('click', async () => {
    try {
        const res = await fetch('/api/weight-balance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                empty_weight: document.getElementById('wb-empty-weight').value,
                empty_moment: document.getElementById('wb-empty-moment').value,
                pilot_weight: document.getElementById('wb-pilot').value,
                front_passenger_weight: document.getElementById('wb-front-pax').value,
                rear_passenger_weight: document.getElementById('wb-rear-pax').value,
                baggage_weight: document.getElementById('wb-baggage').value,
                fuel_gallons: document.getElementById('wb-fuel').value
            })
        });
        const r = await res.json();
        
        document.getElementById('wb-total-weight').textContent = r.total_weight;
        document.getElementById('wb-cg').textContent = r.cg;
        document.getElementById('wb-moment').textContent = r.moment_1000;
        
        const status = document.getElementById('wb-status');
        if (r.within_all_limits) {
            status.className = 'status-message success';
            status.textContent = '✓ Within all limits';
        } else {
            status.className = 'status-message danger';
            status.textContent = '⚠ ' + (!r.within_weight_limits ? `OVERWEIGHT by ${Math.abs(r.weight_margin)} lbs ` : '') +
                                (!r.within_cg_limits ? 'CG OUT OF LIMITS' : '');
        }
        document.getElementById('wb-results').style.display = 'block';
    } catch (e) { alert('Error: ' + e.message); }
});

// Start by checking startup status
document.addEventListener('DOMContentLoaded', checkStartupStatus);
