
function semColor(n) { return SEM_COLORS[n] || "#6b7280"; }
function semLabel(n) { return n ? `Semester ${n}` : "Unknown"; }

/* ── HTML escaping helpers ────────────────────────────────── */
function escH(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escA(s){ return escH(s).replace(/'/g,'&#39;'); }

/* ================================================================
   APP STATE
================================================================ */
let activeSemFilter = "All";
let activeTab = "graph";
let DATA = { plos: PLOS_DEF, courses: COURSES_EMBEDDED };
let dashView = "course";

/* ================================================================
   INIT
================================================================ */
async function init() {
  try {
    const r = await fetch("./data.json");
    if (r.ok) DATA = await r.json();
  } catch(e) {}
  buildFilters();
  renderStats();
  renderDash();      // pre-render dashboard in background
  switchTab('graph'); // hero: start on curriculum graph
}

/* ================================================================
   HELPERS
================================================================ */
function allSemesters() {
  return [...new Set(DATA.courses.map(c=>c.semester).filter(Boolean))].sort((a,b)=>a-b);
}

function matchesSemester(course, semesterFilter) {
  return String(course.semester) === String(semesterFilter);
}

function filtered() {
  if (activeSemFilter === "All") return DATA.courses;
  return DATA.courses.filter(c => matchesSemester(c, activeSemFilter));
}

/* ================================================================
   TAB SWITCHING
================================================================ */
window.switchTab = function(tab) {
  activeTab = tab;
  ["dash","graph","concepts"].forEach(t => {
    document.getElementById("tab-"+t).classList.toggle("hidden", t!==tab);
    document.getElementById("tbtn-"+t).classList.toggle("active", t===tab);
    const mb = document.getElementById("mnbtn-"+t);
    if(mb) mb.classList.toggle("active", t===tab);
  });
  if (tab === "graph")    { buildCurriculumGraph(); }
  if (tab === "dash")     { renderDash(); setDashView(dashView); }
  if (tab === "concepts") { cmRender(); }
};

function knowledgeAreaFromUnit(unit){
  const MIN_AREA_PREFIX_LENGTH = 2;
  const AREA_DELIMITER_COLON = ":";
  const AREA_DELIMITER_DASH = " - ";
  const raw = String(unit || "").trim();
  if (!raw) return "General Chemical Engineering";
  if (raw.includes(AREA_DELIMITER_COLON)) {
    const [area] = raw.split(AREA_DELIMITER_COLON);
    if (area.trim().length > MIN_AREA_PREFIX_LENGTH) return area.trim();
  }
  if (raw.includes(AREA_DELIMITER_DASH)) {
    const [area] = raw.split(AREA_DELIMITER_DASH);
    if (area.trim().length > MIN_AREA_PREFIX_LENGTH) return area.trim();
  }
  return "General Chemical Engineering";
}

/* ================================================================
   FILTERS — now semester numbers
================================================================ */
function buildFilters() {
  const sems = allSemesters();
  const opts = ["All", ...sems.map(String)];
  const filterHtml = opts.map(s => {
    const label = s === "All" ? "All Semesters" : `Semester ${s}`;
    const col   = s === "All" ? "" : `color:${semColor(Number(s))};border-color:${semColor(Number(s))}40;`;
    const act   = activeSemFilter === s;
    return `<button class="fbtn${act?" active":""}" style="${act?`background:${semColor(Number(s))}18;border-color:${semColor(Number(s))};color:${semColor(Number(s))};`:`${col}`}"
      onclick="setFilter('${s}')">${label}</button>`;
  }).join("");
  document.getElementById("filters").innerHTML = filterHtml;
  const mf = document.getElementById("mobile-filters");
  if (mf) mf.innerHTML = filterHtml;
}

window.setFilter = function(s) {
  activeSemFilter = s;
  const nextCourses = s === "All" ? DATA.courses : DATA.courses.filter(c => matchesSemester(c, s));
  const nextVisibleCodes = new Set(nextCourses.map(c => c.code));
  cmCloudSelection = cmCloudSelection.filter(code => nextVisibleCodes.has(code)).slice(0, CM_CLOUD_MAX_COURSES);
  cmCloudSelectionTouched = cmCloudSelection.length > 0;
  syncCloudPinnedCourse(cmCloudSelection);
  buildFilters();
  renderStats();
  renderDash();
  if (activeTab === "graph")    buildCurriculumGraph();
  if (activeTab === "concepts") { if(cmNetSim) cmNetSim.stop(); cmRender(); }
};

/* ── Tooltip ── */
const tip = document.getElementById("tip");
window.hideTip = () => tip.style.display="none";
document.addEventListener("mousemove",moveTip);
function moveTip(e) {
  if(tip.style.display==="none") return;
  let x=e.clientX+14, y=e.clientY+14;
  if(x+280>window.innerWidth) x=e.clientX-290;
  if(y+160>window.innerHeight) y=e.clientY-170;
  tip.style.left=x+"px"; tip.style.top=y+"px";
}

/* ================================================================
   MD FILE VIEWER
================================================================ */
function parseMd(raw) {
  // Escape HTML first
  let s = raw.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Fenced code blocks
  s = s.replace(/```([^`]*?)```/gs,
    (_,c)=>`<pre><code>${c.replace(/^[^\n]*\n?/,'')}</code></pre>`);
  // Headings
  s = s.replace(/^#### (.+)$/gm,'<h4>$1</h4>');
  s = s.replace(/^### (.+)$/gm,'<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm,'<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm,'<h1>$1</h1>');
  // Horizontal rule
  s = s.replace(/^---+$/gm,'<hr>');
  // Bold / italic
  s = s.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g,'<em>$1</em>');
  // Inline code
  s = s.replace(/`([^`\n]+)`/g,'<code>$1</code>');
  // Blockquote
  s = s.replace(/^&gt; (.+)$/gm,'<blockquote>$1</blockquote>');
  // Tables (simple: | col | col |)
  s = s.replace(/(\|.+\|\n\|[-| :]+\|\n(?:\|.+\|\n?)*)/g, m => {
    const rows = m.trim().split('\n');
    const hCells = rows[0].split('|').filter(c=>c.trim()).map(c=>`<th>${c.trim()}</th>`).join('');
    const body = rows.slice(2).map(r => {
      const cells = r.split('|').filter(c=>c.trim()).map(c=>`<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${hCells}</tr></thead><tbody>${body}</tbody></table>`;
  });
  // Ordered/unordered lists
  s = s.replace(/^(\d+)\. (.+)$/gm,'<li>$2</li>');
  s = s.replace(/^[*-] (.+)$/gm,'<li>$1</li>');
  // Wrap consecutive <li> tags in <ul>
  s = s.replace(/((?:<li>.*<\/li>\n?)+)/g,'<ul>$1</ul>');
  // Paragraphs: double newline → <p>
  s = s.replace(/\n\n([^<\n][^\n]*)/g,'\n<p>$1</p>');
  // Line breaks
  s = s.replace(/([^>])\n([^<\n])/g,'$1 $2');
  return s;
}

window.openMdModal = async function(code, title) {
  const modal   = document.getElementById("md-modal");
  const titleEl = document.getElementById("md-modal-title");
  const bodyEl  = document.getElementById("md-modal-body");

  titleEl.textContent = `${code} — ${title}`;
  bodyEl.innerHTML = `<p style="color:var(--dim);font-style:italic;">Loading ${code}.md…</p>`;
  modal.classList.remove("hidden");

  // Try common locations
  const paths = [`./${code}.md`, `./courses/${code}.md`, `./md/${code}.md`];
  let loaded = false;
  for (const p of paths) {
    try {
      const r = await fetch(p);
      if (r.ok) {
        const text = await r.text();
        bodyEl.innerHTML = parseMd(text);
        loaded = true;
        break;
      }
    } catch(e) {}
  }
  if (!loaded) {
    bodyEl.innerHTML = `<p style="color:var(--mu);">No content file found for <strong>${code}</strong>.</p>
      <p style="font-size:.76rem;color:var(--dim);">
        Place a file named <code>${code}.md</code> in the same directory as <code>index.html</code>
        (or in a <code>courses/</code> subdirectory) to display it here.
      </p>`;
  }
};

window.closeMdModal = function() {
  document.getElementById("md-modal").classList.add("hidden");
};
window.onMdModalOverlayClick = function(e) {
  if (e.target === document.getElementById("md-modal")) closeMdModal();
};

function showTip(e,html){tip.innerHTML=html;tip.style.display="block";moveTip(e);}

/* ================================================================
   MOBILE NAV
================================================================ */
window.toggleNav = function() {
  const nav = document.getElementById("mobile-nav");
  const ov  = document.getElementById("nav-overlay");
  const btn = document.getElementById("ham-btn");
  const open = nav.classList.toggle("open");
  ov.classList.toggle("open", open);
  btn.classList.toggle("open", open);
};
window.closeNav = function() {
  document.getElementById("mobile-nav").classList.remove("open");
  document.getElementById("nav-overlay").classList.remove("open");
  document.getElementById("ham-btn").classList.remove("open");
};
