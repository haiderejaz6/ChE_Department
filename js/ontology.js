const CMP_PILL_SELECTED_ALPHA = "24";
const CMP_PILL_DEFAULT_ALPHA = "12";
let conceptColorMap = {};
let cmView = "curriculum";
let cmSelectedConcept = null;
let cmNetSim = null;
let cmCloudPinnedCourseCode = null;
let cmCloudSelection = [];
let cmCloudSelectionTouched = false;
let cmSeqCourse = ""; // "" = all-courses grid; else a course code (Sequence Graph view)

function getCMConceptColor(concept) {
  if (!conceptColorMap[concept]) {
    const idx = Object.keys(conceptColorMap).length % CM_PALETTE.length;
    conceptColorMap[concept] = CM_PALETTE[idx];
  }
  return conceptColorMap[concept];
}

function getConceptIndex() {
  if (DATA.concept_index) return DATA.concept_index;
  const idx = {};
  filtered().forEach(course => {
    const all = new Set();
    (course.clos||[]).forEach(clo => (clo.concepts||[]).forEach(c=>all.add(c)));
    all.forEach(c => { if(!idx[c]) idx[c]=[]; idx[c].push(course.code); });
  });
  return idx;
}

function getConceptsForCourse(courseCode) {
  const course = DATA.courses.find(c=>c.code===courseCode);
  if (!course) return [];
  if (course.concepts && course.concepts.length) return [...course.concepts].sort();
  const s = new Set();
  (course.clos||[]).forEach(cl=>(cl.concepts||[]).forEach(c=>s.add(c)));
  return [...s].sort();
}

function getSemesterFilteredDefaultCloudSelection(courses) {
  if (activeSemFilter === "All") return [];
  return courses.slice(0, CM_CLOUD_MAX_COURSES).map(c => c.code);
}

function normalizeCloudSelection(courses) {
  const visibleCodes = new Set(courses.map(c => c.code));
  cmCloudSelection = cmCloudSelection.filter(code => visibleCodes.has(code)).slice(0, CM_CLOUD_MAX_COURSES);
  if (!cmCloudSelectionTouched && !cmCloudSelection.length) {
    cmCloudSelection = getSemesterFilteredDefaultCloudSelection(courses);
  }
  return [...cmCloudSelection];
}

function syncCloudPinnedCourse(selectedCodes) {
  if (cmCloudPinnedCourseCode && !selectedCodes.includes(cmCloudPinnedCourseCode)) {
    cmCloudPinnedCourseCode = null;
  }
  return cmCloudPinnedCourseCode;
}

function sanitizeCssColor(color) {
  return /^#[0-9a-f]{6}$/i.test(String(color || "")) ? color : DEFAULT_COURSE_COLOR;
}

function calculateAnchorOrbit(canvasSize, courseCount, config) {
  return Math.max(
    config.min,
    Math.min(canvasSize * config.ratio, config.base + courseCount * config.perCourse)
  );
}

function getCloudSelectionMessage(selectedCount, visibleCount) {
  if (!selectedCount) {
    return `Select up to <strong>${CM_CLOUD_MAX_COURSES}</strong> courses to see their Knowledge Unit coverage.`;
  }
  if (visibleCount === selectedCount) {
    return `Showing <strong>${selectedCount}</strong> of up to <strong>${CM_CLOUD_MAX_COURSES}</strong> course blobs.`;
  }
  return `Selected <strong>${selectedCount}</strong> courses; <strong>${visibleCount}</strong> currently have visible coverage.`;
}

window.cmToggleCloudCourse = function(code) {
  const courses = filtered();
  if (!courses.some(c => c.code === code)) return;
  const i = cmCloudSelection.indexOf(code);
  cmCloudSelectionTouched = true;
  if (i >= 0) cmCloudSelection.splice(i, 1);
  else if (cmCloudSelection.length < CM_CLOUD_MAX_COURSES) cmCloudSelection.push(code);
  syncCloudPinnedCourse(cmCloudSelection);
  cmRender();
};

window.cmFitView = function() { if(window._cmFitFn) window._cmFitFn(); };
window.cmUpdateForce = function(val) {
  document.getElementById("cm-force-val").textContent=val;
  if(window._cmUpdateForceFn) window._cmUpdateForceFn(Number(val));
};

window.cmSetView = function(v) {
  // Only allow remaining views
  if(!["curriculum","network","compare","cloud","sequence"].includes(v)) v="curriculum";
  cmView=v;
  document.querySelectorAll(".cm-seg-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===v));
  const fc=document.getElementById("cm-force-controls");
  if(fc) fc.style.display=v==="network"?"flex":"none";
  const sc=document.getElementById("cm-seq-controls");
  if(sc) sc.style.display=v==="sequence"?"flex":"none";
  cmRender();
};

window.cmRender = function() {
  if(activeTab!=="concepts") return;
  const badge=document.getElementById("cm-mode-badge");
  if(badge){
    const mode=DATA.concept_mode||"rule";
    const labels={rule:"Rule-based",llm:"LLM-assisted",both:"Rule + LLM"};
    badge.textContent=labels[mode]||mode;
    badge.className=`cm-mode-badge mode-${mode}`;
    badge.style.display="inline-block";
  }
  const minOverlap=parseInt(document.getElementById("cm-min-overlap").value);
  const search=(document.getElementById("cm-search").value||"").toLowerCase().trim();
  const courses=filtered();
  const rawIdx=getConceptIndex();
  const visibleCodes=new Set(courses.map(c=>c.code));
  const idx={};
  Object.entries(rawIdx).forEach(([concept,codes])=>{
    const fc=codes.filter(code=>visibleCodes.has(code));
    if(fc.length>=minOverlap){
      if(!search||concept.toLowerCase().includes(search)) idx[concept]=fc;
    }
  });
  const sortedConcepts=Object.entries(idx).sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0]));
  sortedConcepts.forEach(([c])=>getCMConceptColor(c));

  ["curriculum", "network", "compare", "cloud", "sequence"].forEach(v => {
    document.getElementById("cmv-"+v).classList.toggle("hidden",cmView!==v);
  });
  if(cmView==="curriculum") cmRenderCurriculum(courses,sortedConcepts,idx);
  if(cmView==="network")    cmRenderNetwork(courses,sortedConcepts,idx);
  if(cmView==="compare")    cmRenderCompare(courses,sortedConcepts,idx);
  if(cmView==="cloud")      cmRenderCloud(courses,sortedConcepts,idx);
  if(cmView==="sequence")   cmRenderSequence(courses);
};

/* ── Curriculum Concept Graph (UCSD-style with concept tags) ── */
function cmRenderCurriculum(courses,sortedConcepts,idx) {
  const el=document.getElementById("cmv-curriculum");
  const sems=allSemesters().filter(s=>courses.some(c=>c.semester===s));
  const sharedSet=new Set(sortedConcepts.map(([c])=>c));

  if(!courses.length){
    el.innerHTML=`<div style="padding:3rem;text-align:center;color:var(--mu);">No courses to display.</div>`;
    return;
  }

  const bySem={};
  sems.forEach(s=>bySem[s]=[]);
  courses.forEach(c=>{if(bySem[c.semester]) bySem[c.semester].push(c);});

  let html=`<div class="cm-curr-grid">`;
  sems.forEach(sem=>{
    const sc=semColor(sem);
    const semCourses=bySem[sem]||[];
    html+=`<div class="cm-curr-col">
      <div class="cm-curr-col-hdr" style="border-top-color:${sc};">
        <div class="cm-curr-col-sem" style="color:${sc};">Semester ${sem}</div>
      </div>`;
    semCourses.forEach(course=>{
      const concepts=getConceptsForCourse(course.code);
      const tags=concepts.map(c=>{
        const col=getCMConceptColor(c);
        const shared=sharedSet.has(c);
        const cnt=(idx[c]||[]).length;
        return `<span class="cm-curr-concept${shared?" shared":""}"
          style="background:${col}18;color:${col};${shared?"outline-color:"+col+"55;":""}"
          onclick="cmClickConcept('${c.replace(/'/g,"\\'")}',null)"
          title="${shared?"Shared by "+cnt+" courses":"Unique to this course"}"
          >${c}${shared?`<span class="cm-curr-shared-badge">${cnt}</span>`:""}</span>`;
      }).join("");
      html+=`<div class="cm-curr-course" style="border-left-color:${sc};"
        id="cmcc-${course.code}"
        onclick="cmCurrSelectCourse('${course.code}',event)">
        <div class="cm-curr-code" style="color:${sc};">${course.code}</div>
        <div class="cm-curr-title">${course.title}</div>
        <div class="cm-curr-concepts">${tags||'<span style="font-size:.6rem;color:var(--dim);">No Knowledge Units extracted</span>'}</div>
      </div>`;
    });
    html+=`</div>`;
  });
  html+=`</div>`;
  el.innerHTML=html;
}

