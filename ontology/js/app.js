/* ================================================================
   Curriculum coverage viewer.

   Joins two research artifacts:
     reference_ontology.json   KA -> KU -> T, the body of knowledge
     claude_extraction.json    which courses teach which KU, with evidence

   Four views answer four questions:
     map     what does the curriculum cover, and how well?
     matrix  which course carries which knowledge area? where is the overlap?
     net     which courses teach the same material?
     gaps    what is thin or missing?

   Coverage STRENGTH matters more than coverage presence: a unit touched
   by one passing secondary mention is not taught. Everything here grades
   by strength so the headline cannot flatter the curriculum.
================================================================ */

const REF_URL = "../pipeline/reference_ontology.json";
const EXT_URL = "../pipeline/claude_extraction.json";

let REF = null, EXT = null;
let UNITS = {};          // KU id -> {id,name,desc,core,bloom,area,areaId,topics,maps[]}
let COURSES = {};        // code -> {code,title,semester,units[],nonTech,hasFile}
let AREA_COLOR = {};
let VIEW = "map";
let QUERY = "";
let MX_MODE = "all", HIDE_NT = false, GAP_FILTER = "weak";
let icFocus = null, nwSim = null, nwZoom = null, nwSvg = null, nwG = null;

const STRENGTH = {
  STRONG:   {label: "Strong",    color: "var(--cov-strong)", hex: "#1f7a4d", note: "taught as a main focus"},
  MODERATE: {label: "Moderate",  color: "var(--cov-mod)",    hex: "#84a83c", note: "a main focus, but on weaker evidence"},
  WEAK:     {label: "Weak",      color: "var(--cov-weak)",   hex: "#eab308", note: "touched on only"},
  VERYWEAK: {label: "Very weak", color: "var(--cov-vweak)",  hex: "#d97706", note: "a passing mention"},
  NONE:     {label: "Uncovered", color: "var(--cov-none)",   hex: "#b03a2e", note: "no course teaches this"},
};

/* ── Boot ────────────────────────────────────────────────────── */

async function init() {
  try {
    const [r, e] = await Promise.all([fetch(REF_URL), fetch(EXT_URL)]);
    if (!r.ok || !e.ok) throw new Error(`HTTP ${r.status}/${e.status}`);
    REF = await r.json();
    EXT = await e.json();
  } catch (err) {
    document.getElementById("ic-canvas").innerHTML =
      `<div style="padding:2rem;color:var(--mu)">Could not load coverage data — ${err.message}</div>`;
    return;
  }
  buildIndex();
  renderStats();
  renderLegends();
  drawIcicle();
  wireSearch();
  window.addEventListener("resize", debounce(() => redraw(), 200));
}

function buildIndex() {
  const n = REF.areas.length;
  const scale = d3.quantize(d3.interpolateHsl("#c9981a", "#4f46e5"), Math.max(n, 2));
  REF.areas.forEach((a, i) => { AREA_COLOR[a.id] = scale[i]; });

  REF.areas.forEach(a => a.units.forEach(u => {
    UNITS[u.id] = {
      id: u.id, name: u.name, desc: u.description, core: u.core,
      bloom: u.expected_bloom, area: a.name, areaId: a.id,
      topics: u.topics || [], maps: [],
    };
  }));

  EXT.courses.forEach(c => {
    COURSES[c.code] = {
      code: c.code, title: c.title, semester: c.semester,
      nonTech: c.is_non_technical, hasFile: c.had_course_file,
      note: c.evidence_note || "", units: [], unmapped: c.unmapped || [],
    };
    c.mapped.forEach(m => {
      if (!UNITS[m.unit_id]) return;
      UNITS[m.unit_id].maps.push({ ...m, code: c.code, title: c.title,
                                   semester: c.semester, hasFile: c.had_course_file });
      COURSES[c.code].units.push(m.unit_id);
    });
  });
}

/** Grade a unit by the strength of its best evidence, not by mere presence. */
function strengthOf(u) {
  if (!u.maps.length) return "NONE";
  if (u.maps.some(m => m.depth === "primary" && m.confidence >= 0.8)) return "STRONG";
  if (u.maps.some(m => m.depth === "primary")) return "MODERATE";
  if (u.maps.some(m => m.confidence >= 0.7)) return "WEAK";
  return "VERYWEAK";
}

