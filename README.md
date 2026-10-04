# ⛽ Trip Fuel Cost

A mobile web app: enter where you are and where you're going, and it tells you what the drive will cost in fuel.

- **From / To** with address autocomplete, plus a 📍 button that uses your current location
- Real driving distance and time (not straight-line)
- Cost = distance × consumption × price, with **round trip** and **split between people**
- Optional **parking** cost per journey, added to the total
- Petrol, diesel, LPG or **electric** (€/kWh, kWh/100 km)
- Route shown on a map
- Settings are saved on your phone; installable to the home screen (PWA)

## Use it on your phone

Once GitHub Pages is enabled, open `https://iszlam93.github.io/Fuel-price/` on your phone, then:

- **iPhone (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** ⋮ menu → *Install app* / *Add to Home screen*

## Run locally

```bash
py -m http.server 8137
```

Then open http://localhost:8137.

## How it works

Plain HTML/CSS/JS, no build step and no API keys.

| Piece | Service |
|---|---|
| Address search & reverse geocoding | [Photon](https://photon.komoot.io) (OpenStreetMap data) |
| Driving route, distance, time | [OSRM](https://project-osrm.org) public demo server |
| Map | [Leaflet](https://leafletjs.com) + OpenStreetMap tiles |

The public OSRM and Photon servers are free but rate-limited and not meant for heavy traffic. That's fine for personal use; if this ever gets many users, switch to a hosted provider (e.g. OpenRouteService, Mapbox, Google).

Fuel prices are typed in by you (defaults are rough Dutch averages). The Netherlands has no free official live pump-price API.

## Ideas for later

- Live fuel prices (e.g. scrape/partner with a price site, or use the UK/DE/FR open data APIs when driving abroad)
- Toll costs
- Save favourite places (home, work)
- Multiple saved cars
