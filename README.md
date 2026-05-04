# SlopeNavigator

SlopeNavigator is a ski resort route planner. It loads resort runs and lifts from OpenSkiMap, normalizes the GeoJSON into a directed routing graph, caches the raw and graph data in `data/`, displays the resort network on a Leaflet map, and plans routes using Dijkstra.

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

Good resorts to try first:

- Eldora
- Copper
- Arosa Lenzerheide
- Wengen
- Murren

Search for a resort, choose a result, and load it. The app writes:

- `data/<slug>.raw.json` for the OpenSkiMap response
- `data/<slug>.graph.json` for the normalized routing graph

After a resort loads, the server logs graph quality:

```text
[slug] graph built: X nodes (Y merged), Z edges (W runs, V lifts), D direction warnings
```

## User Interface

- Search and load a resort from OpenSkiMap.
- Open cached resorts from the home screen.
- View lifts, runs, junctions, selected start/target points, and highlighted routes on the map.
- Click a dot or nearby map point to set start and target locations.
- Use searchable start/target fields instead of scrolling through long dropdowns.
- Choose `Easiest`, `Fastest`, or `Scenic`, then find a route from either the map button or route form.

The hosted demo can run on Render. Render injects `PORT`, and the app binds to `0.0.0.0` automatically in that environment.

## Data Loading and Fallbacks

OpenSkiMap is the primary data source. The loader first tries the OpenSkiMap GeoJSON layers for runs and lifts. If the layer download fails, or if OpenSkiMap returns lifts but zero runs, the app retries with an Overpass viewport fallback and then a search fallback.

The server refuses to cache obviously incomplete graphs that contain lifts but no runs after all fallbacks. This avoids saving broken resort data that would show lifts without slopes.

## Path Finding with Dijkstra

SlopeNavigator converts each resort into a directed graph before routing:

- Nodes are snapped resort locations such as lift bases, lift tops, run endpoints, and junctions.
- Lift edges point uphill from base to top.
- Run edges point downhill from top to bottom when direction or elevation data is available.
- If run direction is missing, the graph uses the GeoJSON coordinate order and marks that edge as inferred.
- Run/run crossings are detected geometrically and converted into junction nodes, so visually crossing slopes can become routeable connections.
- Nearby lift base/station nodes can receive short bidirectional station connector edges for base-area transfers that are missing from OpenSkiMap.

The `/api/route` endpoint runs Dijkstra's algorithm from the selected start node to the target node. It keeps the cheapest known cost for every reachable node, repeatedly visits the currently cheapest unvisited node, relaxes each outgoing lift/run edge, and stores the previous edge so the final ordered route can be reconstructed.

The edge cost depends on the selected route preference:

- `easiest`: difficulty weight times edge length, so harder runs are strongly penalized.
- `fastest`: estimated travel minutes.
- `scenic`: an augmented Dijkstra state tracks seen run difficulties and rewards variety while penalizing repeated colors.

If strict routing cannot find a path, the app retries with a conservative fallback that reverses only runs whose direction was inferred from incomplete OpenSkiMap data. This helps avoid false "no route" results caused by missing elevation/direction tags while still keeping lift travel one-way uphill.

Short station connector edges are deliberately narrow in scope. They are used for close base-area transfers, such as neighboring lift bases that are walkable/skateable in reality but represented as separate nodes in the raw data.

## API

- `GET /api/search?q=<name>`
- `POST /api/load` with `{ "ski_area_id": "...", "name": "..." }`
- `GET /api/resorts`
- `GET /api/resort/:slug/nodes`
- `GET /api/resort/:slug/map`
- `POST /api/route` with `{ "slug": "...", "from": "...", "to": "...", "preference": "easiest|fastest|scenic" }`
- `GET /api/debug/:slug`

## Scope

v1 intentionally excludes PDF/image upload, Anthropic extraction, user accounts, North American difficulty mode, and live lift status.