function renderStats() {
  const all = Object.values(UNITS);
  const s = all.filter(u => strengthOf(u) === "STRONG").length;
  const thin = all.filter(u => ["WEAK", "VERYWEAK", "MODERATE"].includes(strengthOf(u))).length;
  const none = all.filter(u => strengthOf(u) === "NONE").length;
  document.getElementById("hdr-stats").innerHTML = `
    <div class="cv-stat good"><b>${s}</b><span>solid</span></div>
    <div class="cv-stat"><b>${thin}</b><span>thin</span></div>
    <div class="cv-stat bad"><b>${none}</b><span>uncovered</span></div>
    <div class="cv-stat"><b>${Object.keys(COURSES).length}</b><span>courses</span></div>`;
}

function renderLegends() {
  const html = Object.entries(STRENGTH).map(([k, v]) =>
    `<div class="cv-leg"><span class="cv-swatch" style="background:${v.hex}"></span>${v.label}</div>`).join("");
  document.getElementById("legend-map").innerHTML = html;
  document.getElementById("legend-gaps").innerHTML = html;
}

/* ── Search ──────────────────────────────────────────────────── */

function wireSearch() {
  document.getElementById("search").addEventListener("input", debounce(e => {
    QUERY = e.target.value.trim().toLowerCase();
    redraw();
  }, 220));
}

function unitMatches(u) {
  if (!QUERY) return true;
  if ((u.name + " " + u.id + " " + u.area + " " + u.desc).toLowerCase().includes(QUERY)) return true;
  if (u.topics.some(t => t.name.toLowerCase().includes(QUERY))) return true;
  return u.maps.some(m => (m.code + " " + m.title).toLowerCase().includes(QUERY));
}

function redraw() {
  if (VIEW === "map") drawIcicle();
  else if (VIEW === "matrix") drawMatrix();
  else if (VIEW === "net") drawNetwork();
  else drawGaps();
}

/* ── View 1: coverage map (zoomable icicle) ──────────────────── */

function icicleData() {
  return {
    name: "Chemical Engineering", id: "root", kind: "root",
    children: REF.areas.map(a => ({
      name: a.name, id: a.id, kind: "area", desc: a.description,
      children: a.units.map(u => {
        const U = UNITS[u.id];
        return {
          name: u.name, id: u.id, kind: "unit", strength: strengthOf(U),
          dimmed: !unitMatches(U),
          children: (u.topics || []).map(t => ({
            name: t.name, id: t.id, kind: "topic", desc: t.description,
            strength: strengthOf(U), dimmed: !unitMatches(U), value: 1,
          })),
        };
      }),
    })),
  };
}

