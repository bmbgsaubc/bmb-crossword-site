const S = (id)=>document.getElementById(id);

let puzzle = null;
let attemptId = null;
let isAcross = true;
let timerHandle = null;
let msElapsed = 0;

function logErr(msg, err){
  console.error(msg, err || "");
  const el = S("overlayMsg") || S("result");
  if (el) el.textContent = msg;
}

async function loadPuzzleJson(weekId){
  const url = `puzzles/${encodeURIComponent(weekId)}.json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Puzzle JSON not found (${url})`);
  return res.json();
}

function buildGrid(layout){
  const rows = layout.length; const cols = layout[0].length;
  const table = document.createElement("table");
  table.className = "grid";
  for (let r=0;r<rows;r++){
    const tr = document.createElement("tr");
    for (let c=0;c<cols;c++){
      const td = document.createElement("td");
      const ch = layout[r][c];
      if (ch === "#") {
        td.className = "block";
      } else {
        const inp = document.createElement("input");
        inp.maxLength = 1;
        inp.dataset.r = r; inp.dataset.c = c;
        tr.tabIndex = -1; // avoid focus outline on row
        td.appendChild(inp);
      }
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  S("grid").innerHTML = "";
  S("grid").appendChild(table);
}

function readGridString(){
  const rows = puzzle.layout.length, cols = puzzle.layout[0].length;
  let out = "";
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      if (puzzle.layout[r][c] === "#") { out += "#"; continue; }
      const inp = document.querySelector(`input[data-r="${r}"][data-c="${c}"]`);
      const v = (inp?.value || "").toUpperCase();
      out += /^[A-Z]$/.test(v) ? v : "";
    }
  }
  return out;
}

function formatMs(ms){
  const t = Math.floor(ms/100);
  const d = t%10, s = Math.floor(t/10)%60, m = Math.floor(t/600);
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${d}`;
}
function startTimer(){
  msElapsed = 0;
  S("timer").style.display = "inline-block";
  S("timer").textContent = "00:00.0";
  timerHandle = setInterval(()=> {
    msElapsed += 100;
    S("timer").textContent = formatMs(msElapsed);
  }, 100);
}
function stopTimer(){
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
}

// Server calls
async function post(action, payload){
  const res = await fetch(CONFIG.api, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await res.json().catch(()=> ({}));
  if (!res.ok || data.ok === false) {
    const msg = (data && data.error) ? data.error : res.statusText;
    throw new Error(`API ${action} failed: ${msg}`);
  }
  return data;
}

async function beginFlow(){
  const name = S("f-name").value.trim();
  const student = S("f-student").value.trim();
  const email = S("f-email").value.trim();
  const lab = S("f-lab").value.trim();
  if (!name || !student || !email || !lab) {
    S("overlayMsg").textContent = "Please fill all fields.";
    return;
  }

  // 1) Ensure puzzle is loaded (so when we hide overlay, grid is there)
  if (!puzzle) {
    try {
      puzzle = await loadPuzzleJson(CONFIG.weekId);
      S("title").textContent = puzzle.title || `BMB Weekly Crossword — ${CONFIG.weekId}`;
      buildGrid(puzzle.layout);
    } catch (e) {
      return logErr(e.message);
    }
  }

  // 2) Call server to start official attempt
  try {
    const st = await post("startAttempt", {
      weekId: CONFIG.weekId, name, studentNumber: student, email, lab
    });
    attemptId = st.attemptId;
  } catch (e) {
    // Keep overlay up if server says “not open yet” or bad URL
    return logErr(e.message);
  }

  // 3) Hide overlay, start visible timer
  S("overlay").style.display = "none";
  startTimer();
}

function clearCurrentWord(){
  const focused = document.activeElement;
  if (!focused || focused.tagName !== "INPUT") return;
  const r = +focused.dataset.r, c = +focused.dataset.c;
  if (isAcross){
    let c0=c, c1=c;
    while (c0-1>=0 && puzzle.layout[r][c0-1] !== "#") c0--;
    while (c1+1<puzzle.layout[0].length && puzzle.layout[r][c1+1] !== "#") c1++;
    for (let x=c0; x<=c1; x++){
      const inp = document.querySelector(`input[data-r="${r}"][data-c="${x}"]`);
      if (inp) inp.value = "";
    }
  } else {
    let r0=r, r1=r;
    while (r0-1>=0 && puzzle.layout[r0-1][c] !== "#") r0--;
    while (r1+1<puzzle.layout.length && puzzle.layout[r1+1][c] !== "#") r1++;
    for (let y=r0; y<=r1; y++){
      const inp = document.querySelector(`input[data-r="${y}"][data-c="${c}"]`);
      if (inp) inp.value = "";
    }
  }
}

async function submitFlow(){
  if (!attemptId) return logErr("Click Begin first.");
  stopTimer();
  const userGridString = readGridString();
  try{
    const fin = await post("finishAttempt", { attemptId, userGridString });
    S("result").textContent = `You got ${fin.percentCorrect}% correct. Official time: ${(fin.elapsedMs/1000).toFixed(1)} s`;
  }catch(e){
    logErr(e.message);
  }
}

async function init(){
  // Preload puzzle (optional; overlay still blocks until Begin)
  try {
    puzzle = await loadPuzzleJson(CONFIG.weekId);
    S("title").textContent = puzzle.title || `BMB Weekly Crossword — ${CONFIG.weekId}`;
    buildGrid(puzzle.layout);
  } catch (e) {
    // Don’t block Begin; we’ll try again when Begin is clicked
    console.warn("Preload failed:", e.message);
  }
  function validatePuzzle(p){
  if (!p || !Array.isArray(p.layout)) throw new Error("Puzzle missing 'layout' array.");
  const rows = p.layout.length;
  if (!rows) throw new Error("Layout has zero rows.");
  const cols = p.layout[0].length;
  if (!cols) throw new Error("Layout has zero columns.");
  for (let i=0;i<rows;i++){
    if (p.layout[i].length !== cols) {
      throw new Error(`Row ${i+1} length ${p.layout[i].length} ≠ ${cols}. All rows must be equal.`);
    }
    if (/[^A-Za-z#]/.test(p.layout[i])) {
      throw new Error(`Row ${i+1} contains invalid characters. Use A–Z or '#'.`);
    }
  }
  p.rows = rows; p.cols = cols; // normalize
  return p;
}

async function loadPuzzleJson(weekId){
  const url = `puzzles/${encodeURIComponent(weekId)}.json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Puzzle JSON not found at ${url} (HTTP ${res.status})`);
  const json = await res.json();
  return validatePuzzle(json);
}

  // Wire buttons (this is crucial—if IDs don’t match, nothing happens)
  S("btn-begin").onclick = beginFlow;
  S("toggle").onclick = ()=>{ isAcross = !isAcross; };
  S("clear-word").onclick = clearCurrentWord;
  S("submit").onclick = submitFlow;

  console.log("App initialized");
}

document.addEventListener("DOMContentLoaded", init);
