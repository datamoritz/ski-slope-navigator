const API_BASE = "https://api.openskimap.org";
const TILE_DATA_BASE = "https://tiles.openskimap.org/geojson";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const { Readable } = require("stream");
const { chain } = require("stream-chain");
const { parser } = require("stream-json");
const { pick } = require("stream-json/filters/pick.js");
const { streamArray } = require("stream-json/streamers/stream-array.js");

async function requestJson(path, query = {}) {
  const url = path.startsWith("http") ? new URL(path) : new URL(path, API_BASE);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenSkiMap ${response.status} for ${url.pathname}: ${body.slice(0, 160)}`);
  }

  return response.json();
}

function getFeatureId(feature) {
  return feature?.id || feature?.properties?.id || feature?.properties?.osm_id || feature?.properties?.["@id"];
}

function getFeatureName(feature) {
  return (
    feature?.name ||
    feature?.properties?.name ||
    feature?.properties?.title ||
    feature?.properties?.["name:en"] ||
    "Unnamed ski area"
  );
}

function normalizeSkiAreaResult(item) {
  const feature = item?.type === "Feature" ? item : { properties: item };
  const id = getFeatureId(feature) || item?.ski_area_id || item?.skiAreaId;
  const name = getFeatureName(feature);
  const properties = feature.properties || item || {};
  const place = Array.isArray(properties.places) ? properties.places[0] : null;
  const localized = place?.localized?.en || {};

  return {
    id: String(id || name),
    name,
    country: properties.country || localized.country || properties.iso3166_1 || properties["addr:country"] || "",
    region: properties.region || localized.region || properties.state || properties["addr:state"] || "",
    source: "openskimap",
    raw: item,
  };
}

async function searchSkiAreas(query) {
  const raw = await requestJson("/search", { query });
  const list = Array.isArray(raw) ? raw : raw.features || raw.results || [];
  return list
    .filter((item) => (item.properties || item).type === "skiArea")
    .map(normalizeSkiAreaResult)
    .filter((area) => area.id && area.name);
}

function belongsToSkiArea(feature, skiAreaId) {
  const props = feature?.properties || {};
  if (props.ski_area === skiAreaId || props.skiAreaId === skiAreaId) return true;
  return (props.skiAreas || []).some((area) => String(area?.properties?.id || area?.id) === String(skiAreaId));
}

async function fetchGeoJsonLayer(layer, skiAreaId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const response = await fetch(`${TILE_DATA_BASE}/${layer}.geojson`, { signal: controller.signal });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenSkiMap ${response.status} for ${layer}.geojson: ${body.slice(0, 160)}`);
  }

  const features = [];
  const pipeline = chain([
    Readable.fromWeb(response.body),
    parser(),
    pick({ filter: "features" }),
    streamArray(),
  ]);

  try {
    await new Promise((resolve, reject) => {
      pipeline.on("data", ({ value }) => {
        if (belongsToSkiArea(value, skiAreaId)) features.push(value);
      });
      pipeline.on("end", resolve);
      pipeline.on("error", reject);
    });
  } finally {
    clearTimeout(timeout);
  }

  return { type: "FeatureCollection", features };
}

async function fetchSkiAreaDetail(skiAreaId) {
  return requestJson(`/features/openskimap/${skiAreaId}.geojson`);
}

function bboxFromSkiArea(feature) {
  const props = feature?.properties || {};
  const hint = props.viewportHint;
  let lon;
  let lat;
  let widthM = 2000;
  let heightM = 2000;

  if (hint?.center) {
    [lon, lat] = hint.center;
    widthM = Math.max(widthM, Number(hint.rotatedWidthMeters || 0));
    heightM = Math.max(heightM, Number(hint.rotatedHeightMeters || 0));
  } else if (feature?.geometry?.type === "Point") {
    [lon, lat] = feature.geometry.coordinates;
  } else if (feature?.geometry?.type === "Polygon") {
    const coords = feature.geometry.coordinates.flat();
    const lons = coords.map((coord) => coord[0]);
    const lats = coords.map((coord) => coord[1]);
    return {
      south: Math.min(...lats) - 0.006,
      west: Math.min(...lons) - 0.006,
      north: Math.max(...lats) + 0.006,
      east: Math.max(...lons) + 0.006,
    };
  }

  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error("Selected ski area has no usable viewport");
  }

  const bufferM = 700;
  const latDelta = (heightM / 2 + bufferM) / 111320;
  const lonDelta = (widthM / 2 + bufferM) / (111320 * Math.cos((lat * Math.PI) / 180));
  return {
    south: lat - latDelta,
    west: lon - lonDelta,
    north: lat + latDelta,
    east: lon + lonDelta,
  };
}

