const DASH_VIEWS = ["course","plo","bloom"];

window.setDashView = function(view) {
  if(!DASH_VIEWS.includes(view)) view="course";
  dashView = view;
  DASH_VIEWS.forEach(v => {
    const panel = document.getElementById("dash-view-"+v);
    const btn = document.getElementById("dash-subbtn-"+v);
    if (panel) panel.classList.toggle("hidden", v !== view);
    if (btn) btn.classList.toggle("active", v === view);
  });
};

/* ================================================================
   HEADER STATS
================================================================ */
function renderStats() {
  const courses  = filtered();
  const totalCLOs = courses.reduce((a,c) => a+c.clos.length, 0);
  const ploSet   = new Set(courses.flatMap(c => c.clos.map(cl => cl.plo)));
  const nSems    = allSemesters().length;
  document.getElementById("hdr-stats").innerHTML = [
    [DATA.courses.length,"Courses"],[totalCLOs,"CLOs"],[nSems,"Semesters"],[ploSet.size,"PLOs"]
  ].map(([n,l]) =>
    `<div style="text-align:center;">
       <div class="stat-n">${n}</div>
       <div class="stat-l">${l}</div>
     </div>`
  ).join("");
}

/* ================================================================
   DASHBOARD
================================================================ */
function renderDash() {
  const courses = filtered();
  renderHeatmap(courses);
  renderBloomDistributions(courses);
  renderCourseGrid(courses);
  renderPLOFooter();
  document.getElementById("cinfo").textContent =
    `— ${courses.length} course${courses.length!==1?"s":""}, ${courses.reduce((a,c)=>a+c.clos.length,0)} CLOs`;
  setDashView(dashView);
}

/* ── PLO Coverage Matrix (PLO-first: which courses cover each PLO) ── */
function renderHeatmap(courses) {
  const plos = Object.keys(DATA.plos||PLOS_DEF);
  const alphaHex = {None:"14", Low:"2e", Medium:"55", High:"85"};

  // Build: for each PLO, which courses cover it + max emphasis + CLO count
  const coverage = {};
  plos.forEach(p => coverage[p] = {});
  courses.forEach(c => {
    c.clos.forEach(cl => {
      if (!coverage[cl.plo]) return;
      if (!coverage[cl.plo][c.code]) coverage[cl.plo][c.code] = {count:0, maxEmphasis:"None"};
      coverage[cl.plo][c.code].count++;
      if (EMPHASIS_ORDER[cl.emphasis] > EMPHASIS_ORDER[coverage[cl.plo][c.code].maxEmphasis])
        coverage[cl.plo][c.code].maxEmphasis = cl.emphasis;
    });
  });

  const rows = plos.map(p => {
    const col   = PLO_COLORS[p] || "#888";
    const label = (DATA.plos||PLOS_DEF)[p] || "";
    const entries = Object.entries(coverage[p])
      .sort((a,b) => {
        const ca = DATA.courses.find(c=>c.code===a[0]), cb = DATA.courses.find(c=>c.code===b[0]);
        return (ca?.semester||0) - (cb?.semester||0) || a[0].localeCompare(b[0]);
      });

    const pills = entries.length ? entries.map(([code,d]) => {
      const course = DATA.courses.find(c=>c.code===code);
      const bg = col + (alphaHex[d.maxEmphasis] || "14");
      return `<div class="plom-pill" style="border-color:${col};background:${bg};"
        onmouseenter="showTip(event,'${code}','${p}','${d.count}','${d.maxEmphasis}')"
        onmouseleave="hideTip()">
        <span class="plom-pill-code" style="color:${col};">${code}${d.count>1?` ×${d.count}`:""}</span>
        <span class="plom-pill-title">${escH(course ? course.title : "")}</span>
      </div>`;
    }).join("") : `<span class="plom-empty">No courses currently mapped to this PLO</span>`;

    return `<div class="plom-row">
      <div class="plom-plo" style="border-left-color:${col};">
        <div class="plom-plo-code" style="color:${col};">${p.replace("PLO-","PLO ")}</div>
        <div class="plom-plo-label">${escH(label)}</div>
      </div>
      <div class="plom-pills">${pills}</div>
    </div>`;
  }).join("");

  document.getElementById("hm").innerHTML = rows;
}

