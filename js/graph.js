
/* ================================================================
   CURRICULUM GRAPH  (UCSD-style semester columns)
================================================================ */
let cgSelectedCode = null;

function buildCurriculumGraph() {
  const canvas = document.getElementById("cg-canvas");
  const sems   = allSemesters();
  const courses = filtered();

  // Build legend
  document.getElementById("cg-legend").innerHTML = sems.map(s =>
    `<div class="cg-leg-item">
       <div class="cg-leg-dot" style="background:${semColor(s)};"></div>
       Semester ${s}
     </div>`
  ).join("");

  // Group courses by semester
  const bySem = {};
  sems.forEach(s => bySem[s] = []);
  courses.forEach(c => { if(bySem[c.semester]) bySem[c.semester].push(c); });

  canvas.innerHTML = `<div class="cg-grid" id="cg-grid-inner"></div>`;
  const grid = document.getElementById("cg-grid-inner");

  sems.forEach(sem => {
    const col = document.createElement("div");
    col.className = "cg-col";
    const sc  = semColor(sem);
    const semCourses = bySem[sem] || [];

    // Column header
    col.innerHTML = `<div class="cg-col-hdr" style="border-top-color:${sc};">
      <div class="cg-col-sem" style="color:${sc};">Semester ${sem}</div>
      <div class="cg-col-count">${semCourses.length} course${semCourses.length!==1?"s":""}</div>
    </div>`;

    semCourses.forEach(course => {
      const ploSet = [...new Set(course.clos.map(cl=>cl.plo))];
      const ploDots = ploSet.slice(0,8).map(p =>
        `<div class="cg-plo-dot" style="background:${PLO_COLORS[p]||'#888'};" title="${(DATA.plos||PLOS_DEF)[p]}"></div>`
      ).join("");
      const credits = (course.lec||0) + (course.lab||0);
      const credLabel = `${course.lec||0}L${course.lab>0?" + "+course.lab+"P":""}`;

      const node = document.createElement("div");
      node.className = "cg-node";
      node.id = "cgn-"+course.code;
      node.style.borderLeftColor = sc;
      node.innerHTML = `
        <div class="cg-node-code" style="color:${sc};">${course.code}</div>
        <div class="cg-node-title">${course.title}</div>
        <div class="cg-node-meta">
          <span class="cg-credits">${credLabel} cr</span>
          <div class="cg-plo-dots">${ploDots}</div>
        </div>`;
      node.onclick = () => cgOpenPanel(course);
      node.onmouseenter = e => {
        const cloCount = course.clos.length;
        tip.innerHTML = `<div class="th">${course.code}</div>
          <div class="tm">${course.title}</div>
          <div class="tm" style="color:var(--gold);">${semLabel(course.semester)} · ${credLabel} credits · ${cloCount} CLOs</div>`;
        tip.style.display = "block"; moveTip(e);
        highlightPrereqEdges(course.code);
      };
      node.onmouseleave = () => { hideTip(); highlightPrereqEdges(null); };
      col.appendChild(node);
    });

    grid.appendChild(col);
  });

  // Draw prerequisite arrows as SVG overlay after layout
  // Delay to allow the browser to complete layout before reading getBoundingClientRect
  setTimeout(drawPrereqArrows, 60);
}

