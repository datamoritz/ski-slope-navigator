const DIFFICULTY = {
  green: 1,
  blue: 2,
  red: 4,
  black: 8,
  novice: 1,
  easy: 1,
  intermediate: 2,
  advanced: 4,
  expert: 8,
};

const DIFFICULTY_FACTORS = {
  green: 0.8,
  novice: 0.8,
  easy: 0.8,
  blue: 1,
  intermediate: 1,
  red: 1.2,
  advanced: 1.2,
  black: 1.5,
  expert: 1.5,
};

const UNKNOWN_DIFFICULTY_WEIGHT = 4;
const EARTH_RADIUS_M = 6371000;

function toFeatureList(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.features)) return collection.features;
  if (Array.isArray(collection.results)) return collection.results;
  return [];
}

function getProps(feature) {
  return feature?.properties || {};
}

function getName(feature, fallback) {
  const props = getProps(feature);
  return (
    props.name ||
    props["name:en"] ||
    props.ref ||
    props.title ||
    feature?.name ||
    fallback
  );
}

function getCoordinates(feature) {
  const geometry = feature?.geometry || {};
  if (geometry.type === "LineString") return geometry.coordinates || [];
  if (geometry.type === "MultiLineString") return (geometry.coordinates || []).flat();
  return [];
}

function normalizeDifficulty(value) {
  if (!value) return "unknown";
  const text = String(value).toLowerCase().trim();
  if (text.includes(";")) return text.split(";")[0].trim();
  if (text.includes(",")) return text.split(",")[0].trim();
  return text;
}

function difficultyValue(difficulty) {
  return DIFFICULTY[difficulty] || UNKNOWN_DIFFICULTY_WEIGHT;
}

function haversineMeters(a, b) {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function lengthMeters(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += haversineMeters(coordToPoint(coords[i - 1]), coordToPoint(coords[i]));
  }
  return total;
}

function toLatLonGeometry(coords) {
  return coords.map((coord) => {
    const point = coordToPoint(coord);
    return [point.lat, point.lon];
  });
}

function coordToPoint(coord) {
  return {
    lon: Number(coord[0]),
    lat: Number(coord[1]),
    ele: coord.length > 2 && Number.isFinite(Number(coord[2])) ? Number(coord[2]) : null,
  };
}

function roundedKey(point) {
  return `${point.lon.toFixed(4)},${point.lat.toFixed(4)}`;
}

function mergeGroups(nodes, maxDistanceM) {
  const parent = new Map(nodes.map((node) => [node.id, node.id]));

  function find(id) {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(id) !== id) {
      const next = parent.get(id);
      parent.set(id, root);
      id = next;
    }
    return root;
  }

  function union(a, b) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  }

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (haversineMeters(nodes[i], nodes[j]) <= maxDistanceM) {
        union(nodes[i].id, nodes[j].id);
      }
    }
  }

  const groups = new Map();
  for (const node of nodes) {
    const root = find(node.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(node);
  }

  const merged = [];
  const idMap = new Map();
  let index = 1;
  for (const group of groups.values()) {
    const lat = group.reduce((sum, node) => sum + node.lat, 0) / group.length;
    const lon = group.reduce((sum, node) => sum + node.lon, 0) / group.length;
    const labels = group.flatMap((node) => node.labelHints);
    const label = pickBestLabel(labels) || `Junction ${index}`;
    const id = `node_${index}`;
    for (const node of group) idMap.set(node.id, id);
    merged.push({ id, label, lat, lon });
    index += 1;
  }

  return { nodes: merged, idMap };
}

function pickBestLabel(labels) {
  if (!labels.length) return "";
  const topOrBase = labels.find((label) => /^(Top|Base) of /.test(label));
  return topOrBase || labels[0];
}

function getDifficulty(feature) {
  const props = getProps(feature);
  return normalizeDifficulty(
    props["piste:difficulty"] ||
      props.difficulty ||
      props.color ||
      props.colour ||
      props.rating
  );
}

function getDirectionTag(feature) {
  const props = getProps(feature);
  return props.direction || props.oneway || props["piste:oneway"];
}

function getLiftType(feature) {
  const props = getProps(feature);
  return props.liftType || props.aerialway || props["aerialway:type"] || "lift";
}

function getOptionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getLiftMetadata(feature) {
  const props = getProps(feature);
  return {
    liftType: getLiftType(feature),
    occupancy: getOptionalNumber(props.occupancy),
    capacity: getOptionalNumber(props.capacity),
    durationSeconds: getOptionalNumber(props.duration),
    detachable: props.detachable ?? null,
    bubble: props.bubble ?? null,
    heating: props.heating ?? null,
  };
}

function directionFromTag(tag) {
  if (tag === undefined || tag === null) return null;
  const value = String(tag).toLowerCase();
  if (["yes", "true", "1", "forward", "downhill"].includes(value)) return "forward";
  if (["-1", "reverse", "backward", "uphill"].includes(value)) return "reverse";
  return null;
}

function directionForRun(feature, coords, name, warnings) {
  const tagged = directionFromTag(getDirectionTag(feature));
  if (tagged) {
    return { direction: tagged, confidence: "tagged" };
  }

  const first = coordToPoint(coords[0]);
  const last = coordToPoint(coords[coords.length - 1]);
  if (first.ele !== null && last.ele !== null && first.ele !== last.ele) {
    return { direction: first.ele > last.ele ? "forward" : "reverse", confidence: "elevation" };
  }

  const warning = `Run ${name}: direction inferred from geometry order, elevation unavailable`;
  warnings.push(warning);
  return { direction: "forward", confidence: "inferred", warning };
}

