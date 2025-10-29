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
}

document.addEventListener("DOMContentLoaded", init);
