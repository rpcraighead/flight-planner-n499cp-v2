from flask import Flask, render_template, request, jsonify, send_from_directory
from datetime import datetime, timedelta, timezone
import math
import os
import csv
import sqlite3
import requests
from io import StringIO
import threading
import time

app = Flask(__name__)

DATABASE_PATH = 'aviation_data.db'
CHARTS_DIR = 'charts'
AVIATION_WEATHER_BASE = 'https://aviationweather.gov/api/data'

# FAA official tile sources via ArcGIS
TILE_SOURCES = {
    'vfr': 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/{z}/{y}/{x}',
    'ifr_low': 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_Low/MapServer/tile/{z}/{y}/{x}',
    'ifr_high': 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_High/MapServer/tile/{z}/{y}/{x}',
}

# Chart regions - Southwest US coverage
CHART_REGIONS = {
    'socal': {'name': 'Southern California', 'bounds': [[32.0, -121.0], [35.5, -114.0]]},
    'phoenix': {'name': 'Phoenix/Arizona', 'bounds': [[31.0, -115.0], [35.5, -109.0]]},
    'norcal': {'name': 'Northern California', 'bounds': [[36.0, -124.0], [40.0, -119.0]]},
}

OURAIRPORTS_URLS = {
    'airports': 'https://davidmegginson.github.io/ourairports-data/airports.csv',
    'runways': 'https://davidmegginson.github.io/ourairports-data/runways.csv',
    'navaids': 'https://davidmegginson.github.io/ourairports-data/navaids.csv'
}

AIRCRAFT_DATABASE = {
    'N499CP': {
        'name': 'N499CP - Cessna 172S NAV III',
        'empty_weight': 1642, 'empty_weight_moment': 62.6,
        'max_takeoff_weight': 2550, 'usable_fuel': 53,
        'fuel_weight_per_gallon': 6.0,
        'cg_forward_limit': 35.0, 'cg_aft_limit': 47.3,
        'fuel_arm': 48.0, 'taxi_fuel': 1.4,
        
        'cruise_performance': {
            4000: {2500: {0: (69, 115, 9.5)}, 2400: {0: (61, 109, 8.5)}},
            6000: {2600: {0: (73, 119, 9.9)}, 2500: {0: (65, 114, 9.0)}, 2400: {0: (57, 108, 8.2)}},
            8000: {2600: {0: (68, 119, 9.4)}, 2500: {0: (61, 112, 8.6)}, 2400: {0: (54, 106, 7.8)}},
            10000: {2600: {0: (64, 117, 9.0)}, 2500: {0: (57, 111, 8.2)}},
        },
        
        'climb_performance': {
            0: (0, 0.0, 0), 2000: (3, 0.8, 4), 4000: (6, 1.5, 8),
            6000: (10, 2.2, 13), 8000: (14, 3.0, 19), 10000: (20, 3.9, 27),
        },
        
        'takeoff_distance_2550': {
            0: {15: (940, 1630), 30: (1070, 1810)},
            2000: {15: (1150, 1960), 30: (1285, 2190)},
            4000: {15: (1390, 2390), 30: (1550, 2685)},
            6000: {15: (1680, 2950), 30: (1875, 3320)},
        },
        
        'landing_distance': {
            0: {15: (575, 1335), 30: (605, 1380)},
            2000: {15: (620, 1405), 30: (650, 1455)},
            4000: {15: (665, 1480), 30: (700, 1535)},
            6000: {15: (720, 1560), 30: (755, 1620)},
        },
    }
}

DEFAULT_AIRCRAFT = 'N499CP'

os.makedirs(CHARTS_DIR, exist_ok=True)

def get_utc_now():
    return datetime.now(timezone.utc)

def init_database():
    conn = sqlite3.connect(DATABASE_PATH)
    c = conn.cursor()
    c.execute('CREATE TABLE IF NOT EXISTS airports (icao TEXT PRIMARY KEY, name TEXT, city TEXT, state TEXT, latitude REAL, longitude REAL, elevation INTEGER)')
    c.execute('CREATE TABLE IF NOT EXISTS runways (id INTEGER PRIMARY KEY, airport_icao TEXT, runway_id TEXT, length INTEGER, surface TEXT)')
    c.execute('CREATE TABLE IF NOT EXISTS navaids (id TEXT PRIMARY KEY, name TEXT, type TEXT, latitude REAL, longitude REAL)')
    conn.commit()
    conn.close()

