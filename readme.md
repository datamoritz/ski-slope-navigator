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

## Path Finding with Dijkstra

SlopeNavigator converts each resort into a directed graph before routing:

- Nodes are snapped resort locations such as lift bases, lift tops, run endpoints, and junctions.
- Lift edges point uphill from base to top.
- Run edges point downhill from top to bottom when direction or elevation data is available.
- If run direction is missing, the graph uses the GeoJSON coordinate order and marks that edge as inferred.

The `/api/route` endpoint runs Dijkstra's algorithm from the selected start node to the target node. It keeps the cheapest known cost for every reachable node, repeatedly visits the currently cheapest unvisited node, relaxes each outgoing lift/run edge, and stores the previous edge so the final ordered route can be reconstructed.

The edge cost depends on the selected route preference:

- `easiest`: difficulty weight times edge length, so harder runs are strongly penalized.
- `fastest`: estimated travel minutes.
- `scenic`: an augmented Dijkstra state tracks seen run difficulties and rewards variety while penalizing repeated colors.

If strict routing cannot find a path, the app retries with a conservative fallback that reverses only runs whose direction was inferred from incomplete OpenSkiMap data. This helps avoid false "no route" results caused by missing elevation/direction tags while still keeping lift travel one-way uphill.

## API

- `GET /api/search?q=<name>`
- `POST /api/load` with `{ "ski_area_id": "...", "name": "..." }`
- `GET /api/resorts`
- `GET /api/resort/:slug/nodes`
- `POST /api/route` with `{ "slug": "...", "from": "...", "to": "...", "preference": "easiest|fastest|scenic" }`
- `GET /api/debug/:slug`

## Scope

v1 intentionally excludes PDF/image upload, Anthropic extraction, user accounts, North American difficulty mode, and live lift status.
