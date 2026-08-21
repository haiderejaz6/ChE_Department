/* ════════════════════════════════════════════════════════════════
   TREE + COURSE OVERLAY

   Radial tree of the whole ontology, nodes coloured by coverage
   strength, with each selected course drawn as closed boundaries
   around the units it teaches.

   One hull per (course, knowledge area) rather than one hull per
   course: a course's units are scattered across the tree, so a single
   convex hull would swallow dozens of unrelated nodes and assert
   coverage that isn't there. Because the radial layout keeps an area's
   units adjacent, a per-area hull hugs exactly the right nodes - and
   two courses overlapping inside the same area is precisely the
   overlap this view exists to show.
════════════════════════════════════════════════════════════════ */

let TREE_DEPTH = 2, SELECTED = [], trSvg, trG, trZoomB, trNodePos = {};

const COURSE_PALETTE = [
  "#e5484d", "#0090ff", "#e2a336", "#8e4ec6", "#12a594",
  "#d6409f", "#5b5bd6", "#46a758", "#e54d2e", "#0588f0",
];

function courseColor(code) {
  const i = SELECTED.indexOf(code);
  return i < 0 ? "#888888" : COURSE_PALETTE[i % COURSE_PALETTE.length];
}

function buildCourseRail() {
  const box = document.getElementById("tr-course-search");
  const q = (box && box.value ? box.value : "").trim().toLowerCase();
  let list = Object.values(COURSES).filter(c => !c.nonTech);
  if (q) list = list.filter(c => (c.code + " " + c.title).toLowerCase().includes(q));
  list.sort((a, b) => (a.semester - b.semester) || a.code.localeCompare(b.code));

  let html = "", sem = null;
  list.forEach(c => {
    if (c.semester !== sem) { sem = c.semester; html += '<div class="tr-sem">Semester ' + sem + "</div>"; }
    const on = SELECTED.indexOf(c.code) >= 0;
    html += '<div class="tr-course ' + (on ? "on" : "") + '" onclick="toggleCourse(\'' + c.code + '\')"' +
            ' title="' + escapeHtml(c.title) + '">' +
            '<span class="tr-dot" style="background:' + (on ? courseColor(c.code) : "transparent") + '"></span>' +
            '<span class="tr-code">' + c.code + "</span>" +
            '<span class="tr-title">' + escapeHtml(trunc(c.title, 22)) + "</span></div>";
  });
  document.getElementById("tr-course-list").innerHTML = html ||
    "<div style='padding:.7rem;font-size:.68rem;color:var(--mu)'>No match.</div>";

  const note = document.getElementById("tr-sel-note");
  if (!SELECTED.length) {
    note.textContent = "No courses selected - tick up to 6 to compare what they teach.";
  } else {
    const shared = sharedUnits();
    note.innerHTML = SELECTED.map(c =>
      '<span style="color:' + courseColor(c) + ';font-weight:600">' + c + "</span>").join(" &middot; ") +
      (SELECTED.length > 1
        ? '<br><span style="color:var(--mu)">' + shared.length + " unit" + (shared.length === 1 ? "" : "s") +
          " taught by more than one</span>"
        : "");
  }
}

/** Units taught by more than one of the selected courses - the overlap. */
function sharedUnits() {
  const count = {};
  SELECTED.forEach(code => {
    const c = COURSES[code];
    if (c) c.units.forEach(u => { count[u] = (count[u] || 0) + 1; });
  });
  return Object.keys(count).filter(u => count[u] > 1);
}

function toggleCourse(code) {
  const i = SELECTED.indexOf(code);
  if (i >= 0) SELECTED.splice(i, 1);
  else {
    if (SELECTED.length >= 6) SELECTED.shift();   // keep the picture readable
    SELECTED.push(code);
  }
  buildCourseRail();
  drawTree();
}

function clearCourses() { SELECTED = []; buildCourseRail(); drawTree(); }

function setTreeDepth(d) {
  TREE_DEPTH = d;
  document.getElementById("tr-d2").classList.toggle("active", d === 2);
  document.getElementById("tr-d3").classList.toggle("active", d === 3);
  drawTree();
}

function treeData() {
  const areas = REF.areas.slice().sort((a, b) => (a.order == null ? 99 : a.order) - (b.order == null ? 99 : b.order));
  return {
    id: "root", name: "Chemical Engineering", kind: "root",
    children: areas.map(a => ({
      id: a.id, name: a.name, kind: "area",
      children: a.units.map(u => {
        const U = UNITS[u.id];
        const node = { id: u.id, name: u.name, kind: "unit", areaId: a.id, strength: strengthOf(U) };
        if (TREE_DEPTH >= 3) {
          node.children = (u.topics || []).map(t => ({
            id: t.id, name: t.name, kind: "topic", areaId: a.id,
            unitId: u.id, strength: strengthOf(U),
          }));
        }
        return node;
      }),
    })),
  };
}

