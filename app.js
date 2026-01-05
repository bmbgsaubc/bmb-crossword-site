// ===== Helpers =====
const S = (id)=>document.getElementById(id);
let puzzle = null;
let attemptId = null;
let isAcross = true;
let timerHandle = null;
let msElapsed = 0;
let timerStartTime = null;
let lastFocused = null; // {r,c}
let curR = 0, curC = 0; // current cursor (row, col)
let isStartingAttempt = false; // gate duplicate "Begin" clicks
let hasStartedAttempt = false; // prevent re-starting once begun

// minimal config (index.html sets window.CONFIG)
const CFG = window.CONFIG;
const MOBILE_QUERY = typeof window.matchMedia === "function"
  ? window.matchMedia("(max-width: 800px)")
  : null;
const isMobileView = () => MOBILE_QUERY ? MOBILE_QUERY.matches : window.innerWidth <= 800;

// Log to UI + console
function logErr(msg, err){
  console.error(msg, err || "");
  const el = S("overlayMsg") || S("result");
  if (el) el.textContent = msg;
}

async function loadManifest(){
  const res = await fetch('puzzles/index.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Manifest not found (puzzles/index.json)');
  return res.json();
}

function setChosenPuzzle(id){
  CONFIG.weekId = id.trim();
  // reflect selection in the UI if the chooser exists
  const sel = document.getElementById('puzzle-chooser');
  if (sel) sel.value = CONFIG.weekId;
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
  if (!p.solutionString) {
    // Flatten layout into a single string so scoring works even if JSON omits solutionString.
    p.solutionString = p.layout.join("").toUpperCase();
  }
  return p;
}
async function loadPuzzleJson(id){
  const url = `puzzles/${id}.json`;
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
  const isMobile = isMobileView();
  const parentWidth = wrap.parentElement ? wrap.parentElement.clientWidth : wrap.clientWidth || vw;
  const availableDesktopWidth = Math.min(parentWidth || vw, vw - 40);
  const wrapW = Math.floor(isMobile ? vw : Math.max(240, availableDesktopWidth));
  const cell = Math.max(18, Math.floor(wrapW / cols));
  document.documentElement.style.setProperty('--cell', cell + 'px');
  wrap.style.width  = wrapW + 'px';
  wrap.style.height = wrapW + 'px'; // square board
}

