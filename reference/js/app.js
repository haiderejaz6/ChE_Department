/* ================================================================
   Reference knowledge-unit ontology viewer.

   Two views over the same hierarchy (Area -> Unit -> Topic):
     tree     d3 collapsible tree, zoom + pan, works with touch
     outline  nested accordion, the readable option on a phone

   Data comes from pipeline/reference_ontology.json. That file is the
   research artifact; this page only renders it.
================================================================ */

const DATA_URL = "../pipeline/reference_ontology.json";

let RAW = null;         // parsed JSON
let ROOT = null;        // d3.hierarchy root
let VIEW = "tree";
let CORE_ONLY = false;
let QUERY = "";
let AREA_COLOR = {};    // KA id -> colour

let svg, gRoot, gLinks, gNodes, zoomBehavior;
let nodeIdSeq = 0;

/* ── Boot ─────────────────────────────────────────────────────── */

async function init() {
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    RAW = await res.json();
  } catch (err) {
    document.getElementById("rf-loading").innerHTML =
      `Could not load the reference ontology.<br><span style="font-size:.72rem;color:var(--dim)">` +
      `${DATA_URL} — ${err.message}</span>`;
    return;
  }

  buildColors();
  renderHeaderStats();
  buildTree();
  buildOutline();
  wireSearch();
  document.getElementById("rf-loading").style.display = "none";

  window.addEventListener("resize", debounce(() => {
    if (VIEW === "tree") drawTree();
  }, 180));
}

function buildColors() {
  // Span the site's existing gold -> indigo range so this page sits with the rest.
  const n = RAW.areas.length;
  const scale = d3.quantize(d3.interpolateHsl("#c9981a", "#4f46e5"), Math.max(n, 2));
  RAW.areas.forEach((a, i) => { AREA_COLOR[a.id] = scale[i]; });
}

function renderHeaderStats() {
  const units  = RAW.areas.flatMap(a => a.units);
  const topics = units.flatMap(u => u.topics || []);
  const core   = units.filter(u => u.core).length;
  document.getElementById("hdr-stats").innerHTML = `
    <div class="stat"><b>${RAW.areas.length}</b><span>areas</span></div>
    <div class="stat"><b>${units.length}</b><span>units</span></div>
    <div class="stat"><b>${core}</b><span>core</span></div>
    <div class="stat"><b>${topics.length}</b><span>topics</span></div>`;
}

/* ── Shared filtering ─────────────────────────────────────────── */

function matches(text) {
  return QUERY && text && text.toLowerCase().includes(QUERY);
}

/** A unit is visible when it passes the core filter and matches the query
 *  (directly, or through its area or one of its topics). */
function unitVisible(area, unit) {
  if (CORE_ONLY && !unit.core) return false;
  if (!QUERY) return true;
  if (matches(unit.name) || matches(unit.description) || matches(unit.id)) return true;
  if (matches(area.name)) return true;
  return (unit.topics || []).some(t => matches(t.name) || matches(t.description) || matches(t.id));
}

function areaVisible(area) {
  return area.units.some(u => unitVisible(area, u));
}

function countHits() {
  let u = 0, t = 0;
  RAW.areas.forEach(a => a.units.forEach(unit => {
    if (!unitVisible(a, unit)) return;
    u++;
    (unit.topics || []).forEach(top => {
      if (!QUERY || matches(top.name) || matches(top.description) || matches(top.id)) t++;
    });
  }));
  return { units: u, topics: t };
}

/* ── Tree view ────────────────────────────────────────────────── */

function treeData() {
  const areas = RAW.areas.filter(areaVisible).map(a => ({
    kind: "area", id: a.id, name: a.name, description: a.description,
    rationale: a.rationale, color: AREA_COLOR[a.id],
    children: a.units.filter(u => unitVisible(a, u)).map(u => ({
      kind: "unit", id: u.id, name: u.name, description: u.description,
      core: u.core, bloom: u.expected_bloom, color: AREA_COLOR[a.id],
      areaName: a.name, areaId: a.id,
      children: (u.topics || []).map(t => ({
        kind: "topic", id: t.id, name: t.name, description: t.description,
        color: AREA_COLOR[a.id], areaId: a.id, unitId: u.id, unitName: u.name,
      })),
    })),
  }));
  return { kind: "root", id: "ChE", name: "Chemical Engineering", children: areas };
}

function buildTree() {
  svg = d3.select("#rf-svg");
  gRoot  = svg.append("g");
  gLinks = gRoot.append("g").attr("class", "rf-links");
  gNodes = gRoot.append("g").attr("class", "rf-nodes");

  zoomBehavior = d3.zoom()
    .scaleExtent([0.15, 3])
    .on("zoom", ev => gRoot.attr("transform", ev.transform));
  svg.call(zoomBehavior);

  rebuildHierarchy();
  expandTo(2);            // areas + units open, topics collapsed
}