window.cmCurrSelectCourse = function(code, e) {
  e.stopPropagation();
  // Highlight the course; concept click is handled by cmClickConcept
  document.querySelectorAll(".cm-curr-course").forEach(el=>el.classList.remove("highlight"));
  const el=document.getElementById("cmcc-"+code);
  if(el) el.classList.add("highlight");
};


/* ── Network view ── */
function cmRenderNetwork(courses,sortedConcepts,idx){
  const el=document.getElementById("cmv-network");
  if(!courses.length){el.innerHTML=`<div style="padding:3rem;text-align:center;color:var(--mu);">No courses to display.</div>`;return;}
  if(cmNetSim){cmNetSim.stop();cmNetSim=null;}
  el.innerHTML=`<svg id="cm-net-svg" style="width:100%;height:100%;display:block;"></svg>
    <div class="cm-net-hint">Drag any node · Scroll to zoom · Click Knowledge Unit for details</div>
    <div class="cm-net-legend" id="cm-net-legend"></div>`;

  const W=el.clientWidth||960,H=el.clientHeight||620;
  const svg=d3.select("#cm-net-svg");
  const root=svg.append("g");
  const zB=d3.zoom().scaleExtent([0.02,8]).on("zoom",e=>root.attr("transform",e.transform));
  svg.call(zB).on("dblclick.zoom",null);

  function fitToNodes(tr){
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    [...courseNodes,...sharedNodes].forEach(d=>{const r=d.r||12;x0=Math.min(x0,d.x-r);y0=Math.min(y0,d.y-r);x1=Math.max(x1,d.x+r);y1=Math.max(y1,d.y+r);});
    const PAD=60;x0-=PAD;y0-=PAD;x1+=PAD;y1+=PAD;
    const bW=x1-x0,bH=y1-y0;if(bW<=0||bH<=0)return;
    const scale=Math.min(8,Math.min(W/bW,H/bH));
    const tx=W/2-scale*(x0+bW/2),ty=H/2-scale*(y0+bH/2);
    const t=d3.zoomIdentity.translate(tx,ty).scale(scale);
    if(tr)svg.transition().duration(700).ease(d3.easeCubicOut).call(zB.transform,t);
    else svg.call(zB.transform,t);
  }

  const conceptsByCourse={};courses.forEach(c=>{conceptsByCourse[c.code]=[];});
  const sharedConcepts=[];
  sortedConcepts.forEach(([label,codes])=>{
    const visible=codes.filter(c=>courses.some(x=>x.code===c));
    if(!visible.length)return;
    if(visible.length===1){if(conceptsByCourse[visible[0]])conceptsByCourse[visible[0]].push(label);}
    else sharedConcepts.push({label,count:visible.length,courses:visible});
  });

  const sems=allSemesters().filter(s=>courses.some(c=>c.semester===s));
  const semIndex={};sems.forEach((s,i)=>semIndex[s]=i);
  const semW=Math.max(150,W/(sems.length+1));

  // courseNodes/sharedNodes below already carry `type` fields (`course` / `shared`) and can evolve to typed knowledge graph entities later.
  const courseNodes=courses.map(c=>{
    const si=semIndex[c.semester]||0;
    const sameSem=courses.filter(x=>x.semester===c.semester);
    const posInSem=sameSem.indexOf(c);
    return{id:c.code,type:"course",label:c.code,title:c.title,semester:c.semester,
      color:semColor(c.semester),r:55,
      x:(si+0.5)*semW+70+(Math.random()-.5)*30,
      y:80+posInSem*120+(Math.random()-.5)*20};
  });

  const sharedNodes=sharedConcepts.map(sc=>{
    const parents=sc.courses.map(c=>courseNodes.find(n=>n.id===c)).filter(Boolean);
    const sx=parents.reduce((a,n)=>a+n.x,0)/parents.length+(Math.random()-.5)*60;
    const sy=parents.reduce((a,n)=>a+n.y,0)/parents.length+(Math.random()-.5)*60;
    return{id:"s::"+sc.label,type:"shared",label:sc.label,count:sc.count,
      color:getCMConceptColor(sc.label),r:10+sc.count*4,x:sx,y:sy};
  });

  const allNodes=[...courseNodes,...sharedNodes];
  const links=[];
  sharedConcepts.forEach(sc=>{
    sc.courses.filter(c=>courses.some(x=>x.code===c)).forEach(code=>{
      links.push({source:code,target:"s::"+sc.label,color:getCMConceptColor(sc.label)});
    });
  });

  const linkLayer=root.append("g"),bubbleLayer=root.append("g"),uniqueLayer=root.append("g"),sharedLayer=root.append("g");
  const linkEl=linkLayer.selectAll("line").data(links).enter().append("line")
    .attr("stroke",d=>d.color).attr("stroke-width",2.5).attr("stroke-opacity",0.55);

  const bubbleGlow=bubbleLayer.selectAll("circle.bg").data(courseNodes).enter().append("circle").attr("class","bg")
    .attr("r",d=>d.r+8).attr("fill",d=>d.color).attr("fill-opacity",0.06)
    .attr("stroke",d=>d.color).attr("stroke-width",1).attr("stroke-opacity",0.25).attr("pointer-events","none");
  const bubbleEl=bubbleLayer.selectAll("circle.bm").data(courseNodes).enter().append("circle").attr("class","bm")
    .attr("r",d=>d.r).attr("fill",d=>d.color).attr("fill-opacity",0.14)
    .attr("stroke",d=>d.color).attr("stroke-width",2.5).attr("stroke-opacity",0.8)
    .style("cursor","grab").call(dragBehavior(true))
    .on("mouseenter",(e,d)=>{d3.select(e.currentTarget).attr("fill-opacity",0.28);showTip(e,`<div class="th">${d.label}</div><div class="tm">${d.title}</div><div class="tm" style="color:${d.color};">${semLabel(d.semester)}</div>`);})
    .on("mouseleave",(e)=>{d3.select(e.currentTarget).attr("fill-opacity",0.14);hideTip();})
    .on("mousemove",moveTip);
  const courseLabel=bubbleLayer.selectAll("text.bl").data(courseNodes).enter().append("text").attr("class","bl")
    .text(d=>d.label).attr("text-anchor","middle").attr("dominant-baseline","central")
    .attr("font-family","'DM Mono',monospace").attr("font-size","11px").attr("font-weight","800")
    .attr("fill",d=>d.color).attr("pointer-events","none");

  const uniqueData=[];
  courseNodes.forEach(cn=>{
    const labels=conceptsByCourse[cn.id]||[];
    labels.forEach((label,i)=>{
      const n=labels.length,rings=Math.ceil(n/6),ring=Math.floor(i/6),slot=i%6;
      const rr=(ring+1)*(cn.r-10)/(rings+0.5);
      const angle=(2*Math.PI*slot/Math.min(n-ring*6,6))+ring*0.3;
      uniqueData.push({parentId:cn.id,label,ox:Math.cos(angle)*rr,oy:Math.sin(angle)*rr,color:getCMConceptColor(label),parentNode:cn});
    });
  });
  const uniqueG=uniqueLayer.selectAll("g.uc").data(uniqueData).enter().append("g").attr("class","uc")
    .style("cursor","pointer")
    .on("click",(e,d)=>{e.stopPropagation();cmClickConcept(d.label,null);})
    .on("mouseenter",(e,d)=>{d3.select(e.currentTarget).select("circle").attr("r",5).attr("fill-opacity",1);showTip(e,`<div class="th">${d.label}</div><div class="tm">Unique to ${d.parentId}</div>`);})
    .on("mouseleave",(e)=>{d3.select(e.currentTarget).select("circle").attr("r",4).attr("fill-opacity",0.75);hideTip();})
    .on("mousemove",moveTip);
  uniqueG.append("circle").attr("r",4).attr("fill",d=>d.color).attr("fill-opacity",0.75).attr("stroke","#fff").attr("stroke-width",0.8);
  uniqueG.append("text").text(d=>d.label).attr("text-anchor","middle").attr("dy","1.55em")
    .attr("font-family","'Outfit',sans-serif").attr("font-size","8px").attr("fill",d=>d.color).attr("pointer-events","none");

  const sharedG=sharedLayer.selectAll("g.sc").data(sharedNodes).enter().append("g").attr("class","sc")
    .style("cursor","pointer").call(dragBehavior(false))
    .on("click",(e,d)=>{e.stopPropagation();cmClickConcept(d.label,null);})
    .on("mouseenter",(e,d)=>{d3.select(e.currentTarget).select("circle").attr("r",d.r*1.25).attr("fill-opacity",1);showTip(e,`<div class="th">${d.label}</div><div class="tm">Shared by ${d.count} courses: ${(idx[d.label]||[]).join(", ")}</div>`);})
    .on("mouseleave",(e,d)=>{d3.select(e.currentTarget).select("circle").attr("r",d.r).attr("fill-opacity",0.85);hideTip();})
    .on("mousemove",moveTip);
  sharedG.append("circle").attr("r",d=>d.r).attr("fill",d=>d.color).attr("fill-opacity",0.85).attr("stroke","#fff").attr("stroke-width",1.8);
  sharedG.append("text").text(d=>d.label).attr("text-anchor","middle").attr("dy",d=>d.r+11)
    .attr("font-family","'Outfit',sans-serif").attr("font-size","11px").attr("font-weight","700").attr("fill",d=>d.color).attr("pointer-events","none");
  sharedG.append("text").text(d=>d.count).attr("text-anchor","middle").attr("dominant-baseline","central")
    .attr("font-family","'DM Mono',monospace").attr("font-size","9px").attr("font-weight","800").attr("fill","#fff").attr("pointer-events","none");

  function dragBehavior(ic){
    return d3.drag()
      .on("start",(e,d)=>{if(!e.active)sim.alphaTarget(0.15).restart();d.fx=d.x;d.fy=d.y;})
      .on("drag",(e,d)=>{d.fx=e.x;d.fy=e.y;})
      .on("end",(e,d)=>{if(!e.active)sim.alphaTarget(0);d.fx=null;d.fy=null;});
  }

  const linkDist=d=>{
    const src=typeof d.source==="object"?d.source:allNodes.find(n=>n.id===d.source);
    const tgt=typeof d.target==="object"?d.target:allNodes.find(n=>n.id===d.target);
    return(src?.r||55)+(tgt?.r||14)+30;
  };
  let tc=0;
  const sim=d3.forceSimulation(allNodes)
    .force("link",d3.forceLink(links).id(d=>d.id).distance(linkDist).strength(0.4))
    .force("charge",d3.forceManyBody().strength(d=>d.type==="course"?-400:-80).distanceMax(800))
    .force("collide",d3.forceCollide().radius(d=>d.type==="course"?d.r+28:d.r+14).strength(0.85).iterations(3))
    .alphaDecay(0.018).velocityDecay(0.45)
    .on("tick",()=>{
      linkEl.attr("x1",d=>d.source.x).attr("y1",d=>d.source.y).attr("x2",d=>d.target.x).attr("y2",d=>d.target.y);
      [bubbleEl,bubbleGlow].forEach(s=>s.attr("cx",d=>d.x).attr("cy",d=>d.y));
      courseLabel.attr("x",d=>d.x).attr("y",d=>d.y);
      uniqueG.attr("transform",d=>{const pn=courseNodes.find(n=>n.id===d.parentId);if(!pn)return"";return`translate(${pn.x+d.ox},${pn.y+d.oy})`;});
      sharedG.attr("transform",d=>`translate(${d.x},${d.y})`);
      tc++;if(tc===80)fitToNodes(false);
    })
    .on("end",()=>fitToNodes(true));
  cmNetSim=sim;

  svg.on("click",()=>{cmCloseDetail();});
  window._cmFitFn=()=>fitToNodes(true);
  window._cmUpdateForceFn=(val)=>{
    const mult=val/5;
    sim.force("charge",d3.forceManyBody().strength(d=>d.type==="course"?-400*mult:-80*mult).distanceMax(800*mult));
    sim.force("collide",d3.forceCollide().radius(d=>d.type==="course"?d.r+28*mult:d.r+14*mult).strength(0.85).iterations(3));
    sim.alphaTarget(0.25).restart();setTimeout(()=>{sim.alphaTarget(0);fitToNodes(true);},1500);
  };

  const sems2=[...new Set(courses.map(c=>c.semester))].sort((a,b)=>a-b);
  const leg=document.getElementById("cm-net-legend");
  if(leg){
    leg.innerHTML=`<div class="cm-net-legend-title">Semesters</div>`+
      sems2.map(s=>{const col=semColor(s);return`<div class="cm-net-leg-row"><div class="cm-net-leg-dot" style="background:${col};"></div><span style="color:${col};font-weight:600;">${semLabel(s)}</span></div>`;}).join("")+
      `<div style="border-top:1px solid var(--bdr);margin:.4rem 0 .3rem;"></div>
       <div class="cm-net-legend-title">Nodes</div>
       <div class="cm-net-leg-row"><svg width="18" height="18"><circle cx="9" cy="9" r="8" fill="none" stroke="#64748b" stroke-width="2"/></svg><span style="color:var(--mu);">Course bubble</span></div>
       <div class="cm-net-leg-row"><svg width="18" height="18"><circle cx="9" cy="9" r="4" fill="#64748b" fill-opacity=".75"/></svg><span style="color:var(--mu);">Unique Knowledge Unit</span></div>
       <div class="cm-net-leg-row"><svg width="18" height="18"><circle cx="9" cy="9" r="7" fill="#2563eb" fill-opacity=".85" stroke="#fff" stroke-width="1.5"/></svg><span style="color:var(--mu);">Shared Knowledge Unit</span></div>`;
  }
}