function drawIcicle() {
  const canvas = document.getElementById("ic-canvas");
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;

  const root = d3.hierarchy(icicleData())
    .sum(d => d.children && d.children.length ? 0 : 1)
    .sort((a, b) => b.value - a.value);
  d3.partition().size([H, W])(root);

  if (!icFocus || !root.descendants().some(d => d.data.id === icFocus.id)) {
    icFocus = { id: "root", node: root };
  }
  const focus = root.descendants().find(d => d.data.id === icFocus.id) || root;

  const svg = d3.select("#ic-svg").attr("viewBox", `0 0 ${W} ${H}`);
  svg.selectAll("*").remove();
  const g = svg.append("g");

  const x = d3.scaleLinear().domain([focus.y0, W]).range([0, W]);
  const y = d3.scaleLinear().domain([focus.x0, focus.x1]).range([0, H]);

  const nodes = root.descendants().filter(d => d.depth > 0 && d.x1 > focus.x0 && d.x0 < focus.x1);

  const cell = g.selectAll("g").data(nodes).join("g")
    .attr("class", d => "ic-node" + (d.data.dimmed ? " dim" : ""))
    .attr("transform", d => `translate(${x(d.y0)},${y(d.x0)})`)
    .on("click", (ev, d) => {
      ev.stopPropagation();
      if (d.data.kind === "unit" || d.data.kind === "topic") openUnitPanel(unitIdOf(d));
      if (d.children) { icFocus = { id: d.data.id }; drawIcicle(); }
    });

  cell.append("rect")
    .attr("width", d => Math.max(0, x(d.y1) - x(d.y0) - 1))
    .attr("height", d => Math.max(0, y(d.x1) - y(d.x0) - 1))
    .attr("fill", d => d.data.kind === "area" ? AREA_COLOR[d.data.id]
                     : STRENGTH[d.data.strength].hex)
    .attr("opacity", d => d.data.kind === "topic" ? 0.62 : 1);

  cell.append("text")
    .attr("x", 5)
    .attr("y", d => (y(d.x1) - y(d.x0)) / 2)
    .style("font-size", d => d.data.kind === "area" ? "11px" : "9.5px")
    .style("opacity", d => (y(d.x1) - y(d.x0)) > 13 ? 1 : 0)
    .text(d => {
      const w = x(d.y1) - x(d.y0);
      const max = Math.floor(w / 6.2);
      return max > 3 ? (d.data.name.length > max ? d.data.name.slice(0, max - 1) + "…" : d.data.name) : "";
    });

  cell.append("title").text(d =>
    `${d.data.id} ${d.data.name}` +
    (d.data.kind !== "area" ? `\nCoverage: ${STRENGTH[d.data.strength].label} — ${STRENGTH[d.data.strength].note}` : ""));

  // breadcrumb
  const chain = focus.ancestors().reverse();
  document.getElementById("ic-crumb").innerHTML = chain.map((d, i) =>
    `<a onclick="icZoom('${d.data.id}')">${escapeHtml(d.data.name)}</a>` +
    (i < chain.length - 1 ? " <span style='color:var(--dim)'>›</span>" : "")).join("");
}

function unitIdOf(d) { return d.data.kind === "topic" ? d.parent.data.id : d.data.id; }
function icZoom(id) { icFocus = { id }; drawIcicle(); }

/* ── View 2: course × area matrix ────────────────────────────── */

function drawMatrix() {
  const areas = REF.areas;
  let list = Object.values(COURSES);
  if (HIDE_NT) list = list.filter(c => !c.nonTech);
  if (QUERY) {
    list = list.filter(c =>
      (c.code + " " + c.title).toLowerCase().includes(QUERY) ||
      c.units.some(id => unitMatches(UNITS[id])));
  }
  list.sort((a, b) => (a.semester - b.semester) || a.code.localeCompare(b.code));

  const counts = {};
  let max = 0;
  list.forEach(c => {
    counts[c.code] = {};
    areas.forEach(a => {
      const n = c.units.filter(id => {
        if (UNITS[id].areaId !== a.id) return false;
        if (MX_MODE === "primary") {
          return UNITS[id].maps.some(m => m.code === c.code && m.depth === "primary");
        }
        return true;
      }).length;
      counts[c.code][a.id] = n;
      if (n > max) max = n;
    });
  });

  const scale = d3.scaleSequential(d3.interpolateYlGnBu).domain([0, Math.max(max, 1)]);

  let html = "<table class='mx'><thead><tr><th class='mx-row'></th>";
  areas.forEach(a => { html += `<th class='mx-col' title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</th>`; });
  html += "</tr></thead><tbody>";

  let sem = null;
  list.forEach(c => {
    if (c.semester !== sem) {
      sem = c.semester;
      html += `<tr><td class='mx-semband' colspan='${areas.length + 1}'>Semester ${sem}</td></tr>`;
    }
    html += `<tr><th class='mx-row'><span class='mx-code'>${c.code}</span> ${escapeHtml(trunc(c.title, 30))}` +
            (c.hasFile ? "" : " <span title='CLO-only, no outline' style='color:var(--cov-vweak)'>◍</span>") + "</th>";
    areas.forEach(a => {
      const n = counts[c.code][a.id];
      if (!n) { html += "<td class='empty'>0</td>"; return; }
      const bg = scale(n);
      const fg = n > max * 0.55 ? "#fff" : "#12354a";
      html += `<td style="background:${bg};color:${fg}" title="${c.code} — ${escapeHtml(a.name)}: ${n} unit(s)"
                onclick="openCoursePanel('${c.code}','${a.id}')">${n}</td>`;
    });
    html += "</tr>";
  });
  html += "</tbody></table>";
  if (!list.length) html = "<div style='padding:2rem;color:var(--mu)'>No courses match that search.</div>";
  document.getElementById("mx-wrap").innerHTML = html;
}