init_database()

def log_msg(m): print(f"[{datetime.now().strftime('%H:%M:%S')}] {m}")

# Startup/Chart download status
startup_status = {
    'ready': False,
    'in_progress': False,
    'phase': 'initializing',
    'message': 'Starting up...',
    'progress': 0,
    'vfr_tiles': 0,
    'ifr_tiles': 0
}

# Database update status
update_status = {'in_progress': False, 'message': '', 'progress': 0}

def lat_lon_to_tile(lat, lon, zoom):
    lat_rad = math.radians(lat)
    n = 2.0 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return x, y

def get_tiles_for_region(bounds, zoom_levels):
    """Get all tile coordinates for a region"""
    tiles = []
    for z in zoom_levels:
        min_x, max_y = lat_lon_to_tile(bounds[0][0], bounds[0][1], z)
        max_x, min_y = lat_lon_to_tile(bounds[1][0], bounds[1][1], z)
        for x in range(min_x, max_x + 1):
            for y in range(min_y, max_y + 1):
                tiles.append((z, x, y))
    return tiles

def download_tiles(chart_type, tile_url_template, regions, zoom_levels, phase_name):
    """Download tiles for specified regions"""
    global startup_status
    
    # Collect all tiles needed
    all_tiles = []
    for region_key, region in regions.items():
        tiles = get_tiles_for_region(region['bounds'], zoom_levels)
        for t in tiles:
            all_tiles.append((region_key, t[0], t[1], t[2]))
    
    total = len(all_tiles)
    downloaded = 0
    skipped = 0
    errors = 0
    
    chart_dir = os.path.join(CHARTS_DIR, chart_type)
    os.makedirs(chart_dir, exist_ok=True)
    
    for region_key, z, x, y in all_tiles:
        tile_path = os.path.join(chart_dir, str(z), str(x))
        os.makedirs(tile_path, exist_ok=True)
        tile_file = os.path.join(tile_path, f'{y}.png')
        
        if os.path.exists(tile_file) and os.path.getsize(tile_file) > 100:
            skipped += 1
        else:
            try:
                url = tile_url_template.format(z=z, x=x, y=y)
                response = requests.get(url, timeout=15, headers={
                    'User-Agent': 'Mozilla/5.0 N499CP-FlightPlanner/1.0',
                    'Referer': 'https://www.faa.gov/'
                })
                if response.status_code == 200 and len(response.content) > 100:
                    with open(tile_file, 'wb') as f:
                        f.write(response.content)
                else:
                    errors += 1
            except Exception as e:
                errors += 1
                if errors <= 5:
                    log_msg(f"Tile error {z}/{x}/{y}: {e}")
        
        downloaded += 1
        progress = int((downloaded / total) * 100)
        startup_status['progress'] = progress
        startup_status['message'] = f'{phase_name}: {downloaded}/{total} tiles ({skipped} cached, {errors} errors)'
        
        if chart_type == 'vfr':
            startup_status['vfr_tiles'] = downloaded - errors
        else:
            startup_status['ifr_tiles'] = downloaded - errors
    
    return downloaded - errors

def count_existing_tiles():
    """Count tiles already downloaded"""
    vfr_count = 0
    ifr_count = 0
    
    vfr_dir = os.path.join(CHARTS_DIR, 'vfr')
    ifr_dir = os.path.join(CHARTS_DIR, 'ifr')
    
    if os.path.exists(vfr_dir):
        for root, dirs, files in os.walk(vfr_dir):
            vfr_count += len([f for f in files if f.endswith('.png')])
    
    if os.path.exists(ifr_dir):
        for root, dirs, files in os.walk(ifr_dir):
            ifr_count += len([f for f in files if f.endswith('.png')])
    
    return vfr_count, ifr_count