/* ── Knowledge Unit detail panel ── */
window.cmClickConcept = function(concept,tagEl) {
  cmSelectedConcept=concept;
  document.querySelectorAll(".cc-tag").forEach(t=>t.classList.remove("selected"));
  if(tagEl){const col=getCMConceptColor(concept);tagEl.classList.add("selected");tagEl.style.borderColor=col;}

  const idx=getConceptIndex();
  const codes=(idx[concept]||[]).filter(code=>filtered().some(c=>c.code===code));

  let detail=document.getElementById("cm-detail-panel");
  if(!detail){detail=document.createElement("div");detail.id="cm-detail-panel";detail.className="cm-detail";document.body.appendChild(detail);}

  const rows=codes.map(code=>{
    const course=DATA.courses.find(c=>c.code===code);
    const rl=(course?.clos||[]).filter(clo=>(clo.concepts||[]).includes(concept));
    return`<div class="cm-dc-row">
      <span class="cm-dc-code">${code}</span>
      <span class="cm-dc-title">${course?.title||""}</span>
    </div>
    ${rl.map(clo=>`<div style="font-size:.62rem;color:var(--dim);padding-left:1rem;margin-top:.12rem;line-height:1.4;margin-bottom:.2rem;">
      <strong>${clo.code}</strong>: ${clo.description.substring(0,90)}…</div>`).join("")}`;
  }).join("");

  const col=getCMConceptColor(concept);
  detail.innerHTML=`<button class="cm-detail-close" onclick="cmCloseDetail()">✕</button>
    <div class="cm-detail-concept" style="color:${col};">${concept}</div>
    <div style="font-size:.67rem;color:var(--mu);margin-bottom:.6rem;">
      Covered by <strong style="color:var(--tx);">${codes.length}</strong> course${codes.length!==1?"s":""}
    </div>
    <div class="cm-detail-courses">${rows||'<div style="color:var(--dim);font-size:.72rem;">No courses in current filter.</div>'}</div>`;
  detail.classList.add("show");
};

window.cmCloseDetail=function(){
  const d=document.getElementById("cm-detail-panel");
  if(d)d.classList.remove("show");
  cmSelectedConcept=null;
};

/* ── Course Comparison Logic (3+ courses) ── */
let cmCompareSelection = [];

window.cmRenderCompare = function(courses) {
  const el = document.getElementById("cmv-compare");

  // Seed selection with first 3 courses if empty
  if (cmCompareSelection.length === 0 && courses.length >= 2) {
    cmCompareSelection = courses.slice(0, Math.min(3, courses.length)).map(c => c.code);
  }
  // Remove codes no longer in current filter
  cmCompareSelection = cmCompareSelection.filter(code => courses.some(c => c.code === code));

  const pills = courses.map(c => {
    const sc = semColor(c.semester);
    const sel = cmCompareSelection.includes(c.code);
    const title = escH(c.title || "");
    return `<button class="cm-cmp-pill${sel ? ' active' : ''}"
      id="cmpill-${c.code}"
      style="background:${sc}${sel ? CMP_PILL_SELECTED_ALPHA : CMP_PILL_DEFAULT_ALPHA};border-color:${sc};color:${sc};"
      onclick="cmToggleCompare('${c.code}','${sc}')"
      title="${title}">
      <span class="cm-cmp-pill-code">${c.code}</span>
      <span class="cm-cmp-pill-title">${title}</span>
      </button>`;
  }).join("");

  el.innerHTML = `
    <div class="cm-cmp-container">
      <div class="cm-cmp-pills">
        <span class="cm-cmp-heading">Select courses:</span>
        ${pills}
      </div>
      <div id="cm-cmp-results"></div>
    </div>`;

  cmDrawMultiCompare(courses);
};

