/* ============================================================
   app.js — Boolean Algebra Simplifier (Full)
   Features:
     - Parser: tokenize -> shunting-yard -> RPN
     - Evaluator: RPN evaluator (supports ! ~ prefix, ' postfix, *, &, implicit AND, + | OR, ^ XOR)
     - Truth table generation
     - Karnaugh Map rendering (up to 4 vars visible; truth table supports more)
     - K-Map manual editing: click cycles 0 -> 1 -> d -> 0
     - Don't-care (d) handling in QM simplification
     - Quine-McCluskey simplifier (uses don't-cares for grouping; covers only minterms)
     - Mode SOP / POS and SOP<->POS conversion (via truth table duality)
     - Export K-Map as PNG (canvas render), print view
     - Benchmark QM execution (random minterm sets)
     - Inline tooltips via title attributes (in HTML)
     - Dark/light theme toggle (saved to localStorage)
   ============================================================ */

/* ============
   Helper / Globals
   ============ */
const MAX_KMAP_VARS = 4;
const GRAY2 = [0,1];
const GRAY4 = [0,1,3,2];
const byId = id => document.getElementById(id);
const now = () => (performance && performance.now) ? performance.now() : Date.now();
const toBin = (n,w) => n.toString(2).padStart(w,'0');

let currentVars = [];       // array of variable names currently used for truth table eval (A..Z)
let currentRPN = null;      // RPN tokens for expression
let lastTruthRows = [];     // truth table rows [{m, env, y}]
let currentKMap = { vars: [], n:0, layout: null, cells: [], dontcares: [], total:0 };

/* ============
   Parser: tokenize -> toRPN
   Supports:
     - VAR: A..Z
     - NUM: 0/1
     - NOT: prefix ! ~  OR postfix ' (multiple)
     - AND: &, *, implicit adjacency
     - OR: +, |
     - XOR: ^
     - Parens: ( )
   ============ */

function tokenize(raw) {
  const src = (raw||'').replace(/\s+/g,'');
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    // numbers
    if (ch === '0' || ch === '1') {
      tokens.push({type:'NUM', value: Number(ch)});
      i++; continue;
    }
    // variable
    if (/[A-Za-z]/.test(ch)) {
      const v = ch.toUpperCase();
      tokens.push({type: 'VAR', value: v});
      i++;
      // postfix ' handling
      let negCount = 0;
      while (src[i] === "'") { negCount++; i++; }
      if (negCount % 2 === 1) tokens.push({type:'OP', value:'NOT', unary:true, postfix:true, precedence:4, associativity:'right'});
      continue;
    }
    // parentheses
    if (ch === '(') { tokens.push({type:'LP'}); i++; continue; }
    if (ch === ')') { tokens.push({type:'RP'}); i++; continue; }
    // prefix NOT
    if (ch === '!' || ch === '~') { tokens.push({type:'OP', value:'NOT', unary:true, precedence:4, associativity:'right'}); i++; continue; }
    // AND
    if (ch === '&' || ch === '*') { tokens.push({type:'OP', value:'AND', precedence:3, associativity:'left'}); i++; continue; }
    // OR
    if (ch === '+' || ch === '|') { tokens.push({type:'OP', value:'OR', precedence:1, associativity:'left'}); i++; continue; }
    // XOR
    if (ch === '^') { tokens.push({type:'OP', value:'XOR', precedence:2, associativity:'left'}); i++; continue; }
    // unrecognized
    throw new Error("Karakter tidak dikenali pada posisi " + i + ": '" + ch + "'");
  }
  return tokens;
}

function isOperand(tok) {
  return tok && (tok.type === 'VAR' || tok.type === 'NUM' || tok.type === 'RP');
}
function beginsOperand(tok) {
  return tok && (tok.type === 'VAR' || tok.type === 'NUM' || tok.type === 'LP' || (tok.type==='OP' && tok.value==='NOT'));
}

