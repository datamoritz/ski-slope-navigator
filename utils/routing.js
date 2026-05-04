const { DIFFICULTY, UNKNOWN_DIFFICULTY_WEIGHT } = require("./graph");

const MAX_SCENIC_STATES = 50000;

function buildAdjacency(graph) {
  const adjacency = new Map();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.fromNode)) adjacency.set(edge.fromNode, []);
    adjacency.get(edge.fromNode).push(edge);
  }
  return adjacency;
}

function edgeDifficultyValue(edge) {
  if (edge.type === "lift") return 1;
  return DIFFICULTY[edge.difficulty] || UNKNOWN_DIFFICULTY_WEIGHT;
}

function baseWeight(edge, preference) {
  if (preference === "fastest" || preference === "scenic") {
    return edge.estimatedMinutes || 1;
  }
  return edgeDifficultyValue(edge) * Math.max(1, edge.length_m || 1);
}

function nodeLabelMap(graph) {
  return new Map(graph.nodes.map((node) => [node.id, node.label]));
}

function stateKey(nodeId, seen) {
  return `${nodeId}|${Array.from(seen).sort().join(",")}`;
}

function route(graph, from, to, preference = "easiest") {
  if (!graph.nodes.some((node) => node.id === from)) {
    return { steps: [], totalLifts: 0, totalRuns: 0, totalMinutes: 0, warnings: [`Unknown start node: ${from}`] };
  }
  if (!graph.nodes.some((node) => node.id === to)) {
    return { steps: [], totalLifts: 0, totalRuns: 0, totalMinutes: 0, warnings: [`Unknown destination node: ${to}`] };
  }
  if (from === to) {
    return { steps: [], totalLifts: 0, totalRuns: 0, totalMinutes: 0, warnings: ["Start and target are the same location."] };
  }

  const primary = preference === "scenic" ? scenicRoute(graph, from, to) : simpleRoute(graph, from, to, preference);
  if (primary.steps.length || !isDisconnected(primary)) return primary;

  const fallbackGraph = graphWithReversibleInferredRuns(graph);
  const fallback = preference === "scenic" ? scenicRoute(fallbackGraph, from, to) : simpleRoute(fallbackGraph, from, to, preference);
  if (!fallback.steps.length) return primary;

  return {
    ...fallback,
    warnings: Array.from(
      new Set([
        "Used estimated run direction fallback for one or more slopes. OpenSkiMap direction data may be incomplete.",
        ...fallback.warnings,
      ])
    ),
  };
}

function isDisconnected(result) {
  return result.warnings.some((warning) => /No connected|No connected scenic/.test(warning));
}

function graphWithReversibleInferredRuns(graph) {
  const reverseEdges = graph.edges
    .filter((edge) => edge.type === "run" && edge.directionConfidence === "inferred")
    .map((edge) => ({
      ...edge,
      id: edge.id,
      fromNode: edge.toNode,
      toNode: edge.fromNode,
      geometry: Array.isArray(edge.geometry) ? edge.geometry.slice().reverse() : edge.geometry,
      estimatedMinutes: (edge.estimatedMinutes || 1) * 1.1,
      directionWarning: `Run ${edge.name}: route used opposite of inferred direction because elevation data is unavailable`,
    }));
  return { ...graph, edges: [...graph.edges, ...reverseEdges] };
}

function simpleRoute(graph, from, to, preference) {
  const adjacency = buildAdjacency(graph);
  const distances = new Map([[from, 0]]);
  const previous = new Map();
  const queue = [{ nodeId: from, distance: 0 }];
  const visited = new Set();

  while (queue.length) {
    queue.sort((a, b) => a.distance - b.distance);
    const current = queue.shift();
    if (visited.has(current.nodeId)) continue;
    visited.add(current.nodeId);
    if (current.nodeId === to) break;

    for (const edge of adjacency.get(current.nodeId) || []) {
      const nextDistance = current.distance + baseWeight(edge, preference);
      if (nextDistance < (distances.get(edge.toNode) ?? Infinity)) {
        distances.set(edge.toNode, nextDistance);
        previous.set(edge.toNode, { nodeId: current.nodeId, edge });
        queue.push({ nodeId: edge.toNode, distance: nextDistance });
      }
    }
  }

  if (!previous.has(to) && from !== to) {
    return emptyRoute(graph, "No connected route found between these points.");
  }

  return formatRoute(graph, unwindSteps(previous, from, to));
}