function overpassFeature(element, skiAreaId) {
  const tags = element.tags || {};
  const coords = (element.geometry || []).map((point) => [point.lon, point.lat]);
  if (coords.length < 2) return null;

  const isLift = Boolean(tags.aerialway);
  const isRun = Boolean(tags["piste:type"]);
  if (!isLift && !isRun) return null;

  return {
    type: "Feature",
    properties: {
      id: `openstreetmap-way-${element.id}`,
      name: tags.name || tags.ref || null,
      ref: tags.ref || null,
      type: isLift ? "lift" : "run",
      liftType: tags.aerialway || null,
      "piste:difficulty": tags["piste:difficulty"] || tags.difficulty || null,
      oneway: tags.oneway || tags["piste:oneway"] || null,
      source: "openstreetmap-overpass",
      skiAreas: [{ properties: { id: skiAreaId } }],
    },
    geometry: {
      type: "LineString",
      coordinates: coords,
    },
  };
}

async function fetchOverpassResortData(skiAreaId, skiAreaDetail) {
  const bbox = bboxFromSkiArea(skiAreaDetail);
  const bboxText = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const query = `
    [out:json][timeout:25];
    (
      way["piste:type"](${bboxText});
      way["aerialway"](${bboxText});
    );
    out tags geom;
  `;
  const body = `data=${encodeURIComponent(query)}`;
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": "SlopeNavigator/1.0 local route planner",
      Accept: "application/json",
    },
    body,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Overpass ${response.status}: ${text.slice(0, 160)}`);
  }
  const data = await response.json();
  const features = (data.elements || [])
    .map((element) => overpassFeature(element, skiAreaId))
    .filter(Boolean);
  return {
    runs: { type: "FeatureCollection", features: features.filter((feature) => feature.properties.type === "run") },
    lifts: { type: "FeatureCollection", features: features.filter((feature) => feature.properties.type === "lift") },
  };
}

async function fetchSearchFallback(name, skiAreaId) {
  const raw = await requestJson("/search", { query: name });
  const list = Array.isArray(raw) ? raw : raw.features || raw.results || [];
  const features = list.filter((feature) => belongsToSkiArea(feature, skiAreaId));
  return {
    runs: { type: "FeatureCollection", features: features.filter((feature) => feature.properties?.type === "run") },
    lifts: { type: "FeatureCollection", features: features.filter((feature) => feature.properties?.type === "lift") },
  };
}

async function fetchResortData(skiAreaId, name) {
  const skiAreaDetail = await fetchSkiAreaDetail(skiAreaId).catch(() => null);
  let runs;
  let lifts;
  try {
    [runs, lifts] = await Promise.all([
      fetchGeoJsonLayer("runs", skiAreaId),
      fetchGeoJsonLayer("lifts", skiAreaId),
    ]);
  } catch (error) {
    console.warn(`OpenSkiMap layer download failed, using Overpass viewport fallback: ${error.message}`);
    if (skiAreaDetail) {
      try {
        ({ runs, lifts } = await fetchOverpassResortData(skiAreaId, skiAreaDetail));
      } catch (overpassError) {
        console.warn(`Overpass fallback failed, using search fallback: ${overpassError.message}`);
        ({ runs, lifts } = await fetchSearchFallback(name, skiAreaId));
      }
    } else {
      ({ runs, lifts } = await fetchSearchFallback(name, skiAreaId));
    }
  }

  return {
    ski_area_id: String(skiAreaId),
    name,
    ski_area: skiAreaDetail,
    fetched_at: new Date().toISOString(),
    source: "openskimap",
    runs,
    lifts,
  };
}

module.exports = {
  fetchResortData,
  searchSkiAreas,
};