function toRPN(tokens) {
  // insert implicit ANDs
  const withImplicit = [];
  for (let i=0;i<tokens.length;i++) {
    withImplicit.push(tokens[i]);
    const a = tokens[i], b = tokens[i+1];
    if (isOperand(a) && beginsOperand(b)) {
      withImplicit.push({type:'OP', value:'AND', precedence:3, associativity:'left', implicit:true});
    }
  }

  const output = [];
  const stack = [];
  for (const t of withImplicit) {
    if (t.type === 'VAR' || t.type === 'NUM') { output.push(t); continue; }
    if (t.type === 'OP' && t.postfix && t.value === 'NOT') { output.push(t); continue; }
    if (t.type === 'OP' && t.unary && !t.postfix) { stack.push(t); continue; }
    if (t.type === 'OP' && !t.unary) {
      while (stack.length) {
        const top = stack[stack.length-1];
        if (top.type === 'OP' && ((top.precedence > t.precedence) || (top.precedence === t.precedence && t.associativity === 'left'))) {
          output.push(stack.pop());
        } else break;
      }
      stack.push(t);
      continue;
    }
    if (t.type === 'LP') { stack.push(t); continue; }
    if (t.type === 'RP') {
      while (stack.length && stack[stack.length-1].type !== 'LP') output.push(stack.pop());
      if (!stack.length) throw new Error("Kurung tidak seimbang");
      stack.pop(); // remove LP
      continue;
    }
  }
  while (stack.length) {
    const s = stack.pop();
    if (s.type === 'LP' || s.type === 'RP') throw new Error("Kurung tidak seimbang di akhir");
    output.push(s);
  }
  return output;
}

/* ============
   RPN Evaluator
   ============ */
function evalRPN(rpn, env) {
  const st = [];
  for (const t of rpn) {
    if (t.type === 'NUM') st.push(Boolean(t.value));
    else if (t.type === 'VAR') {
      if (!(t.value in env)) throw new Error(`Variabel ${t.value} tidak didefinisikan`);
      st.push(Boolean(env[t.value]));
    } else if (t.type === 'OP') {
      if (t.value === 'NOT') {
        if (st.length < 1) throw new Error("Operator NOT kekurangan operand");
        const a = st.pop(); st.push(!a);
      } else {
        if (st.length < 2) throw new Error(`Operator ${t.value} kekurangan operand`);
        const b = st.pop(); const a = st.pop();
        if (t.value === 'AND') st.push(a && b);
        else if (t.value === 'OR') st.push(a || b);
        else if (t.value === 'XOR') st.push(Boolean(a) !== Boolean(b));
        else throw new Error("Operator tidak dikenal: " + t.value);
      }
    }
  }
  if (st.length !== 1) throw new Error("Ekspresi tidak valid");
  return st[0] ? 1 : 0;
}

/* ============
   Truth Table Builder & Renderer
   ============ */
function extractVars(expr) {
  const vars = (expr.match(/[A-Za-z]/g) || []).map(ch => ch.toUpperCase());
  return Array.from(new Set(vars)).sort();
}

function buildTruthTable(vars, rpn) {
  const rows = [];
  const n = vars.length;
  const total = 1 << n;
  for (let m=0;m<total;m++) {
    const env = {};
    for (let i=0;i<n;i++) env[vars[i]] = (m >> (n-1-i)) & 1; // MSB is first var
    const y = rpn ? evalRPN(rpn, env) : 0;
    rows.push({m, env, y});
  }
  return rows;
}