function scenicRoute(graph, from, to) {
  const adjacency = buildAdjacency(graph);
  const startSeen = new Set();
  const startKey = stateKey(from, startSeen);
  const distances = new Map([[startKey, 0]]);
  const previous = new Map();
  const queue = [{ nodeId: from, seen: startSeen, key: startKey, distance: 0 }];
  const visited = new Set();
  let finalKey = "";

  while (queue.length) {
    queue.sort((a, b) => a.distance - b.distance);
    const current = queue.shift();
    if (visited.has(current.key)) continue;
    visited.add(current.key);
    if (visited.size > MAX_SCENIC_STATES) {
      return emptyRoute(graph, "Scenic search reached the 50k state cap. Try easiest or fastest.");
    }
    if (current.nodeId === to) {
      finalKey = current.key;
      break;
    }

    for (const edge of adjacency.get(current.nodeId) || []) {
      const diff = edge.type === "run" ? edge.difficulty || "unknown" : "lift";
      const seenNext = new Set(current.seen);
      const hasSeen = seenNext.has(diff);
      seenNext.add(diff);
      const nextKey = stateKey(edge.toNode, seenNext);
      const nextDistance = current.distance + (edge.estimatedMinutes || 1) * (hasSeen ? 1.5 : 0.7);

      if (nextDistance < (distances.get(nextKey) ?? Infinity)) {
        distances.set(nextKey, nextDistance);
        previous.set(nextKey, { prevKey: current.key, edge });
        queue.push({ nodeId: edge.toNode, seen: seenNext, key: nextKey, distance: nextDistance });
      }
    }
  }

  if (!finalKey && from !== to) {
    return emptyRoute(graph, "No connected scenic route found between these points.");
  }

  const steps = [];
  let key = finalKey;
  while (key && key !== startKey) {
    const item = previous.get(key);
    if (!item) break;
    steps.push(item.edge);
    key = item.prevKey;
  }
  steps.reverse();
  return formatRoute(graph, steps);
}

function unwindSteps(previous, from, to) {
  const steps = [];
  let current = to;
  while (current !== from) {
    const item = previous.get(current);
    if (!item) break;
    steps.push(item.edge);
    current = item.nodeId;
  }
  return steps.reverse();
}

function formatRoute(graph, edges) {
  const labels = nodeLabelMap(graph);
  const warnings = [];
  const steps = edges.map((edge) => {
    if (edge.directionWarning) warnings.push(edge.directionWarning);
    return {
      id: edge.id,
      type: edge.type,
      name: edge.name,
      from: labels.get(edge.fromNode) || "Unknown location",
      to: labels.get(edge.toNode) || "Unknown location",
      difficulty: edge.difficulty,
      liftType: edge.liftType || null,
      occupancy: edge.occupancy ?? null,
      capacity: edge.capacity ?? null,
      durationSeconds: edge.durationSeconds ?? null,
      detachable: edge.detachable ?? null,
      bubble: edge.bubble ?? null,
      heating: edge.heating ?? null,
      estimatedMinutes: Number((edge.estimatedMinutes || 0).toFixed(1)),
      directionConfidence: edge.directionConfidence,
    };
  });

  const totalMinutes = steps.reduce((sum, step) => sum + step.estimatedMinutes, 0);
  return {
    steps,
    totalLifts: steps.filter((step) => step.type === "lift").length,
    totalRuns: steps.filter((step) => step.type === "run").length,
    totalMinutes: Number(totalMinutes.toFixed(1)),
    warnings: Array.from(new Set(warnings)),
  };
}

function emptyRoute(graph, message) {
  return {
    steps: [],
    totalLifts: 0,
    totalRuns: 0,
    totalMinutes: 0,
    warnings: [message],
  };
}

module.exports = {
  route,
};