function rebuildHierarchy() {
  ROOT = d3.hierarchy(treeData());
  ROOT.x0 = 0; ROOT.y0 = 0;
  ROOT.descendants().forEach(d => { d._uid = ++nodeIdSeq; });
}

/** Collapse everything deeper than `depth` (1 = areas, 2 = units, 3 = topics). */
function expandTo(depth) {
  if (!ROOT) return;
  ROOT.each(d => {
    const kids = d.children || d._children;
    if (!kids) return;
    if (d.depth < depth) { d.children = kids; d._children = null; }
    else                 { d._children = kids; d.children = null; }
  });
  drawTree(true);
}

function toggleNode(d) {
  if (d.children)       { d._children = d.children; d.children = null; }
  else if (d._children) { d.children = d._children; d._children = null; }
  drawTree();
}

function drawTree(fit = false) {
  if (!ROOT) return;
  const canvas = document.getElementById("rf-canvas");
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;

  const layout = d3.tree().nodeSize([26, 272]);
  layout(ROOT);

  const nodes = ROOT.descendants();
  const links = ROOT.links();

  // ── links ──
  const link = gLinks.selectAll("path").data(links, d => d.target._uid);
  link.exit().remove();
  link.enter().append("path")
      .attr("class", "rf-link")
    .merge(link)
      .transition().duration(280)
      .attr("d", d3.linkHorizontal().x(d => d.y).y(d => d.x));

  // ── nodes ──
  const node = gNodes.selectAll("g.rf-node").data(nodes, d => d._uid);
  node.exit().remove();

  const enter = node.enter().append("g")
    .attr("class", "rf-node")
    .attr("transform", d => `translate(${d.y},${d.x})`)
    .on("click", (ev, d) => {
      ev.stopPropagation();
      if (d.data.kind !== "root") openPanel(d.data);
      if (d.children || d._children) toggleNode(d);
    });

  enter.append("rect").attr("class", "rf-node-box");
  enter.append("text").attr("class", "rf-node-id");
  enter.append("text").attr("class", "rf-node-label");
  enter.append("circle").attr("class", "rf-toggle-bg");
  enter.append("text").attr("class", "rf-toggle");
  enter.append("text").attr("class", "rf-count");

  const all = enter.merge(node);

  all.transition().duration(280)
     .attr("transform", d => `translate(${d.y},${d.x})`);

  all.each(function (d) {
    const g = d3.select(this);
    const kind = d.data.kind;
    const isRoot  = kind === "root";
    const isArea  = kind === "area";
    const isTopic = kind === "topic";

    const label = truncate(d.data.name, isTopic ? 30 : 34);
    const w = Math.max(96, label.length * (isArea ? 7.4 : 6.6) + (isRoot ? 26 : 44));
    const h = isArea ? 24 : 20;

    g.select(".rf-node-box")
      .attr("x", -w / 2).attr("y", -h / 2)
      .attr("width", w).attr("height", h)
      .attr("fill", isRoot ? "#18263e" : isArea ? d.data.color : isTopic ? "#ffffff" : "#fbfcff")
      .attr("stroke", isRoot ? "#18263e" : d.data.color)
      .attr("opacity", isTopic ? 0.96 : 1);

    g.select(".rf-node-label")
      .attr("x", isRoot ? 0 : -w / 2 + 8)
      .attr("text-anchor", isRoot ? "middle" : "start")
      .attr("y", isArea || isRoot ? 0 : -0.5)
      .style("font-size", isArea ? "11.5px" : isTopic ? "9.6px" : "10.4px")
      .style("font-weight", isArea || isRoot ? 600 : 500)
      .style("fill", isRoot || isArea ? "#ffffff" : "var(--tx)")
      .text(label);

    // id badge, right-aligned inside the box
    g.select(".rf-node-id")
      .attr("x", w / 2 - 7).attr("text-anchor", "end").attr("y", 0)
      .style("fill", isArea ? "rgba(255,255,255,.75)" : "var(--dim)")
      .style("font-size", isArea ? "8.5px" : "8px")
      .text(isRoot ? "" : d.data.id);

    // collapsed-children affordance
    const hidden = d._children ? d._children.length : 0;
    g.select(".rf-toggle-bg")
      .attr("cx", w / 2 + 9).attr("cy", 0).attr("r", hidden ? 7.5 : 0)
      .attr("fill", d.data.color || "#18263e");
    g.select(".rf-toggle")
      .attr("x", w / 2 + 9).attr("y", 0)
      .text(hidden ? hidden : "");
    g.select(".rf-count").attr("x", 0).attr("y", 0).text("");

    g.classed("match", QUERY && (matches(d.data.name) || matches(d.data.id)));
  });

  if (fit) resetZoom();
}

