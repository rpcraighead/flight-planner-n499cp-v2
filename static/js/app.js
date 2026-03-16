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
        const res = await fetch('/api/tile-sources');
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
        } else if (tab === 'profile') {
            setTimeout(() => { if (terrainData) drawTerrainProfile(); }, 100);
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
        maxZoom: 12,
        minZoom: 4,
        errorTileUrl: ''
    });

    const ifrHighTiles = L.tileLayer('https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_High/MapServer/tile/{z}/{y}/{x}', {
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
    const latlngs = points.map(p => [p.lat || p.latitude, p.lon || p.longitude]);

    // Route line with white outline
    L.polyline(latlngs, { color: '#ffffff', weight: 8, opacity: 0.9 }).addTo(vfrRouteLayer);
    L.polyline(latlngs, { color: '#bf0a30', weight: 4, opacity: 1 }).addTo(vfrRouteLayer);

    // Markers
    points.forEach((pt, idx) => {
        let color = '#1e3a5f', radius = 8;
        if (idx === 0) { color = '#28a745'; radius = 12; }
        else if (idx === points.length - 1) { color = '#bf0a30'; radius = 12; }

        L.circleMarker([pt.lat || pt.latitude, pt.lon || pt.longitude], {
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
    const latlngs = points.map(p => [p.lat || p.latitude, p.lon || p.longitude]);

    // Magenta for IFR
    L.polyline(latlngs, { color: '#ffffff', weight: 8, opacity: 0.9 }).addTo(ifrRouteLayer);
    L.polyline(latlngs, { color: '#ff00ff', weight: 4, opacity: 1 }).addTo(ifrRouteLayer);

    points.forEach((pt, idx) => {
        let color = '#1e3a5f', radius = 8;
        if (idx === 0) { color = '#28a745'; radius = 12; }
        else if (idx === points.length - 1) { color = '#bf0a30'; radius = 12; }

        L.circleMarker([pt.lat || pt.latitude, pt.lon || pt.longitude], {
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
                const res = await fetch(`/api/airport-info/${icao}`);
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
        const res = await fetch('/api/calculate-route', {
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

        // Fetch airport details and terrain profile in background
        try { fetchAirportDetails(); } catch (e) { console.error('Airport details failed:', e); }
        try { fetchTerrainProfile(); } catch (e) { console.error('Terrain profile failed:', e); }

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
        const res = await fetch('/api/weather-briefing', {
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
        const res = await fetch('/api/performance/takeoff', {
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
        const res = await fetch('/api/performance/landing', {
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

// Airports Tab
async function fetchAirportDetails() {
    if (!currentRoute || !currentRoute.route_points) return;

    const points = currentRoute.route_points;
    // Get unique airport identifiers (departure, waypoints, destination)
    const airports = points.filter(p => p.type === 'airport').map(p => p.identifier);
    if (airports.length === 0) return;

    const container = document.getElementById('airports-cards');
    container.innerHTML = '<div class="profile-loading"><span class="spinner"></span> Loading airport data...</div>';
    document.getElementById('no-airports').style.display = 'none';
    document.getElementById('airports-content').style.display = 'block';

    let html = '';
    for (const icao of airports) {
        try {
            const res = await fetch(`/api/airport-detail/${icao}`);
            const data = await res.json();
            if (!data.success) continue;

            const apt = data.airport;
            const runways = data.runways;
            const metar = data.metar;
            const fltcat = (metar?.fltcat || metar?.fltCat || 'VFR').toUpperCase();
            const fltcatClass = fltcat.toLowerCase();

            html += `<div class="airport-detail-card">
                <h3>${icao} <span class="flight-cat-badge ${fltcatClass}">${fltcat}</span></h3>
                <div class="airport-name">${apt.name} — ${apt.city}, ${apt.state}</div>
                <div class="airport-detail-grid">
                    <div class="airport-info-section">
                        <h4>Airport Info</h4>
                        <div class="airport-info-row"><span class="label">Elevation</span><span class="value">${apt.elevation}' MSL</span></div>
                        <div class="airport-info-row"><span class="label">Latitude</span><span class="value">${apt.latitude.toFixed(4)}°</span></div>
                        <div class="airport-info-row"><span class="label">Longitude</span><span class="value">${apt.longitude.toFixed(4)}°</span></div>
                        <div class="airport-info-row"><span class="label">FAA ID</span><span class="value">${data.faa_id}</span></div>

                        <h4 style="margin-top:1rem;">Current Weather</h4>
                        <div class="metar-box ${metar?.simulated ? 'simulated' : ''}">${metar?.rawOb || 'No METAR available'}${metar?.simulated ? '<br><em>(simulated)</em>' : ''}</div>
                    </div>
                    <div class="airport-info-section">
                        <h4>Runways</h4>
                        ${runways.length > 0 ? `
                        <table class="runway-table">
                            <thead><tr><th>Runway</th><th>Length</th><th>Surface</th></tr></thead>
                            <tbody>${runways.map(r => `<tr><td>${r.runway_id}</td><td>${r.length.toLocaleString()}' </td><td>${r.surface}</td></tr>`).join('')}</tbody>
                        </table>` : '<p>No runway data</p>'}
                    </div>
                </div>
                ${data.diagram_url ? `<div class="diagram-container">
                    <h4 style="color:var(--navy); font-size:0.85rem; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.5rem;">Airport Diagram</h4>
                    <iframe src="${data.diagram_url}" title="${icao} Airport Diagram"></iframe>
                    <a href="${data.diagram_url}" target="_blank" class="diagram-link">Open diagram in new tab ↗</a>
                </div>` : '<p style="color:var(--text-dim); margin-top:1rem; font-size:0.85rem;">No airport diagram available</p>'}
            </div>`;
        } catch (e) {
            console.error(`Failed to fetch details for ${icao}:`, e);
        }
    }

    container.innerHTML = html || '<p>No airport data available</p>';
}

// Terrain Profile
let terrainData = null;

async function fetchTerrainProfile() {
    if (!currentRoute || !currentRoute.route_points) return;

    const profileContent = document.getElementById('profile-content');
    const noProfile = document.getElementById('no-profile');

    // Show loading state
    noProfile.innerHTML = '<div class="profile-loading"><span class="spinner"></span> Fetching terrain data along route...</div>';
    noProfile.style.display = 'block';
    profileContent.style.display = 'none';

    try {
        const res = await fetch('/api/terrain-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                route_points: currentRoute.route_points.map(p => ({
                    lat: p.latitude || p.lat,
                    lon: p.longitude || p.lon,
                    identifier: p.identifier
                })),
                cruise_altitude: currentRoute.cruise?.altitude || 6000
            })
        });

        const data = await res.json();
        if (!data.success) {
            noProfile.innerHTML = '<p>Failed to fetch terrain data: ' + (data.error || 'Unknown error') + '</p>';
            return;
        }

        terrainData = data;

        // Update stats
        document.getElementById('profile-max-terrain').textContent = data.max_terrain.toLocaleString();
        document.getElementById('profile-min-clearance').textContent = data.min_clearance.toLocaleString();
        document.getElementById('profile-climb-dist').textContent = data.climb_distance || '--';
        document.getElementById('profile-desc-dist').textContent = data.descent_distance || '--';

        const statusEl = document.getElementById('profile-clearance-status');
        if (data.min_clearance >= 2000) {
            statusEl.textContent = 'ADEQUATE CLEARANCE';
            statusEl.className = 'profile-clearance ok';
        } else if (data.min_clearance >= 1000) {
            statusEl.textContent = 'MINIMUM VFR CLEARANCE';
            statusEl.className = 'profile-clearance warning';
        } else {
            statusEl.textContent = 'INSUFFICIENT CLEARANCE';
            statusEl.className = 'profile-clearance danger';
        }

        noProfile.style.display = 'none';
        profileContent.style.display = 'block';

        drawTerrainProfile();
    } catch (e) {
        noProfile.innerHTML = '<p>Error fetching terrain data: ' + e.message + '</p>';
    }
}

function drawTerrainProfile() {
    if (!terrainData) return;

    const canvas = document.getElementById('terrain-canvas');
    const container = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;

    // Size canvas to container
    const rect = container.getBoundingClientRect();
    const width = rect.width - 32; // account for padding
    const height = 350;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const profile = terrainData.profile;
    const cruiseAlt = terrainData.cruise_altitude;
    const totalDist = terrainData.total_distance;

    // Chart margins
    const margin = { top: 30, right: 20, bottom: 45, left: 55 };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    // Y-axis range: 0 to max(cruise alt + 1000, max terrain + 2000)
    const maxTerrain = terrainData.max_terrain;
    const yMax = Math.max(cruiseAlt + 1000, maxTerrain + 2000);
    const yMin = 0;

    // Scale functions
    const xScale = (dist) => margin.left + (dist / totalDist) * chartW;
    const yScale = (alt) => margin.top + chartH - ((alt - yMin) / (yMax - yMin)) * chartH;

    // Clear
    ctx.fillStyle = '#0a1628';
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;

    // Y grid (every 1000 or 2000 ft depending on range)
    const yStep = yMax > 10000 ? 2000 : 1000;
    for (let alt = 0; alt <= yMax; alt += yStep) {
        const y = yScale(alt);
        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(width - margin.right, y);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(alt.toLocaleString() + "'", margin.left - 8, y + 4);
    }

    // X grid (every 10 NM or appropriate interval)
    const xStep = totalDist > 100 ? 20 : (totalDist > 50 ? 10 : 5);
    for (let dist = 0; dist <= totalDist; dist += xStep) {
        const x = xScale(dist);
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, height - margin.bottom);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(dist + ' NM', x, height - margin.bottom + 18);
    }

    // 1000' AGL below flight path (dashed orange)
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(255,165,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < profile.length; i++) {
        const x = xScale(profile[i].dist_nm);
        const flightAlt = profile[i].flight_alt || cruiseAlt;
        const y = yScale(flightAlt - 1000);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // Terrain fill
    ctx.beginPath();
    ctx.moveTo(xScale(profile[0].dist_nm), yScale(0));
    for (let i = 0; i < profile.length; i++) {
        ctx.lineTo(xScale(profile[i].dist_nm), yScale(profile[i].elevation_ft));
    }
    ctx.lineTo(xScale(profile[profile.length - 1].dist_nm), yScale(0));
    ctx.closePath();

    // Terrain gradient
    const terrainGrad = ctx.createLinearGradient(0, yScale(maxTerrain), 0, yScale(0));
    terrainGrad.addColorStop(0, '#5b8c5a');
    terrainGrad.addColorStop(0.5, '#3d6b3d');
    terrainGrad.addColorStop(1, '#2a4a2a');
    ctx.fillStyle = terrainGrad;
    ctx.fill();

    // Terrain outline
    ctx.beginPath();
    for (let i = 0; i < profile.length; i++) {
        const x = xScale(profile[i].dist_nm);
        const y = yScale(profile[i].elevation_ft);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#7ec87e';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Flight path line (red, shows climb/cruise/descent)
    ctx.beginPath();
    for (let i = 0; i < profile.length; i++) {
        const x = xScale(profile[i].dist_nm);
        const flightAlt = profile[i].flight_alt || cruiseAlt;
        const y = yScale(flightAlt);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#bf0a30';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Cruise altitude reference line (thin dashed white)
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(margin.left, yScale(cruiseAlt));
    ctx.lineTo(width - margin.right, yScale(cruiseAlt));
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Flight path labels
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.textAlign = 'left';

    // Cruise alt label
    ctx.fillStyle = '#bf0a30';
    ctx.fillText(cruiseAlt.toLocaleString() + "' MSL", margin.left + 5, yScale(cruiseAlt) - 6);

    // Top of Descent marker
    const todDist = terrainData.top_of_descent;
    const descDist = terrainData.descent_distance;
    const climbDist = terrainData.climb_distance;
    if (todDist > 0 && descDist > 2) {
        const todX = xScale(todDist);
        ctx.save();
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(todX, yScale(cruiseAlt));
        ctx.lineTo(todX, height - margin.bottom);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '10px IBM Plex Sans, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('T/D', todX, yScale(cruiseAlt) + 14);
    }

    // Top of Climb marker
    if (climbDist > 2) {
        const tocX = xScale(climbDist);
        ctx.save();
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tocX, yScale(cruiseAlt));
        ctx.lineTo(tocX, height - margin.bottom);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '10px IBM Plex Sans, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('T/C', tocX, yScale(cruiseAlt) + 14);
    }

    // Waypoint markers
    for (const pt of profile) {
        if (pt.waypoint) {
            const x = xScale(pt.dist_nm);
            ctx.beginPath();
            ctx.moveTo(x, margin.top);
            ctx.lineTo(x, height - margin.bottom);
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Waypoint label at top
            ctx.fillStyle = '#ffd700';
            ctx.font = 'bold 11px IBM Plex Sans, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(pt.waypoint, x, margin.top - 8);

            // Small diamond marker on terrain
            const terrainY = yScale(pt.elevation_ft);
            ctx.fillStyle = '#ffd700';
            ctx.beginPath();
            ctx.moveTo(x, terrainY - 5);
            ctx.lineTo(x + 4, terrainY);
            ctx.lineTo(x, terrainY + 5);
            ctx.lineTo(x - 4, terrainY);
            ctx.closePath();
            ctx.fill();
        }
    }

    // Axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '11px IBM Plex Sans, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Distance (NM)', margin.left + chartW / 2, height - 5);

    ctx.save();
    ctx.translate(14, margin.top + chartH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Altitude (ft MSL)', 0, 0);
    ctx.restore();

    // Mouse hover interaction
    canvas.onmousemove = (e) => {
        const canvasRect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - canvasRect.left;
        const dist = ((mouseX - margin.left) / chartW) * totalDist;

        if (dist < 0 || dist > totalDist) {
            document.getElementById('profile-hover-info').textContent = '';
            return;
        }

        // Find nearest profile point
        let nearest = profile[0];
        let minDiff = Infinity;
        for (const pt of profile) {
            const diff = Math.abs(pt.dist_nm - dist);
            if (diff < minDiff) { minDiff = diff; nearest = pt; }
        }

        const flightAlt = nearest.flight_alt || cruiseAlt;
        const clearance = flightAlt - nearest.elevation_ft;
        let phase = 'Cruise';
        if (nearest.dist_nm <= (terrainData.climb_distance || 0)) phase = 'Climb';
        else if (nearest.dist_nm >= (terrainData.top_of_descent || totalDist)) phase = 'Descent';
        document.getElementById('profile-hover-info').textContent =
            `${phase}  |  Dist: ${nearest.dist_nm} NM  |  Alt: ${flightAlt.toLocaleString()}'  |  Terrain: ${nearest.elevation_ft.toLocaleString()}'  |  Clearance: ${clearance.toLocaleString()}' AGL` +
            (nearest.waypoint ? `  |  ${nearest.waypoint}` : '');
    };

    canvas.onmouseleave = () => {
        document.getElementById('profile-hover-info').textContent = '';
    };
}

// Redraw on window resize
window.addEventListener('resize', () => {
    if (terrainData) drawTerrainProfile();
});

// Start by checking startup status
document.addEventListener('DOMContentLoaded', checkStartupStatus);