window.cmToggleCompare = function(code, color) {
  const i = cmCompareSelection.indexOf(code);
  const btn = document.getElementById("cmpill-" + code);
  if (i >= 0) {
    cmCompareSelection.splice(i, 1);
    if (btn) {
      btn.classList.remove("active");
      const course = filtered().find(c => c.code === code);
      const sc = semColor(course?.semester || 0);
      btn.style.cssText = `background:${sc}${CMP_PILL_DEFAULT_ALPHA};border-color:${sc};color:${sc};`;
    }
  } else {
    cmCompareSelection.push(code);
    if (btn) {
      btn.classList.add("active");
      btn.style.cssText = `background:${color}${CMP_PILL_SELECTED_ALPHA};border-color:${color};color:${color};`;
    }
  }
  const courses = filtered();
  cmDrawMultiCompare(courses);
};

function cmDrawMultiCompare(courses) {
  const resEl = document.getElementById("cm-cmp-results");
  if (!resEl) return;

  const sel = cmCompareSelection.filter(code => courses.some(c => c.code === code));

  if (sel.length < 2) {
    resEl.innerHTML = `<div style="text-align:center;color:var(--mu);padding:2rem;">
      Select at least <strong>2</strong> courses above to compare their Knowledge Units.
    </div>`;
    return;
  }

  // Build concept sets per selected course
  const selCourses = sel.map(code => ({
    code,
    course: courses.find(c => c.code === code),
    concepts: new Set(getConceptsForCourse(code))
  }));

  // Collect all Knowledge Units covered by any selected course
  const allTopics = [...new Set(selCourses.flatMap(s => [...s.concepts]))].sort();

  if (!allTopics.length) {
    resEl.innerHTML = `<div style="text-align:center;color:var(--mu);padding:2rem;">
      No Knowledge Units extracted for the selected courses.
    </div>`;
    return;
  }

  // Count how many selected courses cover each topic
  const topicCoverage = allTopics.map(t => ({
    topic: t,
    count: selCourses.filter(s => s.concepts.has(t)).length,
    courses: selCourses.filter(s => s.concepts.has(t)).map(s => s.code)
  }));

  // Sort: most shared first, then alphabetical
  topicCoverage.sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));

  const sharedAll = topicCoverage.filter(t => t.count === sel.length);
  const shared    = topicCoverage.filter(t => t.count > 1 && t.count < sel.length);
  const unique    = topicCoverage.filter(t => t.count === 1);

  const colHeaders = sel.map(code => {
    const c = selCourses.find(s => s.code === code);
    const sc = semColor(c.course?.semester || 0);
    return `<th style="color:${sc};">${code}</th>`;
  }).join("");

  const renderRows = (rows, rowClass) => rows.map(({topic, courses: cCodes}) => {
    const col = getCMConceptColor(topic);
    const cells = sel.map(code => {
      const has = cCodes.includes(code);
      const sc2 = semColor(selCourses.find(s=>s.code===code)?.course?.semester || 0);
      return `<td><span class="cm-cmp-chk" style="${has
        ? `background:${sc2}18;color:${sc2};` : 'color:var(--dim);'}">${has ? "✓" : "·"}</span></td>`;
    }).join("");
    return `<tr class="${rowClass}">
      <td class="topic-cell">
        <span style="background:${col}18;color:${col};padding:.1rem .4rem;border-radius:10px;font-size:.67rem;font-weight:600;cursor:pointer;"
          data-concept="${escA(topic)}"
          onclick="cmClickConcept(this.dataset.concept)">${escH(topic)}</span>
      </td>${cells}
    </tr>`;
  }).join("");

  const totalShared = sharedAll.length + shared.length;
  resEl.innerHTML = `
    <p class="cm-cmp-info">
      Comparing <strong>${sel.length} courses</strong> ·
      <strong>${allTopics.length}</strong> Knowledge Units total ·
      <strong style="color:var(--goldd);">${sharedAll.length}</strong> shared by all ·
      <strong>${totalShared}</strong> shared by any two+
    </p>
    <div class="cm-cmp-table-wrap">
      <table class="cm-cmp-tbl">
        <thead><tr><th class="topic-col">Knowledge Unit</th>${colHeaders}</tr></thead>
        <tbody>
          ${sharedAll.length ? `<tr><td colspan="${sel.length+1}"
            style="font-size:.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;
              color:var(--goldd);padding:.4rem .7rem .15rem;background:#fdf8ee;">
            ★ Shared by all ${sel.length} courses (${sharedAll.length})
          </td></tr>${renderRows(sharedAll,'cm-cmp-shared-all')}` : ''}
          ${shared.length ? `<tr><td colspan="${sel.length+1}"
            style="font-size:.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;
              color:var(--mu);padding:.4rem .7rem .15rem;background:#f7f9fd;">
            Shared by some courses (${shared.length})
          </td></tr>${renderRows(shared,'')}` : ''}
          ${unique.length ? `<tr><td colspan="${sel.length+1}"
            style="font-size:.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;
              color:var(--dim);padding:.4rem .7rem .15rem;background:#f7f9fd;">
            Unique to one course (${unique.length})
          </td></tr>${renderRows(unique,'')}` : ''}
        </tbody>
      </table>
    </div>`;
}

/* ================================================================
   KNOWLEDGE AREA OVERLAP VIEW
================================================================ */
function cmMulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cmMeasurePill(measureCtx, concept, count) {
  const LABEL_MIN = 9, LABEL_MAX = 18, LABEL_SCALE = 110, SHARED_TOPIC_BONUS = 4;
  const PILL_PAD_X = 16, PILL_PAD_Y = 9;
  const fontSize = Math.max(
    LABEL_MIN,
    Math.min(LABEL_MAX, LABEL_SCALE / Math.max(1, concept.length) + Math.min(SHARED_TOPIC_BONUS, count - 1))
  );
  if (measureCtx) measureCtx.font = `600 ${fontSize}px Outfit, sans-serif`;
  const textW = measureCtx ? measureCtx.measureText(concept).width : concept.length * fontSize * 0.58;
  const width = Math.max(70, textW + PILL_PAD_X * 2);
  const height = fontSize + PILL_PAD_Y * 2;
  return { fontSize, width, height, radius: Math.sqrt((width / 2) ** 2 + (height / 2) ** 2) };
}

/* Andrew's monotone chain convex hull over point centers; returns the outer boundary in drawing order. */
function cmHullPoints(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 1) return sorted;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  sorted.forEach(p => {
    while (lower.length >= 2) {
      const secondLastLower = lower[lower.length - 2];
      const lastLower = lower[lower.length - 1];
      if (cross(secondLastLower, lastLower, p) > 0) break;
      lower.pop();
    }
    lower.push(p);
  });
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2) {
      const secondLastUpper = upper[upper.length - 2];
      const lastUpper = upper[upper.length - 1];
      if (cross(secondLastUpper, lastUpper, p) > 0) break;
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function cmInflateHull(points, pad) {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  return points.map(p => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const pd = (p.radius || 0) + pad;
    return { x: p.x + (dx / len) * pd, y: p.y + (dy / len) * pd };
  });
}

function cmTwoPointBlob(points, pad) {
  const [a, b] = points;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const p = (((a.radius || 0) + (b.radius || 0)) / 2) * 0.58 + pad;
  const cap = p * 0.4;
  return [
    { x: a.x - ux * cap + px * p, y: a.y - uy * cap + py * p },
    { x: b.x + ux * cap + px * p, y: b.y + uy * cap + py * p },
    { x: b.x + ux * cap - px * p, y: b.y + uy * cap - py * p },
    { x: a.x - ux * cap - px * p, y: a.y - uy * cap - py * p },
  ];
}

const CM_BLOB_PAD = 14;
const CM_BLOB_LINE = d3.line().x(d => d.x).y(d => d.y).curve(d3.curveCatmullRomClosed.alpha(0.72));

/* Evenly space selected-course "attractor" centroids around a ring so shared topics
   naturally settle between the centroids of every course that covers them. */