function renderTruthTable(vars, rows) {
  const container = byId('truthTableContainer');
  if (!container) return;
  // build table HTML
  let html = '<table id="truthTable"><thead><tr>';
  for (const v of vars) html += `<th>${v}</th>`;
  html += '<th>Y</th><th class="muted">m</th></tr></thead><tbody>';
  for (const r of rows) {
    html += '<tr>';
    for (const v of vars) html += `<td>${r.env[v]}</td>`;
    html += `<td><b>${r.y}</b></td><td class="muted">${r.m}</td></tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

/* ============
   K-Map Layout & Rendering (DOM and Canvas export)
   Supports up to 4 vars for K-Map visualisation.
   ============ */

function kmapLayoutForVars(nVars) {
  if (nVars === 1) {
    return { rows: GRAY2, cols: [0], rowVars: ['A'], colVars: [], index({r,c}) { return GRAY2[r]; } };
  }
  if (nVars === 2) {
    return { rows: GRAY2, cols: GRAY2, rowVars: ['A'], colVars: ['B'], index({r,c}) { return (GRAY2[r]<<1)|GRAY2[c]; } };
  }
  if (nVars === 3) {
    return { rows: GRAY2, cols: GRAY4, rowVars: ['A'], colVars: ['B','C'], index({r,c}) { return (GRAY2[r]<<2) | GRAY4[c]; } };
  }
  if (nVars === 4) {
    return { rows: GRAY4, cols: GRAY4, rowVars: ['A','B'], colVars: ['C','D'], index({r,c}) {
      const AB = GRAY4[r], CD = GRAY4[c];
      const A = (AB>>1)&1, B = AB&1, C = (CD>>1)&1, D = CD&1;
      return (A<<3)|(B<<2)|(C<<1)|D;
    } };
  }
  return null;
}

function initKMap(vars) {
  const n = Math.min(vars.length, MAX_KMAP_VARS);
  const layout = kmapLayoutForVars(n);
  currentKMap = { vars: vars.slice(0,n), n, layout, cells: [], dontcares: [], total: (1<<n) };
  currentKMap.cells = new Array(currentKMap.total).fill(0);
  // render DOM
  const kmapEl = byId('kmapContainer');
  if (!kmapEl) return;
  if (!layout) {
    kmapEl.innerHTML = `<div class="muted">K-Map hanya sampai ${MAX_KMAP_VARS} variabel. Variabel terdeteksi: ${vars.length}.</div>`;
    return;
  }
  const rows = layout.rows.length || 1;
  const cols = layout.cols.length || 1;
  // style grid
  kmapEl.style.display = 'grid';
  kmapEl.style.gridTemplateColumns = `repeat(${cols}, 56px)`;
  kmapEl.style.gap = '6px';
  kmapEl.innerHTML = '';
  for (let r=0;r<rows;r++) {
    for (let c=0;c<cols;c++) {
      const idx = layout.index({r,c});
      const div = document.createElement('div');
      div.className = 'kcell';
      div.dataset.index = idx;
      div.textContent = '0';
      div.title = `m${idx}`;
      // cycle: 0 -> 1 -> d -> 0
      div.addEventListener('click', ()=>{
        if (currentKMap.dontcares.includes(idx)) {
          // was d -> become 0
          currentKMap.dontcares = currentKMap.dontcares.filter(x=>x!==idx);
          currentKMap.cells[idx] = 0;
        } else if (currentKMap.cells[idx] === 0) {
          currentKMap.cells[idx] = 1;
        } else if (currentKMap.cells[idx] === 1) {
          // become don't care
          currentKMap.cells[idx] = 0;
          currentKMap.dontcares.push(idx);
        }
        updateKMapDOM();
      });
      kmapEl.appendChild(div);
    }
  }
  updateKMapDOM();
}

function updateKMapDOM() {
  const kmapEl = byId('kmapContainer');
  if (!kmapEl || !currentKMap.layout) return;
  const children = kmapEl.children;
  for (let i=0;i<children.length;i++) {
    const el = children[i];
    const idx = Number(el.dataset.index);
    const isD = currentKMap.dontcares.includes(idx);
    const v = currentKMap.cells[idx];
    el.classList.toggle('on', !!v);
    el.classList.toggle('dc', isD);
    el.textContent = isD ? 'd' : String(v);
  }
}

function paintKMapFromMinterms(minterms=[], dontcares=[]) {
  if (!currentKMap.layout) return;
  currentKMap.cells.fill(0);
  currentKMap.dontcares = [];
  for (const m of minterms) if (m>=0 && m<currentKMap.total) currentKMap.cells[m] = 1;
  for (const d of dontcares) if (d>=0 && d<currentKMap.total) currentKMap.dontcares.push(d);
  updateKMapDOM();
}
function collectMintermsFromKMap() {
  const res = [];
  for (let i=0;i<currentKMap.total;i++) if (currentKMap.cells[i]) res.push(i);
  return res.sort((a,b)=>a-b);
}
function collectDontCaresFromKMap() { return currentKMap.dontcares.slice().sort((a,b)=>a-b); }

/* ============
   Quine–McCluskey with Don't-Care
   - minterms: required to cover
   - dontcares: used for combining but not required to be covered
   ============ */

function countOnes(binStr) { return binStr.split('').filter(c=>c==='1').length; }
function canCombine(a,b) {
  let diff = 0;
  for (let i=0;i<a.length;i++) {
    if (a[i] !== b[i]) diff++;
    if (diff>1) return false;
  }
  return diff === 1;
}
function combineBins(a,b) {
  let r = '';
  for (let i=0;i<a.length;i++) r += (a[i]===b[i]) ? a[i] : '-';
  return r;
}
function covers(imp, binStr) {
  for (let i=0;i<imp.length;i++) {
    if (imp[i] === '-') continue;
    if (imp[i] !== binStr[i]) return false;
  }
  return true;
}
function implicantsToSOP(impls, vars) {
  if (!impls.length) return '0';
  const parts = impls.map(mask=>{
    let s = '';
    for (let i=0;i<mask.length;i++) {
      if (mask[i] === '-') continue;
      const v = vars[i];
      s += (mask[i] === '1') ? v : (v + "'");
    }
    return s || '1';
  });
  return parts.join(' + ');
}

function qmSimplifyWithDontCare(minterms, dontcares, varNames) {
  // Build list of candidate terms (minterms + dontcares) for grouping
  const all = Array.from(new Set([...(minterms||[]), ...(dontcares||[])])).sort((a,b)=>a-b);
  if (!minterms || minterms.length === 0) return {implicants: [], sop: '0'};
  const W = varNames.length;
  const bins = all.map(m => toBin(m, W));
  // group by ones count
  let groups = {};
  for (const b of bins) {
    const k = countOnes(b);
    (groups[k] || (groups[k]=[])).push({bin:b, used:false, from:[b]});
  }
  let anyCombined = true;
  const allPrimes = [];
  while (anyCombined) {
    anyCombined = false;
    const newGroups = {};
    const keys = Object.keys(groups).map(Number).sort((a,b)=>a-b);
    for (let idx=0; idx<keys.length-1; idx++) {
      const g1 = groups[keys[idx]] || [], g2 = groups[keys[idx+1]] || [];
      for (const a of g1) for (const b of g2) {
        if (canCombine(a.bin, b.bin)) {
          const c = combineBins(a.bin, b.bin);
          const ones = countOnes(c.replace(/-/g,''));
          const item = {bin:c, used:false, from:[...new Set([...(a.from||[]), ...(b.from||[])])]};
          (newGroups[ones] || (newGroups[ones]=[])).push(item);
          a.used = true; b.used = true; anyCombined = true;
        }
      }
    }
    // collect primes from current groups that were not used
    for (const k in groups) for (const it of groups[k]) if (!it.used) allPrimes.push(it.bin);
    // dedup newGroups
    for (const k in newGroups) {
      const unique = []; const seen = new Set();
      for (const it of newGroups[k]) {
        const key = it.bin + '|' + (it.from||[]).join(',');
        if (!seen.has(key)) { seen.add(key); unique.push(it); }
      }
      groups[k] = unique;
    }
    if (!anyCombined) break;
  }
  // also add remaining groups as primes
  for (const k in groups) for (const it of groups[k]) allPrimes.push(it.bin);
  const primeList = Array.from(new Set(allPrimes));
  // Build prime implicant chart for required minterms only
  const reqBins = minterms.map(m => toBin(m, W));
  const cover = {};
  for (let i=0;i<reqBins.length;i++) {
    cover[i] = [];
    for (let j=0;j<primeList.length;j++) {
      if (covers(primeList[j], reqBins[i])) cover[i].push(j);
    }
  }
  // essential primes
  const chosen = new Set();
  const coveredRows = new Set();
  for (let i=0;i<reqBins.length;i++) {
    if (cover[i].length === 1) chosen.add(cover[i][0]);
  }
  const markCovered = ()=>{
    let changed = false;
    for (let i=0;i<reqBins.length;i++) {
      if (coveredRows.has(i)) continue;
      for (const j of (cover[i]||[])) {
        if (chosen.has(j)) { coveredRows.add(i); changed = true; break; }
      }
    }
    return changed;
  };
  markCovered();
  // greedy choose remaining primes
  while (coveredRows.size < reqBins.length) {
    let bestJ = -1, bestCover = -1;
    for (let j=0;j<primeList.length;j++) if (!chosen.has(j)) {
      let cnt = 0;
      for (let i=0;i<reqBins.length;i++) {
        if (coveredRows.has(i)) continue;
        if (cover[i].includes(j)) cnt++;
      }
      if (cnt > bestCover) { bestCover = cnt; bestJ = j; }
    }
    if (bestJ === -1) break;
    chosen.add(bestJ);
    markCovered();
  }
  const implicants = Array.from(chosen).map(j => primeList[j]);
  const sop = implicantsToSOP(implicants, varNames);
  return {implicants, sop};
}

/* ============
   POS conversion utilities
   - compute POS from truth table zeros (maxterms)
   ============ */
function posFromTruth(vars, rows) {
  const zeros = rows.filter(r=>r.y===0).map(r=>r.m);
  if (!zeros.length) return '1'; // always true
  // run QM on zeros to find implicants that cover zeros (these become sum clauses)
  const {implicants} = qmSimplifyWithDontCare(zeros, [], vars);
  // convert implicant masks to sum (OR) clauses:
  const clauses = implicants.map(mask=>{
    const parts = [];
    for (let i=0;i<mask.length;i++) {
      if (mask[i] === '-') continue;
      const v = vars[i];
      // mask bit '1' => var==1 in implicant for zeros => clause must be false when var==1 => use v'
      parts.push(mask[i] === '1' ? (v + "'") : v);
    }
    return '(' + (parts.length ? parts.join(' + ') : '1') + ')';
  });
  return clauses.join('');
}

/* ============
   K-Map Canvas Export & Print
   ============ */
function renderKMapToCanvas(canvasId='kmap-canvas') {
  // Renders current K-Map to canvas and returns canvas element
  const canvas = byId(canvasId) || createHiddenCanvas();
  const ctx = canvas.getContext('2d');
  // clear
  ctx.clearRect(0,0,canvas.width, canvas.height);
  if (!currentKMap.layout || currentKMap.total === 0) {
    ctx.fillStyle = '#333'; ctx.font = '16px sans-serif';
    ctx.fillText('K-Map tidak tersedia (lebih dari 4 variabel atau belum dibuat).', 10, 30);
    return canvas;
  }
  const rows = currentKMap.layout.rows.length || 1;
  const cols = currentKMap.layout.cols.length || 1;
  // layout sizes
  const padding = 20;
  const cellW = Math.floor((canvas.width - padding*2) / cols);
  const cellH = Math.floor((canvas.height - padding*2) / rows);
  const startX = padding;
  const startY = padding;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
    const idx = currentKMap.layout.index({r,c});
    const x = startX + c*cellW;
    const y = startY + r*cellH;
    const isD = currentKMap.dontcares.includes(idx);
    const val = currentKMap.cells[idx];
    // fill
    if (isD) ctx.fillStyle = '#fff1b8';
    else if (val) ctx.fillStyle = '#2b8cff';
    else ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, cellW-2, cellH-2);
    // border
    ctx.strokeStyle = '#999';
    ctx.strokeRect(x, y, cellW-2, cellH-2);
    // text
    ctx.fillStyle = isD ? '#333' : (val ? '#fff' : '#333');
    ctx.font = `${Math.min(18, Math.floor(cellH*0.45))}px monospace`;
    const txt = isD ? 'd' : String(val);
    ctx.fillText(txt, x + (cellW-2)/2, y + (cellH-2)/2);
    // index label
    ctx.font = '10px monospace';
    ctx.fillStyle = '#555';
    ctx.fillText('m'+idx, x + 10, y + cellH - 10);
  }
  return canvas;
}
function createHiddenCanvas(w=800, h=600) {
  let canvas = byId('kmap-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'kmap-canvas';
    canvas.width = w; canvas.height = h;
    canvas.style.display = 'none';
    document.body.appendChild(canvas);
  } else {
    canvas.width = w; canvas.height = h;
  }
  return canvas;
}
function exportKMapPNG() {
  const canvas = renderKMapToCanvas('kmap-canvas');
  if (!canvas) return;
  const dataUrl = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `kmap_${(new Date()).toISOString().replace(/[:.]/g,'-')}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function printKMap() {
  const canvas = renderKMapToCanvas('kmap-canvas');
  const dataUrl = canvas.toDataURL('image/png');
  const w = window.open('', '_blank');
  if (!w) { alert('Popup diblokir — izinkan popup untuk mencetak.'); return; }
  w.document.write(`<html><head><title>K-Map Print</title><style>body{font-family:sans-serif;padding:20px}</style></head><body><h3>Karnaugh Map</h3><img src="${dataUrl}" alt="K-Map"/><script>window.onload=function(){window.print();}</script></body></html>`);
  w.document.close();
}

/* ============
   Benchmark: measure QM average time
   ============ */
function qmBenchmark(varCount=4, trials=50) {
  const times = [];
  const total = 1<<varCount;
  for (let t=0;t<trials;t++) {
    const k = Math.floor(Math.random()*(Math.max(1, total-1))) + 1; // at least 1 minterm
    const set = [];
    while (set.length < k) {
      const x = Math.floor(Math.random()*total);
      if (!set.includes(x)) set.push(x);
    }
    const start = now();
    qmSimplifyWithDontCare(set, [], Array.from({length:varCount}, (_,i)=>String.fromCharCode(65+i)));
    const end = now();
    times.push(end - start);
  }
  const avg = times.reduce((a,b)=>a+b,0) / times.length;
  // visual simple bars
  const vis = byId('benchmarkResult');
  if (vis) {
    vis.innerHTML = `Benchmark (n=${varCount}, trials=${trials}): avg ${avg.toFixed(3)} ms`;
    const maxT = Math.max(...times);
    const bars = times.map(t=>`<div style="display:inline-block;height:10px;margin:2px;background:#2b8cff;width:${Math.round((t/maxT)*160)}px;" title="${t.toFixed(3)} ms"></div>`).join('');
    vis.innerHTML += `<div style="margin-top:8px">${bars}</div>`;
  }
  addLog(`Benchmark complete: avg ${avg.toFixed(3)} ms`);
  return {times, avg};
}

/* ============
   Import/Export JSON data (expression, table, kmap)
   ============ */
function exportDataToJSON() {
  const payload = {
    expr: byId('exprInput') ? byId('exprInput').value : '',
    vars: currentVars,
    truth: lastTruthRows,
    kmap: {
      vars: currentKMap.vars,
      cells: currentKMap.cells,
      dontcares: currentKMap.dontcares
    },
    simplified: byId('simplifiedExpr') ? byId('simplifiedExpr').textContent : ''
  };
  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `boolean_data_${(new Date()).toISOString().replace(/[:.]/g,'-')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  addLog('Data diekspor sebagai JSON.');
}

function importDataFromJSONFile(file) {
  const reader = new FileReader();
  reader.onload = (e)=>{
    try {
      const obj = JSON.parse(e.target.result);
      if (obj.expr && byId('exprInput')) byId('exprInput').value = obj.expr;
      // load truth & kmap as best effort
      if (obj.kmap && obj.kmap.vars) initKMap(obj.kmap.vars);
      if (obj.kmap && obj.kmap.cells) {
        currentKMap.cells = obj.kmap.cells.slice(0, currentKMap.total);
        currentKMap.dontcares = obj.kmap.dontcares || [];
        updateKMapDOM();
      }
      if (obj.expr) { // evaluate
        triggerEvaluate();
      }
      addLog('Data berhasil diimpor.');
    } catch (err) {
      alert('File JSON tidak valid.');
      addLog('Gagal mengimpor data: ' + err.message);
    }
  };
  reader.readAsText(file);
}

/* ============
   UI Wiring & Event Handlers
   ============ */

function addLog(msg) {
  const area = byId('logArea');
  const t = (new Date()).toLocaleTimeString();
  if (area) {
    const d = document.createElement('div');
    d.textContent = `${t} — ${msg}`;
    area.prepend(d);
  } else {
    console.log(t + ' — ' + msg);
  }
}

/* Main evaluation: parse expr, build truth table, init K-map, paint, compute SOP or POS */
function triggerEvaluate() {
  try {
    const expr = (byId('exprInput')||{}).value || '';
    if (!expr) { addLog('Tidak ada ekspresi.'); return; }
    const vars = extractVars(expr);
    currentVars = vars.slice(); // keep all for truth table
    currentRPN = toRPN(tokenize(expr));
    const rows = buildTruthTable(currentVars, currentRPN);
    lastTruthRows = rows;
    renderTruthTable(currentVars, rows);
    // init K-Map for up to MAX_KMAP_VARS
    const kvars = currentVars.slice(0, MAX_KMAP_VARS);
    initKMap(kvars);
    // paint K-Map if within limit
    if (currentVars.length <= MAX_KMAP_VARS) {
      const minterms = rows.filter(r=>r.y===1).map(r=>r.m);
      paintKMapFromMinterms(minterms, []);
      // simplify using QM with don't-care empty
      const {sop} = qmSimplifyWithDontCare(minterms, [], kvars);
      if (byId('simplifiedExpr')) byId('simplifiedExpr').textContent = sop;
      addLog('Evaluasi selesai. Minterm: ' + (minterms.length ? minterms.join(',') : '—'));
    } else {
      if (byId('simplifiedExpr')) byId('simplifiedExpr').textContent = '— (K-Map sampai 4 variabel)';
      addLog('Evaluasi selesai (lebih dari 4 variabel; K-Map nonaktif).');
    }
  } catch (e) {
    alert("Kesalahan: " + e.message);
    addLog("Kesalahan: " + e.message);
  }
}

/* simplify from K-Map (considers dontcares) */
function simplifyFromKMap() {
  const ms = collectMintermsFromKMap();
  const ds = collectDontCaresFromKMap();
  const vars = currentKMap.vars;
  const {sop} = qmSimplifyWithDontCare(ms, ds, vars);
  if (byId('simplifiedExpr')) byId('simplifiedExpr').textContent = sop;
  addLog('Sederhana (SOP) dari K-Map: ' + sop);
}

/* auto-group: compute implicants and highlight cells covered by implicants (simple visual) */
function autoGroupKMap() {
  const ms = collectMintermsFromKMap();
  const ds = collectDontCaresFromKMap();
  const vars = currentKMap.vars;
  if (!vars.length) { addLog('Auto group gagal: K-Map kosong.'); return; }
  const {implicants} = qmSimplifyWithDontCare(ms, ds, vars);
  // clear previous highlights
  const kmapEl = byId('kmapContainer');
  if (!kmapEl) return;
  // mark cells that belong to any implicant: add class 'group'
  const children = kmapEl.children;
  for (let i=0;i<children.length;i++) children[i].classList.remove('group');
  // for each implicant mask, mark matching cells
  const W = vars.length;
  for (const mask of implicants) {
    for (let m=0;m<currentKMap.total;m++) {
      const bin = toBin(m, W);
      if (covers(mask, bin)) {
        const el = kmapEl.querySelector(`[data-index="${m}"]`);
        if (el) el.classList.add('group');
      }
    }
  }
  addLog(`Auto-group: ditemukan ${implicants.length} implicant(s).`);
}

/* convert SOP<->POS using truth table duality */
function convertSOPtoPOS() {
  if (!lastTruthRows || !lastTruthRows.length) { alert('Buat dulu tabel kebenaran (Evaluate).'); return; }
  const vars = currentVars.slice(0, MAX_KMAP_VARS);
  const sop = (function(){
    const ms = lastTruthRows.filter(r=>r.y===1).map(r=>r.m);
    return qmSimplifyWithDontCare(ms, [], vars).sop;
  })();
  const pos = posFromTruth(vars, lastTruthRows);
  const choice = confirm(`SOP:\n${sop}\n\nPOS:\n${pos}\n\nKlik OK untuk tampilkan POS di panel hasil, Cancel untuk SOP.`);
  if (choice) {
    if (byId('simplifiedExpr')) byId('simplifiedExpr').textContent = pos;
    addLog('Menampilkan POS hasil konversi.');
  } else {
    if (byId('simplifiedExpr')) byId('simplifiedExpr').textContent = sop;
    addLog('Menampilkan SOP (tidak diubah).');
  }
}

/* theme management */
function loadTheme() {
  const saved = localStorage.getItem('boolean_theme') || 'light';
  if (saved === 'dark') document.body.classList.add('dark');
  else document.body.classList.remove('dark');
}
function toggleTheme() {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  localStorage.setItem('boolean_theme', isDark ? 'dark' : 'light');
}

/* bind UI events */
function bindUI() {
  // Evaluate
  const evalBtn = byId('evalBtn');
  if (evalBtn) evalBtn.addEventListener('click', ()=>{ triggerEvaluate(); });

  // Simplify (QM) using K-map
  const simplifyBtn = byId('simplifyBtn') || byId('btn-simplify');
  if (simplifyBtn) simplifyBtn.addEventListener('click', ()=> simplifyFromKMap());

  // Convert SOP<->POS
  const convertBtn = byId('convertBtn') || byId('btn-sop2pos');
  if (convertBtn) convertBtn.addEventListener('click', ()=> convertSOPtoPOS());

  // Export data JSON
  const exportBtn = byId('exportBtn');
  if (exportBtn) exportBtn.addEventListener('click', ()=> exportDataToJSON());

  // Import data from file picker (create input if not present)
  const importBtn = byId('importBtn');
  if (importBtn) importBtn.addEventListener('click', ()=>{
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json';
    input.onchange = (ev)=> {
      const file = ev.target.files[0];
      if (file) importDataFromJSONFile(file);
    };
    input.click();
  });

  // Export PNG
  const exportPngBtn = byId('exportPngBtn') || byId('btn-export-png');
  if (exportPngBtn) exportPngBtn.addEventListener('click', ()=> exportKMapPNG());

  // Print
  const printBtn = byId('btn-print');
  if (printBtn) printBtn.addEventListener('click', ()=> printKMap());

  // Benchmark
  const benchmarkBtn = byId('benchmarkBtn') || byId('btn-benchmark');
  if (benchmarkBtn) benchmarkBtn.addEventListener('click', ()=> {
    const varCount = Math.min(MAX_KMAP_VARS, currentKMap.vars.length || 4);
    qmBenchmark(varCount, 60);
  });

  // K-Map controls: auto group, reset
  const autoGroupBtn = byId('autoGroupBtn');
  if (autoGroupBtn) autoGroupBtn.addEventListener('click', ()=> autoGroupKMap());
  const resetKmapBtn = byId('resetKmapBtn');
  if (resetKmapBtn) resetKmapBtn.addEventListener('click', ()=> { paintKMapFromMinterms([],[]); addLog('K-Map direset.'); });

  // Toggle theme
  const themeToggle = byId('themeToggle') || byId('toggle-theme');
  if (themeToggle) {
    themeToggle.addEventListener('click', ()=> toggleTheme());
  }
  // If HTML includes a checkbox for mode pos, bind it
  const modeCheckbox = byId('mode-pos') || byId('modeSelect');
  if (modeCheckbox && modeCheckbox.addEventListener) {
    // if select, use change to recompute display
    if (modeCheckbox.tagName === 'SELECT') {
      modeCheckbox.addEventListener('change', ()=> {
        // if POS selected, compute pos and show
        if (modeCheckbox.value === 'POS') {
          if (lastTruthRows.length) {
            const pos = posFromTruth(currentVars.slice(0, MAX_KMAP_VARS), lastTruthRows);
            if (byId('simplifiedExpr')) byId('simplifiedExpr').textContent = pos;
            addLog('Mode POS aktif (menampilkan POS).');
          }
        } else {
          if (lastTruthRows.length) {
            const ms = lastTruthRows.filter(r=>r.y===1).map(r=>r.m);
            const {sop} = qmSimplifyWithDontCare(ms, [], currentVars.slice(0, MAX_KMAP_VARS));
            if (byId('simplifiedExpr')) byId('simplifiedExpr').textContent = sop;
            addLog('Mode SOP aktif (menampilkan SOP).');
          }
        }
      });
    }
  }

  // Input Enter to evaluate
  const exprInput = byId('exprInput');
  if (exprInput) exprInput.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter') { e.preventDefault(); triggerEvaluate(); }
  });

  // Initialize theme
  loadTheme();
}

/* ============
   Boot / Init
   ============ */
(function init() {
  bindUI();
  // Prepare empty K-map
  initKMap([]);
  addLog('Engine siap.');
})();

/* =============================
   End of app.js
   ============================= */
