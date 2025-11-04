const S = (id)=>document.getElementById(id);

let puzzle = null;
let attemptId = null;
let isAcross = true;
let timerHandle = null;
let msElapsed = 0;
let lastFocusedInput = null;

function logErr(msg, err){
  console.error(msg, err || "");
  const el = S("overlayMsg") || S("result");
  if (el) el.textContent = msg;
}

// Numbering + lookups
let cellNum = [];          // cellNum[r][c] = number or 0
let acrossMap = {};        // number -> {cells:[{r,c}], clue}
let downMap = {};          // number -> {cells:[{r,c}], clue}

// Find a clue text by number/kind
function findClue(p, kind, num){
  const bag = (kind === "across") ? (p.clues?.across || {}) : (p.clues?.down || {});
  const keyA = String(num) + (kind === "across" ? "A" : "D");
  const keyB = String(num);
  return bag[keyA] || bag[keyB] || "";
}

// Build numbering and word maps
function computeNumbering(p){
  const R = p.layout.length, C = p.layout[0].length;
  const isOpen = (r,c)=> r>=0 && r<R && c>=0 && c<C && p.layout[r][c] !== "#";
  cellNum = Array.from({length:R},()=>Array(C).fill(0));
  acrossMap = {}; downMap = {};
  let n = 0;

  for (let r=0;r<R;r++){
    for (let c=0;c<C;c++){
      if (!isOpen(r,c)) continue;
      const startAcross = !isOpen(r, c-1);
      const startDown   = !isOpen(r-1, c);
      if (startAcross || startDown){ n++; cellNum[r][c] = n; }
      if (startAcross){
        const cells = []; let cc=c; while (isOpen(r,cc)) { cells.push({r, c:cc}); cc++; }
        acrossMap[n] = { cells, clue: findClue(p, "across", n) };
      }
      if (startDown){
        const cells = []; let rr=r; while (isOpen(rr,c)) { cells.push({r:rr, c}); rr++; }
        downMap[n] = { cells, clue: findClue(p, "down", n) };
      }
    }
  }
}

function getWordCells(p, r, c, isAcross){
  const R = p.layout.length, C = p.layout[0].length;
  const isOpen = (r,c)=> r>=0 && r<R && c>=0 && c<C && p.layout[r][c] !== "#";
  if (!isOpen(r,c)) return [];
  const cells = [];
  if (isAcross){ let c0=c; while (isOpen(r,c0-1)) c0--; let c1=c; while (isOpen(r,c1+1)) c1++; for (let x=c0;x<=c1;x++) cells.push({r,c:x}); }
  else { let r0=r; while (isOpen(r0-1,c)) r0--; let r1=r; while (isOpen(r1+1,c)) r1++; for (let y=r0;y<=r1;y++) cells.push({r:y,c}); }
  return cells;
}

function headNumber(p, r, c){
  const isOpen = (r,c)=> p.layout[r] && p.layout[r][c] && p.layout[r][c] !== "#";
  if (isAcross){ while (isOpen(r,c-1)) c--; } else { while (isOpen(r-1,c)) r--; }
  return cellNum[r]?.[c] || 0;
}

function setActiveWord(p, r, c){
  document.querySelectorAll(".grid td.active").forEach(td=>td.classList.remove("active"));
  const cells = getWordCells(p, r, c, isAcross);
  cells.forEach(({r,c})=>{
    const td = document.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
    if (td) td.classList.add("active");
  });
  setFocusCell(r, c);  // << add this line
  const num = cellNum[r]?.[c] || headNumber(p, r, c);
  const map = isAcross ? acrossMap : downMap;
  const clue = (num && map[num]) ? map[num].clue : "";
  const arrow = isAcross ? "Across" : "Down";
  S("current-clue").textContent = clue ? `${num} ${arrow}: ${clue}` : "";
}