def startup_chart_download():
    """Download all charts on startup"""
    global startup_status
    
    startup_status['in_progress'] = True
    startup_status['ready'] = False
    
    # Check if charts already exist
    vfr_existing, ifr_existing = count_existing_tiles()
    min_tiles_needed = 500  # Rough estimate of minimum tiles for coverage
    
    if vfr_existing > min_tiles_needed and ifr_existing > min_tiles_needed:
        log_msg(f"Charts already cached: {vfr_existing} VFR, {ifr_existing} IFR tiles")
        startup_status['vfr_tiles'] = vfr_existing
        startup_status['ifr_tiles'] = ifr_existing
        startup_status['ready'] = True
        startup_status['in_progress'] = False
        startup_status['message'] = 'Charts loaded from cache'
        startup_status['progress'] = 100
        return
    
    try:
        # Download VFR Sectionals - zoom 6-12 for full detail
        startup_status['phase'] = 'vfr'
        startup_status['message'] = 'Downloading VFR Sectional charts...'
        log_msg("Downloading VFR Sectional charts (zoom 6-12)...")
        download_tiles('vfr', TILE_SOURCES['vfr'], CHART_REGIONS, range(6, 13), 'VFR Sectionals')
        
        # Download IFR Low - zoom 5-11 for full detail
        startup_status['phase'] = 'ifr'
        startup_status['message'] = 'Downloading IFR Low Enroute charts...'
        log_msg("Downloading IFR Low Enroute charts (zoom 5-11)...")
        download_tiles('ifr', TILE_SOURCES['ifr_low'], CHART_REGIONS, range(5, 12), 'IFR Low Enroute')
        
        startup_status['ready'] = True
        startup_status['message'] = 'All charts downloaded!'
        startup_status['progress'] = 100
        log_msg("Chart download complete!")
        
    except Exception as e:
        log_msg(f"Chart download error: {e}")
        startup_status['message'] = f'Error: {str(e)} - continuing with online tiles'
        startup_status['ready'] = True  # Allow app to work with online fallback
    finally:
        startup_status['in_progress'] = False

def download_database():
    global update_status
    update_status = {'in_progress': True, 'progress': 5, 'message': 'Downloading airports...'}
    try:
        r = requests.get(OURAIRPORTS_URLS['airports'], timeout=300)
        conn = sqlite3.connect(DATABASE_PATH)
        c = conn.cursor()
        c.execute('DELETE FROM airports')
        c.execute('DELETE FROM runways')
        c.execute('DELETE FROM navaids')
        
        update_status['progress'] = 20
        cnt = 0
        for row in csv.DictReader(StringIO(r.content.decode('utf-8'))):
            icao = row.get('ident', '').upper()
            if row.get('iso_country') in ['US'] and len(icao) >= 3:
                try:
                    c.execute('INSERT OR REPLACE INTO airports VALUES (?,?,?,?,?,?,?)',
                        (icao, row.get('name',''), row.get('municipality',''),
                         row.get('iso_region','')[-2:] if row.get('iso_region') else '',
                         float(row.get('latitude_deg',0) or 0),
                         float(row.get('longitude_deg',0) or 0),
                         int(float(row.get('elevation_ft',0) or 0))))
                    cnt += 1
                except: pass
        conn.commit()
        
        update_status['message'] = 'Downloading runways...'
        update_status['progress'] = 40
        r = requests.get(OURAIRPORTS_URLS['runways'], timeout=300)
        
        c.execute('SELECT icao FROM airports')
        apts = set(x[0] for x in c.fetchall())
        rcnt = 0
        for row in csv.DictReader(StringIO(r.content.decode('utf-8'))):
            apt = row.get('airport_ident','').upper()
            if apt in apts and row.get('le_ident'):
                try:
                    c.execute('INSERT INTO runways (airport_icao, runway_id, length, surface) VALUES (?,?,?,?)',
                        (apt, row.get('le_ident',''), int(float(row.get('length_ft',0) or 0)), row.get('surface','')))
                    rcnt += 1
                except: pass
        conn.commit()
        
        update_status['message'] = 'Downloading navaids...'
        update_status['progress'] = 70
        r = requests.get(OURAIRPORTS_URLS['navaids'], timeout=300)
        
        ncnt = 0
        for row in csv.DictReader(StringIO(r.content.decode('utf-8'))):
            nid = row.get('ident','').upper()
            if row.get('iso_country') in ['US'] and nid:
                try:
                    c.execute('INSERT OR REPLACE INTO navaids VALUES (?,?,?,?,?)',
                        (nid, row.get('name',''), row.get('type',''),
                         float(row.get('latitude_deg',0) or 0),
                         float(row.get('longitude_deg',0) or 0)))
                    ncnt += 1
                except: pass
        conn.commit()
        conn.close()
        
        update_status['message'] = f'Done! {cnt} airports, {rcnt} runways, {ncnt} navaids'
        update_status['progress'] = 100
    except Exception as e:
        update_status['message'] = f'Error: {e}'
    finally:
        update_status['in_progress'] = False

