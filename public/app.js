const state = {
  resort: null,
  nodes: [],
  map: null,
  mapData: null,
  graphLayer: null,
  nodeLayer: null,
  selectionLayer: null,
  routeLayer: null,
  hoverLayer: null,
  activeTooltip: null,
  edgeLayers: new Map(),
  nodeMarkers: new Map(),
  nextPick: "start",
};

const els = {
  homeButton: document.querySelector("#homeButton"),
  searchInput: document.querySelector("#searchInput"),
  searchButton: document.querySelector("#searchButton"),
  searchStatus: document.querySelector("#searchStatus"),
  searchResults: document.querySelector("#searchResults"),
  cachedResorts: document.querySelector("#cachedResorts"),
  refreshCached: document.querySelector("#refreshCached"),
  resortTitle: document.querySelector("#resortTitle"),
  stats: document.querySelector("#stats"),
  debugLink: document.querySelector("#debugLink"),
  fromInput: document.querySelector("#fromInput"),
  toInput: document.querySelector("#toInput"),
  fromSelect: document.querySelector("#fromSelect"),
  toSelect: document.querySelector("#toSelect"),
  nodeOptions: document.querySelector("#nodeOptions"),
  routeButton: document.querySelector("#routeButton"),
  routeStatus: document.querySelector("#routeStatus"),
  routeTitle: document.querySelector("#routeTitle"),
  summary: document.querySelector("#summary"),
  routeWarning: document.querySelector("#routeWarning"),
  steps: document.querySelector("#steps"),
  anotherRoute: document.querySelector("#anotherRoute"),
  mapPanel: document.querySelector("#mapPanel"),
  mapTitle: document.querySelector("#mapTitle"),
  resortMap: document.querySelector("#resortMap"),
  mapStatus: document.querySelector("#mapStatus"),
  pickStatus: document.querySelector("#pickStatus"),
  hoverInfo: document.querySelector("#hoverInfo"),
};

