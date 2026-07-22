/* ================================================================
   STATIC DATA  (overridden by data.json if present)
================================================================ */
const PLOS_DEF = {
  "PLO-1":"Engineering Knowledge","PLO-2":"Problem Analysis",
  "PLO-3":"Design/Development of Solutions","PLO-4":"Investigation",
  "PLO-5":"Modern Tool Usage","PLO-6":"The Engineer & Society",
  "PLO-7":"Environment & Sustainability","PLO-8":"Ethics",
  "PLO-9":"Individual & Team Work","PLO-10":"Communication",
  "PLO-11":"Project Management","PLO-12":"Lifelong Learning"
};
const PLO_COLORS = {
  "PLO-1":"#2563eb","PLO-2":"#0891b2","PLO-3":"#059669","PLO-4":"#65a30d",
  "PLO-5":"#d97706","PLO-6":"#ea580c","PLO-7":"#dc2626","PLO-8":"#db2777",
  "PLO-9":"#9333ea","PLO-10":"#7c3aed","PLO-11":"#4f46e5","PLO-12":"#0d9488"
};

// Semester → colour (warm = early, cool = late)
const SEM_COLORS = {
  1:"#d4a820", 2:"#c9981a", 3:"#ba8820", 4:"#ab7831",
  5:"#8d6480", 6:"#6f57a3", 7:"#5d4cb7", 8:"#4f46e5"
};

const DOMAIN_CFG = {
  "C-2":{color:"#3b82f6",label:"C2 · Understand"},
  "C-3":{color:"#10b981",label:"C3 · Apply"},
  "C-4":{color:"#f59e0b",label:"C4 · Analyze"},
  "C-5":{color:"#f97316",label:"C5 · Evaluate"},
  "C-6":{color:"#ef4444",label:"C6 · Create"},
  "P-3":{color:"#a855f7",label:"P3 · Precision"},
  "P-4":{color:"#6366f1",label:"P4 · Articulation"},
  "A-3":{color:"#f97316",label:"A3 · Valuing"}
};
const EMPHASIS_ORDER = {None:0,Low:1,Medium:2,High:3};

/* ── Prerequisite graph edges ─────────────────────────────── */
const PREREQ_EDGES = [
  ["HU-131",  "HU-132"],
  ["QR-100",  "QR-101"],
  ["MATH-101","MATH-243"],
  ["CHE-103", "CHE-222"],
  ["CHE-222", "CHE-451"],
  ["CHE-223", "CHE-332"],
  ["CHE-214", "CHE-224"],
  ["CHE-220", "CHE-345"],
  ["CHE-220", "CHE-451"],
];

/* ── Static embedded courses (fallback if data.json absent) ── */
const COURSES_EMBEDDED = [
  {code:"CHE-425",title:"Maintenance & Process Safety",semester:8,lec:3,lab:0,clos:[
    {code:"CLO-1",plo:"PLO-1",emphasis:"Low",domain:"C-2",description:"Describe the key principles of process safety.",concepts:[]},
    {code:"CLO-2",plo:"PLO-1",emphasis:"Low",domain:"C-2",description:"Explain safety and risk management in process industry.",concepts:[]}
  ]},
  {code:"CHE-103",title:"Chemical Engineering Principles-I",semester:1,lec:2,lab:0,clos:[
    {code:"CLO-1",plo:"PLO-1",emphasis:"Low",domain:"C-2",description:"Comprehend the basic concepts of chemical engineering principles.",concepts:[]},
    {code:"CLO-2",plo:"PLO-2",emphasis:"Medium",domain:"C-4",description:"Extend the concepts to solve material balance problems.",concepts:[]}
  ]}
];

const BLOOM_COGNITIVE_LEVELS = [
  { key: "C-1", label: "Remember",  color: "#d4a820" },
  { key: "C-2", label: "Understand", color: "#c9981a" },
  { key: "C-3", label: "Apply",     color: "#ab7831" },
  { key: "C-4", label: "Analyze",   color: "#8d6480" },
  { key: "C-5", label: "Evaluate",  color: "#6f57a3" },
  { key: "C-6", label: "Create",    color: "#4f46e5" }
];
const BLOOM_AFFECTIVE_LEVELS = [
  { key: "A-1", label: "Receiving",      color: "#38bdf8" },
  { key: "A-2", label: "Responding",     color: "#22c1a6" },
  { key: "A-3", label: "Valuing",        color: "#f97316" },
  { key: "A-4", label: "Organizing",     color: "#a855f7" },
  { key: "A-5", label: "Characterizing", color: "#ef4444" }
];
const BLOOM_PSYCHOMOTOR_LEVELS = [
  { key: "P-1", label: "Perception",             color: "#5eead4" },
  { key: "P-2", label: "Set",                    color: "#38bdf8" },
  { key: "P-3", label: "Guided Response",        color: "#a855f7" },
  { key: "P-4", label: "Mechanism",              color: "#6366f1" },
  { key: "P-5", label: "Complex Overt Response", color: "#f59e0b" },
  { key: "P-6", label: "Adaptation",             color: "#f97316" },
  { key: "P-7", label: "Origination",            color: "#ef4444" }
];

/* ================================================================
   ChE ONTOLOGY TAB
================================================================ */
const CM_PALETTE = [
  "#2563eb","#0891b2","#059669","#65a30d","#d97706","#ea580c",
  "#dc2626","#db2777","#9333ea","#7c3aed","#4f46e5","#0d9488",
  "#0369a1","#047857","#b45309","#be123c","#7e22ce","#1d4ed8",
];
const CM_CLOUD_MAX_COURSES = 10;

const DEFAULT_COURSE_COLOR = "#64748b";