# Weather simulation
def simulate_metar(station):
    now = get_utc_now()
    h = sum(ord(c) for c in station) + now.hour
    wd, ws = (h*37)%36*10, 5+(h%15)
    t, d = 15+(h%20)-10, 10+(h%15)-10
    alt = 29.80 + (h%40)/100
    vis = 10 if (h%10)>2 else (h%10)+3
    fltcat = 'VFR' if vis >= 5 else ('MVFR' if vis >= 3 else 'IFR')
    return {
        'icaoId': station,
        'rawOb': f"{station} {now.strftime('%d%H%M')}Z {wd:03d}{ws:02d}KT {vis}SM FEW050 {t:02d}/{d:02d} A{int(alt*100)}",
        'fltcat': fltcat, 'simulated': True
    }

def simulate_taf(station):
    now = get_utc_now()
    h = sum(ord(c) for c in station)
    return {
        'icaoId': station,
        'rawTAF': f"TAF {station} {now.strftime('%d%H%M')}Z {now.strftime('%d%H')}/{(now+timedelta(hours=24)).strftime('%d%H')} {(h*41)%36*10:03d}{8+(h%12):02d}KT P6SM FEW050",
        'simulated': True
    }

def simulate_winds(lat, lon):
    h = int((lat*100 + lon*100) % 1000)
    return {
        'station': 'ESTIMATED', 'simulated': True,
        'levels': {
            3000: {'direction': (h*7)%360, 'speed': 10+(h%10), 'temp': 10},
            6000: {'direction': (h*11)%360, 'speed': 15+(h%15), 'temp': 3},
            9000: {'direction': (h*13)%360, 'speed': 20+(h%20), 'temp': -4},
            12000: {'direction': (h*17)%360, 'speed': 25+(h%25), 'temp': -11},
        }
    }

def fetch_metar(station):
    try:
        r = requests.get(f"{AVIATION_WEATHER_BASE}/metar?ids={station}&format=json", timeout=8,
                        headers={'User-Agent': 'N499CP-Planner/1.0'})
        if r.status_code == 200 and r.text.strip().startswith('['):
            data = r.json()
            if data: 
                data[0]['simulated'] = False
                return data[0]
    except: pass
    return simulate_metar(station)

def fetch_taf(station):
    try:
        r = requests.get(f"{AVIATION_WEATHER_BASE}/taf?ids={station}&format=json", timeout=8,
                        headers={'User-Agent': 'N499CP-Planner/1.0'})
        if r.status_code == 200 and r.text.strip().startswith('['):
            data = r.json()
            if data:
                data[0]['simulated'] = False
                return data[0]
    except: pass
    return simulate_taf(station)

