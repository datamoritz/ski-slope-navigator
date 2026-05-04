require("dotenv").config();

const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const { buildGraph } = require("./utils/graph");
const { fetchResortData, searchSkiAreas } = require("./utils/osm");
const { route } = require("./utils/routing");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.json({ limit: "2mb" }));
app.use(express.static(PUBLIC_DIR));

function slugify(name, id = "") {
  const base = String(name || "resort")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "resort";
  const idPart = String(id || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return idPart ? `${base}-${idPart}` : base;
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function findCachedBySkiAreaId(skiAreaId) {
  await ensureDataDir();
  const files = await fs.readdir(DATA_DIR);
  for (const file of files.filter((name) => name.endsWith(".graph.json"))) {
    const graph = await readJson(path.join(DATA_DIR, file)).catch(() => null);
    if (graph?.ski_area_id && String(graph.ski_area_id) === String(skiAreaId)) {
      return { slug: graph.slug || file.replace(/\.graph\.json$/, ""), graph };
    }
  }
  return null;
}

async function readGraph(slug) {
  const safeSlug = slug.replace(/[^a-zA-Z0-9_-]/g, "");
  const graphPath = path.join(DATA_DIR, `${safeSlug}.graph.json`);
  return readJson(graphPath);
}

function graphStats(graph) {
  return {
    slug: graph.slug,
    name: graph.resortName,
    source: graph.source,
    lifts: graph.stats?.liftCount ?? graph.edges.filter((edge) => edge.type === "lift").length,
    runs: graph.stats?.runCount ?? graph.edges.filter((edge) => edge.type === "run").length,
    locations: graph.nodes.length,
    warnings: graph.warnings?.length || 0,
  };
}

function logGraph(slug, graph) {
  const stats = graph.stats || {};
  console.log(
    `[${slug}] graph built: ${stats.nodesAfterMerge || graph.nodes.length} nodes (${stats.nodesMerged || 0} merged), ` +
      `${stats.edgeCount || graph.edges.length} edges (${stats.runCount || 0} runs, ${stats.liftCount || 0} lifts), ` +
      `${stats.directionWarningCount || 0} direction warnings`
  );
}

app.get("/api/search", async (req, res, next) => {
  try {
    const query = String(req.query.q || "").trim();
    if (query.length < 2) return res.json([]);
    const results = await searchSkiAreas(query);
    res.json(results);
  } catch (error) {
    next(error);
  }
});

app.post("/api/load", async (req, res, next) => {
  try {
    const { ski_area_id: skiAreaId, name } = req.body || {};
    if (!skiAreaId || !name) {
      return res.status(400).json({ error: "ski_area_id and name are required" });
    }

    const cached = await findCachedBySkiAreaId(skiAreaId);
    if (cached) {
      return res.json({ ...graphStats(cached.graph), cached: true });
    }

    await ensureDataDir();
    const slug = slugify(name, skiAreaId);
    const raw = await fetchResortData(skiAreaId, name);
    raw.name = name;
    raw.slug = slug;
    await writeJson(path.join(DATA_DIR, `${slug}.raw.json`), raw);

    const graph = buildGraph(raw);
    graph.slug = slug;
    graph.resortName = name;
    await writeJson(path.join(DATA_DIR, `${slug}.graph.json`), graph);
    logGraph(slug, graph);

    res.json({ ...graphStats(graph), cached: false });
  } catch (error) {
    next(error);
  }
});

app.get("/api/resorts", async (req, res, next) => {
  try {
    await ensureDataDir();
    const files = await fs.readdir(DATA_DIR);
    const resorts = [];
    for (const file of files.filter((name) => name.endsWith(".graph.json"))) {
      const graph = await readJson(path.join(DATA_DIR, file)).catch(() => null);
      if (graph) resorts.push(graphStats(graph));
    }
    resorts.sort((a, b) => a.name.localeCompare(b.name));
    res.json(resorts);
  } catch (error) {
    next(error);
  }
});

app.get("/api/resort/:slug/nodes", async (req, res, next) => {
  try {
    const graph = await readGraph(req.params.slug);
    res.json(graph.nodes.map((node) => ({ id: node.id, label: node.label })));
  } catch (error) {
    next(error);
  }
});

app.get("/api/resort/:slug/map", async (req, res, next) => {
  try {
    const graph = await readGraph(req.params.slug);
    res.json({
      slug: graph.slug,
      name: graph.resortName,
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        lat: node.lat,
        lon: node.lon,
      })),
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        name: edge.name,
        type: edge.type,
        difficulty: edge.difficulty,
        liftType: edge.liftType || null,
        fromNode: edge.fromNode,
        toNode: edge.toNode,
        geometry: edge.geometry || [],
      })),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/route", async (req, res, next) => {
  try {
    const { slug, from, to, preference } = req.body || {};
    if (!slug || !from || !to) {
      return res.status(400).json({ error: "slug, from and to are required" });
    }
    const graph = await readGraph(slug);
    res.json(route(graph, from, to, preference || "easiest"));
  } catch (error) {
    next(error);
  }
});

app.get("/api/debug/:slug", async (req, res, next) => {
  try {
    const graph = await readGraph(req.params.slug);
    res.json({
      slug: graph.slug,
      name: graph.resortName,
      source: graph.source,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      stats: graph.stats,
      sampleNodes: graph.nodes.slice(0, 12),
      sampleEdges: graph.edges.slice(0, 12),
      warnings: graph.warnings || [],
    });
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error, req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || "Internal server error" });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`SlopeNavigator running on ${HOST}:${PORT}`);
});

server.on("error", (error) => {
  console.error(`Unable to start server on ${HOST}:${PORT}`, error);
  process.exit(1);
});