function drawPrereqArrows() {
  const canvas = document.getElementById("cg-canvas");
  if (!canvas) return;

  // Remove old overlay
  const old = document.getElementById("prereq-svg");
  if (old) old.remove();

  const svgNS = "http://www.w3.org/2000/svg";
  const svgEl = document.createElementNS(svgNS, "svg");
  svgEl.id = "prereq-svg";
  svgEl.style.cssText =
    `position:absolute;top:0;left:0;` +
    `width:${canvas.scrollWidth}px;height:${canvas.scrollHeight}px;` +
    `pointer-events:none;overflow:visible;z-index:5;`;

  const defs = document.createElementNS(svgNS, "defs");
  defs.innerHTML =
    `<marker id="arr-end" markerWidth="10" markerHeight="8" refX="8.5" refY="4" orient="auto">
      <polygon points="0 0,10 4,0 8" fill="rgba(184,146,14,0.85)"/>
    </marker>`;
  svgEl.appendChild(defs);

  const canvasRect = canvas.getBoundingClientRect();

  PREREQ_EDGES.forEach(([from, to]) => {
    const fromEl = document.getElementById("cgn-" + from);
    const toEl   = document.getElementById("cgn-" + to);
    if (!fromEl || !toEl) return;

    const fr = fromEl.getBoundingClientRect();
    const tr = toEl.getBoundingClientRect();
    const sl = canvas.scrollLeft, st = canvas.scrollTop;

    // right-center of source → left-center of target
    const x1 = fr.right  - canvasRect.left + sl;
    const y1 = fr.top    + fr.height / 2 - canvasRect.top + st;
    const x2 = tr.left   - canvasRect.left + sl - 2;
    const y2 = tr.top    + tr.height / 2 - canvasRect.top + st;

    const pathEl = document.createElementNS(svgNS, "path");
    const cx = (x1 + x2) / 2;
    pathEl.setAttribute("d", `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
    pathEl.setAttribute("class", "prereq-edge");
    pathEl.setAttribute("data-from", from);
    pathEl.setAttribute("data-to", to);
    pathEl.setAttribute("stroke", "rgba(184,146,14,0.75)");
    pathEl.setAttribute("stroke-width", "2");
    pathEl.setAttribute("stroke-dasharray", "5,3");
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("marker-end", "url(#arr-end)");
    svgEl.appendChild(pathEl);
  });

  canvas.insertBefore(svgEl, canvas.firstChild);
}

/* Highlight prerequisite edges touching a given course code; dim the rest.
   Pass null to clear the highlight and restore all edges to their default state. */
function highlightPrereqEdges(code) {
  const svgEl = document.getElementById("prereq-svg");
  if (!svgEl) return;
  const edges = svgEl.querySelectorAll(".prereq-edge");
  edges.forEach(edge => {
    if (!code) { edge.classList.remove("active", "dim"); return; }
    const touches = edge.getAttribute("data-from") === code || edge.getAttribute("data-to") === code;
    edge.classList.toggle("active", touches);
    edge.classList.toggle("dim", !touches);
  });
}

function cgOpenPanel(course) {  if (cgSelectedCode) {
    const prev = document.getElementById("cgn-"+cgSelectedCode);
    if (prev) prev.classList.remove("selected");
  }
  cgSelectedCode = course.code;
  const node = document.getElementById("cgn-"+course.code);
  if (node) node.classList.add("selected");

  const panel = document.getElementById("cg-panel");
  panel.classList.remove("hidden");

  const sc = semColor(course.semester);
  document.getElementById("cgp-type").textContent = semLabel(course.semester) +
    ` · ${course.lec||0}L+${course.lab||0}P cr`;
  document.getElementById("cgp-name").innerHTML =
    `<span style="color:${sc};">${course.code}</span>`;
  document.getElementById("cgp-sub").textContent = course.title;

  const byPLO = {};
  course.clos.forEach(cl => { if(!byPLO[cl.plo]) byPLO[cl.plo]=[]; byPLO[cl.plo].push(cl); });
  const maxC = Math.max(...Object.values(byPLO).map(a=>a.length));
  const ploHtml = Object.entries(byPLO).map(([plo,clos]) => {
    const col = PLO_COLORS[plo]||"#888";
    return `<div class="plo-conn">
      <div class="plo-pill-sm" style="background:${col};">${plo.replace("PLO-","P")}</div>
      <div style="flex:1;">
        <div class="plo-conn-name">${(DATA.plos||PLOS_DEF)[plo]||plo}</div>
        <div class="plo-conn-cnt">${clos.length} CLO${clos.length>1?"s":""}</div>
        <div class="p-bar-wrap"><div class="p-bar-fill" style="width:${(clos.length/maxC*100).toFixed(0)}%;background:${col};"></div></div>
      </div>
    </div>`;
  }).join("");

  const cloHtml = course.clos.map(cl => {
    const col = PLO_COLORS[cl.plo]||"#888";
    const dc  = (DOMAIN_CFG[cl.domain]||{color:"#888"}).color;
    const dl  = (DOMAIN_CFG[cl.domain]||{label:cl.domain}).label;
    return `<div class="p-clo-item">
      <div class="p-clo-badge" style="background:${col}18;border:1px solid ${col}30;color:${col};">${cl.code}</div>
      <div style="flex:1;min-width:0;">
        <div class="p-clo-desc">${cl.description}</div>
        <div class="p-clo-tags">
          <span class="pctag" style="background:${col}18;color:${col};">${cl.plo}</span>
          <span class="pctag" style="background:${dc}18;color:${dc};">${dl}</span>
          <span class="pctag" style="background:#f0f3fa;color:var(--mu);">${cl.emphasis}</span>
        </div>
      </div>
      <button class="clo-suggest-btn" title="Suggest an edit to ${escA(cl.code)}"
        data-course="${escA(course.code)}" data-title="${escA(course.title)}"
        data-context="CLO ${escA(cl.code)}" data-current="${escA(cl.description)}"
        onclick="openSuggestFromEl(this)">✎</button>
    </div>`;
  }).join("");

  document.getElementById("cg-panel-inner").innerHTML =
    `<div style="margin-bottom:1rem;"><div class="psec-hd">PLO Connections</div>${ploHtml}</div>
     ${buildDepSection(course)}
     <div><div class="psec-hd">${course.clos.length} CLOs</div>${cloHtml}</div>
     <div style="margin-top:.75rem;border-top:1px solid var(--bdr);padding-top:.75rem;display:flex;gap:.5rem;flex-wrap:wrap;">
       <button class="md-view-btn" data-code="${escH(course.code)}" data-title="${escA(course.title)}"
         onclick="openMdModal(this.dataset.code,this.dataset.title)">
         📄 View Course Content (.md)
       </button>
       <button class="suggest-trigger"
         data-course="${escA(course.code)}" data-title="${escA(course.title)}" data-context="Course File / Overview"
         onclick="openSuggestFromEl(this)">
         Suggest an Edit
       </button>
     </div>`;
}

function buildDepSection(course) {
  const prereqs  = PREREQ_EDGES.filter(([,t])=>t===course.code).map(([f])=>f);
  const unlocks  = PREREQ_EDGES.filter(([f])=>f===course.code).map(([,t])=>t);
  if (!prereqs.length && !unlocks.length) return "";
  let html = `<div style="margin-bottom:1rem;">`;
  if (prereqs.length) {
    html += `<div class="psec-hd">Prerequisites</div>`;
    html += prereqs.map(code => {
      const c = DATA.courses.find(x=>x.code===code);
      const sc = semColor(c?.semester||0);
      return `<span class="cg-dep-tag" style="background:${sc}12;color:${sc};border-color:${sc}40;margin:.18rem .18rem 0 0;"
        onclick="cgJumpTo('${code}')">← ${code}</span>`;
    }).join("");
  }
  if (unlocks.length) {
    html += `<div class="psec-hd" style="margin-top:.55rem;">Unlocks</div>`;
    html += unlocks.map(code => {
      const c = DATA.courses.find(x=>x.code===code);
      const sc = semColor(c?.semester||0);
      return `<span class="cg-dep-tag" style="background:${sc}12;color:${sc};border-color:${sc}40;margin:.18rem .18rem 0 0;"
        onclick="cgJumpTo('${code}')">${code} →</span>`;
    }).join("");
  }
  html += `</div>`;
  return html;
}

window.cgClosePanel = function() {
  document.getElementById("cg-panel").classList.add("hidden");
  if (cgSelectedCode) {
    const prev = document.getElementById("cgn-"+cgSelectedCode);
    if (prev) prev.classList.remove("selected");
    cgSelectedCode = null;
  }
};

window.cgJumpTo = function(code) {
  const course = DATA.courses.find(c=>c.code===code);
  if (!course) return;
  // Scroll the node into view
  const el = document.getElementById("cgn-"+code);
  if (el) el.scrollIntoView({behavior:"smooth",block:"center",inline:"center"});
  cgOpenPanel(course);
};