// ===== Build grid with DIV cells (no native keyboard) =====
function buildGrid(layout){
  const rows = layout.length, cols = layout[0].length;

  const table = document.createElement("table");
  table.className = "grid";
  table.setAttribute("role","grid");

  // Precompute numbering for first-letter squares
  const numbers = firstLetters(layout);   // your existing helper

  for (let r = 0; r < rows; r++){
    const tr = document.createElement("tr");

    for (let c = 0; c < cols; c++){
      const td = document.createElement("td");
      td.dataset.r = r;
      td.dataset.c = c;

      if (layout[r][c] === "#") {
        td.className = "block";
      } else {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.textContent = "";

        // we DO NOT focus anything; we just move our logical cursor
        cell.addEventListener("click", () => {
          curR = r;
          curC = c;
          setActiveWord(puzzle, curR, curC);   // highlight word + clue
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

  // responsive sizing
  applyPhoneWidthSizing(rows, cols);  // your existing function

  // set initial cursor on first non-block cell
  const first = table.querySelector(".cell");
  if (first) {
    curR = +first.dataset.r;
    curC = +first.dataset.c;
    setActiveWord(puzzle, curR, curC);
  }

  updateSubmitState();
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
  const dirLabel = isAcross ? 'A' : 'D';

  const el = document.getElementById('current-clue');
  if (el) {
    const prefix = clueNum ? `${clueNum}${dirLabel}` : dirLabel;
    el.textContent = clueText ? `${prefix} — ${clueText}` : prefix;
    el.style.display = 'block';
    fitClueText(el);
  }
}

// Keep the clue bar to one line by shrinking the font if needed
function fitClueText(el) {
  if (!el) return;
  if (!el.dataset.baseFontSize) {
    el.dataset.baseFontSize = String(parseFloat(getComputedStyle(el).fontSize) || 14);
  }
  const baseSize = parseFloat(el.dataset.baseFontSize);
  const minSize = 10;
  let size = baseSize;
  el.style.fontSize = `${size}px`;
  while (el.scrollWidth > el.clientWidth && size > minSize) {
    size -= 0.5; // step down until it fits
    el.style.fontSize = `${size}px`;
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
function buildKeys() {
  const wrap = document.getElementById('softkeys');
  if (!wrap) return;

  if (!isMobileView()) {
    wrap.innerHTML = "";
    wrap.setAttribute("aria-hidden", "true");
    return;
  }
  wrap.removeAttribute("aria-hidden");

  // Clear any previous keyboard
  wrap.innerHTML = `
    <div class="row letters r1"></div>
    <div class="row letters r2"></div>
    <div class="row letters r3"></div>
  `;

  const rows = [
    'QWERTYUIOP',
    'ASDFGHJKL',
    'ZXCVBNM'
  ];

  const r1 = wrap.querySelector('.r1');
  const r2 = wrap.querySelector('.r2');
  const r3 = wrap.querySelector('.r3');

  // Row 1
  for (const ch of rows[0]) {
    const b = document.createElement('button');
    b.className = 'key';
    b.type = 'button';
    b.textContent = ch;
    b.addEventListener('click', () => handleLetterInput(ch));
    r1.appendChild(b);
  }

  // Row 2
  for (const ch of rows[1]) {
    const b = document.createElement('button');
    b.className = 'key';
    b.type = 'button';
    b.textContent = ch;
    b.addEventListener('click', () => handleLetterInput(ch));
    r2.appendChild(b);
  }

  // Row 3 (Z–M)
  for (const ch of rows[2]) {
    const b = document.createElement('button');
    b.className = 'key';
    b.type = 'button';
    b.textContent = ch;
    b.addEventListener('click', () => handleLetterInput(ch));
    r3.appendChild(b);
  }

  // ⌫ at the far right of row 3
  const back = document.createElement('button');
  back.id = 'key-back';
  back.className = 'key';
  back.type = 'button';
  back.textContent = '⌫';
  back.addEventListener('click', handleBackspace);
  r3.appendChild(back);

}

function putLetterAt(r, c, ch){
  const td = document.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
  if (!td || td.classList.contains('block')) return;
  const cell = td.querySelector('.cell');
  if (cell) cell.textContent = ch;
}

function getLetterAt(r, c){
  const td = document.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
  const cell = td?.querySelector('.cell');
  return (cell?.textContent || '').toUpperCase();
}

function getWordStart(p, r, c, across){
  let rr = r, cc = c;
  if (across) {
    while (cc - 1 >= 0 && p.layout[rr][cc - 1] !== "#") cc--;
  } else {
    while (rr - 1 >= 0 && p.layout[rr - 1][cc] !== "#") rr--;
  }
  return { r: rr, c: cc };
}

function getWordStartsByDirection(p, across){
  const key = across ? "_acrossStarts" : "_downStarts";
  if (p[key]) return p[key];
  const starts = [];
  for (let r = 0; r < p.rows; r++){
    for (let c = 0; c < p.cols; c++){
      if (p.layout[r][c] === "#") continue;
      const startsAcross = (c === 0 || p.layout[r][c - 1] === "#") && (c + 1 < p.cols && p.layout[r][c + 1] !== "#");
      const startsDown = (r === 0 || p.layout[r - 1][c] === "#") && (r + 1 < p.rows && p.layout[r + 1][c] !== "#");
      if (across && startsAcross) starts.push({ r, c });
      if (!across && startsDown) starts.push({ r, c });
    }
  }
  p[key] = starts;
  return starts;
}

function findNextWordStart(p, startR, startC, across){
  const starts = getWordStartsByDirection(p, across);
  const idx = starts.findIndex(pos => pos.r === startR && pos.c === startC);
  if (idx >= 0 && idx + 1 < starts.length) return starts[idx + 1];
  return null;
}

function stepForwardInWord(p, r, c, across){
  if (across){
    const nc = c + 1;
    if (nc < p.cols && p.layout[r][nc] !== "#") return { r, c: nc };
  } else {
    const nr = r + 1;
    if (nr < p.rows && p.layout[nr][c] !== "#") return { r: nr, c };
  }
  return null;
}

function moveNextCell(){
  const rows = puzzle.rows, cols = puzzle.cols;
  let r = curR, c = curC;
  if (isAcross){
    do { c++; } while (c<cols && puzzle.layout[r][c] === '#');
    if (c>=cols){ /* stop at end of row */ c = curC; }
    curC = c;
  } else {
    do { r++; } while (r<rows && puzzle.layout[r][c] === '#');
    if (r>=rows){ r = curR; }
    curR = r;
  }
  setActiveWord(puzzle, curR, curC);
}

function movePrevCell(){
  const rows = puzzle.rows, cols = puzzle.cols;
  let r = curR, c = curC;
  if (isAcross){
    do { c--; } while (c>=0 && puzzle.layout[r][c] === '#');
    if (c<0){ c = curC; }
    curC = c;
  } else {
    do { r--; } while (r>=0 && puzzle.layout[r][c] === '#');
    if (r<0){ r = curR; }
    curR = r;
  }
  setActiveWord(puzzle, curR, curC);
}

function moveCursorByDelta(dr, dc) {
  if (!puzzle) return;
  let r = curR;
  let c = curC;
  while (true) {
    r += dr;
    c += dc;
    if (r < 0 || c < 0 || r >= puzzle.rows || c >= puzzle.cols) {
      return;
    }
    if (puzzle.layout[r][c] === '#') continue;
    curR = r;
    curC = c;
    setActiveWord(puzzle, curR, curC);
    return;
  }
}

function handleLetterInput(ch) {
  if (!puzzle) return;

  // write into current logical cell
  const cell = document.querySelector(`.cell[data-r="${curR}"][data-c="${curC}"]`);
  if (cell) {
    cell.textContent = ch.toUpperCase();
  }

  // move forward in the current direction
  const currentStart = getWordStart(puzzle, curR, curC, isAcross);
  const nextCell = stepForwardInWord(puzzle, curR, curC, isAcross);
  if (nextCell) {
    curR = nextCell.r;
    curC = nextCell.c;
  } else {
    const nextWord = findNextWordStart(puzzle, currentStart.r, currentStart.c, isAcross);
    if (nextWord) {
      curR = nextWord.r;
      curC = nextWord.c;
    }
  }

  // keep word highlight + clue in sync
  setActiveWord(puzzle, curR, curC);
  updateSubmitState();
}

// Backspace behaviour: clear current cell, then move backwards
function handleBackspace() {
  if (!puzzle) return;

  // 1) if current cell has a letter, just clear it and stay here
  let cell = document.querySelector(`.cell[data-r="${curR}"][data-c="${curC}"]`);
  if (cell && cell.textContent) {
    cell.textContent = '';
    setActiveWord(puzzle, curR, curC);
    updateSubmitState();
    return;
  }

  // 2) otherwise, move one cell backward in the word
  if (isAcross) {
    let c = curC - 1;
    while (c >= 0 && puzzle.layout[curR][c] === '#') c--;
    if (c >= 0 && puzzle.layout[curR][c] !== '#') {
      curC = c;
    }
  } else {
    let r = curR - 1;
    while (r >= 0 && puzzle.layout[r][curC] === '#') r--;
    if (r >= 0 && puzzle.layout[r][curC] !== '#') {
      curR = r;
    }
  }

  // 3) clear the new cell we landed on
  cell = document.querySelector(`.cell[data-r="${curR}"][data-c="${curC}"]`);
  if (cell) {
    cell.textContent = '';
  }

  setActiveWord(puzzle, curR, curC);
  updateSubmitState();
}

function handlePhysicalKey(e) {
  if (!puzzle) return;
  const overlayVisible = (() => {
    const overlay = S("overlay");
    return overlay && overlay.style.display !== "none";
  })();
  if (overlayVisible) return;

  const active = document.activeElement;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) {
    return;
  }

  const key = e.key;
  if (/^[a-zA-Z]$/.test(key)) {
    e.preventDefault();
    handleLetterInput(key.toUpperCase());
    return;
  }
  switch (key) {
    case "Backspace":
    case "Delete":
      e.preventDefault();
      handleBackspace();
      break;
    case "ArrowRight":
      e.preventDefault();
      moveCursorByDelta(0, 1);
      break;
    case "ArrowLeft":
      e.preventDefault();
      moveCursorByDelta(0, -1);
      break;
    case "ArrowUp":
      e.preventDefault();
      moveCursorByDelta(-1, 0);
      break;
    case "ArrowDown":
      e.preventDefault();
      moveCursorByDelta(1, 0);
      break;
    case " ":
      e.preventDefault();
      isAcross = !isAcross;
      if (puzzle) setActiveWord(puzzle, curR, curC);
      break;
    default:
      break;
  }
}

function placeLetter(ch){
  if (!lastFocused) return;
  const { r, c } = lastFocused;
  updateCurrentClue(puzzle, r, c);    // <-- keep hint visible/updated
  const cell = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
  if (!cell) return;
  cell.textContent = ch;
  advanceCursor();
  updateSubmitState();
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
  updateSubmitState();
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

function jumpToNextWord(){
  if (!puzzle) return;
  const start = getWordStart(puzzle, curR, curC, isAcross);
  const next = findNextWordStart(puzzle, start.r, start.c, isAcross);
  if (!next) return;
  curR = next.r;
  curC = next.c;
  setActiveWord(puzzle, curR, curC);
}

function clearCurrentWord() {
  if (!puzzle) return;

  const layout = puzzle.layout;
  const rows = puzzle.rows;
  const cols = puzzle.cols;
  const r = curR;
  const c = curC;

  // If the cursor somehow sits on a block, bail
  if (layout[r][c] === '#') return;

  if (isAcross) {
    let c0 = c, c1 = c;
    while (c0 - 1 >= 0 && layout[r][c0 - 1] !== '#') c0--;
    while (c1 + 1 < cols && layout[r][c1 + 1] !== '#') c1++;

    for (let x = c0; x <= c1; x++) {
      const cell = document.querySelector(`.cell[data-r="${r}"][data-c="${x}"]`);
      if (cell) cell.textContent = '';
    }
  } else {
    let r0 = r, r1 = r;
    while (r0 - 1 >= 0 && layout[r0 - 1][c] !== '#') r0--;
    while (r1 + 1 < rows && layout[r1 + 1][c] !== '#') r1++;

    for (let y = r0; y <= r1; y++) {
      const cell = document.querySelector(`.cell[data-r="${y}"][data-c="${c}"]`);
      if (cell) cell.textContent = '';
    }
  }

  // keep highlight + clue consistent
  setActiveWord(puzzle, curR, curC);
  updateSubmitState();
}

// Read grid into string for scoring
function readGridString(){
  const rows = puzzle.rows, cols = puzzle.cols;
  let out = "";
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      if (puzzle.layout[r][c] === "#") { out += "#"; continue; }
      const cell = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
      const v = getLetterAt(r,c);
      out += /^[A-Z]$/.test(v) ? v : "";
    }
  }
  return out;
}

function isGridFullyFilled(){
  if (!puzzle) return false;
  const { rows, cols, layout } = puzzle;
  for (let r = 0; r < rows; r++){
    for (let c = 0; c < cols; c++){
      if (layout[r][c] === "#") continue;
      if (!getLetterAt(r, c)) return false;
    }
  }
  return true;
}
function updateSubmitState(){
  const btn = S("submit");
  if (!btn) return;
  btn.disabled = !isGridFullyFilled();
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
function formatElapsedMs(ms){
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
function startTimer(){
  // Reset and ensure we never accumulate multiple intervals from double-clicks
  stopTimer();
  msElapsed = 0;
  timerStartTime = performance.now();
  S("timer").style.display = "inline-block";
  S("timer").textContent = "00:00";
  timerHandle = setInterval(()=> {
    // use wall clock so the display stays accurate even if intervals aren't
    msElapsed = Math.max(0, performance.now() - timerStartTime);
    S("timer").textContent = formatMs(msElapsed);
  }, 100);
}
function stopTimer(){
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
  timerStartTime = null;
}

// ===== Flows =====
async function beginFlow(){
  const beginBtn = S("btn-begin");
  if (hasStartedAttempt || isStartingAttempt) return;
  isStartingAttempt = true;
  if (beginBtn) {
    beginBtn.disabled = true;
    beginBtn.textContent = "Starting...";
  }
  const resetBeginBtn = () => {
    isStartingAttempt = false;
    if (!hasStartedAttempt && beginBtn) {
      beginBtn.disabled = false;
      beginBtn.textContent = "Begin and Start Timer";
    }
  };

  const name = S("f-name").value.trim();
  const student = S("f-student").value.trim();
  const email = S("f-email").value.trim();
  const lab = S("f-lab").value.trim();
  if (!name || !student || !email || !lab) {
    S("overlayMsg").textContent = "Please fill all fields.";
    resetBeginBtn();
    return;
  }

  // Ensure puzzle is ready
  if (!puzzle) {
    try {
      puzzle = await loadPuzzleJson(CFG.weekId);
      buildGrid(puzzle.layout);
      buildKeys();
    } catch (e) {
      resetBeginBtn();
      return logErr(e.message);
    }
  }

  // Start attempt on server
  try {
    const st = await post("startAttempt", { weekId: CONFIG.weekId, name, studentNumber: student, email, lab });
    attemptId = st.attemptId;
    hasStartedAttempt = true;
    isStartingAttempt = false;
  } catch (e) {
    resetBeginBtn();
    return logErr(e.message);
  }

  // Hide overlay + start timer
  S("overlay").style.display = "none";
  startTimer();
}

async function submitFlow(){
  if (!attemptId) return logErr("Click Begin first.");
  stopTimer();
  const userGridString = readGridString();
  const percentCorrect = puzzle.solutionString
    ? computePercent(userGridString, puzzle.solutionString) // if you included solution in JSON
    : null;
  try{
    const fin = await post("finishAttempt", {
      attemptId,
      weekId: CONFIG.weekId,
      userGridString,
      rows: puzzle.rows,
      cols: puzzle.cols,
      solutionString: puzzle.solutionString, // optional: if you prefer server fetch, drop this
      percentCorrect
    });
    S("result").textContent = `You got ${fin.percentCorrect}% correct. Official time: ${formatElapsedMs(fin.elapsedMs)}. Check email/junk folder for your completed crossword.`;
  }catch(e){ logErr(e.message); }
}

function computePercent(user, sol){
  const U = user.toUpperCase(), S = sol.toUpperCase();
  let total=0, correct=0;
  for (let i=0;i<S.length;i++){
    if (S[i] !== "#") { total++; if (U[i] && U[i]===S[i]) correct++; }
  }
  return total ? Math.round(100*correct/total) : 0;
}

// ===== Init =====
async function init(){
  try {
    // 1) Read query param (?p=ID / ?puzzle=ID / ?puzzles=ID), else use manifest default
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get('p') || params.get('puzzle') || params.get('puzzles');
    const manifest = await loadManifest();

    const all = (manifest.puzzles || []);
    const manifestDefault = manifest.default || all[0]?.id || null;
    const chosen = (fromUrl && fromUrl.trim()) || CFG.weekId || manifestDefault;
    // populate dropdown (if present)
    const sel = document.getElementById('puzzle-chooser');
    if (sel) {
      sel.innerHTML = all.map(p => `<option value="${p.id}">${p.title || p.id}</option>`).join('');
    }
    if (chosen) setChosenPuzzle(chosen);

    // 2) Load the chosen puzzle JSON from GitHub Pages
    puzzle = await loadPuzzleJson(CONFIG.weekId);
    S("title").textContent = puzzle.title || `BMB Weekly Crossword — ${CONFIG.weekId}`;
    buildGrid(puzzle.layout);
    buildKeys();

    // when chooser changes, reload the puzzle
    if (sel) {
      sel.addEventListener('change', async () => {
        try {
          setChosenPuzzle(sel.value);
          puzzle = await loadPuzzleJson(CONFIG.weekId);
          S("title").textContent = puzzle.title || `BMB Weekly Crossword — ${CONFIG.weekId}`;
          buildGrid(puzzle.layout);
          buildKeys();
          // optional: reset attempt state if someone switches before starting
          attemptId = null;
          S("overlayMsg").textContent = '';
        } catch(e){
          logErr(e.message);
        }
      });
    }
  } catch (e) {
    console.warn('Preload failed:', e.message);
  }

    // Initialize soft keyboard
  buildKeys();

  // wire buttons as you already do
  S("btn-begin").onclick = beginFlow;
  S("toggle").onclick = () => {
    isAcross = !isAcross;
    if (puzzle) {
      setActiveWord(puzzle, curR, curC);   // re-highlight + update clue
    }
  };  
  const nextWordBtn = S("next-word");
  if (nextWordBtn) nextWordBtn.onclick = jumpToNextWord;
  const clearWordBtn = S("clear-word");
  if (clearWordBtn) clearWordBtn.onclick = clearCurrentWord;
  S("submit").onclick = submitFlow;
  document.addEventListener("keydown", handlePhysicalKey);

  // Resize handling
  window.addEventListener('resize', () => {
    if (puzzle) applyPhoneWidthSizing(puzzle.rows, puzzle.cols);
    buildKeys();
    fitClueText(S("current-clue"));
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (puzzle) applyPhoneWidthSizing(puzzle.rows, puzzle.cols);
      fitClueText(S("current-clue"));
    });
  }
  console.log("App initialized");
}
document.addEventListener("DOMContentLoaded", init);
