/* ================================================================
   COMMON — shared across the Curriculum site (index.html) and the
   standalone ChE Ontology site (ontology/index.html): data loading,
   filtering helpers, formatting helpers, and the shared tooltip.
================================================================ */

/* ── HTML escaping helpers ────────────────────────────────── */
function escH(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escA(s){ return escH(s).replace(/'/g,'&#39;'); }

function semColor(n) { return SEM_COLORS[n] || "#6b7280"; }
function semLabel(n) { return n ? `Semester ${n}` : "Unknown"; }

/* ================================================================
   APP STATE
================================================================ */
let activeSemFilter = "All";
let DATA = { plos: PLOS_DEF, courses: COURSES_EMBEDDED };

async function loadData(path) {
  try {
    const r = await fetch(path);
    if (r.ok) DATA = await r.json();
  } catch(e) {}
  return DATA;
}

/* ================================================================
   FILTER HELPERS
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
function showTip(e,html){tip.innerHTML=html;tip.style.display="block";moveTip(e);}