function estimateMinutes(type, lengthM, difficulty) {
  if (type === "lift") return Math.max(1, lengthM / 300);
  const factor = DIFFICULTY_FACTORS[difficulty] || 1.2;
  return Math.max(0.5, (lengthM / 833) * factor);
}

function endpointLabel(role, featureName) {
  if (!featureName || /^Unnamed/.test(featureName)) return "";
  return `${role} of ${featureName}`;
}

function createEndpoint(rawNodes, point, labelHint) {
  const key = roundedKey(point);
  if (!rawNodes.has(key)) {
    rawNodes.set(key, {
      id: `raw_${rawNodes.size + 1}`,
      lat: point.lat,
      lon: point.lon,
      labelHints: [],
    });
  }
  const node = rawNodes.get(key);
  if (labelHint) node.labelHints.push(labelHint);
  return node.id;
}

function buildGraph(rawData, options = {}) {
  const warnings = [];
  const rawNodes = new Map();
  const rawEdges = [];
  const runs = toFeatureList(rawData.runs);
  const lifts = toFeatureList(rawData.lifts);
  const unknownDifficulties = new Set();

  for (const feature of lifts) {
    const coords = getCoordinates(feature);
    if (coords.length < 2) continue;
    const name = getName(feature, "Unnamed lift");
    const first = coordToPoint(coords[0]);
    const last = coordToPoint(coords[coords.length - 1]);
    const fromRaw = createEndpoint(rawNodes, first, endpointLabel("Base", name));
    const toRaw = createEndpoint(rawNodes, last, endpointLabel("Top", name));
    const lengthM = lengthMeters(coords);
    const lift = getLiftMetadata(feature);

    rawEdges.push({
      id: `lift_${rawEdges.length + 1}`,
      name,
      type: "lift",
      liftType: lift.liftType,
      occupancy: lift.occupancy,
      capacity: lift.capacity,
      durationSeconds: lift.durationSeconds,
      detachable: lift.detachable,
      bubble: lift.bubble,
      heating: lift.heating,
      difficulty: "lift",
      directionConfidence: "lift",
      length_m: Math.round(lengthM),
      estimatedMinutes: estimateMinutes("lift", lengthM, "lift"),
      geometry: toLatLonGeometry(coords),
      fromRaw,
      toRaw,
    });
  }

  for (const feature of runs) {
    const coords = getCoordinates(feature);
    if (coords.length < 2) continue;
    const name = getName(feature, "Unnamed run");
    const difficulty = getDifficulty(feature);
    if (!DIFFICULTY[difficulty]) {
      unknownDifficulties.add(difficulty);
      warnings.push(`Run ${name}: unknown difficulty "${difficulty}"`);
    }

    const { direction, confidence, warning } = directionForRun(feature, coords, name, warnings);
    const directedCoords = direction === "forward" ? coords : coords.slice().reverse();
    const first = coordToPoint(coords[0]);
    const last = coordToPoint(coords[coords.length - 1]);
    const fromRaw = createEndpoint(rawNodes, direction === "forward" ? first : last, endpointLabel("Top", name));
    const toRaw = createEndpoint(rawNodes, direction === "forward" ? last : first, `Junction near ${name}`);
    const lengthM = lengthMeters(coords);

    rawEdges.push({
      id: `run_${rawEdges.length + 1}`,
      name,
      type: "run",
      difficulty,
      directionConfidence: confidence,
      directionWarning: warning || "",
      length_m: Math.round(lengthM),
      estimatedMinutes: estimateMinutes("run", lengthM, difficulty),
      geometry: toLatLonGeometry(directedCoords),
      fromRaw,
      toRaw,
    });
  }

  const rawNodeList = Array.from(rawNodes.values());
  const beforeMerge = rawNodeList.length;
  const { nodes, idMap } = mergeGroups(rawNodeList, options.snapDistanceM || 80);
  const edges = rawEdges.map(({ fromRaw, toRaw, ...edge }) => ({
    ...edge,
    fromNode: idMap.get(fromRaw),
    toNode: idMap.get(toRaw),
  }));

  const resortName = rawData.name || rawData.resort_name || rawData.ski_area_name || "Unnamed resort";
  const slug = rawData.slug || "";
  const stats = {
    nodesBeforeMerge: beforeMerge,
    nodesAfterMerge: nodes.length,
    nodesMerged: beforeMerge - nodes.length,
    edgeCount: edges.length,
    runCount: edges.filter((edge) => edge.type === "run").length,
    liftCount: edges.filter((edge) => edge.type === "lift").length,
    directionWarningCount: warnings.filter((warning) => warning.includes("direction inferred")).length,
    unknownDifficulties: Array.from(unknownDifficulties),
  };

  return {
    version: 1,
    source: rawData.source || "openskimap",
    ski_area_id: rawData.ski_area_id || "",
    slug,
    resortName,
    createdAt: new Date().toISOString(),
    nodes,
    edges,
    warnings,
    stats,
  };
}

module.exports = {
  DIFFICULTY,
  UNKNOWN_DIFFICULTY_WEIGHT,
  buildGraph,
  difficultyValue,
  haversineMeters,
};