function renderClues(p){
  const a = S("clues-across"), d = S("clues-down");
  if (a) a.innerHTML = ""; if (d) d.innerHTML = "";
  Object.keys(acrossMap).map(Number).sort((x,y)=>x-y).forEach(n=>{
    const li = document.createElement("li");
    li.textContent = `${n}. ${acrossMap[n].clue || ""}`;
    li.onclick = ()=>{
      const head = acrossMap[n].cells[0];
      const inp = document.querySelector(`input[data-r="${head.r}"][data-c="${head.c}"]`);
      if (inp){ isAcross = true; inp.focus(); setActiveWord(p, head.r, head.c); }
    };
    a.appendChild(li);
  });
  Object.keys(downMap).map(Number).sort((x,y)=>x-y).forEach(n=>{
    const li = document.createElement("li");
    li.textContent = `${n}. ${downMap[n].clue || ""}`;
    li.onclick = ()=>{
      const head = downMap[n].cells[0];
      const inp = document.querySelector(`input[data-r="${head.r}"][data-c="${head.c}"]`);
      if (inp){ isAcross = false; inp.focus(); setActiveWord(p, head.r, head.c); }
    };
    d.appendChild(li);
  });
}

function setFocusCell(r, c){
  // remove previous
  document.querySelectorAll(".grid td.cursor").forEach(td => td.classList.remove("cursor"));
  // add to current
  const td = document.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
  if (td) td.classList.add("cursor");
}

function buildGrid(layout){
  const rows = layout.length; const cols = layout[0].length;

  // compute numbering/maps once per build
  computeNumbering(puzzle);

  const table = document.createElement("table");
  table.className = "grid";

  for (let r=0;r<rows;r++){
    const tr = document.createElement("tr");
    for (let c=0;c<cols;c++){
      const td = document.createElement("td");
      td.dataset.r = r; td.dataset.c = c;

      if (layout[r][c] === "#") {
        td.className = "block";
      } else {
        // numbering
        const n = cellNum[r][c];
        if (n) {
          const num = document.createElement("span");
          num.className = "num";
          num.textContent = n;
          td.appendChild(num);
        }
        // input
        const inp = document.createElement("input");
        inp.maxLength = 1;
        inp.dataset.r = r; inp.dataset.c = c;

        // highlight on focus
        inp.addEventListener("focus", () => {
          setActiveWord(puzzle, r, c);
          setFocusCell(r, c);
        });
        inp.addEventListener('focus', () => { lastFocusedInput = inp; setActiveWord(puzzle, r, c); });
        // move forward within active word on entry
        inp.addEventListener("input", (e) => {
          const v = e.target.value.toUpperCase().replace(/[^A-Z]/g,"");
          e.target.value = v;
          if (v) {
            const cells = getWordCells(puzzle, r, c, isAcross);
            let idx = cells.findIndex(k=>k.r===r && k.c===c);
            const next = cells[idx+1];
            if (next) {
              const nxt = document.querySelector(`input[data-r="${next.r}"][data-c="${next.c}"]`);
              if (nxt) nxt.focus();
            }
          }
        });

        td.appendChild(inp);
      }
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }

  S("grid").innerHTML = "";
  S("grid").appendChild(table);
  // In buildGrid(), after S("grid").appendChild(table);
  applyPhoneWidthSizing(puzzle.rows, puzzle.cols);
  // render clues
  renderClues(puzzle);

  // focus the first open cell and highlight its word
  const firstOpen = document.querySelector('.grid td:not(.block) input');
  if (firstOpen){ firstOpen.focus(); setActiveWord(puzzle, +firstOpen.dataset.r, +firstOpen.dataset.c); }
}

// Compute the largest square cell that fits both width and height.
// Respects mobile keyboard because it uses window.innerHeight at the moment.
// Compute largest square cell that fits inside #grid-wrap, respecting keyboard.
function applyResponsiveCellSize(rows, cols) {
  const availW = Math.min(document.documentElement.clientWidth, window.innerWidth) * 0.96;
  const maxCellByW = Math.floor(availW / cols);

  const header = 50;     // timer etc.
  const controls = 60;   // smaller buttons now
  const clueBar = 56;    // current clue
  const vPad = 20;

  const vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight);
  const availH = Math.max(180, vh - header - controls - clueBar - vPad);
  const maxCellByH = Math.floor(availH / rows);

  const cell = Math.max(20, Math.min(maxCellByW, maxCellByH));
  document.documentElement.style.setProperty('--cell', cell + 'px');
}