function renderBloomDomainChart(courses, { hostId, insightId, levels, domainLabel }) {
  const host = document.getElementById(hostId);
  const insightEl = document.getElementById(insightId);
  if (!host || !insightEl) return;
  host.innerHTML = "";

  const sems = [...new Set(courses.map(c => c.semester).filter(Boolean))].sort((a,b)=>a-b);
  if (!sems.length) {
    insightEl.textContent = "No semester data available for this domain.";
    return;
  }

  const totalDomainCLOs = courses.flatMap(c => c.clos || []).filter(cl => levels.some(l => l.key === cl.domain)).length;
  if (!totalDomainCLOs) {
    insightEl.innerHTML = `No CLOs are currently mapped to the ${domainLabel} domain.`;
    return;
  }

  const rows = sems.map(semester => {
    const clos = courses.filter(c => c.semester === semester).flatMap(c => c.clos || []);
    const counts = Object.fromEntries(levels.map(l => [l.key, 0]));
    clos.forEach(clo => { if (counts[clo.domain] !== undefined) counts[clo.domain] += 1; });
    const total = Object.values(counts).reduce((a,b)=>a+b,0) || 1;
    const row = { semester };
    levels.forEach(l => { row[l.key] = counts[l.key] / total; });
    return row;
  });

  const width = Math.max(700, host.clientWidth || 700);
  const height = 320;
  const margin = { top: 12, right: 12, bottom: 42, left: 44 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const svg = d3.select(host).append("svg").attr("width", width).attr("height", height);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const x = d3.scalePoint().domain(sems).range([0, innerW]).padding(0.25);
  const y = d3.scaleLinear().domain([0, 1]).range([innerH, 0]);
  const stacked = d3.stack().keys(levels.map(l => l.key)).offset(d3.stackOffsetExpand)(rows);

  g.selectAll("line.grid").data(y.ticks(5)).enter().append("line")
    .attr("x1", 0).attr("x2", innerW).attr("y1", d => y(d)).attr("y2", d => y(d))
    .attr("stroke", "rgba(0,0,0,.05)");

  g.append("g").attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickSizeOuter(0))
    .call(sel => sel.selectAll("text").attr("fill", "#5a6e8c").style("font-family", "Outfit").style("font-size", "11px"));

  g.append("g")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")))
    .call(sel => sel.selectAll("text").attr("fill", "#5a6e8c").style("font-family", "Outfit").style("font-size", "11px"))
    .call(sel => sel.selectAll("line,path").attr("stroke", "rgba(0,0,0,.12)"));

  const area = d3.area()
    .x(d => x(d.data.semester))
    .y0(d => y(d[0]))
    .y1(d => y(d[1]))
    .curve(d3.curveMonotoneX);

  g.selectAll("path.bloom-band").data(stacked).enter().append("path")
    .attr("class", "bloom-band")
    .attr("fill", d => levels.find(l => l.key === d.key)?.color || "#64748b")
    .attr("fill-opacity", 0.92)
    .attr("d", area);

  const legendItemW = Math.max(70, Math.min(106, innerW / levels.length));
  const legend = svg.append("g").attr("transform", `translate(${margin.left},${height - 8})`);
  const li = legend.selectAll("g").data(levels).enter().append("g").attr("transform", (_,i) => `translate(${i * legendItemW},0)`);
  li.append("rect").attr("width", 10).attr("height", 10).attr("rx", 2).attr("fill", d => d.color);
  li.append("text").attr("x", 14).attr("y", 8).text(d => d.label)
    .attr("fill", "#5a6e8c").style("font-family", "Outfit").style("font-size", "11px");

  const first = rows[0], last = rows[rows.length - 1];
  const advanced = levels.slice(-Math.min(3, levels.length));
  const shareOf = row => advanced.reduce((s,l) => s + (row[l.key] || 0), 0);
  const advancedLabel = advanced.map(l => l.label).join("/");
  insightEl.innerHTML = `Auto insight: Higher-order ${domainLabel} demand (<strong>${advancedLabel}</strong>) changes from <strong>${(shareOf(first) * 100).toFixed(1)}%</strong> in Semester ${sems[0]} to <strong>${(shareOf(last) * 100).toFixed(1)}%</strong> in Semester ${sems[sems.length - 1]}.`;
}