function drawTree() {
  const canvas = document.getElementById("tr-canvas");
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;

  const R = Math.min(W, H) / 2 - (TREE_DEPTH >= 3 ? 100 : 70);
  const root = d3.hierarchy(treeData());
  d3.tree()
    .size([2 * Math.PI, Math.max(R, 60)])
    .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth)(root);

  trSvg = d3.select("#tr-svg").attr("viewBox", (-W / 2) + " " + (-H / 2) + " " + W + " " + H);
  trSvg.selectAll("*").remove();
  trG = trSvg.append("g");
  trZoomB = d3.zoom().scaleExtent([0.35, 6]).on("zoom", ev => trG.attr("transform", ev.transform));
  trSvg.call(trZoomB);

  const hullLayer = trG.append("g");   // beneath the tree so nodes stay readable
  const linkLayer = trG.append("g");
  const nodeLayer = trG.append("g");

  linkLayer.selectAll("path").data(root.links()).join("path")
    .attr("class", "tr-link")
    .attr("d", d3.linkRadial().angle(d => d.x).radius(d => d.y));

  const nodes = root.descendants();
  trNodePos = {};
  nodes.forEach(d => {
    d.px = Math.cos(d.x - Math.PI / 2) * d.y;
    d.py = Math.sin(d.x - Math.PI / 2) * d.y;
    trNodePos[d.data.id] = d;
  });

  const shared = {};
  sharedUnits().forEach(u => { shared[u] = true; });

  const g = nodeLayer.selectAll("g").data(nodes).join("g")
    .attr("class", d => "tr-node" +
      (d.data.kind === "unit" && QUERY && !unitMatches(UNITS[d.data.id]) ? " dim" : ""))
    .attr("transform", d => "translate(" + d.px + "," + d.py + ")")
    .on("click", (ev, d) => {
      ev.stopPropagation();
      if (d.data.kind === "unit") openUnitPanel(d.data.id);
      else if (d.data.kind === "topic") openUnitPanel(d.data.unitId);
    });

  g.append("circle")
    .attr("r", d => d.data.kind === "root" ? 9 : d.data.kind === "area" ? 6.5
                  : d.data.kind === "unit" ? 5 : 2.6)
    .attr("fill", d => d.data.kind === "root" ? "#18263e"
                     : d.data.kind === "area" ? AREA_COLOR[d.data.id]
                     : STRENGTH[d.data.strength].hex)
    .attr("stroke", d => shared[d.data.id] ? "#18263e" : "#ffffff")
    .attr("stroke-width", d => shared[d.data.id] ? 2.4 : 1.3);

  g.append("text")
    .attr("transform", d => {
      const deg = (d.x * 180 / Math.PI - 90);
      const flip = d.x >= Math.PI;
      return "rotate(" + deg + ") translate(" + (d.data.kind === "root" ? 0 : 10) + ",0)" +
             " rotate(" + (flip ? 180 : 0) + ")";
    })
    .attr("text-anchor", d => d.data.kind === "root" ? "middle" : (d.x >= Math.PI ? "end" : "start"))
    .attr("dy", "0.32em")
    .style("font-size", d => d.data.kind === "area" ? "10px" : d.data.kind === "unit" ? "8.6px" : "6.4px")
    .style("font-weight", d => d.data.kind === "area" ? 600 : 400)
    .text(d => d.data.kind === "root" ? ""
             : trunc(d.data.name, d.data.kind === "area" ? 26 : d.data.kind === "unit" ? 22 : 16));

  g.append("title").text(d =>
    (d.data.kind === "unit" || d.data.kind === "topic")
      ? d.data.id + " " + d.data.name + "\nCoverage: " + STRENGTH[d.data.strength].label +
        " - " + STRENGTH[d.data.strength].note
      : d.data.id + " " + d.data.name);

  drawHulls(hullLayer);
  trFit();
}

/** Closed boundary around a set of points, padded so it encloses the nodes
 *  rather than clipping them. Scattering padding circles around each point
 *  first makes it work for 1 and 2 points too, where a bare convex hull
 *  would be degenerate. */
function hullPath(points, pad) {
  const spread = [];
  points.forEach(p => {
    for (let a = 0; a < Math.PI * 2 - 0.01; a += Math.PI / 8) {
      spread.push([p[0] + Math.cos(a) * pad, p[1] + Math.sin(a) * pad]);
    }
  });
  const h = d3.polygonHull(spread);
  if (!h) return null;
  return d3.line().curve(d3.curveCatmullRomClosed.alpha(0.7))(h);
}

function drawHulls(layer) {
  if (!SELECTED.length) return;

  SELECTED.forEach(code => {
    const c = COURSES[code];
    if (!c) return;
    const col = courseColor(code);

    // Group this course's units by knowledge area, so each boundary stays
    // inside one branch of the tree instead of spanning the whole circle.
    const byArea = {};
    c.units.forEach(uid => {
      const n = trNodePos[uid];
      if (!n) return;
      if (!byArea[UNITS[uid].areaId]) byArea[UNITS[uid].areaId] = [];
      byArea[UNITS[uid].areaId].push(n);
    });

    Object.keys(byArea).forEach(aid => {
      const ns = byArea[aid];
      const pts = ns.map(n => [n.px, n.py]);
      const areaNode = trNodePos[aid];
      if (areaNode && ns.length > 1) pts.push([areaNode.px * 0.93, areaNode.py * 0.93]);

      const d = hullPath(pts, ns.length === 1 ? 13 : 17);
      if (!d) return;
      layer.append("path")
        .attr("class", "tr-hull")
        .attr("d", d)
        .attr("fill", col)
        .attr("stroke", col);
    });

    // Label the course at its densest cluster.
    let biggest = null;
    Object.keys(byArea).forEach(aid => {
      if (!biggest || byArea[aid].length > biggest.length) biggest = byArea[aid];
    });
    if (biggest && biggest.length) {
      layer.append("text")
        .attr("class", "tr-hull-label")
        .attr("x", d3.mean(biggest, n => n.px))
        .attr("y", d3.mean(biggest, n => n.py))
        .attr("text-anchor", "middle")
        .attr("fill", col)
        .text(code);
    }
  });
}

function trZoom(k) { if (trSvg) trSvg.transition().duration(200).call(trZoomB.scaleBy, k); }
function trFit()   { if (trSvg) trSvg.transition().duration(280).call(trZoomB.transform, d3.zoomIdentity); }