function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n - 1) + "…" : (s || "");
}

/* ── Zoom controls ────────────────────────────────────────────── */

function zoomBy(k) {
  svg.transition().duration(220).call(zoomBehavior.scaleBy, k);
}

function resetZoom() {
  if (!ROOT) return;
  const canvas = document.getElementById("rf-canvas");
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const nodes = ROOT.descendants();
  if (!nodes.length || !W || !H) return;

  const xs = nodes.map(d => d.x), ys = nodes.map(d => d.y);
  const x0 = Math.min(...xs) - 40, x1 = Math.max(...xs) + 40;
  const y0 = Math.min(...ys) - 130, y1 = Math.max(...ys) + 200;
  const bw = y1 - y0, bh = x1 - x0;

  const k = Math.min(W / bw, H / bh, 1.1);
  const tx = (W - k * (y0 + y1)) / 2;
  const ty = (H - k * (x0 + x1)) / 2;

  svg.transition().duration(340)
     .call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
}

/* ── Outline view ─────────────────────────────────────────────── */

function buildOutline() {
  const host = document.getElementById("rf-outline");
  const areas = RAW.areas.filter(areaVisible);

  if (!areas.length) {
    host.innerHTML = `<div class="rf-empty">Nothing matches “${escapeHtml(QUERY)}”.</div>`;
    return;
  }

  host.innerHTML = areas.map(a => {
    const units = a.units.filter(u => unitVisible(a, u));
    const nTop  = units.reduce((s, u) => s + (u.topics || []).length, 0);
    const col   = AREA_COLOR[a.id];

    const unitHtml = units.map(u => {
      const topics = (u.topics || []).map(t => `
        <div class="rf-topic">
          <span class="rf-topic-id">${t.id}</span>
          <span class="rf-topic-name">${escapeHtml(t.name)}</span>
          <span class="rf-topic-desc">${escapeHtml(t.description || "")}</span>
        </div>`).join("");

      return `
        <div class="rf-unit${QUERY ? " open" : ""}">
          <div class="rf-unit-head" onclick="this.parentNode.classList.toggle('open')">
            <span class="rf-unit-id">${u.id}</span>
            <span class="rf-unit-name">${escapeHtml(u.name)}</span>
            <span class="rf-badge ${u.core ? "core" : "elective"}">${u.core ? "CORE" : "elective"}</span>
            <span class="rf-badge bloom">${escapeHtml(u.expected_bloom || "")}</span>
            <span class="rf-unit-id">${(u.topics || []).length} topics</span>
          </div>
          <div class="rf-unit-body">
            <div class="rf-unit-desc">${escapeHtml(u.description || "")}</div>
            ${topics}
          </div>
        </div>`;
    }).join("");

    return `
      <div class="rf-area${QUERY ? " open" : ""}">
        <div class="rf-area-head" style="border-left-color:${col}"
             onclick="this.parentNode.classList.toggle('open')">
          <span class="rf-chev">▶</span>
          <span class="rf-area-id" style="background:${col}">${a.id}</span>
          <span class="rf-area-name">${escapeHtml(a.name)}</span>
          <span class="rf-area-meta">${units.length} units · ${nTop} topics</span>
        </div>
        <div class="rf-area-body">
          <div class="rf-area-desc">${escapeHtml(a.description || "")}</div>
          ${unitHtml}
        </div>
      </div>`;
  }).join("");
}

function outlineAll(open) {
  document.querySelectorAll("#rf-outline .rf-area, #rf-outline .rf-unit")
    .forEach(el => el.classList.toggle("open", open));
}

/* ── Detail panel ─────────────────────────────────────────────── */

