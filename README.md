# N499CP Flight Planner

**SIMULATOR USE ONLY. NOT FOR REAL WORLD NAVIGATION.**

Flight planning application for N499CP (2020 Cessna 172S NAV III), built for Civil Air Patrol San Diego Senior Squadron 57.

**Live:** [flightplanner.rpc-cyberflight.com](https://flightplanner.rpc-cyberflight.com)

## Features

- **Route Planning** - Enter departure, destination, and waypoints. Calculates fuel burn, time enroute, headings, and wind corrections using real performance data from the C172S POH.
- **VFR/IFR Charts** - FAA sectional and IFR enroute charts via ArcGIS tile services with route overlay.
- **Vertical Terrain Profile** - Terrain elevation along the route using USGS Elevation API, with climb/descent gradients based on aircraft performance data.
- **Airport Data** - Airport info, runway diagrams (FAA d-TPP), current METAR, and runway lengths for all route airports.
- **Weather Briefing** - Live METAR, TAF, and winds aloft from aviationweather.gov.
- **Performance** - Takeoff and landing distance calculations adjusted for altitude, temperature, and wind.
- **Weight & Balance** - CG envelope verification with graphical output.
- **Reference** - V-speeds, limitations, and fuel data for the aircraft.

## Tech Stack

- **Backend:** Python / Flask
- **Frontend:** Vanilla JavaScript, Leaflet.js, HTML5 Canvas
- **Data:** SQLite (OurAirports data), FAA d-TPP diagrams, USGS elevation API, aviationweather.gov
- **Hosting:** Google Cloud Run

## Running Locally

```bash
pip install -r requirements.txt
python app.py
```

Open http://localhost:5000. Click "Update Database" on first run to download airport/navaid data.

## Deploying to Google Cloud Run

```bash
gcloud run deploy flight-planner \
  --source . \
  --region us-west1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --timeout 120 \
  --project cyberflight-web
```

## Built With

Built in under 4 hours using VSCode + Claude. Flight tested in the actual airplane.