function setMxMode(m) {
  MX_MODE = m;
  document.getElementById("mx-mode-all").classList.toggle("active", m === "all");
  document.getElementById("mx-mode-primary").classList.toggle("active", m === "primary");
  drawMatrix();
}
function toggleHideNT() {
  HIDE_NT = !HIDE_NT;
  const b = document.getElementById("mx-hide-nt");
  b.classList.toggle("active", HIDE_NT);
  b.textContent = HIDE_NT ? "On" : "Off";
  drawMatrix();
}

/* ── View 3: course overlap network ──────────────────────────── */

function drawNetwork() {
  const min = +document.getElementById("nw-min").value;
  const canvas = document.getElementById("nw-canvas");
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;

  const list = Object.values(COURSES).filter(c => !c.nonTech && c.units.length);
  const nodes = list.map(c => ({ id: c.code, title: c.title, semester: c.semester, n: c.units.length }));
  const links = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const shared = list[i].units.filter(u => list[j].units.includes(u));
      if (shared.length >= min) {
        links.push({ source: list[i].code, target: list[j].code, w: shared.length, shared });
      }
    }
  }

  nwSvg = d3.select("#nw-svg").attr("viewBox", `0 0 ${W} ${H}`);
  nwSvg.selectAll("*").remove();
  nwG = nwSvg.append("g");
  nwZoom = d3.zoom().scaleExtent([0.25, 4]).on("zoom", ev => nwG.attr("transform", ev.transform));
  nwSvg.call(nwZoom);

  const link = nwG.append("g").selectAll("line").data(links).join("line")
    .attr("class", "nw-link")
    .attr("stroke-width", d => Math.min(6, 0.7 + d.w * 0.55));
  link.append("title").text(d => `${d.source} ↔ ${d.target}\n${d.w} shared units:\n` +
    d.shared.map(u => "· " + UNITS[u].name).join("\n"));

  const r = d3.scaleSqrt().domain([1, d3.max(nodes, d => d.n) || 1]).range([5, 20]);
  const node = nwG.append("g").selectAll("g").data(nodes).join("g")
    .attr("class", d => "nw-node" + (QUERY && !(d.id + " " + d.title).toLowerCase().includes(QUERY) ? " dim" : ""))
    .call(d3.drag()
      .on("start", (ev, d) => { if (!ev.active) nwSim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag",  (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on("end",   (ev, d) => { if (!ev.active) nwSim.alphaTarget(0); d.fx = null; d.fy = null; }))
    .on("click", (ev, d) => openCoursePanel(d.id));

  node.append("circle")
    .attr("r", d => r(d.n))
    .attr("fill", d => (typeof SEM_COLORS !== "undefined" && SEM_COLORS[d.semester]) || "#6b7280");
  node.append("text").attr("dy", d => r(d.n) + 8).text(d => d.id);
  node.append("title").text(d => `${d.id} — ${d.title}\n${d.n} knowledge units`);

  nwSim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(d => 130 - Math.min(70, d.w * 7)).strength(0.35))
    .force("charge", d3.forceManyBody().strength(-260))
    .force("center", d3.forceCenter(W / 2, H / 2))
    .force("collide", d3.forceCollide().radius(d => r(d.n) + 13))
    .on("tick", () => {
      link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
          .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      node.attr("transform", d => `translate(${d.x},${d.y})`);
    });
}

function netZoom(k) { if (nwSvg) nwSvg.transition().duration(200).call(nwZoom.scaleBy, k); }
function netFit()   { if (nwSvg) nwSvg.transition().duration(300).call(nwZoom.transform, d3.zoomIdentity); }

/* ── View 4: gaps ────────────────────────────────────────────── */

const ORDER = { NONE: 0, VERYWEAK: 1, WEAK: 2, MODERATE: 3, STRONG: 4 };

function drawGaps() {
  let list = Object.values(UNITS).filter(unitMatches);
  if (GAP_FILTER === "weak") list = list.filter(u => ORDER[strengthOf(u)] <= 2);
  if (GAP_FILTER === "core") list = list.filter(u => u.core);
  list.sort((a, b) => ORDER[strengthOf(a)] - ORDER[strengthOf(b)] || a.id.localeCompare(b.id));

  const host = document.getElementById("gap-grid");
  if (!list.length) { host.innerHTML = "<div style='padding:2rem;color:var(--mu)'>Nothing matches.</div>"; return; }

  host.innerHTML = list.map(u => {
    const s = strengthOf(u), S = STRENGTH[s];
    const courses = u.maps
      .slice().sort((a, b) => (b.depth === "primary") - (a.depth === "primary") || b.confidence - a.confidence)
      .map(m => `<span class="gap-course ${m.depth === "primary" ? "primary" : ""}"
                   title="${escapeHtml(m.title)} — ${m.depth}, confidence ${m.confidence}">${m.code}</span>`).join("");
    return `<div class="gap-card s-${s}" onclick="openUnitPanel('${u.id}')" style="cursor:pointer">
      <div class="gap-head">
        <span class="gap-id">${u.id}</span>
        <span class="gap-name">${escapeHtml(u.name)}</span>
        ${u.core ? '<span class="gap-pill" style="background:var(--gold)">CORE</span>' : ""}
        <span class="gap-pill" style="background:${S.hex}">${S.label.toUpperCase()}</span>
        <span class="gap-area">${escapeHtml(u.area)}</span>
      </div>
      ${courses ? `<div class="gap-courses">${courses}</div>`
                : `<div class="gap-empty">No course maps to this unit.</div>`}
    </div>`;
  }).join("");
}

function setGapFilter(f) {
  GAP_FILTER = f;
  ["weak", "core", "all"].forEach(k =>
    document.getElementById("gp-" + k).classList.toggle("active", k === f));
  drawGaps();
}

/* ── Detail panels ───────────────────────────────────────────── */

function openUnitPanel(id) {
  const u = UNITS[id]; if (!u) return;
  const s = strengthOf(u), S = STRENGTH[s];
  const maps = u.maps.slice()
    .sort((a, b) => (b.depth === "primary") - (a.depth === "primary") || b.confidence - a.confidence);

  const warn = s === "NONE"
    ? `<div class="cv-warn"><b>No course teaches this unit.</b> Before reporting it as a curriculum gap, confirm with the instructor — it may be taught without appearing in the syllabus.</div>`
    : (s === "VERYWEAK" || s === "WEAK")
    ? `<div class="cv-warn">Covered only by passing mentions. This unit looks covered in a raw count but is not substantively taught.</div>` : "";

  document.getElementById("panel-body").innerHTML = `
    <div class="cv-p-kind">Knowledge Unit</div>
    <div class="cv-p-id">${u.id} · ${escapeHtml(u.area)}</div>
    <div class="cv-p-name">${escapeHtml(u.name)}</div>
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin:.5rem 0 .2rem;">
      ${u.core ? '<span class="cv-map-tag p">CORE</span>' : '<span class="cv-map-tag s">elective</span>'}
      <span class="cv-map-tag b">Graduate level: ${escapeHtml(u.bloom)}</span>
      <span class="cv-map-tag" style="background:${S.hex};color:#fff">${S.label}</span>
    </div>
    <div class="cv-p-desc">${escapeHtml(u.desc)}</div>
    ${warn}
    <div class="cv-p-sec">${maps.length} course${maps.length === 1 ? "" : "s"} teaching this</div>
    ${maps.map(m => `
      <div class="cv-map ${m.depth === "primary" ? "primary" : ""}">
        <div class="cv-map-head">
          <span class="cv-map-code">${m.code}</span>
          <span class="cv-map-title">${escapeHtml(trunc(m.title, 34))}</span>
          <span class="cv-map-tag ${m.depth === "primary" ? "p" : "s"}">${m.depth}</span>
          <span class="cv-map-tag b">${escapeHtml(m.bloom_level)}</span>
        </div>
        <div class="cv-map-ev">“${escapeHtml(trunc(m.evidence, 260))}”</div>
      </div>`).join("") || "<div style='font-size:.75rem;color:var(--mu)'>—</div>"}
    <div class="cv-p-sec">${u.topics.length} topics in this unit</div>
    <div style="font-size:.72rem;color:var(--mu);line-height:1.6">
      ${u.topics.map(t => escapeHtml(t.name)).join(" · ")}
    </div>
    <div style="margin-top:1rem;font-size:.65rem;color:var(--dim);line-height:1.5">
      Mapping is recorded at knowledge-unit level, so topics inherit their unit's coverage.
    </div>`;
  openPanel();
}

function openCoursePanel(code, areaId) {
  const c = COURSES[code]; if (!c) return;
  let units = c.units.map(id => UNITS[id]);
  if (areaId) units = units.filter(u => u.areaId === areaId);
  units.sort((a, b) => a.id.localeCompare(b.id));

  const mapOf = u => u.maps.find(m => m.code === code);

  document.getElementById("panel-body").innerHTML = `
    <div class="cv-p-kind">Course</div>
    <div class="cv-p-id">${c.code} · Semester ${c.semester}</div>
    <div class="cv-p-name">${escapeHtml(c.title)}</div>
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin:.55rem 0;">
      <span class="cv-map-tag ${c.hasFile ? "p" : "s"}">${c.hasFile ? "outline available" : "CLO-only"}</span>
      <span class="cv-map-tag b">${c.units.length} units taught</span>
    </div>
    ${c.note ? `<div class="cv-warn">${escapeHtml(c.note)}</div>` : ""}
    <div class="cv-p-sec">${units.length} knowledge unit${units.length === 1 ? "" : "s"}${areaId ? " in this area" : ""}</div>
    ${units.map(u => {
      const m = mapOf(u);
      return `<div class="cv-map ${m && m.depth === "primary" ? "primary" : ""}"
                   onclick="openUnitPanel('${u.id}')" style="cursor:pointer">
        <div class="cv-map-head">
          <span class="cv-map-code">${u.id}</span>
          <span class="cv-map-title">${escapeHtml(trunc(u.name, 30))}</span>
          ${m ? `<span class="cv-map-tag ${m.depth === "primary" ? "p" : "s"}">${m.depth}</span>
                 <span class="cv-map-tag b">${escapeHtml(m.bloom_level)}</span>` : ""}
        </div>
        ${m ? `<div class="cv-map-ev">“${escapeHtml(trunc(m.evidence, 200))}”</div>` : ""}
      </div>`;
    }).join("")}
    ${c.unmapped.length ? `<div class="cv-p-sec">${c.unmapped.length} taught but not in the reference</div>
      ${c.unmapped.map(x => `<div class="cv-map">
        <div class="cv-map-head"><span class="cv-map-code">${escapeHtml(x.label)}</span></div>
        <div class="cv-map-ev">${escapeHtml(trunc(x.suggestion, 180))}</div></div>`).join("")}` : ""}`;
  openPanel();
}

function openPanel() {
  document.getElementById("panel").classList.add("open");
  document.getElementById("scrim").classList.add("open");
}
function closePanel() {
  document.getElementById("panel").classList.remove("open");
  document.getElementById("scrim").classList.remove("open");
}

/* ── View switching / nav ────────────────────────────────────── */

function setView(v) {
  VIEW = v;
  ["map", "matrix", "net", "gaps"].forEach(k => {
    document.getElementById("v-" + k).classList.toggle("hidden", k !== v);
    document.getElementById("tb-" + k)?.classList.toggle("active", k === v);
    document.getElementById("mn-" + k)?.classList.toggle("active", k === v);
  });
  redraw();
}

function toggleNav() {
  document.getElementById("mobile-nav").classList.toggle("open");
  document.getElementById("nav-overlay").classList.toggle("open");
}
function closeNav() {
  document.getElementById("mobile-nav").classList.remove("open");
  document.getElementById("nav-overlay").classList.remove("open");
}

/* ── Utilities ───────────────────────────────────────────────── */

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function trunc(s, n) { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