function openPanel(data) {
  const p = document.getElementById("rf-panel-body");
  let html = "";

  if (data.kind === "area") {
    const area = RAW.areas.find(a => a.id === data.id);
    html = `
      <div class="rf-p-kind">Knowledge Area</div>
      <div class="rf-p-id">${area.id}</div>
      <div class="rf-p-name">${escapeHtml(area.name)}</div>
      <div class="rf-p-desc">${escapeHtml(area.description || "")}</div>
      ${area.rationale ? `<div class="rf-p-sec">Why it is a distinct area</div>
        <div class="rf-p-desc">${escapeHtml(area.rationale)}</div>` : ""}
      <div class="rf-p-sec">${area.units.length} knowledge units</div>
      ${area.units.map(u => `
        <div class="rf-p-item" onclick='openPanel(${JSON.stringify({kind:"unit",id:u.id})})'>
          <div class="rf-p-item-id">${u.id} ${u.core ? "· CORE" : ""}</div>
          <div class="rf-p-item-name">${escapeHtml(u.name)}</div>
        </div>`).join("")}`;
  }

  if (data.kind === "unit") {
    let area = null, unit = null;
    RAW.areas.forEach(a => a.units.forEach(u => {
      if (u.id === data.id) { area = a; unit = u; }
    }));
    if (!unit) return;
    html = `
      <div class="rf-p-kind">Knowledge Unit</div>
      <div class="rf-p-crumb"><a onclick='openPanel(${JSON.stringify({kind:"area",id:area.id})})'>${area.id} ${escapeHtml(area.name)}</a></div>
      <div class="rf-p-id">${unit.id}</div>
      <div class="rf-p-name">${escapeHtml(unit.name)}</div>
      <div class="rf-p-badges">
        <span class="rf-badge ${unit.core ? "core" : "elective"}">${unit.core ? "CORE" : "elective"}</span>
        <span class="rf-badge bloom">Graduate level: ${escapeHtml(unit.expected_bloom || "")}</span>
      </div>
      <div class="rf-p-desc">${escapeHtml(unit.description || "")}</div>
      <div class="rf-p-sec">${(unit.topics || []).length} topics</div>
      ${(unit.topics || []).map(t => `
        <div class="rf-p-item">
          <div class="rf-p-item-id">${t.id}</div>
          <div class="rf-p-item-name">${escapeHtml(t.name)}</div>
          <div class="rf-p-item-desc">${escapeHtml(t.description || "")}</div>
        </div>`).join("")}`;
  }

  if (data.kind === "topic") {
    let area = null, unit = null, topic = null;
    RAW.areas.forEach(a => a.units.forEach(u => (u.topics || []).forEach(t => {
      if (t.id === data.id) { area = a; unit = u; topic = t; }
    })));
    if (!topic) return;
    html = `
      <div class="rf-p-kind">Topic</div>
      <div class="rf-p-crumb">
        <a onclick='openPanel(${JSON.stringify({kind:"area",id:area.id})})'>${area.id}</a> ›
        <a onclick='openPanel(${JSON.stringify({kind:"unit",id:unit.id})})'>${escapeHtml(unit.name)}</a>
      </div>
      <div class="rf-p-id">${topic.id}</div>
      <div class="rf-p-name">${escapeHtml(topic.name)}</div>
      <div class="rf-p-desc">${escapeHtml(topic.description || "")}</div>`;
  }

  if (!html) return;
  p.innerHTML = html;
  document.getElementById("rf-panel").classList.add("open");
  document.getElementById("rf-panel-scrim").classList.add("open");
}

function closePanel() {
  document.getElementById("rf-panel").classList.remove("open");
  document.getElementById("rf-panel-scrim").classList.remove("open");
}

/* ── View + filter wiring ─────────────────────────────────────── */

function setView(v) {
  VIEW = v;
  document.getElementById("view-tree").style.display    = v === "tree"    ? "flex" : "none";
  document.getElementById("view-outline").style.display = v === "outline" ? "flex" : "none";
  ["tree", "outline"].forEach(k => {
    document.getElementById("tbtn-" + k)?.classList.toggle("active", k === v);
    document.getElementById("mnbtn-" + k)?.classList.toggle("active", k === v);
  });
  if (v === "tree") { rebuildHierarchy(); expandTo(2); }
}

function toggleCoreOnly() {
  CORE_ONLY = !CORE_ONLY;
  document.getElementById("btn-core")?.classList.toggle("active", CORE_ONLY);
  document.getElementById("btn-core2")?.classList.toggle("active", CORE_ONLY);
  refresh();
}

function wireSearch() {
  const box = document.getElementById("search");
  box.addEventListener("input", debounce(() => {
    QUERY = box.value.trim().toLowerCase();
    refresh();
  }, 200));
}

function refresh() {
  const hits = countHits();
  document.getElementById("rf-hits").textContent =
    (QUERY || CORE_ONLY) ? `${hits.units} units · ${hits.topics} topics` : "";
  buildOutline();
  if (VIEW === "tree") { rebuildHierarchy(); expandTo(QUERY ? 3 : 2); }
}

/* ── Mobile nav (mirrors the main site) ───────────────────────── */

function toggleNav() {
  document.getElementById("mobile-nav").classList.toggle("open");
  document.getElementById("nav-overlay").classList.toggle("open");
}
function closeNav() {
  document.getElementById("mobile-nav").classList.remove("open");
  document.getElementById("nav-overlay").classList.remove("open");
}

/* ── Utilities ────────────────────────────────────────────────── */

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
