/* ================================================================
   Standalone ChE Ontology site — init + semester filter wiring.
   This page only ever shows the "concepts" view, so activeTab is
   fixed to "concepts" (ontology.js's cmRender() checks it).
================================================================ */
let activeTab = "concepts";

async function init() {
  await loadData("../data.json");
  buildFilters();
  cmRender();
}

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
  if (cmNetSim) cmNetSim.stop();
  cmRender();
};

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