function cmLayoutCourseCentroids(codes, canvasW, canvasH) {
  const map = new Map();
  const n = codes.length;
  if (!n) return map;
  const cx = canvasW / 2, cy = canvasH / 2;
  if (n === 1) { map.set(codes[0], { x: cx, y: cy }); return map; }
  const radius = Math.min(canvasW, canvasH) * (n <= 3 ? 0.2 : n <= 6 ? 0.28 : 0.34);
  codes.forEach((code, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    map.set(code, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  });
  return map;
}

let _cmCloud = null;

function cmCloudSignature(courses, sortedConcepts) {
  return courses.map(c => c.code).sort().join(",") + "||" + sortedConcepts.map(([c]) => c).sort().join(",");
}

/* ── Dispatcher: mount fresh only when the underlying course/topic set actually
   changes (filters, search); course-selection toggles reuse the live simulation
   so topics animate fluidly instead of snapping to a freshly computed layout. ── */
function cmRenderCloud(courses, sortedConcepts, idx) {
  const el = document.getElementById("cmv-cloud");
  if (!courses.length || !sortedConcepts.length) {
    if (_cmCloud && _cmCloud.sim) _cmCloud.sim.stop();
    _cmCloud = null;
    el.innerHTML = `<div style="padding:3rem;text-align:center;color:var(--mu);">No Knowledge Units to display.</div>`;
    return;
  }
  normalizeCloudSelection(courses);
  const signature = cmCloudSignature(courses, sortedConcepts);
  const needsRemount = !_cmCloud || _cmCloud.signature !== signature || !document.getElementById("cm-cloud-svg");
  if (needsRemount) {
    cmMountCloud(courses, sortedConcepts, idx, signature);
  } else {
    _cmCloud.idx = idx;
    _cmCloud.courses = courses;
    cmUpdateCloudSelection();
  }
}

function cmMountCloud(courses, sortedConcepts, idx, signature) {
  const el = document.getElementById("cmv-cloud");
  if (_cmCloud && _cmCloud.sim) _cmCloud.sim.stop();

  // Fixed logical canvas that every node is clamped inside — this guarantees the
  // "fit view" transform always reveals the full topic space, however it settles.
  const canvasW = Math.max(1000, Math.round(Math.sqrt(sortedConcepts.length) * 190));
  const canvasH = Math.max(680, Math.round(Math.sqrt(sortedConcepts.length) * 140));

  const courseByCode = Object.fromEntries(courses.map(c => [c.code, c]));
  const courseIndexByCode = new Map(courses.map((course, i) => [course.code, i]));
  const courseColor = code => CM_PALETTE[(courseIndexByCode.get(code) ?? 0) % CM_PALETTE.length] || semColor(courseByCode[code]?.semester || 0);

  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  const rng = cmMulberry32(sortedConcepts.length * 2654435761 % 2147483647 || 1);

  const nodes = sortedConcepts.map(([concept, codes]) => {
    const metrics = cmMeasurePill(measureCtx, concept, codes.length);
    return {
      id: concept,
      concept,
      courses: [...codes],
      courseSet: new Set(codes),
      count: codes.length,
      color: getCMConceptColor(concept),
      ...metrics,
      x: CM_BLOB_PAD + 40 + rng() * (canvasW - (CM_BLOB_PAD + 40) * 2),
      y: CM_BLOB_PAD + 40 + rng() * (canvasH - (CM_BLOB_PAD + 40) * 2),
      targetX: null,
      targetY: null,
      selected: false,
    };
  });
  const nodeByConcept = new Map(nodes.map(n => [n.concept, n]));

  el.innerHTML = `
    <div class="kc-course-strip" id="kc-course-strip"></div>
    <div class="kc-stage" id="kc-stage">
      <div class="kb-legend-box">
        <div class="kb-legend-title">Knowledge Area Overlap</div>
        <div class="kb-legend-row"><span style="width:22px;height:14px;border-radius:999px;background:rgba(37,99,235,.15);border:1px solid rgba(37,99,235,.5);display:inline-block;"></span><span style="color:var(--mu);">pill = Knowledge Unit</span></div>
        <div class="kb-legend-row"><span style="width:22px;height:14px;border-radius:999px;background:rgba(14,165,233,.14);display:inline-block;"></span><span style="color:var(--mu);">blob = selected course</span></div>
        <div style="font-size:.58rem;color:var(--dim);margin-top:.3rem;line-height:1.4;">
          Overlapping blobs = shared units.<br>Scroll/drag to zoom &amp; pan.
        </div>
      </div>
      <div class="kc-stage-toolbar">
        <button class="kc-stage-btn" onclick="cmCloudZoomBy(1.3)" title="Zoom in">+</button>
        <button class="kc-stage-btn" onclick="cmCloudZoomBy(0.77)" title="Zoom out">\u2212</button>
        <button class="kc-stage-btn" onclick="cmFitView()" title="Fit all topics">\u2922</button>
      </div>
      <svg id="cm-cloud-svg"></svg>
    </div>`;

  const svg = d3.select("#cm-cloud-svg");
  const zoomLayer = svg.append("g").attr("class", "kc-zoom-layer");
  const blobLayer = zoomLayer.append("g").attr("class", "kc-blob-layer").style("mix-blend-mode", "multiply");
  const pillLayer = zoomLayer.append("g").attr("class", "kc-pill-layer");

  const zoom = d3.zoom()
    .scaleExtent([0.2, 4])
    .on("start", () => svg.classed("grabbing", true))
    .on("zoom", event => zoomLayer.attr("transform", event.transform))
    .on("end", () => svg.classed("grabbing", false));
  svg.call(zoom).on("dblclick.zoom", null);

  _cmCloud = {
    signature, el, svg, zoom, zoomLayer, blobLayer, pillLayer,
    nodes, nodeByConcept, courses, courseByCode, courseColor,
    canvasW, canvasH, idx,
    pinned: cmCloudPinnedCourseCode, hovered: null,
    blobGroups: [], blobSel: null,
  };

  const pillSel = pillLayer.selectAll("g.kc-cloud-pill")
    .data(nodes, d => d.concept)
    .enter()
    .append("g")
    .attr("class", "kc-cloud-pill")
    .style("cursor", "pointer")
    .on("mouseenter", (e, d) => {
      kbShowTip(e, d.concept, d.courses.join(", "));
      d3.select(e.currentTarget).select("rect").attr("fill-opacity", 0.3).attr("stroke-opacity", 0.8);
    })
    .on("mousemove", moveTip)
    .on("mouseleave", e => {
      hideTip();
      const d = d3.select(e.currentTarget).datum();
      d3.select(e.currentTarget).select("rect")
        .attr("fill-opacity", d.selected ? 0.2 : 0.05)
        .attr("stroke-opacity", d.selected ? 0.65 : 0.18);
    })
    .on("click", (e, d) => {
      e.stopPropagation();
      _cmCloud.pinned = null;
      cmCloudPinnedCourseCode = null;
      cmApplyBlobFocus();
      cmClickConcept(d.concept, null);
    });

  pillSel.append("rect")
    .attr("x", d => -d.width / 2).attr("y", d => -d.height / 2)
    .attr("rx", d => d.height / 2).attr("ry", d => d.height / 2)
    .attr("width", d => d.width).attr("height", d => d.height)
    .attr("fill", d => d.color).attr("fill-opacity", 0.05)
    .attr("stroke", d => d.color).attr("stroke-opacity", 0.18)
    .attr("stroke-width", 1);

  pillSel.append("text")
    .attr("text-anchor", "middle").attr("dominant-baseline", "central")
    .attr("font-family", "'Outfit',sans-serif")
    .attr("font-size", d => `${d.fontSize}px`)
    .attr("font-weight", 500)
    .attr("fill", d => d.color).attr("fill-opacity", 0.35)
    .text(d => d.concept);

  _cmCloud.pillSel = pillSel;

  const sim = d3.forceSimulation(nodes)
    .force("charge", d3.forceManyBody().strength(-26))
    .force("collide", d3.forceCollide().radius(d => d.radius + 3).strength(0.9).iterations(2))
    .force("x", d3.forceX(d => d.targetX != null ? d.targetX : canvasW / 2).strength(d => d.targetX != null ? 0.16 : 0.012))
    .force("y", d3.forceY(d => d.targetY != null ? d.targetY : canvasH / 2).strength(d => d.targetY != null ? 0.16 : 0.012))
    .alphaDecay(0.018)
    .alphaMin(0.001)
    .velocityDecay(0.55)
    .on("tick", cmCloudTick);

  _cmCloud.sim = sim;

  window._cmFitFn = cmCloudFitView;
  requestAnimationFrame(cmCloudFitView);

  cmUpdateCloudSelection();
}

function cmCloudTick() {
  if (!_cmCloud) return;
  const { nodes, pillSel, canvasW, canvasH } = _cmCloud;
  const pad = 10;
  nodes.forEach(d => {
    d.x = Math.max(pad + d.width / 2, Math.min(canvasW - pad - d.width / 2, d.x));
    d.y = Math.max(pad + d.height / 2, Math.min(canvasH - pad - d.height / 2, d.y));
  });
  pillSel.attr("transform", d => `translate(${d.x},${d.y})`);
  cmDrawBlobs();
}

/* Recompute each selected course's blob boundary from its member topics' *current*
   simulated positions, so blobs fluidly track the nodes every tick. */
function cmDrawBlobs() {
  if (!_cmCloud) return;
  const { blobLayer, nodeByConcept, courses, courseColor, idx } = _cmCloud;
  const selectedCourseSet = new Set(cmCloudSelection);
  const selectedCourses = courses.filter(c => selectedCourseSet.has(c.code));

  const groups = selectedCourses.map(course => {
    const conceptList = (getConceptsForCourse(course.code) || []).filter(c => idx[c]);
    const conceptNodes = conceptList.map(c => nodeByConcept.get(c)).filter(Boolean);
    const hullSource = conceptNodes.map(n => ({ x: n.x, y: n.y, radius: n.radius }));
    const hull = conceptNodes.length >= 3 ? cmHullPoints(hullSource) : [];
    const blobPoints = conceptNodes.length >= 3 ? cmInflateHull(hull, CM_BLOB_PAD)
      : conceptNodes.length === 2 ? cmTwoPointBlob(hullSource, CM_BLOB_PAD) : [];
    const centroid = conceptNodes.length ? {
      x: conceptNodes.reduce((s, n) => s + n.x, 0) / conceptNodes.length,
      y: conceptNodes.reduce((s, n) => s + n.y, 0) / conceptNodes.length,
    } : null;
    return {
      course, color: courseColor(course.code), nodes: conceptNodes, centroid,
      path: blobPoints.length >= 3 ? CM_BLOB_LINE(blobPoints) : null,
    };
  }).filter(g => g.nodes.length);

  const sel = blobLayer.selectAll("g.kc-blob").data(groups, g => g.course.code);
  sel.exit().remove();

  const enter = sel.enter().append("g").attr("class", "kc-blob").style("cursor", "pointer")
    .on("mouseenter", function(e, g) {
      _cmCloud.hovered = g.course.code;
      cmApplyBlobFocus();
      showTip(e, `<div class="th">${escH(g.course.code)} \u2014 ${escH(g.course.title)}</div>
        <div class="tm"><strong>${g.nodes.length} Knowledge Unit${g.nodes.length !== 1 ? "s" : ""} in current view</strong></div>`);
    })
    .on("mousemove", moveTip)
    .on("mouseleave", function() {
      _cmCloud.hovered = null;
      cmApplyBlobFocus();
      hideTip();
    })
    .on("click", function(e, g) {
      e.stopPropagation();
      _cmCloud.pinned = _cmCloud.pinned === g.course.code ? null : g.course.code;
      cmCloudPinnedCourseCode = _cmCloud.pinned;
      cmApplyBlobFocus();
      if (_cmCloud.pinned) showTip(e, `<div class="th">${escH(g.course.code)} \u2014 ${escH(g.course.title)}</div>
        <div class="tm"><strong>${g.nodes.length} Knowledge Unit${g.nodes.length !== 1 ? "s" : ""} in current view</strong></div>`);
      else hideTip();
    });
  enter.append("path").attr("class", "kc-blob-path");
  enter.append("circle").attr("class", "kc-blob-dot");

  const merged = enter.merge(sel);
  merged.each(function(g) {
    const node = d3.select(this);
    const path = node.select("path.kc-blob-path");
    const dot = node.select("circle.kc-blob-dot");
    if (g.path) {
      path.attr("d", g.path).style("display", null).attr("fill", g.color).attr("stroke", g.color);
      dot.style("display", "none");
    } else if (g.centroid) {
      path.style("display", "none");
      dot.attr("cx", g.centroid.x).attr("cy", g.centroid.y).attr("r", 10).style("display", null)
        .attr("fill", g.color).attr("stroke", g.color);
    } else {
      path.style("display", "none");
      dot.style("display", "none");
    }
  });

  _cmCloud.blobGroups = groups;
  _cmCloud.blobSel = merged;
  cmApplyBlobFocus();
}

function cmApplyBlobFocus() {
  if (!_cmCloud || !_cmCloud.blobSel) return;
  const activeCode = _cmCloud.pinned || _cmCloud.hovered;
  _cmCloud.blobSel.each(function(g) {
    const isActive = !!activeCode && g.course.code === activeCode;
    const dim = !!activeCode && !isActive;
    d3.select(this).selectAll("path.kc-blob-path,circle.kc-blob-dot")
      .attr("fill-opacity", isActive ? 0.22 : dim ? 0.035 : 0.1)
      .attr("stroke-opacity", isActive ? 0.5 : dim ? 0.06 : 0.16)
      .attr("stroke-width", isActive ? 1.6 : 1.1);
    if (isActive) this.parentNode.appendChild(this);
  });
}

/* Re-targets nodes toward the centroids of the currently-selected courses (or lets
   them float freely if unselected), refreshes the compact course strip, and gently
   reheats the simulation so the transition between selections is animated. */
function cmUpdateCloudSelection() {
  if (!_cmCloud) return;
  normalizeCloudSelection(_cmCloud.courses);
  syncCloudPinnedCourse(cmCloudSelection);
  _cmCloud.pinned = cmCloudPinnedCourseCode;

  const selectedCourseSet = new Set(cmCloudSelection);
  const selectedCourses = _cmCloud.courses.filter(c => selectedCourseSet.has(c.code));
  const centroids = cmLayoutCourseCentroids(selectedCourses.map(c => c.code), _cmCloud.canvasW, _cmCloud.canvasH);

  _cmCloud.nodes.forEach(n => {
    const myCourses = n.courses.filter(code => selectedCourseSet.has(code));
    n.selected = myCourses.length > 0;
    if (myCourses.length) {
      let tx = 0, ty = 0;
      myCourses.forEach(code => { const c = centroids.get(code); tx += c.x; ty += c.y; });
      n.targetX = tx / myCourses.length;
      n.targetY = ty / myCourses.length;
    } else {
      n.targetX = null;
      n.targetY = null;
    }
  });

  _cmCloud.pillSel.select("rect")
    .attr("fill-opacity", d => d.selected ? 0.2 : 0.05)
    .attr("stroke-opacity", d => d.selected ? 0.65 : 0.18)
    .attr("stroke-width", d => d.selected ? 1.6 : 1);
  _cmCloud.pillSel.select("text")
    .attr("font-weight", d => d.selected ? 800 : 500)
    .attr("fill-opacity", d => d.selected ? 1 : 0.35);

  if (_cmCloud.sim) _cmCloud.sim.alpha(Math.max(_cmCloud.sim.alpha(), 0.6)).restart();

  cmDrawBlobs();
  cmRenderCourseStrip();
}

function cmRenderCourseStrip() {
  const track = document.getElementById("kc-course-strip");
  if (!track || !_cmCloud) return;
  const { courses, courseColor } = _cmCloud;
  const selectedCourseSet = new Set(cmCloudSelection);
  const selectedCourses = courses.filter(c => selectedCourseSet.has(c.code));
  const chips = courses.map(course => {
    const color = sanitizeCssColor(courseColor(course.code));
    const courseCode = String(course.code || "");
    const safeCode = courseCode.replace(/'/g, "\\'");
    const safeLabel = escH(courseCode);
    const safeTitle = escH(course.title || "");
    const sel = selectedCourseSet.has(course.code);
    const disabled = !sel && selectedCourses.length >= CM_CLOUD_MAX_COURSES;
    return `<button class="kc-course-chip${sel ? " active" : ""}"
      style="${sel ? `background:${color}18;border-color:${color};color:${color};` : ""}"
      onclick="cmToggleCloudCourse('${safeCode}')"
      ${disabled ? "disabled" : ""}
      title="${safeTitle}">
      <span class="kc-course-chip-code" style="${sel ? `color:${color};` : ""}">${safeLabel}</span>
      <span class="kc-course-chip-title" style="${sel ? `color:${color};` : ""}">${safeTitle}</span>
      </button>`;
  }).join("");
  const visibleCount = _cmCloud.blobGroups ? _cmCloud.blobGroups.length : selectedCourses.length;
  const cloudNote = getCloudSelectionMessage(selectedCourses.length, visibleCount);
  const statusClass = `kc-course-strip-status${selectedCourses.length ? "" : " empty-selection"}`;
  track.innerHTML = `
    <span class="kc-course-strip-label">Courses</span>
    <div class="kc-course-strip-track">${chips}</div>
    <span class="${statusClass}">${cloudNote}</span>`;
}

function cmCloudFitView() {
  if (!_cmCloud) return;
  const stage = document.getElementById("kc-stage");
  if (!stage) return;
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  const { canvasW, canvasH, svg, zoom } = _cmCloud;
  const scale = Math.max(0.2, Math.min(4, Math.min(w / canvasW, h / canvasH) * 0.94));
  const tx = (w - canvasW * scale) / 2;
  const ty = (h - canvasH * scale) / 2;
  const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
  svg.transition().duration(500).call(zoom.transform, t);
}

window.cmCloudZoomBy = function(factor) {
  if (!_cmCloud) return;
  _cmCloud.svg.transition().duration(200).call(_cmCloud.zoom.scaleBy, factor);
};

/* Helper: show tooltip from Knowledge Unit overlays */
window.kbShowTip = function(e, concept, courseList) {
  const n = courseList.split(',').filter(s => s.trim()).length;
  tip.innerHTML = `<div class="th">${escH(concept)}</div>
    <div class="tm">Covered by <strong>${n}</strong> course${n !== 1 ? 's' : ''}:
    ${escH(courseList)}</div>`;
  tip.style.display = 'block';
  moveTip(e);
};

/* ══════════════════════════════════════════════════════════
   SEQUENCE GRAPH  —  topic-level prerequisite DAG per course,
   or a semester-grouped grid of every course's mini-DAG.

   Reads course.topics[] = {id,label,bloom_level,status} and
   course.edges[] = {source,target,type,rationale,confidence,status}
   as written by excel_to_json.py (edge_schema.types:
   prerequisite_of / corequisite_with / related_to).
══════════════════════════════════════════════════════════ */
const CM_SEQ_EDGE_STYLE = {
  prerequisite_of:  { stroke: "#4f46e5", label: "prerequisite of" },
  corequisite_with: { stroke: "#b8920e", label: "corequisite with" },
  related_to:       { stroke: "#9aaabf", label: "related to" },
};

function cmBloomColor(label) {
  const lvl = BLOOM_COGNITIVE_LEVELS.find(l => l.label === label);
  return lvl ? lvl.color : "#9aaabf";
}

const _cmSeqMeasureCtx = document.createElement("canvas").getContext("2d");
function cmSeqTextWidth(str, font) {
  _cmSeqMeasureCtx.font = font;
  return _cmSeqMeasureCtx.measureText(str).width;
}

function cmSeqEdgePath(a, b) {
  const midX = (a.x + a.w / 2 + b.x - b.w / 2) / 2;
  return `M${a.x + a.w / 2},${a.y} C${midX},${a.y} ${midX},${b.y} ${b.x - b.w / 2},${b.y}`;
}

/* Longest-path layering using prerequisite_of edges only; corequisite_with
   pairs are then pulled to the same layer. related_to never affects layer
   assignment — it's drawn as a purely informational connector. */
function cmLayoutTopicDag(course) {
  const topics = course.topics || [];
  const nodes  = topics.map(t => ({ ...t }));
  const byId   = new Map(nodes.map(n => [n.id, n]));
  const edges  = (course.edges || []).filter(e => byId.has(e.source) && byId.has(e.target));

  const prereq = edges.filter(e => e.type === "prerequisite_of");
  const coreq  = edges.filter(e => e.type === "corequisite_with");

  const indeg = new Map(nodes.map(n => [n.id, 0]));
  const adj   = new Map(nodes.map(n => [n.id, []]));
  prereq.forEach(e => {
    adj.get(e.source).push(e.target);
    indeg.set(e.target, (indeg.get(e.target) || 0) + 1);
  });

  const layer = new Map(nodes.map(n => [n.id, 0]));
  const queue = nodes.filter(n => indeg.get(n.id) === 0).map(n => n.id);
  const seen = new Set();
  let guard = 0;
  while (queue.length && guard++ < 2000) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    (adj.get(id) || []).forEach(next => {
      layer.set(next, Math.max(layer.get(next), layer.get(id) + 1));
      indeg.set(next, indeg.get(next) - 1);
      if (indeg.get(next) <= 0) queue.push(next);
    });
  }
  coreq.forEach(e => {
    const m = Math.max(layer.get(e.source), layer.get(e.target));
    layer.set(e.source, m); layer.set(e.target, m);
  });
  // The corequisite pull above can flatten a downstream prerequisite_of edge
  // to the same layer as its source (e.g. when the target was itself pulled
  // sideways by a coreq pair). Re-enforce strict ordering along every
  // prerequisite edge with a bounded relaxation pass.
  let relaxed = true, guard2 = 0;
  while (relaxed && guard2++ < 100) {
    relaxed = false;
    prereq.forEach(e => {
      const s = layer.get(e.source), t = layer.get(e.target);
      if (t <= s) { layer.set(e.target, s + 1); relaxed = true; }
    });
  }

  const maxLayer = nodes.length ? Math.max(...[...layer.values()]) : 0;
  const byLayer = Array.from({ length: maxLayer + 1 }, () => []);
  nodes.forEach(n => { n.layer = layer.get(n.id); byLayer[n.layer].push(n); });
  byLayer.forEach(col => col.forEach((n, i) => n.slot = i));

  return { nodes, byId, maxLayer, byLayer, edges };
}

window.cmSeqSelectCourse = function(code) {
  cmSeqCourse = code || "";
  const sel = document.getElementById("cm-seq-course-select");
  if (sel) sel.value = cmSeqCourse;
  cmRenderSequence(filtered());
};

function cmPopulateSeqCourseSelect(courses) {
  const sel = document.getElementById("cm-seq-course-select");
  if (!sel) return;
  const sorted = [...courses].sort((a, b) => (a.semester || 0) - (b.semester || 0) || a.code.localeCompare(b.code));
  const opts = sorted.map(c => `<option value="${c.code}">[${c.code}] ${escH(c.title)}</option>`).join("");
  sel.innerHTML = `<option value="">All courses (grid)</option>${opts}`;
  if (!courses.some(c => c.code === cmSeqCourse)) cmSeqCourse = "";
  sel.value = cmSeqCourse;
}

function cmSeqLegendHtml() {
  const s = CM_SEQ_EDGE_STYLE;
  return `<div class="cm-seq-legend">
    <div class="cm-seq-leg-item"><span class="cm-seq-leg-line" style="border-top-color:${s.prerequisite_of.stroke};"></span>prerequisite of</div>
    <div class="cm-seq-leg-item"><span class="cm-seq-leg-line dashed" style="border-top-color:${s.corequisite_with.stroke};"></span>corequisite with</div>
    <div class="cm-seq-leg-item"><span class="cm-seq-leg-line dotted" style="border-top-color:${s.related_to.stroke};"></span>related to</div>
    <div class="cm-seq-leg-item" style="margin-left:auto;font-style:italic;font-family:'Crimson Pro',serif;">
      LLM-proposed — pending expert validation
    </div>
  </div>`;
}

function cmRenderSequence(courses) {
  const el = document.getElementById("cmv-sequence");
  cmPopulateSeqCourseSelect(courses);
  window._cmFitFn = null;
  if (!courses.length) {
    el.innerHTML = `<div style="padding:3rem;text-align:center;color:var(--mu);">No courses to display.</div>`;
    return;
  }
  const course = cmSeqCourse ? courses.find(c => c.code === cmSeqCourse) : null;
  if (course) cmRenderSeqFull(el, course);
  else cmRenderSeqGrid(el, courses);
}

/* ── Grid: every course's mini-DAG, grouped by semester ── */
function cmRenderSeqGrid(el, courses) {
  const sems = allSemesters().filter(s => courses.some(c => c.semester === s));
  const bySem = {}; sems.forEach(s => bySem[s] = []);
  courses.forEach(c => { if (bySem[c.semester]) bySem[c.semester].push(c); });

  let html = cmSeqLegendHtml() + `<div class="cm-seq-scroll">`;
  sems.forEach(sem => {
    const sc = semColor(sem);
    html += `<div class="cm-seq-sem-block">
      <div class="cm-seq-sem-hd" style="color:${sc};border-top-color:${sc};">${semLabel(sem)}</div>
      <div class="cm-seq-grid">`;
    bySem[sem].forEach(course => {
      const nTopics = (course.topics || []).length;
      const nEdges  = (course.edges || []).length;
      html += `<div class="cm-seq-card" style="border-top-color:${sc};" onclick="cmSeqSelectCourse('${course.code}')">
        <div class="cm-seq-card-code" style="color:${sc};">${course.code}</div>
        <div class="cm-seq-card-title">${escH(course.title)}</div>
        <svg class="cm-seq-mini-svg" data-code="${course.code}"></svg>
        <div class="cm-seq-card-meta">${nTopics} topic${nTopics !== 1 ? "s" : ""} · ${nEdges} edge${nEdges !== 1 ? "s" : ""}</div>
      </div>`;
    });
    html += `</div></div>`;
  });
  html += `</div>`;
  el.innerHTML = html;

  courses.forEach(course => {
    const svgEl = el.querySelector(`svg[data-code="${course.code}"]`);
    if (svgEl) cmDrawMiniDag(svgEl, course);
  });
}

function cmDrawMiniDag(svgNode, course) {
  const g = cmLayoutTopicDag(course);
  const svg = d3.select(svgNode);
  if (!g.nodes.length) {
    svg.attr("viewBox", "0 0 200 34").append("text")
      .attr("x", 100).attr("y", 19).attr("text-anchor", "middle")
      .attr("font-family", "Outfit").attr("font-size", "9px").attr("fill", "var(--dim)")
      .text("No topics extracted yet");
    return;
  }
  const colW = 76, rowH = 24, marginX = 10, marginY = 10;
  const w = marginX * 2 + (g.maxLayer + 1) * colW;
  const h = marginY * 2 + Math.max(...g.byLayer.map(c => c.length), 1) * rowH;

  g.nodes.forEach(n => {
    n.w = Math.max(50, cmSeqTextWidth(n.label, "500 6.4px 'DM Mono'") + 8);
    n.h = 15;
    n.x = marginX + n.layer * colW;
    n.y = marginY + n.slot * rowH + (h - marginY * 2 - g.byLayer[n.layer].length * rowH) / 2 + rowH / 2;
  });

  svg.attr("viewBox", `0 0 ${Math.max(w, 160)} ${Math.max(h, 46)}`);
  svg.append("g").selectAll("path").data(g.edges).join("path")
    .attr("class", e => `cm-seq-mini-edge ${e.type}`)
    .attr("fill", "none")
    .attr("d", e => cmSeqEdgePath(g.byId.get(e.source), g.byId.get(e.target)));

  const ng = svg.append("g").selectAll("g").data(g.nodes).join("g")
    .attr("transform", n => `translate(${n.x - n.w / 2},${n.y - n.h / 2})`);
  ng.append("rect").attr("class", "cm-seq-mini-node")
    .attr("width", d => d.w).attr("height", d => d.h).attr("rx", 4)
    .attr("stroke", d => cmBloomColor(d.bloom_level));
  ng.append("text").attr("class", "cm-seq-mini-label")
    .attr("x", d => d.w / 2).attr("y", d => d.h / 2 + 2.2).attr("text-anchor", "middle")
    .text(d => d.label);
}

/* ── Single-course full DAG, with pan/zoom + hover detail via the shared tooltip ── */
function cmRenderSeqFull(el, course) {
  const sc = semColor(course.semester);
  const g = cmLayoutTopicDag(course);

  let html = `
    <div class="cm-seq-full-hdr">
      <button class="cm-fit-btn" onclick="cmSeqSelectCourse('')">← All courses</button>
      <div class="cm-seq-full-title">
        <span class="cm-seq-full-code" style="color:${sc};">${course.code}</span>
        <span class="cm-seq-full-name">${escH(course.title)}</span>
        <span class="sem-badge" style="background:${sc}18;color:${sc};">${semLabel(course.semester)}</span>
      </div>
    </div>
    ${cmSeqLegendHtml()}`;

  if (!g.nodes.length) {
    html += `<div style="padding:3rem;text-align:center;color:var(--mu);">
      No topics extracted for this course yet — run
      <code style="font-family:'DM Mono',monospace;color:var(--gold);">python excel_to_json.py --mode llm</code>
      (or <code style="font-family:'DM Mono',monospace;color:var(--gold);">--mode both</code>) to populate its knowledge graph, then refresh.
    </div>`;
    el.innerHTML = html;
    return;
  }

  html += `<div class="cm-seq-canvas-wrap"><svg id="cm-seq-full-svg"></svg></div>`;
  el.innerHTML = html;

  const colW = 220, rowH = 74, marginX = 50, marginY = 40;
  const width  = marginX * 2 + (g.maxLayer + 1) * colW;
  const height = marginY * 2 + Math.max(...g.byLayer.map(c => c.length), 1) * rowH;

  g.nodes.forEach(n => {
    n.w = Math.max(110, cmSeqTextWidth(n.label, "500 12.5px Outfit") + 34);
    n.h = 42;
    n.x = marginX + n.layer * colW;
    n.y = marginY + n.slot * rowH + (height - marginY * 2 - g.byLayer[n.layer].length * rowH) / 2 + rowH / 2;
  });

  const svgEl = document.getElementById("cm-seq-full-svg");
  const svg = d3.select(svgEl).attr("width", Math.max(width, 600)).attr("height", Math.max(height, 260));
  const zoomG = svg.append("g").attr("class", "cm-seq-zoom-g");

  const defs = svg.append("defs");
  defs.append("marker").attr("id", "cm-seq-arrow").attr("viewBox", "0 -5 10 10")
    .attr("refX", 9).attr("refY", 0).attr("markerWidth", 7).attr("markerHeight", 7).attr("orient", "auto")
    .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", CM_SEQ_EDGE_STYLE.prerequisite_of.stroke);

  zoomG.append("g").selectAll("path").data(g.edges).join("path")
    .attr("class", e => `cm-seq-edge ${e.type}`)
    .attr("marker-end", e => e.type === "prerequisite_of" ? "url(#cm-seq-arrow)" : null)
    .attr("opacity", e => 0.35 + 0.65 * (e.confidence != null ? e.confidence : 0.5))
    .attr("d", e => cmSeqEdgePath(g.byId.get(e.source), g.byId.get(e.target)))
    .on("mouseenter", (ev, e) => {
      const style = CM_SEQ_EDGE_STYLE[e.type] || { label: e.type };
      showTip(ev, `<div class="th">${escH(style.label)}</div>
        <div class="tm">${escH(e.rationale || "No rationale recorded.")}</div>
        <div class="tm" style="color:var(--gold);">confidence ${e.confidence != null ? e.confidence : "—"} · ${escH(e.status || "pending_validation")}</div>`);
    })
    .on("mousemove", moveTip)
    .on("mouseleave", hideTip);

  const ng = zoomG.append("g").selectAll("g").data(g.nodes).join("g")
    .attr("transform", n => `translate(${n.x - n.w / 2},${n.y - n.h / 2})`)
    .on("mouseenter", (ev, n) => {
      showTip(ev, `<div class="th">${escH(n.label)}</div>
        <div class="tm">${escH(n.id)}</div>
        <div class="tm" style="color:${cmBloomColor(n.bloom_level)};">${escH(n.bloom_level || "Bloom level unknown")} · ${escH(n.status || "pending_validation")}</div>`);
    })
    .on("mousemove", moveTip)
    .on("mouseleave", hideTip);
  ng.append("rect").attr("class", "cm-seq-node")
    .attr("width", n => n.w).attr("height", n => n.h).attr("rx", 9)
    .attr("stroke", n => cmBloomColor(n.bloom_level));
  ng.append("text").attr("class", "cm-seq-node-label")
    .attr("x", n => n.w / 2).attr("y", n => n.h / 2 - 3).attr("text-anchor", "middle")
    .text(n => n.label);
  ng.append("text").attr("class", "cm-seq-node-bloom")
    .attr("x", n => n.w / 2).attr("y", n => n.h / 2 + 13).attr("text-anchor", "middle")
    .text(n => n.bloom_level || "");

  const zoom = d3.zoom().scaleExtent([0.3, 2.5])
    .on("zoom", ev => zoomG.attr("transform", ev.transform))
    .on("start", () => svgEl.classList.add("grabbing"))
    .on("end", () => svgEl.classList.remove("grabbing"));
  svg.call(zoom);

  window._cmFitFn = () => {
    const availW = (el.clientWidth || 900) - 40;
    const scale = Math.max(0.3, Math.min(1, availW / width));
    svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity.translate(20, 20).scale(scale));
  };
  window._cmFitFn();
}
