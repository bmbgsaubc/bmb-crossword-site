const S = (id)=>document.getElementById(id);
let puzzle, attemptId, isAcross = true;

async function post(action, payload){
  const res = await fetch(CONFIG.api, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ action, ...payload })
  });
  return res.json();
}

function buildGrid(layout){
  const rows = layout.length; const cols = layout[0].length;
  const grid = document.createElement("table");
  grid.className = "grid";
  for (let r=0;r<rows;r++){
    const tr = document.createElement("tr");
    for (let c=0;c<cols;c++){
      const ch = layout[r][c];
      const td = document.createElement("td");
      if (ch==="#") { td.className="block"; }
      else {
        const inp = document.createElement("input");
        inp.maxLength = 1;
        inp.dataset.r = r; inp.dataset.c = c;
        td.appendChild(inp);
      }
      tr.appendChild(td);
    }
    grid.appendChild(tr);
  }
  S("grid").innerHTML = "";
  S("grid").appendChild(grid);
}

function readGridString(){
  const rows = puzzle.layout.length, cols = puzzle.layout[0].length;
  let out = "";
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const ch = puzzle.layout[r][c];
      if (ch === "#") out += "#";
      else {
        const inp = document.querySelector(`input[data-r="${r}"][data-c="${c}"]`);
        const v = (inp.value || "").toUpperCase();
        out += /^[A-Z]$/.test(v) ? v : "";
      }
    }
  }
  return out;
}
async function loadPuzzleJson(weekId){
  // GitHub Pages serves files statically; this fetch is same-origin.
  const url = `puzzles/${encodeURIComponent(weekId)}.json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Puzzle JSON not found for ${weekId}`);
  return res.json();
}

async function init(){
  try {
    puzzle = await loadPuzzleJson(CONFIG.weekId);
  } catch (e) {
    S("gateMsg").textContent = e.message || "Failed to load puzzle.";
    return;
  }

  S("title").textContent = puzzle.title || `BMB Weekly Crossword — ${CONFIG.weekId}`;
  buildGrid(puzzle.layout);

  // buttons
  S("toggle").onclick = ()=>{ isAcross = !isAcross; };
  S("clear").onclick = ()=>{ document.querySelectorAll("#grid input").forEach(i=>i.value=""); };

  S("start").onclick = async ()=>{
    const name = S("name").value.trim();
    const student = S("student").value.trim();
    if (!name || !student){ S("gateMsg").textContent = "Enter name and student #"; return; }

    // Server creates official start time and will reject if puzzle not open yet
    const st = await post("startAttempt", { weekId: CONFIG.weekId, name, studentNumber: student });
    if (!st.ok){ S("gateMsg").textContent = st.error; return; }
    attemptId = st.attemptId;
    S("gate").style.display = "none";
    S("puzzle").style.display = "block";
  };

  S("submit").onclick = async ()=>{
    if (!attemptId) return;
    const userGridString = readGridString();
    const fin = await post("finishAttempt", { attemptId, userGridString });
    if (!fin.ok){ S("result").textContent = fin.error; return; }
    S("result").textContent = fin.isCorrect
      ? `Official time: ${(fin.elapsedMs/1000).toFixed(1)} s`
      : "Not correct yet — keep going!";
  };
  let attemptId = null;
let timerHandle = null;
let msElapsed = 0;
let isAcross = true;
let puzzle = null;

function formatMs(ms){
  const t = Math.floor(ms/100);
  const d = t%10; const s = Math.floor(t/10)%60; const m = Math.floor(t/600);
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${d}`;
}

function startTimer(){
  msElapsed = 0;
  S("timer").style.display = "inline-block";
  S("timer").textContent = "00:00.0";
  timerHandle = setInterval(()=>{
    msElapsed += 100;
    S("timer").textContent = formatMs(msElapsed);
  }, 100);
}
function stopTimer(){
  if (timerHandle){ clearInterval(timerHandle); timerHandle = null; }
}

async function beginFlow(){
  const name = S("f-name").value.trim();
  const student = S("f-student").value.trim();
  const email = S("f-email").value.trim();
  const lab = S("f-lab").value.trim();
  if (!name || !student || !email || !lab){
    S("overlayMsg").textContent = "Please fill all fields.";
    return;
  }
  // Call server to log official start
  try{
    const st = await post("startAttempt", { weekId: CONFIG.weekId, name, studentNumber: student, email, lab });
    if (!st.ok) throw new Error(st.error);
    attemptId = st.attemptId;
    S("overlay").style.display = "none";
    startTimer();
  }catch(e){
    S("overlayMsg").textContent = e.message || "Failed to start.";
  }
}

// Clear current word along active direction
function clearCurrentWord(){
  const focused = document.activeElement;
  if (!focused || focused.tagName !== "INPUT") return;
  const r = +focused.dataset.r, c = +focused.dataset.c;
  // find word bounds
  let r0=r, c0=c, r1=r, c1=c;
  if (isAcross){
    while (c0-1>=0 && puzzle.layout[r][c0-1] !== "#") c0--;
    while (c1+1<puzzle.layout[0].length && puzzle.layout[r][c1+1] !== "#") c1++;
    for (let x=c0; x<=c1; x++){
      const inp = document.querySelector(`input[data-r="${r}"][data-c="${x}"]`);
      if (inp) inp.value = "";
    }
  } else {
    while (r0-1>=0 && puzzle.layout[r0-1][c] !== "#") r0--;
    while (r1+1<puzzle.layout.length && puzzle.layout[r1+1][c] !== "#") r1++;
    for (let y=r0; y<=r1; y++){
      const inp = document.querySelector(`input[data-r="${y}"][data-c="${c}"]`);
      if (inp) inp.value = "";
    }
  }
}

function wireUI(){
  S("btn-begin").onclick = beginFlow;
  S("toggle").onclick = ()=>{ isAcross = !isAcross; };
  S("clear-word").onclick = clearCurrentWord;

  S("submit").onclick = async ()=>{
    if (!attemptId) { S("result").textContent = "Click Begin first."; return; }
    stopTimer();
    const userGridString = readGridString();
    try{
      const fin = await post("finishAttempt", { attemptId, userGridString });
      if (!fin.ok) throw new Error(fin.error);
      S("result").textContent = `You got ${fin.percentCorrect}% correct. Official time: ${(fin.elapsedMs/1000).toFixed(1)} s`;
    }catch(e){
      S("result").textContent = e.message || "Submit failed.";
    }
  };
}
}

document.addEventListener("DOMContentLoaded", init);
