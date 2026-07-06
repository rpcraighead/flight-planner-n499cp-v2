# Quick Start — N499CP Flight Planner

Plan your first route in about a minute. We'll fly
**KSEE → JLI → TRM → KPSP** (Gillespie Field, over the Julian and Thermal VORs,
into Palm Springs).

> ⚠️ **SIM USE ONLY** — weather is partly simulated. Brief with official sources
> before any real flight.

---

## 1. Open the app

- **Public:** https://flightplanner.rpc-cyberflight.com
- **Local:** http://192.168.50.236:5001

Check the pill in the top-right shows an airport count (e.g. `32,553 apts`),
not `No data`.

## 2. Type the route

In the route box at the top, type (it auto-uppercases):

```
KSEE JLI TRM KPSP
```

Departure first, destination last, spaces between. `KSEE`/`KPSP` are airports;
`JLI`/`TRM` are VORs.

## 3. Set cruise

- **Altitude:** `9,500 ft`
- **RPM:** `2400 (55%)` (default)
- **Reserve:** `45 min` (default)

## 4. Press **Fly**

The route draws on the map and the **Flight Log** drawer opens at the bottom.

## 5. Read the log

- **Summary strip:** ~85 NM, ~74 min, ~19 gal, winds.
- **Nav log table:** per-leg DIST / TC / **MH** / GS / TIME / FUEL. (Magnetic
  headings run ~11° less than true course — that's SoCal magnetic variation.)
- Exact time/fuel/heading numbers vary with the current winds aloft (live GFS forecast).

## 6. Look around the tabs

- **Terrain** — profile + Min Clearance badge vs your 9,500 ft cruise.
- **Weather** — METARs (live if reachable) + live GFS winds aloft.
- **Airports** — runways for KSEE and KPSP.

## 7. Edit on the map (the fun part)

- Every leg has a **white midpoint dot** — drag it to bend the route.
- Drop it on or near a fix → pick from the **top-3 snap** menu, or
- Hold **Shift** and release to drop a **user waypoint** at that exact spot.
- **Click** an intermediate waypoint to **remove** it.

The route and nav log recompute automatically after every edit.

---

## Cheat sheet

| Do this | How |
|---------|-----|
| Add a fix by ICAO/navaid | Type it in the route box |
| Calculate | **Fly** button (or Enter) |
| Change chart | VFR Sec / IFR Low / IFR High / Satellite / Street (top-left) |
| Add a fix by clicking the map | **✈ Plan**, click, choose Dep/Wpt/Dest |
| Bend a leg | Drag its white midpoint dot |
| Drop a user waypoint fast | **Shift** + release while dragging a handle |
| Remove a waypoint | Click its marker → ✕ Remove |
| Frame the route | **⊙ Fit** |
| Takeoff/landing numbers | **Perf** |
| Weight & balance | **W&B** |
| V-speeds / limits | **Ref** |

Full details in **[USER_GUIDE.md](USER_GUIDE.md)**.