# Navigation
def gc_dist(lat1, lon1, lat2, lon2):
    R = 3440.065
    la1, la2 = math.radians(lat1), math.radians(lat2)
    dla, dlo = math.radians(lat2-lat1), math.radians(lon2-lon1)
    a = math.sin(dla/2)**2 + math.cos(la1)*math.cos(la2)*math.sin(dlo/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

def bearing(lat1, lon1, lat2, lon2):
    la1, la2 = math.radians(lat1), math.radians(lat2)
    dlo = math.radians(lon2-lon1)
    x = math.sin(dlo)*math.cos(la2)
    y = math.cos(la1)*math.sin(la2) - math.sin(la1)*math.cos(la2)*math.cos(dlo)
    return (math.degrees(math.atan2(x,y))+360)%360

def wind_corr(tc, tas, wd, ws):
    if ws == 0: return 0, tas
    swc = (ws/tas)*math.sin(math.radians(wd-tc))
    swc = max(-1, min(1, swc))
    wca = math.degrees(math.asin(swc))
    gs = tas*math.cos(math.asin(swc)) + ws*math.cos(math.radians(wd-tc))
    return round(wca,1), max(round(gs,1), 0)

def get_airport(icao):
    conn = sqlite3.connect(DATABASE_PATH)
    c = conn.cursor()
    c.execute('SELECT icao,name,city,state,latitude,longitude,elevation FROM airports WHERE icao=?', (icao,))
    r = c.fetchone()
    conn.close()
    if r: return {'icao':r[0],'name':r[1],'city':r[2],'state':r[3],'latitude':r[4],'longitude':r[5],'elevation':r[6]}
    return None

def get_runways(icao):
    conn = sqlite3.connect(DATABASE_PATH)
    c = conn.cursor()
    c.execute('SELECT runway_id,length,surface FROM runways WHERE airport_icao=? ORDER BY length DESC', (icao,))
    rws = [{'runway_id':r[0],'length':r[1],'surface':r[2]} for r in c.fetchall()]
    conn.close()
    return rws

def get_navaid(nid):
    conn = sqlite3.connect(DATABASE_PATH)
    c = conn.cursor()
    c.execute('SELECT id,name,type,latitude,longitude FROM navaids WHERE id=?', (nid,))
    r = c.fetchone()
    conn.close()
    if r: return {'id':r[0],'name':r[1],'type':r[2],'latitude':r[3],'longitude':r[4]}
    return None

def get_coords(ident):
    a = get_airport(ident)
    if a: return (a['latitude'], a['longitude'], 'airport', a)
    n = get_navaid(ident)
    if n: return (n['latitude'], n['longitude'], 'navaid', n)
    return None

def get_cruise(alt, rpm):
    ac = AIRCRAFT_DATABASE[DEFAULT_AIRCRAFT]
    cd = ac['cruise_performance']
    alts = sorted(cd.keys())
    a = min(alts, key=lambda x: abs(x-alt))
    if a not in cd: return {'true_airspeed': 110, 'fuel_flow_gph': 8.5}
    rpms = sorted(cd[a].keys())
    r = min(rpms, key=lambda x: abs(x-rpm))
    if r not in cd[a]: return {'true_airspeed': 110, 'fuel_flow_gph': 8.5}
    pwr, tas, gph = cd[a][r][0]
    return {'power_percent': pwr, 'true_airspeed': tas, 'fuel_flow_gph': gph}

def get_climb(fr, to):
    ac = AIRCRAFT_DATABASE[DEFAULT_AIRCRAFT]
    cd = ac['climb_performance']
    alts = sorted(cd.keys())
    f = min(alts, key=lambda x: abs(x-fr))
    t = min(alts, key=lambda x: abs(x-to))
    fd, td = cd[f], cd[t]
    return {'time_minutes': max(0,td[0]-fd[0]), 'fuel_gallons': max(0,td[1]-fd[1]), 'distance_nm': max(0,td[2]-fd[2])}

def calc_takeoff(wt, alt, temp, hw=0):
    ac = AIRCRAFT_DATABASE[DEFAULT_AIRCRAFT]
    tbl = ac['takeoff_distance_2550']
    alts = sorted(tbl.keys())
    a = min([x for x in alts if x >= alt], default=alts[-1])
    temps = sorted(tbl[a].keys())
    t = min([x for x in temps if x >= temp], default=temps[-1])
    gr, tot = tbl[a][t]
    wf = 1.0 - (hw/9*0.10) if hw > 0 else 1.0
    return {'ground_roll': int(gr*wf), 'total_over_50ft': int(tot*wf)}

def calc_landing(alt, temp, hw=0):
    ac = AIRCRAFT_DATABASE[DEFAULT_AIRCRAFT]
    tbl = ac['landing_distance']
    alts = sorted(tbl.keys())
    a = min([x for x in alts if x >= alt], default=alts[-1])
    temps = sorted(tbl[a].keys())
    t = min([x for x in temps if x >= temp], default=temps[-1])
    gr, tot = tbl[a][t]
    wf = 1.0 - (hw/9*0.10) if hw > 0 else 1.0
    return {'ground_roll': int(gr*wf), 'total_over_50ft': int(tot*wf)}

# Flask Routes
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/startup-status')
def get_startup_status():
    return jsonify(startup_status)

@app.route('/api/tile-sources')
def get_tile_sources():
    return jsonify({
        'vfr': TILE_SOURCES['vfr'],
        'ifr_low': TILE_SOURCES['ifr_low'],
        'ifr_high': TILE_SOURCES['ifr_high'],
    })

# Serve cached tiles
@app.route('/tiles/<chart_type>/<int:z>/<int:x>/<int:y>.png')
def serve_tile(chart_type, z, x, y):
    tile_dir = os.path.join(CHARTS_DIR, chart_type, str(z), str(x))
    tile_file = f'{y}.png'
    full_path = os.path.join(tile_dir, tile_file)
    if os.path.exists(full_path):
        return send_from_directory(tile_dir, tile_file, mimetype='image/png')
    return '', 204

@app.route('/api/update-database', methods=['POST'])
def trigger_update():
    if update_status['in_progress']: return jsonify({'success': False})
    threading.Thread(target=download_database, daemon=True).start()
    return jsonify({'success': True})

@app.route('/api/update-status')
def get_status():
    conn = sqlite3.connect(DATABASE_PATH)
    c = conn.cursor()
    c.execute('SELECT COUNT(*) FROM airports')
    cnt = c.fetchone()[0]
    conn.close()
    return jsonify({'in_progress': update_status['in_progress'], 'message': update_status['message'],
                   'progress': update_status['progress'], 'airports': cnt})

@app.route('/api/airport-info/<icao>')
def airport_info(icao):
    a = get_airport(icao.upper())
    if not a: return jsonify({'success': False})
    return jsonify({'success': True, 'airport': a, 'runways': get_runways(icao.upper())})

@app.route('/api/calculate-route', methods=['POST'])
def calc_route():
    d = request.json
    dep, dest = d.get('departure','').upper(), d.get('destination','').upper()
    wpts = [w.upper() for w in d.get('waypoints', []) if w.strip()]
    alt, rpm = int(d.get('cruise_altitude', 6000)), int(d.get('rpm', 2400))
    
    ac = AIRCRAFT_DATABASE[DEFAULT_AIRCRAFT]
    pts = [dep] + wpts + [dest]
    
    coords = []
    for p in pts:
        c = get_coords(p)
        if not c: return jsonify({'success': False, 'error': f'Not found: {p}'})
        coords.append({'identifier': p, 'lat': c[0], 'lon': c[1], 'type': c[2], 'data': c[3]})
    
    cruise = get_cruise(alt, rpm)
    mid = coords[len(coords)//2]
    winds = simulate_winds(mid['lat'], mid['lon'])
    
    wdir, wspd = 0, 0
    if winds and 'levels' in winds:
        lvls = sorted(winds['levels'].keys())
        nrst = min(lvls, key=lambda x: abs(x-alt))
        wdir = winds['levels'][nrst]['direction']
        wspd = winds['levels'][nrst]['speed']
    
    segs = []
    tot_dist, tot_time, tot_fuel = 0, 0, 0
    
    for i in range(len(coords)-1):
        fr, to = coords[i], coords[i+1]
        dist = gc_dist(fr['lat'], fr['lon'], to['lat'], to['lon'])
        tc = bearing(fr['lat'], fr['lon'], to['lat'], to['lon'])
        wca, gs = wind_corr(tc, cruise['true_airspeed'], wdir, wspd)
        mh = (tc + wca) % 360
        lt = (dist/gs)*60 if gs > 0 else 0
        lf = (lt/60) * cruise['fuel_flow_gph']
        
        segs.append({'from': fr['identifier'], 'to': to['identifier'],
            'distance_nm': round(dist,1), 'true_course': round(tc,0),
            'wind_correction': round(wca,0), 'magnetic_heading': round(mh,0),
            'ground_speed': round(gs,0), 'time_minutes': round(lt,0), 'fuel_gallons': round(lf,1)})
        tot_dist += dist; tot_time += lt; tot_fuel += lf
    
    dep_elev = coords[0]['data'].get('elevation', 0) if coords[0]['data'] else 0
    climb = get_climb(dep_elev, alt)
    taxi = ac['taxi_fuel']
    reserve = 0.75 * cruise['fuel_flow_gph']
    
    return jsonify({
        'success': True, 'route_points': coords, 'segments': segs,
        'winds_aloft': {'altitude': alt, 'direction': wdir, 'speed': wspd, 'source': 'estimated'},
        'cruise': {'altitude': alt, 'rpm': rpm, 'true_airspeed': cruise['true_airspeed'], 'fuel_flow_gph': cruise['fuel_flow_gph']},
        'climb': climb,
        'totals': {
            'distance_nm': round(tot_dist,1),
            'time_minutes': round(tot_time + climb['time_minutes'],0),
            'taxi_fuel': taxi, 'climb_fuel': climb['fuel_gallons'],
            'cruise_fuel': round(tot_fuel,1), 'reserve_fuel': round(reserve,1),
            'total_fuel': round(taxi + climb['fuel_gallons'] + tot_fuel + reserve, 1)
        }
    })

@app.route('/api/weather-briefing', methods=['POST'])
def weather_briefing():
    try:
        d = request.json
        dep, dest = d.get('departure','').upper(), d.get('destination','').upper()
        wpts = [w.upper() for w in d.get('waypoints', []) if w.strip()]
        apts = [a for a in [dep] + wpts + [dest] if a]
        
        briefing = {
            'generated_at': get_utc_now().strftime('%Y-%m-%d %H:%M UTC'),
            'route': ' -> '.join(apts),
            'metars': [], 'tafs': [], 'winds_aloft': None,
            'pireps': [], 'airmets_sigmets': [], 'notams': [], 'tfrs': []
        }
        
        for a in apts:
            briefing['metars'].append(fetch_metar(a))
            briefing['tafs'].append(fetch_taf(a))
            briefing['notams'].append({'airport': a, 'text': f'Check notams.faa.gov for {a}', 'simulated': True})
        
        dc, nc = get_coords(dep), get_coords(dest)
        if dc and nc:
            mlat, mlon = (dc[0]+nc[0])/2, (dc[1]+nc[1])/2
            briefing['winds_aloft'] = simulate_winds(mlat, mlon)
        
        briefing['tfrs'] = [{'notam_id': 'INFO', 'type': 'INFO', 'description': 'Check tfr.faa.gov'}]
        
        return jsonify({'success': True, 'briefing': briefing})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/performance/takeoff', methods=['POST'])
def perf_to():
    d = request.json
    return jsonify(calc_takeoff(int(d.get('weight',2550)), int(d.get('pressure_altitude',0)),
                                int(d.get('temperature',15)), int(d.get('headwind',0))))

@app.route('/api/performance/landing', methods=['POST'])
def perf_land():
    d = request.json
    return jsonify(calc_landing(int(d.get('pressure_altitude',0)), int(d.get('temperature',15)), int(d.get('headwind',0))))

@app.route('/api/weight-balance', methods=['POST'])
def wb():
    d = request.json
    ac = AIRCRAFT_DATABASE[DEFAULT_AIRCRAFT]
    ew = float(d.get('empty_weight', ac['empty_weight']))
    em = float(d.get('empty_moment', ac['empty_weight_moment']))
    p, f, r, b, fu = float(d.get('pilot_weight',0)), float(d.get('front_passenger_weight',0)), float(d.get('rear_passenger_weight',0)), float(d.get('baggage_weight',0)), float(d.get('fuel_gallons',0))
    
    fw = fu * ac['fuel_weight_per_gallon']
    tw = ew + p + f + r + b + fw
    tm = em*1000 + p*40 + f*40 + r*73 + b*95 + fw*48
    cg = tm/tw if tw > 0 else 0
    
    return jsonify({
        'total_weight': round(tw,1), 'max_weight': ac['max_takeoff_weight'],
        'weight_margin': round(ac['max_takeoff_weight']-tw,1),
        'cg': round(cg,2), 'cg_forward_limit': ac['cg_forward_limit'], 'cg_aft_limit': ac['cg_aft_limit'],
        'within_weight_limits': tw <= ac['max_takeoff_weight'],
        'within_cg_limits': ac['cg_forward_limit'] <= cg <= ac['cg_aft_limit'],
        'within_all_limits': tw <= ac['max_takeoff_weight'] and ac['cg_forward_limit'] <= cg <= ac['cg_aft_limit'],
        'moment_1000': round(tm/1000,1)
    })

if __name__ == '__main__':
    print("=" * 60)
    print("N499CP Flight Planner - CAP San Diego Sr. Sq. 57")
    print("=" * 60)
    print(f"Charts directory: {os.path.abspath(CHARTS_DIR)}")
    
    # Start chart download in background
    threading.Thread(target=startup_chart_download, daemon=True).start()
    
    print("Starting server at http://localhost:5000")
    print("Charts will download automatically on first run...")
    print("=" * 60)
    
    app.run(debug=False, host='0.0.0.0', port=5000)