function showView(id) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === id);
  });
  els.mapPanel.classList.toggle("hidden", id === "viewSelector" || !state.mapData);
  if (state.map && id !== "viewSelector") {
    window.setTimeout(() => state.map.invalidateSize(), 80);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function sourceLabel(source) {
  return source === "manual_upload" ? "Manual upload" : "OpenSkiMap";
}

function renderBadge(source) {
  return `<span class="badge ${source || "openskimap"}">${sourceLabel(source)}</span>`;
}

function setStatus(element, message) {
  element.textContent = message || "";
}

function humanizeLiftType(value) {
  if (!value) return "Lift";
  const labels = {
    cable_car: "Cable car",
    chair_lift: "Chairlift",
    drag_lift: "Drag lift",
    funicular: "Funicular",
    gondola: "Gondola",
    magic_carpet: "Magic carpet",
    mixed_lift: "Mixed lift",
    platter: "Platter lift",
    railway: "Railway",
    rope_tow: "Rope tow",
    t_bar: "T-bar",
    "t-bar": "T-bar",
  };
  return labels[value] || String(value).replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function liftIconType(value) {
  const type = String(value || "").toLowerCase();
  if (type.includes("gondola")) return "gondola";
  if (type.includes("cable")) return "cable";
  if (type.includes("chair")) return "chair";
  if (type.includes("rail") || type.includes("funicular")) return "rail";
  if (type.includes("carpet")) return "carpet";
  if (type.includes("t_bar") || type.includes("t-bar") || type.includes("platter") || type.includes("drag") || type.includes("rope")) return "drag";
  return "lift";
}

function renderLiftIcon(liftType) {
  const iconType = liftIconType(liftType);
  const icons = {
    gondola: `
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path class="lift-cable" d="M4 7.5 28 4.5" />
        <path class="lift-hanger" d="M16 6v6" />
        <rect class="lift-body" x="9" y="12" width="14" height="12" rx="4" />
        <path class="lift-window" d="M12 16h8" />
      </svg>
    `,
    cable: `
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path class="lift-cable" d="M4 7.5 28 4.5" />
        <path class="lift-hanger" d="M16 6v5" />
        <rect class="lift-body" x="7" y="11" width="18" height="12" rx="3" />
        <path class="lift-window" d="M10 15h12" />
      </svg>
    `,
    chair: `
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path class="lift-cable" d="M4 7.5 28 4.5" />
        <path class="lift-hanger" d="M16 6v8" />
        <path class="lift-seat" d="M10 15v7h12" />
        <path class="lift-seat" d="M13 22v3M22 22v3" />
      </svg>
    `,
    drag: `
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path class="lift-cable" d="M4 7.5 28 4.5" />
        <path class="lift-hanger" d="M17 6v14" />
        <path class="lift-seat" d="m17 20 6 4" />
      </svg>
    `,
    rail: `
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect class="lift-body" x="8" y="8" width="16" height="10" rx="3" />
        <path class="lift-window" d="M11 12h10" />
        <path class="lift-cable" d="M6 23h20M8 27h16" />
      </svg>
    `,
    carpet: `
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path class="lift-body" d="M6 20c6-4 14-4 20 0v4H6z" />
        <path class="lift-window" d="M9 20h14" />
        <path class="lift-cable" d="M8 26h16" />
      </svg>
    `,
    lift: `
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path class="lift-cable" d="M4 7.5 28 4.5" />
        <path class="lift-hanger" d="M16 6v7" />
        <rect class="lift-body" x="11" y="13" width="10" height="11" rx="3" />
      </svg>
    `,
  };
  return `<span class="lift-icon lift-icon-${iconType}" aria-hidden="true">${icons[iconType] || icons.lift}</span>`;
}

function liftDetail(step) {
  if (step.type !== "lift") return "";
  const parts = [humanizeLiftType(step.liftType)];
  if (step.occupancy) parts.push(`${step.occupancy}-person`);
  if (step.capacity) parts.push(`${step.capacity}/h`);
  return `<span class="lift-detail">${escapeHtml(parts.join(" · "))}</span>`;
}

function setMapStatus(message) {
  els.mapStatus.textContent = message || "";
}

function updatePickStatus() {
  const next = state.nextPick === "start" ? "START" : "TARGET";
  els.pickStatus.textContent = `Click a dot or nearby map point to set ${next}.`;
}

function setHoverInfo(message) {
  if (els.hoverInfo) {
    els.hoverInfo.textContent = message || "Hover a lift, run, route, or dot for details.";
  }
}

function middlePoint(points) {
  if (!Array.isArray(points) || !points.length) return null;
  return points[Math.floor((points.length - 1) / 2)];
}

function showMapLabel(message, latlng) {
  if (!state.map || !latlng) return;
  hideMapLabel();
  state.activeTooltip = L.tooltip({
    direction: "top",
    opacity: 0.99,
    pane: "tooltipPane",
    className: "map-hover-label",
  })
    .setLatLng(latlng)
    .setContent(escapeHtml(message))
    .addTo(state.map);
}

function hideMapLabel() {
  if (state.activeTooltip && state.map) {
    state.map.removeLayer(state.activeTooltip);
  }
  state.activeTooltip = null;
}

function difficultyColor(difficulty) {
  const value = String(difficulty || "unknown").toLowerCase();
  if (["green", "easy", "novice"].includes(value)) return "#16a34a";
  if (["blue", "intermediate"].includes(value)) return "#2563eb";
  if (["red", "advanced"].includes(value)) return "#dc2626";
  if (["black", "expert"].includes(value)) return "#111827";
  return "#64748b";
}

function edgeStyle(edge, highlighted = false) {
  if (highlighted) {
    return {
      color: "#f59e0b",
      weight: 9,
      opacity: 0.96,
      lineCap: "round",
      lineJoin: "round",
      pane: "routePane",
      bubblingMouseEvents: false,
    };
  }

  if (edge.type === "lift") {
    return {
      color: "#8b5cf6",
      weight: 4,
      opacity: 0.88,
      dashArray: "7 7",
      lineCap: "round",
      lineJoin: "round",
      pane: "liftPane",
      bubblingMouseEvents: false,
    };
  }

  return {
    color: difficultyColor(edge.difficulty),
    weight: 3,
    opacity: 0.78,
    lineCap: "round",
    lineJoin: "round",
    pane: "runPane",
    bubblingMouseEvents: false,
  };
}

function edgeTooltip(edge) {
  const detail = edge.type === "lift" ? humanizeLiftType(edge.liftType) : edge.difficulty || "unknown";
  const type = edge.type === "lift" ? "Lift" : "Run";
  return `${edge.name || "Unnamed"} · ${type} · ${detail}`;
}

function nodeTooltip(node) {
  return `Junction · ${node.label}`;
}

function ensureMap() {
  if (state.map) return true;
  if (!window.L) {
    setMapStatus("Map library could not load. Check your internet connection for Leaflet assets.");
    return false;
  }

  state.map = L.map(els.resortMap, {
    zoomControl: true,
    scrollWheelZoom: true,
  });
  state.map.createPane("runPane");
  state.map.createPane("liftPane");
  state.map.createPane("routePane");
  state.map.createPane("hoverPane");
  state.map.createPane("selectionPane");
  state.map.getPane("runPane").style.zIndex = 410;
  state.map.getPane("liftPane").style.zIndex = 520;
  state.map.getPane("routePane").style.zIndex = 620;
  state.map.getPane("hoverPane").style.zIndex = 680;
  state.map.getPane("selectionPane").style.zIndex = 700;

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);

  state.graphLayer = L.layerGroup().addTo(state.map);
  state.nodeLayer = L.layerGroup().addTo(state.map);
  state.selectionLayer = L.layerGroup().addTo(state.map);
  state.routeLayer = L.layerGroup().addTo(state.map);
  state.hoverLayer = L.layerGroup().addTo(state.map);
  state.map.on("click", handleMapClick);
  return true;
}

async function loadMap(slug) {
  state.mapData = null;
  state.edgeLayers.clear();
  els.mapPanel.classList.remove("hidden");
  setMapStatus("Loading map...");
  if (!ensureMap()) return;

  const data = await api(`/api/resort/${encodeURIComponent(slug)}/map`);
  state.mapData = data;
  els.mapTitle.textContent = `${data.name} map`;
  renderMap(data);
  setMapStatus("");
}

function renderMap(data) {
  state.graphLayer.clearLayers();
  state.nodeLayer.clearLayers();
  state.selectionLayer.clearLayers();
  state.routeLayer.clearLayers();
  state.hoverLayer.clearLayers();
  hideMapLabel();
  state.edgeLayers.clear();
  state.nodeMarkers.clear();
  state.nextPick = "start";
  updatePickStatus();
  setHoverInfo("");

  const bounds = [];

  for (const edge of data.edges) {
    if (!Array.isArray(edge.geometry) || edge.geometry.length < 2) continue;
    const line = L.polyline(edge.geometry, edgeStyle(edge));
    line.bindPopup(`<strong>${escapeHtml(edge.name)}</strong><br>${escapeHtml(edgeTooltip(edge))}`);
    line.addTo(state.graphLayer);

    const showEdgeHover = () => {
      setHoverInfo(edgeTooltip(edge));
      showMapLabel(edgeTooltip(edge), middlePoint(edge.geometry));
      line.setStyle({ weight: edge.type === "lift" ? 6 : 5, opacity: 1 });
    };
    const hideEdgeHover = () => {
      setHoverInfo("");
      hideMapLabel();
      line.setStyle(edgeStyle(edge));
    };
    const hitLine = L.polyline(edge.geometry, {
      color: "#000000",
      weight: edge.type === "lift" ? 18 : 14,
      opacity: 0.01,
      lineCap: "round",
      lineJoin: "round",
      pane: "hoverPane",
      bubblingMouseEvents: false,
    });
    hitLine.on("mouseover", showEdgeHover);
    hitLine.on("mouseout", hideEdgeHover);
    hitLine.on("click", handleMapClick);
    hitLine.addTo(state.hoverLayer);
    line.on("mouseover", showEdgeHover);
    line.on("mouseout", hideEdgeHover);
    state.edgeLayers.set(edge.id, { edge, line });
    edge.geometry.forEach((point) => bounds.push(point));
  }

  for (const node of data.nodes) {
    if (!Number.isFinite(node.lat) || !Number.isFinite(node.lon)) continue;
    const marker = L.circleMarker([node.lat, node.lon], {
      radius: 3,
      color: "#ffffff",
      weight: 1,
      fillColor: "#17211d",
      fillOpacity: 0.78,
      opacity: 0.88,
      pane: "selectionPane",
      bubblingMouseEvents: false,
    });
    marker.on("mouseover", () => {
      setHoverInfo(nodeTooltip(node));
      showMapLabel(nodeTooltip(node), [node.lat, node.lon]);
    });
    marker.on("mouseout", () => {
      setHoverInfo("");
      hideMapLabel();
    });
    marker.on("click", (event) => {
      event.originalEvent?.stopPropagation();
      pickNode(node);
    });
    marker.addTo(state.nodeLayer);
    state.nodeMarkers.set(node.id, marker);
    bounds.push([node.lat, node.lon]);
  }

  if (bounds.length) {
    state.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
  }
  window.setTimeout(() => state.map.invalidateSize(), 80);
  highlightSelection();
}

function findNode(id) {
  return state.mapData?.nodes.find((node) => node.id === id);
}

function nodeById(id) {
  return state.nodes.find((node) => node.id === id);
}

function syncNodeInputs() {
  const from = nodeById(els.fromSelect.value);
  const to = nodeById(els.toSelect.value);
  els.fromInput.value = from?.label || "";
  els.toInput.value = to?.label || "";
}

function addSelectionMarker(node, kind) {
  if (!node) return;
  const color = kind === "start" ? "#16a34a" : "#dc2626";
  const label = kind === "start" ? "Start" : "End";
  L.circleMarker([node.lat, node.lon], {
    radius: 7,
    color: "#ffffff",
    weight: 2,
    fillColor: color,
    fillOpacity: 0.95,
    pane: "selectionPane",
    bubblingMouseEvents: false,
  })
    .on("mouseover", () => showMapLabel(`${label}: ${node.label}`, [node.lat, node.lon]))
    .on("mouseout", hideMapLabel)
    .on("click", (event) => {
      event.originalEvent?.stopPropagation();
      pickNode(node);
    })
    .addTo(state.selectionLayer);
}

function highlightSelection() {
  if (!state.map || !state.mapData) return;
  state.selectionLayer.clearLayers();
  addSelectionMarker(findNode(els.fromSelect.value), "start");
  addSelectionMarker(findNode(els.toSelect.value), "end");
  syncNodeInputs();
  updatePickStatus();
}

function highlightRoute(result) {
  if (!state.map || !state.mapData) return;
  state.routeLayer.clearLayers();
  const bounds = [];

  for (const step of result.steps || []) {
    const item = state.edgeLayers.get(step.id);
    if (!item?.edge?.geometry?.length) continue;
    const routeLabel = `Route: ${step.name} · ${step.type}`;
    const routeLine = L.polyline(item.edge.geometry, edgeStyle(item.edge, true))
      .bindPopup(`<strong>${escapeHtml(step.name)}</strong><br>Route step · ${escapeHtml(step.type)}`)
      .addTo(state.routeLayer);
    routeLine.on("mouseover", () => {
      setHoverInfo(routeLabel);
      showMapLabel(routeLabel, middlePoint(item.edge.geometry));
    });
    routeLine.on("mouseout", () => {
      setHoverInfo("");
      hideMapLabel();
    });
    routeLine.on("click", handleMapClick);
    item.edge.geometry.forEach((point) => bounds.push(point));
  }

  highlightSelection();
  if (bounds.length) {
    state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }
}

function pickNode(node) {
  if (!node) return;
  if (state.nextPick === "start") {
    els.fromSelect.value = node.id;
    state.nextPick = "target";
  } else {
    els.toSelect.value = node.id;
    state.nextPick = "start";
  }
  state.routeLayer?.clearLayers();
  highlightSelection();
}

function findNearestNode(latlng) {
  if (!state.mapData?.nodes.length || !state.map) return null;
  let best = null;
  let bestDistance = Infinity;
  const clickPoint = state.map.latLngToContainerPoint(latlng);
  for (const node of state.mapData.nodes) {
    const point = state.map.latLngToContainerPoint([node.lat, node.lon]);
    const distance = clickPoint.distanceTo(point);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }
  return bestDistance <= 40 ? best : null;
}

function handleMapClick(event) {
  event.originalEvent?.stopPropagation();
  const node = findNearestNode(event.latlng);
  if (node) {
    pickNode(node);
  } else {
    setMapStatus("Click closer to a black dot to choose a start or target location.");
    window.setTimeout(() => setMapStatus(""), 2200);
  }
}

async function search() {
  const query = els.searchInput.value.trim();
  if (query.length < 2) {
    setStatus(els.searchStatus, "Type at least two characters.");
    return;
  }

  els.searchResults.innerHTML = "";
  setStatus(els.searchStatus, "Searching OpenSkiMap...");
  try {
    const results = await api(`/api/search?q=${encodeURIComponent(query)}`);
    setStatus(els.searchStatus, results.length ? `${results.length} resort candidates found.` : "No OpenSkiMap results. Upload fallback arrives in v2.");
    els.searchResults.innerHTML = results
      .map(
        (result) => `
          <article class="result-item">
            <div>
              <h3>${escapeHtml(result.name)}</h3>
              <p>${escapeHtml([result.region, result.country].filter(Boolean).join(" · ") || result.id)}</p>
            </div>
            <button data-load='${escapeAttr(JSON.stringify({ id: result.id, name: result.name }))}'>Load</button>
          </article>
        `
      )
      .join("");
  } catch (error) {
    setStatus(els.searchStatus, error.message);
  }
}

async function loadResort(id, name) {
  setStatus(els.searchStatus, `Loading ${name}...`);
  try {
    const resort = await api("/api/load", {
      method: "POST",
      body: JSON.stringify({ ski_area_id: id, name }),
    });
    await openResort(resort);
    await loadCachedResorts();
  } catch (error) {
    setStatus(els.searchStatus, error.message);
  }
}

async function openResort(resort) {
  state.resort = resort;
  els.resortTitle.textContent = resort.name;
  els.debugLink.href = `/api/debug/${encodeURIComponent(resort.slug)}`;
  renderStats(resort);
  setStatus(els.routeStatus, "Loading locations...");
  state.nodes = await api(`/api/resort/${encodeURIComponent(resort.slug)}/nodes`);
  populateNodeSelects(state.nodes);
  setStatus(els.routeStatus, "");
  showView("viewLoaded");
  await loadMap(resort.slug);
}

function renderStats(resort) {
  els.stats.innerHTML = [
    ["lifts", resort.lifts],
    ["runs", resort.runs],
    ["locations", resort.locations],
  ]
    .map(([label, value]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");
}

function populateNodeSelects(nodes) {
  const sorted = nodes.slice().sort((a, b) => a.label.localeCompare(b.label));
  const options = sorted.map((node) => `<option value="${escapeAttr(node.id)}">${escapeHtml(node.label)}</option>`).join("");
  els.fromSelect.innerHTML = options;
  els.toSelect.innerHTML = options;
  els.nodeOptions.innerHTML = sorted.map((node) => `<option value="${escapeAttr(node.label)}"></option>`).join("");
  if (nodes.length > 1) els.toSelect.selectedIndex = 1;
  syncNodeInputs();
}

function resolveNodeSearch(value) {
  const query = normalizeSearchText(value);
  if (!query) return null;
  return (
    state.nodes.find((node) => normalizeSearchText(node.label) === query) ||
    state.nodes.find((node) => normalizeSearchText(node.label).includes(query))
  );
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function applyNodeSearch(kind) {
  const input = kind === "from" ? els.fromInput : els.toInput;
  const select = kind === "from" ? els.fromSelect : els.toSelect;
  const node = resolveNodeSearch(input.value);
  if (!node) {
    setStatus(els.routeStatus, `No matching ${kind === "from" ? "start" : "target"} location.`);
    return false;
  }
  select.value = node.id;
  input.value = node.label;
  state.routeLayer?.clearLayers();
  highlightSelection();
  setStatus(els.routeStatus, "");
  return true;
}

async function loadCachedResorts() {
  try {
    const resorts = await api("/api/resorts");
    els.cachedResorts.innerHTML = resorts.length
      ? resorts
          .map(
            (resort) => `
              <article class="cached-item">
                <div>
                  <h3>${escapeHtml(resort.name)}</h3>
                  <p>${resort.lifts} lifts · ${resort.runs} runs · ${resort.locations} locations</p>
                </div>
                <div>
                  ${renderBadge(resort.source)}
                  <button data-open="${escapeAttr(resort.slug)}">Open</button>
                </div>
              </article>
            `
          )
          .join("")
      : `<p class="status">No cached resorts yet.</p>`;
  } catch (error) {
    els.cachedResorts.innerHTML = `<p class="status">${escapeHtml(error.message)}</p>`;
  }
}

async function openCached(slug) {
  try {
    const debug = await api(`/api/debug/${encodeURIComponent(slug)}`);
    await openResort({
      slug,
      name: debug.name,
      source: debug.source,
      lifts: debug.stats?.liftCount || 0,
      runs: debug.stats?.runCount || 0,
      locations: debug.nodeCount,
      warnings: debug.warnings?.length || 0,
    });
  } catch (error) {
    els.cachedResorts.innerHTML = `<p class="status">${escapeHtml(error.message)}</p>`;
  }
}

async function findRoute() {
  if (!state.resort) return;
  if (!applyNodeSearch("from") || !applyNodeSearch("to")) return;
  const preference = document.querySelector("input[name='preference']:checked").value;
  setStatus(els.routeStatus, "Finding route...");
  try {
    const result = await api("/api/route", {
      method: "POST",
      body: JSON.stringify({
        slug: state.resort.slug,
        from: els.fromSelect.value,
        to: els.toSelect.value,
        preference,
      }),
    });
    renderRoute(result);
    showView("viewResult");
    highlightRoute(result);
  } catch (error) {
    setStatus(els.routeStatus, error.message);
  }
}

function renderRoute(result) {
  els.routeTitle.textContent = state.resort?.name || "Suggested route";
  els.summary.innerHTML = [
    ["total lifts", result.totalLifts],
    ["total runs", result.totalRuns],
    ["minutes", result.totalMinutes],
  ]
    .map(([label, value]) => `<div class="summary-item"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");

  const inferred = result.steps.some((step) => step.directionConfidence === "inferred");
  els.routeWarning.classList.toggle("hidden", !inferred);

  if (!result.steps.length) {
    els.steps.innerHTML = `<li class="warning">${escapeHtml(result.warnings?.[0] || "No route found.")}</li>`;
    return;
  }

  els.steps.innerHTML = result.steps
    .map((step) => {
      const icon = step.type === "lift" ? renderLiftIcon(step.liftType) : `<span class="run-arrow" aria-hidden="true">↓</span>`;
      const difficulty = step.type === "lift" ? "" : `<span class="badge difficulty ${escapeAttr(step.difficulty)}">${escapeHtml(step.difficulty)}</span>`;
      return `
        <li class="step">
          <span class="step-icon">${icon}</span>
          <div>
            <h3>${escapeHtml(step.name)}</h3>
            <p>${escapeHtml(step.from)} → ${escapeHtml(step.to)}</p>
            ${liftDetail(step)}
          </div>
          <div>
            ${difficulty}
            <p>${step.estimatedMinutes} min</p>
          </div>
        </li>
      `;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

els.searchButton.addEventListener("click", search);
els.searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") search();
});

els.searchResults.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-load]");
  if (!button) return;
  const data = JSON.parse(button.dataset.load);
  loadResort(data.id, data.name);
});

els.cachedResorts.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-open]");
  if (button) openCached(button.dataset.open);
});

els.refreshCached.addEventListener("click", loadCachedResorts);
els.routeButton.addEventListener("click", findRoute);
els.anotherRoute.addEventListener("click", () => showView("viewLoaded"));
els.homeButton.addEventListener("click", () => showView("viewSelector"));
els.fromSelect.addEventListener("change", () => {
  state.routeLayer?.clearLayers();
  highlightSelection();
});
els.toSelect.addEventListener("change", () => {
  state.routeLayer?.clearLayers();
  highlightSelection();
});
els.fromInput.addEventListener("change", () => applyNodeSearch("from"));
els.toInput.addEventListener("change", () => applyNodeSearch("to"));
els.fromInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    applyNodeSearch("from");
  }
});
els.toInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    applyNodeSearch("to");
  }
});

loadCachedResorts();
