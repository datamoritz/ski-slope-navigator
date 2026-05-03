# SlopeNavigator

SlopeNavigator is a local ski resort route planner. It loads resort runs and lifts from OpenSkiMap, normalizes the GeoJSON into a directed routing graph, caches the raw and graph data in `data/`, and plans routes using Dijkstra.

## Setup

```sh
npm install
cp .env.example .env
npm start
```

Open http://localhost:3000.

If that port is busy, run with another port:

```sh
PORT=4000 npm start
```

## Environment

```env
PORT=3000
HOST=127.0.0.1
```

No API keys are needed for v1.

## Test Resorts

Good small Alpine resorts to try first:

- Wengen
- Mürren

Search for a resort, choose a result, and load it. The app writes:

- `data/<slug>.raw.json` for the OpenSkiMap response
- `data/<slug>.graph.json` for the normalized routing graph

After a resort loads, the server logs graph quality:

```text
[slug] graph built: X nodes (Y merged), Z edges (W runs, V lifts), D direction warnings
```

## API

- `GET /api/search?q=<name>`
- `POST /api/load` with `{ "ski_area_id": "...", "name": "..." }`
- `GET /api/resorts`
- `GET /api/resort/:slug/nodes`
- `POST /api/route` with `{ "slug": "...", "from": "...", "to": "...", "preference": "easiest|fastest|scenic" }`
- `GET /api/debug/:slug`

## Scope

v1 intentionally excludes map rendering, PDF/image upload, Anthropic extraction, user accounts, North American difficulty mode, and live lift status.