function renderBloomDistributions(courses) {
  renderBloomDomainChart(courses, { hostId: "bloom-cognitive-chart",   insightId: "bloom-cognitive-insight",   levels: BLOOM_COGNITIVE_LEVELS,   domainLabel: "cognitive" });
  renderBloomDomainChart(courses, { hostId: "bloom-affective-chart",   insightId: "bloom-affective-insight",   levels: BLOOM_AFFECTIVE_LEVELS,   domainLabel: "affective" });
  renderBloomDomainChart(courses, { hostId: "bloom-psychomotor-chart", insightId: "bloom-psychomotor-insight", levels: BLOOM_PSYCHOMOTOR_LEVELS, domainLabel: "psychomotor" });
}

function renderCourseGrid(courses) {
  document.getElementById("cgrid").innerHTML = courses.map(c => {
    const sc     = semColor(c.semester);
    const ploSet = [...new Set(c.clos.map(cl=>cl.plo))];
    const pills  = ploSet.map(p=>
      `<div class="pm" style="background:${PLO_COLORS[p]||'#888'}" title="${(DATA.plos||PLOS_DEF)[p]}">${p.replace("PLO-","P")}</div>`
    ).join("");
    const total = c.clos.length;
    const bar = Object.entries(DOMAIN_CFG).map(([d,cfg]) => {
      const cnt = c.clos.filter(cl=>cl.domain===d).length;
      return cnt ? `<div class="dm-seg" style="background:${cfg.color};width:${(cnt/total*100).toFixed(1)}%;"></div>` : "";
    }).join("");
    const cloRows = c.clos.map(cl => {
      const col = PLO_COLORS[cl.plo]||"#888";
      const dc  = (DOMAIN_CFG[cl.domain]||{color:"#888"}).color;
      const dl  = (DOMAIN_CFG[cl.domain]||{label:cl.domain}).label;
      return `<div class="clo-item">
        <div class="clo-num">${cl.code}</div>
        <div class="clo-desc">${cl.description}</div>
        <div class="clo-tags">
          <span class="tag" style="background:${col}18;color:${col};">${cl.plo}</span>
          <span class="tag" style="background:${dc}18;color:${dc};">${dl}</span>
          <span class="tag" style="background:#f0f3fa;color:var(--mu);">${cl.emphasis}</span>
        </div>
      </div>`;
    }).join("");
    const credits = `${c.lec||0}L+${c.lab||0}P`;
    return `<div class="ccard" id="cc-${c.code}" onclick="toggleCard('${c.code}')"
      style="border-top:3px solid ${sc};">
      <div class="cc-hdr">
        <div style="flex:1;">
          <div class="cc-code">${c.code}
            <span class="sem-badge" style="background:${sc}18;color:${sc};">${semLabel(c.semester)}</span>
          </div>
          <div class="cc-title">${c.title}</div>
          <div class="cc-meta">${pills}
            <span class="sem-badge" style="margin-left:.2rem;">${credits} cr</span>
          </div>
        </div>
        <div class="cc-r">
          <div class="cc-n">${c.clos.length}</div>
          <div class="cc-nl">CLOs</div>
          <button class="exp-btn">▾</button>
        </div>
      </div>
      <div class="dm-bar">${bar}</div>
      <div class="clo-list">${cloRows}</div>
    </div>`;
  }).join("");
}
window.toggleCard = id => document.getElementById("cc-"+id).classList.toggle("open");

function renderPLOFooter() {
  const plos = DATA.plos||PLOS_DEF;
  document.getElementById("plo-footer").innerHTML = Object.entries(plos).map(([k,v]) =>
    `<div class="plo-def">
       <div class="plo-ic" style="background:${PLO_COLORS[k]||'#888'}">${k.replace("PLO-","P")}</div>
       <div><span class="plo-code-t">${k}</span><span class="plo-name-t">${v}</span></div>
     </div>`
  ).join("");
}