// Fit the board to the phone width; make the board square (height == width)
// Cells remain squares; for 15x15 this fills the whole square perfectly.
function applyPhoneWidthSizing(rows, cols) {
  const wrap = document.getElementById('grid-wrap') || S('grid');
  if (!wrap) return;

  // Use the visible viewport width when available (handles iOS UI chrome)
  const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
  const wrapW = Math.floor(vw); // exact phone width in CSS px

  // Cell size from width constraint
  const cell = Math.max(18, Math.floor(wrapW / cols)); // clamp min for readability

  // Set CSS var and container dimensions
  document.documentElement.style.setProperty('--cell', cell + 'px');
  wrap.style.width  = wrapW + 'px';
  wrap.style.height = wrapW + 'px';  // square board: height matches width

  // If your puzzle isn't square (rows != cols), cells stay square; you'll see
  // extra blank space below or right. For 15x15 it's a perfect fill.
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

async function post(action, payload){
  const body = new URLSearchParams();
  body.set("action", action);
  body.set("payload", JSON.stringify(payload));

  const res = await fetch(CONFIG.api, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body
  });

  const txt = await res.text();           // read as text first (for debugging)
  let data;
  try { data = JSON.parse(txt); } catch {
    throw new Error(`Server did not return JSON: ${txt.slice(0,120)}...`);
  }
  if (!res.ok || data.ok === false) {
    throw new Error(data && data.error ? data.error : res.statusText);
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

function validatePuzzle(p){
  if (!p || !Array.isArray(p.layout)) throw new Error("Puzzle missing 'layout' array.");
  const rows = p.layout.length;
  if (!rows) throw new Error("Layout has zero rows.");
  const cols = p.layout[0].length;
  if (!cols) throw new Error("Layout has zero columns.");
  for (let i=0;i<rows;i++){
    if (p.layout[i].length !== cols) throw new Error(`Row ${i+1} length ${p.layout[i].length} ≠ ${cols}`);
    if (/[^A-Za-z#]/.test(p.layout[i])) throw new Error(`Row ${i+1} has invalid chars. Use A–Z or '#'.`);
  }
  p.rows = rows; p.cols = cols;
  return p;
}

async function loadPuzzleJson(weekId){
  const url = `puzzles/${encodeURIComponent(weekId)}.json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Puzzle JSON not found at ${url} (HTTP ${res.status})`);
  const json = await res.json();
  return validatePuzzle(json);
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

    // Wire buttons (this is crucial—if IDs don’t match, nothing happens)
  S("btn-begin").onclick = beginFlow;
  S("toggle").onclick = ()=>{
    isAcross = !isAcross;
    const f = document.activeElement;
    if (f && f.tagName === "INPUT") {
      const r = +f.dataset.r, c = +f.dataset.c;
      setActiveWord(puzzle, r, c);
      setFocusCell(r, c);
    }
  };
  S("clear-word").onclick = clearCurrentWord;
  S("submit").onclick = submitFlow;

  // In init():
  window.addEventListener('resize', () => {
    if (puzzle) applyPhoneWidthSizing(puzzle.rows, puzzle.cols);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (puzzle) applyPhoneWidthSizing(puzzle.rows, puzzle.cols);
    });
  }

  // On mobile, if the user taps empty space, keep focus on the last cell to keep the keyboard up.
document.addEventListener('pointerdown', (e) => {
  const t = e.target;
  const isInput = t && t.tagName === 'INPUT';
  if (!isInput && lastFocusedInput) {
    e.preventDefault();
    lastFocusedInput.focus();
  }
}, { passive: false });

// (Optional) re-apply when focusing inputs (helps when keyboard pops)
document.addEventListener('focusin', (e) => {
  if (e.target && e.target.tagName === 'INPUT' && puzzle) {
    applyResponsiveCellSize(puzzle.rows, puzzle.cols);
  }
});

  console.log("App initialized");
}

document.addEventListener("DOMContentLoaded", init);
