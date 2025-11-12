// ===== Helpers =====
const S = (id)=>document.getElementById(id);
let puzzle = null;
let attemptId = null;
let isAcross = true;
let timerHandle = null;
let msElapsed = 0;
let lastFocused = null; // {r,c}

// minimal config (index.html sets window.CONFIG)
const CFG = window.CONFIG;

// Log to UI + console
function logErr(msg, err){
  console.error(msg, err || "");
  const el = S("overlayMsg") || S("result");
  if (el) el.textContent = msg;
}

// ===== Loading puzzle JSON =====
function validatePuzzle(p){
  if (!p || !Array.isArray(p.layout)) throw new Error("Puzzle missing 'layout' array.");
  const rows = p.layout.length;
  const cols = p.layout[0].length;
  if (!rows || !cols) throw new Error("Layout has zero size.");
  for (let i=0;i<rows;i++){
    if (p.layout[i].length !== cols) throw new Error(`Row ${i+1} len ${p.layout[i].length} ≠ ${cols}`);
    if (/[^A-Za-z#]/.test(p.layout[i])) throw new Error(`Row ${i+1} invalid chars (A–Z or '#').`);
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

// ===== Layout + sizing =====
function applyPhoneWidthSizing(rows, cols) {
  const wrap = document.getElementById('grid-wrap') || S('grid');
  if (!wrap) return;
  const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
  const wrapW = Math.floor(vw);
  const cell = Math.max(18, Math.floor(wrapW / cols));
  document.documentElement.style.setProperty('--cell', cell + 'px');
  wrap.style.width  = wrapW + 'px';
  wrap.style.height = wrapW + 'px'; // square board
}

// ===== Build grid with DIV cells (no native keyboard) =====
function buildGrid(layout){
  const rows = layout.length, cols = layout[0].length;
  // Table with data-* on TD so we can style cursor/active
  const table = document.createElement("table");
  table.className = "grid";
  table.setAttribute("role","grid");

  // Precompute numbering for first-letter squares
  const numbers = firstLetters(layout);

  for (let r=0;r<rows;r++){
    const tr = document.createElement("tr");
    for (let c=0;c<cols;c++){
      const td = document.createElement("td");
      td.dataset.r = r; td.dataset.c = c;

      if (layout[r][c] === "#") {
        td.className = "block";
      } else {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.r = r; cell.dataset.c = c;
        cell.textContent = "";
        cell.tabIndex = 0;
        cell.addEventListener("click", () => {
          setActiveWord(puzzle, r, c);
          setFocusCell(r, c);
          lastFocused = { r, c };
        });
        td.appendChild(cell);

        // draw number if first letter of a clue
        const n = numbers.get(`${r},${c}`);
        if (n) {
          const num = document.createElement("div");
          num.className = "num";
          num.textContent = n;
          td.appendChild(num);
        }
      }
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  S("grid").innerHTML = "";
  S("grid").appendChild(table);
  applyPhoneWidthSizing(puzzle.rows, puzzle.cols);
  // focus first non-block by default
  const first = table.querySelector(".cell");
  if (first) {
    const r = +first.dataset.r, c = +first.dataset.c;
    setActiveWord(puzzle, r, c);
    setFocusCell(r, c);
    lastFocused = { r, c };
  }
}

// Calculate clue numbers for first letters
function firstLetters(layout){
  const rows = layout.length, cols = layout[0].length;
  let n = 0;
  const map = new Map();
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      if (layout[r][c] === "#") continue;
      const startsAcross = (c===0 || layout[r][c-1]==="#") && (c+1<cols && layout[r][c+1] !== "#");
      const startsDown   = (r===0 || layout[r-1][c]==="#") && (r+1<rows && layout[r+1][c] !== "#");
      if (startsAcross || startsDown) {
        n += 1;
        map.set(`${r},${c}`, n);
      }
    }
  }
  return map;
}

// --- helpers you likely already have ---
// firstLetters(layout) => Map<'r,c', clueNum>
// isAcross (boolean) indicates direction
// setActiveWord(p, r, c) highlights the word starting at (r,c)
// lastFocused = { r, c }

function updateCurrentClue(p, r, c) {
  // Ensure we have a map of first-letter numbers like { "r,c" => 1, 2, 3... }
  if (!p._numMap) p._numMap = firstLetters(p.layout);

  // Walk back to the first cell of the current word
  let rr = r, cc = c;
  if (isAcross) {
    while (cc - 1 >= 0 && p.layout[rr][cc - 1] !== '#') cc--;
  } else {
    while (rr - 1 >= 0 && p.layout[rr - 1][cc] !== '#') rr--;
  }

  // Look up the clue number from that first cell
  const clueNum = p._numMap.get(`${rr},${cc}`);

  // Accept either "1A"/"1D" or numeric keys in your JSON
  const bucket = isAcross ? (p.clues?.across || {}) : (p.clues?.down || {});
  const key1 = `${clueNum}${isAcross ? 'A' : 'D'}`;
  const clueText = bucket[key1] ?? bucket[clueNum] ?? '';

  const el = document.getElementById('current-clue');
  if (el) {
    el.textContent = clueText
      ? `${clueNum} ${isAcross ? 'Across' : 'Down'} — ${clueText}`
      : `${isAcross ? 'Across' : 'Down'}`;
    el.style.display = 'block';
  }
}

// ===== Active word highlight & current clue text =====
// ===== Active word highlight & current clue text =====
function setActiveWord(p, r, c){
  // clear previous highlights
  document.querySelectorAll(".grid td.active").forEach(td=>td.classList.remove("active"));
  document.querySelectorAll(".grid td.cursor").forEach(td=>td.classList.remove("cursor"));

  const rows = p.rows, cols = p.cols;

  if (isAcross){
    let c0=c; while (c0-1>=0 && p.layout[r][c0-1] !== "#") c0--;
    let c1=c; while (c1+1<cols && p.layout[r][c1+1] !== "#") c1++;
    for (let x=c0; x<=c1; x++){
      const td = document.querySelector(`td[data-r="${r}"][data-c="${x}"]`);
      if (td) td.classList.add("active");
    }
  } else {
    let r0=r; while (r0-1>=0 && p.layout[r0-1][c] !== "#") r0--;
    let r1=r; while (r1+1<rows && p.layout[r1+1][c] !== "#") r1++;
    for (let y=r0; y<=r1; y++){
      const td = document.querySelector(`td[data-r="${y}"][data-c="${c}"]`);
      if (td) td.classList.add("active");
    }
  }

  const here = document.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
  if (here) here.classList.add("cursor");

  // single source of truth: always update the hint here
  updateCurrentClue(p, r, c);
}

function findClueNumberAt(r,c){
  // recompute numbering once and cache on puzzle
  if (!puzzle._numMap) puzzle._numMap = firstLetters(puzzle.layout);
  return puzzle._numMap.get(`${r},${c}`) || "";
}
function lookupClueText(num, key){
  if (!num || !puzzle.clues || !puzzle.clues[key]) return "";
  // clues were keyed like "1A","1D" originally; we stored as across/down with labels.
  // If yours are numeric only, adapt here.
  const bucket = puzzle.clues[key]; // object like { "1A":"...", ... } or {"1":"..."}
  // Try "1A"/"1D" first
  const k1 = String(num) + (key==="across" ? "A":"D");
  if (bucket[k1]) return bucket[k1];
  // fallback numeric
  if (bucket[String(num)]) return bucket[String(num)];
  return "";
}

function setFocusCell(r, c){
  document.querySelectorAll(".grid td.cursor").forEach(td => td.classList.remove("cursor"));
  const td = document.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
  if (td) td.classList.add("cursor");
  updateCurrentClue(puzzle, r, c);  // <-- add this
}

// ===== Soft keyboard =====
function buildKeys(){
  const wrap = S("softkeys");
  if (!wrap) return;
  const lettersRow = wrap.querySelector(".letters");
  if (!lettersRow) return;
  lettersRow.innerHTML = "";
  "QWERTYUIOPASDFGHJKLZXCVBNM⌫".split("").forEach(ch => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "key"; b.textContent = ch;

    
    if (ch === '⌫') {
      b.id = 'key-back';
      b.addEventListener('click', backspaceLetter);
    } else {
    b.addEventListener("click", () => placeLetter(ch));
    lettersRow.appendChild(b);
  });
  S("key-back").onclick = backspaceLetter;
  S("key-clear").onclick = clearCurrentWord;
}

function placeLetter(ch){
  if (!lastFocused) return;
  const { r, c } = lastFocused;
  updateCurrentClue(puzzle, r, c);    // <-- keep hint visible/updated
  const cell = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
  if (!cell) return;
  cell.textContent = ch;
  advanceCursor();
}
function backspaceLetter(){
  if (!lastFocused) return;
  const { r, c } = lastFocused;
  updateCurrentClue(puzzle, r, c);      // <-- keep
  const cell = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
  if (!cell) return;
  if (cell.textContent) {
    cell.textContent = "";
  } else {
    moveCursor(-1);
    const prev = document.querySelector(`.cell[data-r="${lastFocused.r}"][data-c="${lastFocused.c}"]`);
    if (prev) prev.textContent = "";
  }
}
function advanceCursor(){ moveCursor(+1); }
function moveCursor(delta){
  if (!lastFocused) return;
  let { r, c } = lastFocused;
  if (isAcross){
    do { c += Math.sign(delta); } while (c>=0 && c<puzzle.cols && puzzle.layout[r][c] === "#");
    if (c<0 || c>=puzzle.cols) return;
  } else {
    do { r += Math.sign(delta); } while (r>=0 && r<puzzle.rows && puzzle.layout[r][c] === "#");
    if (r<0 || r>=puzzle.rows) return;
  }
  lastFocused = { r, c };
  setActiveWord(puzzle, r, c);
  setFocusCell(r, c);
}

// Clear current word (respects isAcross)
function clearCurrentWord(){
  if (!lastFocused) return;
  const { r, c } = lastFocused;
  if (isAcross){
    let c0=c; while (c0-1>=0 && puzzle.layout[r][c0-1] !== "#") c0--;
    let c1=c; while (c1+1<puzzle.cols && puzzle.layout[r][c1+1] !== "#") c1++;
    for (let x=c0; x<=c1; x++){
      const cell = document.querySelector(`.cell[data-r="${r}"][data-c="${x}"]`);
      if (cell) cell.textContent = "";
    }
  } else {
    let r0=r; while (r0-1>=0 && puzzle.layout[r0-1][c] !== "#") r0--;
    let r1=r; while (r1+1<puzzle.rows && puzzle.layout[r1+1][c] !== "#") r1++;
    for (let y=r0; y<=r1; y++){
      const cell = document.querySelector(`.cell[data-r="${y}"][data-c="${c}"]`);
      if (cell) cell.textContent = "";
    }
  }
}

// Read grid into string for scoring
function readGridString(){
  const rows = puzzle.rows, cols = puzzle.cols;
  let out = "";
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      if (puzzle.layout[r][c] === "#") { out += "#"; continue; }
      const cell = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
      const v = (cell?.textContent || "").toUpperCase().trim();
      out += /^[A-Z]$/.test(v) ? v : "";
    }
  }
  return out;
}

// ===== Server calls (Google Apps Script) =====
async function post(action, payload){
  const body = new URLSearchParams();
  body.set("action", action);
  body.set("payload", JSON.stringify(payload));

  const res = await fetch(CFG.api, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body
  });

  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch {
    throw new Error(`Server did not return JSON: ${txt.slice(0,120)}...`);
  }
  if (!res.ok || data.ok === false) {
    throw new Error(data && data.error ? data.error : res.statusText);
  }
  return data;
}

// ===== Timer =====
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

// ===== Flows =====
async function beginFlow(){
  const name = S("f-name").value.trim();
  const student = S("f-student").value.trim();
  const email = S("f-email").value.trim();
  const lab = S("f-lab").value.trim();
  if (!name || !student || !email || !lab) {
    S("overlayMsg").textContent = "Please fill all fields.";
    return;
  }

  // Ensure puzzle is ready
  if (!puzzle) {
    try {
      puzzle = await loadPuzzleJson(CFG.weekId);
      buildGrid(puzzle.layout);
      buildKeys();
    } catch (e) { return logErr(e.message); }
  }

  // Start attempt on server
  try {
    const st = await post("startAttempt", { weekId: CFG.weekId, name, studentNumber: student, email, lab });
    attemptId = st.attemptId;
  } catch (e) { return logErr(e.message); }

  // Hide overlay + start timer
  S("overlay").style.display = "none";
  startTimer();
}

async function submitFlow(){
  if (!attemptId) return logErr("Click Begin first.");
  stopTimer();
  const userGridString = readGridString();
  try{
    const fin = await post("finishAttempt", { attemptId, userGridString });
    S("result").textContent = `You got ${fin.percentCorrect}% correct. Official time: ${(fin.elapsedMs/1000).toFixed(1)} s`;
  }catch(e){ logErr(e.message); }
}

// ===== Init =====
async function init(){
  // Preload puzzle so users see it behind the overlay
  try {
    puzzle = await loadPuzzleJson(CFG.weekId);
    buildGrid(puzzle.layout);
    buildKeys();
  } catch (e) {
    console.warn("Preload failed:", e.message);
  }

  // Wire buttons
  S("btn-begin").onclick = beginFlow;
  S("toggle").onclick = ()=>{ isAcross = !isAcross; if (lastFocused) setActiveWord(puzzle, lastFocused.r, lastFocused.c); };
  S("clear-word").onclick = clearCurrentWord;
  S("submit").onclick = submitFlow;

  // Resize handling
  window.addEventListener('resize', () => { if (puzzle) applyPhoneWidthSizing(puzzle.rows, puzzle.cols); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => { if (puzzle) applyPhoneWidthSizing(puzzle.rows, puzzle.cols); });
  }
  console.log("App initialized");
}
document.addEventListener("DOMContentLoaded", init);
