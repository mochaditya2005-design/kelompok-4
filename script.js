/* ============================
   script.js — lengkap & final
   ============================
   Fitur:
   - Tokenizer & Shunting-yard -> RPN
   - Evaluator RPN
   - Truth table generator
   - K-Map (2..4 vars) Gray code layout; interactive cells (0/1/d)
   - Quine–McCluskey simplifier supporting don't-care
   - Mode SOP / POS conversion (POS via QM on zeros)
   - Import/Export minterm strings, supports d prefix/suffix
   - Export K-Map to PNG (canvas)
   - Benchmark QM timings
   - Dark/Light theme toggle (saved to localStorage)
   - Tooltips + UI wiring
*/

/* ===== constants ===== */
const GRAY2 = [0,1];
const GRAY4 = [0,1,3,2];
const MAX_VARS = 4;

/* ===== DOM helpers ===== */
const $ = id => document.getElementById(id);

/* ===== Theme handling ===== */
function applyThemeFromStorage(){
  const t = localStorage.getItem('kmap_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
}
function toggleTheme(){
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('kmap_theme', next);
}

/* ===== Utility: binary string pad ===== */
const toBin = (n, w) => n.toString(2).padStart(w, '0');

/* ===== Variables state ===== */
let currentVars = [];      // array of var names (order)
let currentRPN = null;     // rpn tokens
let currentKMap = { vars: [], n:0, layout:null, cells:[], dc:[], total:0 };
let mode = 'SOP';          // SOP or POS

/* ====== Tokenizer & Shunting-yard parser ====== */
/*
 Supports:
 - VAR: A..Z
 - NUM: 0/1
 - NOT: ' (postfix), !, ~ (prefix)
 - AND: &, * or implicit (AB)
 - OR: + or |
 - XOR: ^
 - parentheses ( )
*/
function tokenize(expr){
  const src = String(expr || '').replace(/\s+/g, '');
  const tokens = [];
  let i = 0;
  while (i < src.length){
    const ch = src[i];
    if (ch === '0' || ch === '1'){
      tokens.push({type:'NUM', value: Number(ch)});
      i++; continue;
    }
    if (/[A-Za-z]/.test(ch)){
      const v = ch.toUpperCase();
      tokens.push({type:'VAR', value: v});
      i++;
      // handle postfix ' repeated
      let count = 0;
      while (src[i] === "'"){ count++; i++; }
      if (count % 2 === 1){
        tokens.push({type:'OP', value:'NOT', unary:true, postfix:true, precedence: 4});
      }
      continue;
    }
    if (ch === '('){ tokens.push({type:'LP'}); i++; continue; }
    if (ch === ')'){ tokens.push({type:'RP'}); i++; continue; }
    if (ch === '!' || ch === '~'){ tokens.push({type:'OP', value:'NOT', unary:true, precedence:4}); i++; continue; }
    if (ch === '&' || ch === '*'){ tokens.push({type:'OP', value:'AND', precedence:3, associativity:'left'}); i++; continue;}
    if (ch === '+' || ch === '|'){ tokens.push({type:'OP', value:'OR', precedence:1, associativity:'left'}); i++; continue;}
    if (ch === '^'){ tokens.push({type:'OP', value:'XOR', precedence:2, associativity:'left'}); i++; continue;}
    // unknown char -> throw with position for debugging
    throw new Error(`Karakter tidak dikenali pada posisi ${i}: '${ch}'`);
  }
  return tokens;
}

function isOperand(tok){ return tok && (tok.type === 'VAR' || tok.type === 'NUM' || tok.type === 'RP'); }
function beginsOperand(tok){ return tok && (tok.type === 'VAR' || tok.type === 'NUM' || tok.type === 'LP' || (tok.type === 'OP' && tok.value === 'NOT')); }

function toRPN(tokens){
  // Inserts implicit AND when operand followed by operand
  const withImplicit = [];
  for (let i=0;i<tokens.length;i++){
    withImplicit.push(tokens[i]);
    const a = tokens[i], b = tokens[i+1];
    if (isOperand(a) && beginsOperand(b)){
      withImplicit.push({type:'OP', value:'AND', precedence:3, associativity:'left', implicit:true});
    }
  }

  const output = [];
  const stack = [];
  for (const t of withImplicit){
    if (t.type === 'VAR' || t.type === 'NUM'){ output.push(t); continue; }
    if (t.type === 'OP' && t.postfix && t.value === 'NOT'){ output.push(t); continue; }
    if (t.type === 'OP' && t.unary && !t.postfix){ stack.push(t); continue; }
    if (t.type === 'OP' && !t.unary){
      while (stack.length){
        const top = stack[stack.length-1];
        if (top.type === 'OP' && ((top.precedence > t.precedence) || (top.precedence === t.precedence && t.associativity === 'left'))){
          output.push(stack.pop());
        } else break;
      }
      stack.push(t); continue;
    }
    if (t.type === 'LP'){ stack.push(t); continue; }
    if (t.type === 'RP'){
      while (stack.length && stack[stack.length-1].type !== 'LP') output.push(stack.pop());
      if (!stack.length) throw new Error('Kurung tidak seimbang');
      stack.pop(); // remove LP
      continue;
    }
  }
  while (stack.length){
    const s = stack.pop();
    if (s.type === 'LP' || s.type === 'RP') throw new Error('Kurung tidak seimbang di akhir');
    output.push(s);
  }
  return output;
}

/* ===== RPN Evaluator ===== */
function evalRPN(rpn, env){
  const st = [];
  for (const t of rpn){
    if (t.type === 'NUM') st.push(Boolean(t.value));
    else if (t.type === 'VAR'){
      if (!(t.value in env)) throw new Error(`Variabel ${t.value} tidak didefinisikan`);
      st.push(Boolean(env[t.value]));
    } else if (t.type === 'OP'){
      if (t.value === 'NOT'){
        if (st.length < 1) throw new Error('Operator NOT kekurangan operand');
        const a = st.pop(); st.push(!a);
      } else {
        if (st.length < 2) throw new Error(`Operator ${t.value} kekurangan operand`);
        const b = st.pop(), a = st.pop();
        if (t.value === 'AND') st.push(a && b);
        else if (t.value === 'OR') st.push(a || b);
        else if (t.value === 'XOR') st.push(Boolean(a) !== Boolean(b));
        else throw new Error('Operator tidak dikenal: ' + t.value);
      }
    }
  }
  if (st.length !== 1) throw new Error('Ekspresi tidak valid');
  return st[0] ? 1 : 0;
}

/* ===== Quine-McCluskey (SOP) with don't-cares support ===== */
/* helper functions */
function countOnes(bin) { return bin.split('').filter(c=>c==='1').length; }
function canCombine(a,b){
  let diff = 0;
  for (let i=0;i<a.length;i++){
    if (a[i] !== b[i]) diff++;
    if (diff > 1) return false;
  }
  return diff === 1;
}
function combinePattern(a,b){
  let r = '';
  for (let i=0;i<a.length;i++) r += (a[i] === b[i]) ? a[i] : '-';
  return r;
}
function covers(imp, bin){
  for (let i=0;i<imp.length;i++){
    if (imp[i] === '-') continue;
    if (imp[i] !== bin[i]) return false;
  }
  return true;
}

/*
 qmSimplify(minterms, varNames, dontCares)
 - minterms: array of ints that must be covered
 - dontCares: array of ints allowed to combine but not required to cover
 returns { implicants: [mask strings], sop: string }
*/
function qmSimplify(minterms, varNames, dontCares = []){
  const W = varNames.length;
  const allSet = Array.from(new Set([...(minterms||[]), ...(dontCares||[])]));
  if (allSet.length === 0) return { implicants: [], sop: '0' };

  // initial groups by ones count
  let groups = {};
  for (const m of allSet){
    const b = toBin(m, W);
    const k = countOnes(b);
    (groups[k] = groups[k] || []).push({ bin: b, used: false, from: [b] });
  }

  const allCombinedLevels = [];
  let anyCombined = true;

  while (anyCombined){
    anyCombined = false;
    const newGroups = {};
    const keys = Object.keys(groups).map(Number).sort((a,b)=>a-b);
    for (let ki=0; ki<keys.length-1; ki++){
      const g1 = groups[keys[ki]] || [];
      const g2 = groups[keys[ki+1]] || [];
      for (const a of g1) for (const b of g2){
        if (canCombine(a.bin, b.bin)){
          const c = combinePattern(a.bin, b.bin);
          const ones = countOnes(c.replace(/-/g,''));
          const item = { bin: c, used: false, from: [...new Set([...(a.from||[]), ...(b.from||[])])] };
          (newGroups[ones] = newGroups[ones] || []).push(item);
          a.used = true; b.used = true; anyCombined = true;
        }
      }
    }
    // dedupe newGroups
    for (const k in newGroups){
      const uniq = []; const seen = new Set();
      for (const it of newGroups[k]){
        const key = it.bin + '|' + (it.from || []).join(',');
        if (!seen.has(key)){ seen.add(key); uniq.push(it); }
      }
      newGroups[k] = uniq;
    }
    // collect primes (not used)
    const primes = [];
    for (const k in groups) for (const it of groups[k]) if (!it.used) primes.push(it.bin);
    allCombinedLevels.push(primes);
    groups = newGroups;
  }

  // final primes
  const finalPrimes = new Set();
  for (const arr of allCombinedLevels) for (const p of arr) finalPrimes.add(p);
  for (const k in groups) for (const it of groups[k]) finalPrimes.add(it.bin);
  const primeList = Array.from(finalPrimes);

  // cover chart for minterms only
  const minBin = (minterms||[]).map(m => toBin(m, W));
  const cover = {};
  for (let i=0;i<minBin.length;i++){
    cover[i] = [];
    for (let j=0;j<primeList.length;j++){
      if (covers(primeList[j], minBin[i])) cover[i].push(j);
    }
  }

  // essential primes
  const chosen = new Set();
  const coveredRows = new Set();
  for (let i=0;i<minBin.length;i++){
    if (cover[i].length === 1) chosen.add(cover[i][0]);
  }
  const markCovered = () => {
    let changed = false;
    for (let i=0;i<minBin.length;i++){
      if (coveredRows.has(i)) continue;
      for (const j of (cover[i]||[])){
        if (chosen.has(j)){ coveredRows.add(i); changed = true; break; }
      }
    }
    return changed;
  };
  markCovered();

  // greedy cover for remaining
  while (coveredRows.size < minBin.length){
    let bestJ = -1, bestCover = -1;
    for (let j=0;j<primeList.length;j++) if (!chosen.has(j)){
      let c = 0;
      for (let i=0;i<minBin.length;i++) if (!coveredRows.has(i) && cover[i].includes(j)) c++;
      if (c > bestCover){ bestCover = c; bestJ = j; }
    }
    if (bestJ === -1) break;
    chosen.add(bestJ);
    markCovered();
  }

  const implicants = Array.from(chosen).map(j => primeList[j]);
  const sop = implicantsToSOP(implicants, varNames);
  return { implicants, sop };
}

function implicantsToSOP(impls, vars){
  if (!impls || !impls.length) return '0';
  const parts = impls.map(mask => {
    let s = '';
    for (let i=0;i<mask.length;i++){
      if (mask[i] === '-') continue;
      const v = vars[i];
      s += (mask[i] === '1') ? v : (v + "'");
    }
    return s || '1';
  });
  return parts.join(' + ');
}

// POS representation from implicants (interpreting masks as maxterms)
function implicantsToPOS(impls, vars){
  if (!impls || !impls.length) return '1';
  const parts = impls.map(mask => {
    const terms = [];
    for (let i=0;i<mask.length;i++){
      if (mask[i] === '-') continue;
      const v = vars[i];
      // for POS: '0' -> var (uncomplemented) inside sum; '1' -> var'
      terms.push(mask[i] === '0' ? v : (v + "'"));
    }
    return '(' + terms.join(' + ') + ')';
  });
  return parts.join(' · ');
}

/* ===== K-Map layout helpers ===== */
function kmapLayoutForVars(nVars){
  if (nVars === 0) return null;
  if (nVars === 1) return { rows: [0,1], cols: [0], rowVars: ['A'], colVars: [], index: ({r,c}) => GRAY2[r] };
  if (nVars === 2) return { rows: GRAY2, cols: GRAY2, rowVars: ['A'], colVars: ['B'], index: ({r,c}) => (GRAY2[r] << 1) | GRAY2[c] };
  if (nVars === 3) return { rows: GRAY2, cols: GRAY4, rowVars: ['A'], colVars: ['B','C'], index: ({r,c}) => (GRAY2[r] << 2) | GRAY4[c] };
  if (nVars === 4) return { rows: GRAY4, cols: GRAY4, rowVars: ['A','B'], colVars: ['C','D'], index: ({r,c}) => {
    const AB = GRAY4[r], CD = GRAY4[c];
    const A = (AB>>1)&1, B = AB&1, C = (CD>>1)&1, D = CD&1;
    return (A<<3)|(B<<2)|(C<<1)|D;
  } };
  return null;
}
function prettyAxisLabel(vars){ return vars && vars.length ? vars.join('') : '—'; }

/* ===== Truth table builder ===== */
function buildTruthTable(vars, rpn){
  const rows = []; const n = vars.length; const total = 1 << n;
  for (let m=0;m<total;m++){
    const env = {};
    for (let i=0;i<n;i++) env[vars[i]] = (m >> (n-1-i)) & 1;
    const y = rpn ? evalRPN(rpn, env) : 0;
    rows.push({ m, env, y });
  }
  return rows;
}

/* ===== UI state & elements ===== */
const els = {
  expr: $('expr'), btnEval: $('btn-eval'), btnClear: $('btn-clear'), btnSample: $('btn-sample'),
  varsPill: $('vars-pill'), mintermsPill: $('minterms-pill'), dcPill: $('dc-pill'), simpPill: $('simp-pill'),
  ttHead: $('ttbl').querySelector('thead'), ttBody: $('ttbl').querySelector('tbody'),
  kmap: $('kmap'), rowlabel: $('rowlabel'), collabel: $('collabel'),
  btnSimplify: $('btn-simplify'), btnReset: $('btn-reset'), outSimplified: $('out-simplified'),
  mintermIO: $('minterm-io'), btnImport: $('btn-import'), btnExport: $('btn-export'),
  modeToggle: $('mode-toggle'), modeLabel: $('mode-label'), btnPng: $('btn-png'),
  btnBenchmark: $('btn-benchmark'), benchResult: $('bench-result'), themeToggle: $('theme-toggle'),
  btnPrint: $('btn-print')
};

/* ===== K-Map rendering & interaction ===== */
function initKMap(vars){
  const n = Math.min(vars.length, MAX_VARS);
  const layout = kmapLayoutForVars(n);
  currentKMap = { vars: vars.slice(0,n), n, layout, cells: new Array(1<<n).fill(0), dc: new Array(1<<n).fill(false), total: 1<<n };

  if (!layout){
    els.kmap.innerHTML = `<div class="muted">K-Map hanya sampai 4 variabel. Terdeteksi: ${vars.length}</div>`;
    els.rowlabel.textContent = '—'; els.collabel.textContent = '—';
    return;
  }

  els.rowlabel.textContent = prettyAxisLabel(layout.rowVars);
  els.collabel.textContent = prettyAxisLabel(layout.colVars);

  const rows = layout.rows.length || 1;
  const cols = layout.cols.length || 1;
  els.kmap.style.gridTemplateColumns = `repeat(${cols}, 64px)`;
  els.kmap.innerHTML = '';

  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const idx = layout.index({r,c});
      const el = document.createElement('div');
      el.className = 'kcell';
      el.dataset.index = idx;
      el.textContent = '0';
      el.title = `m${idx} — klik kiri toggle 0/1; klik kanan cycle 0→1→d`;
      // left click toggle 0/1 (clears don't-care)
      el.addEventListener('click', ()=>{
        currentKMap.dc[idx] = false;
        currentKMap.cells[idx] = currentKMap.cells[idx] ? 0 : 1;
        el.classList.toggle('on', !!currentKMap.cells[idx]);
        el.classList.remove('dc');
        el.textContent = String(currentKMap.cells[idx]);
        updatePills();
      });
      // right click cycle 0 -> 1 -> d -> 0
      el.addEventListener('contextmenu', (ev)=>{
        ev.preventDefault();
        const wasDc = currentKMap.dc[idx];
        const wasOne = !!currentKMap.cells[idx];
        if (!wasOne && !wasDc){ // 0 -> 1
          currentKMap.cells[idx] = 1; currentKMap.dc[idx] = false;
          el.classList.add('on'); el.classList.remove('dc'); el.textContent = '1';
        } else if (wasOne && !wasDc){ // 1 -> d
          currentKMap.cells[idx] = 0; currentKMap.dc[idx] = true;
          el.classList.remove('on'); el.classList.add('dc'); el.textContent = 'd';
        } else { // d -> 0
          currentKMap.cells[idx] = 0; currentKMap.dc[idx] = false;
          el.classList.remove('on'); el.classList.remove('dc'); el.textContent = '0';
        }
        updatePills();
        return false;
      });
      els.kmap.appendChild(el);
    }
  }
}

function paintKMapFromMinterms(minterms, dontCares = []){
  if (!currentKMap.layout) return;
  for (let i=0;i<currentKMap.total;i++){ currentKMap.cells[i] = 0; currentKMap.dc[i] = false; }
  const children = els.kmap.children;
  for (let k=0;k<children.length;k++){ children[k].classList.remove('on','dc'); children[k].textContent = '0'; }
  for (const m of minterms) if (Number.isInteger(m) && m>=0 && m<currentKMap.total) currentKMap.cells[m] = 1;
  for (const d of dontCares) if (Number.isInteger(d) && d>=0 && d<currentKMap.total) { currentKMap.dc[d] = true; currentKMap.cells[d] = 0; }
  for (let k=0;k<children.length;k++){
    const idx = Number(children[k].dataset.index);
    if (currentKMap.dc[idx]) { children[k].classList.add('dc'); children[k].textContent = 'd'; }
    else { children[k].classList.toggle('on', !!currentKMap.cells[idx]); children[k].textContent = currentKMap.cells[idx] ? '1' : '0'; }
  }
}

function collectMintermsFromKMap(){
  const res = [];
  for (let i=0;i<currentKMap.total;i++) if (currentKMap.cells[i] && !currentKMap.dc[i]) res.push(i);
  return res.sort((a,b)=>a-b);
}
function collectDontCaresFromKMap(){
  const res = [];
  for (let i=0;i<currentKMap.total;i++) if (currentKMap.dc[i]) res.push(i);
  return res.sort((a,b)=>a-b);
}

/* ===== Simplify (SOP/POS) and update UI ===== */
function simplifyFromKMap(){
  const n = currentKMap.n; const vars = currentKMap.vars;
  if (!currentKMap.layout) { $('out-simplified').textContent = '—'; return; }
  if (n === 0){ $('out-simplified').textContent = currentKMap.cells[0] ? '1' : '0'; return; }

  const ms = collectMintermsFromKMap();
  const ds = collectDontCaresFromKMap();
  if (mode === 'SOP'){
    const t0 = performance.now();
    const res = qmSimplify(ms, vars, ds);
    const t1 = performance.now();
    $('out-simplified').textContent = res.sop || '0';
    $('bench-result').textContent = `QM: ${(t1-t0).toFixed(2)} ms (d digunakan untuk grouping)`;
    setPills(vars, ms, ds, res.sop || '—');
  } else {
    // POS: simplify zeros (values==0 and not don't-care)
    const all = Array.from({length: currentKMap.total}, (_,i) => i);
    const zeros = all.filter(i => (!currentKMap.cells[i] && !currentKMap.dc[i]));
    const res = qmSimplify(zeros, vars, collectDontCaresFromKMap());
    const pos = implicantsToPOS(res.implicants, vars);
    $('out-simplified').textContent = pos || '1';
    $('bench-result').textContent = `POS (QM on zeros): ${zeros.length} zeros simplified`;
    setPills(vars, collectMintermsFromKMap(), collectDontCaresFromKMap(), pos || '—');
  }
}

/* ===== Import / Export parsing ===== */
function parseMintermInput(txt){
  const parts = String(txt || '').split(/[,;\s]+/).map(s=>s.trim()).filter(Boolean);
  const mins = [], dcs = [];
  for (const token of parts){
    const m = token.match(/^([dD]?)(\d+)([dD]?)$/);
    if (!m) continue;
    const isD = !!(m[1] || m[3]);
    const num = Number(m[2]);
    if (isD) dcs.push(num); else mins.push(num);
  }
  return { minterms: Array.from(new Set(mins)).sort((a,b)=>a-b), dontCares: Array.from(new Set(dcs)).sort((a,b)=>a-b) };
}

/* ===== Export K-Map to PNG (canvas) ===== */
function exportKMapPNG(){
  if (!currentKMap.layout) { alert('Tidak ada K-Map untuk diekspor (≤4 variabel).'); return; }
  const cols = currentKMap.layout.cols.length || 1, rows = currentKMap.layout.rows.length || 1;
  const cellW = 110, cellH = 72, pad = 36;
  const canvas = document.createElement('canvas');
  canvas.width = pad*2 + cols*cellW;
  canvas.height = pad*2 + rows*cellH + 60;
  const ctx = canvas.getContext('2d');

  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  ctx.fillStyle = isLight ? '#ffffff' : '#071228';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = isLight ? '#0b1324' : '#e8eefc';
  ctx.font = '18px sans-serif';
  ctx.fillText('K-Map', 12, 22);

  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const idx = currentKMap.layout.index({r,c});
      const x = pad + c*cellW, y = pad + r*cellH + 24;
      ctx.strokeStyle = isLight ? '#dfe9ff' : '#263665';
      ctx.lineWidth = 2;
      ctx.strokeRect(x,y,cellW,cellH);
      if (currentKMap.dc[idx]){
        ctx.fillStyle = '#ffd86b';
        ctx.fillRect(x+2,y+2,cellW-4,cellH-4);
        ctx.fillStyle = '#000'; ctx.font = '20px sans-serif'; ctx.fillText('d', x+cellW/2-6, y+cellH/2+8);
      } else if (currentKMap.cells[idx]){
        ctx.fillStyle = '#74d19a';
        ctx.fillRect(x+2,y+2,cellW-4,cellH-4);
        ctx.fillStyle = '#022'; ctx.font = '20px sans-serif'; ctx.fillText('1', x+cellW/2-6, y+cellH/2+8);
      } else {
        ctx.fillStyle = isLight ? '#f7f9ff' : '#0e1a33';
        ctx.fillRect(x+2,y+2,cellW-4,cellH-4);
        ctx.fillStyle = isLight ? '#000' : '#dbe6ff'; ctx.font = '20px sans-serif'; ctx.fillText('0', x+cellW/2-6, y+cellH/2+8);
      }
      ctx.fillStyle = isLight ? '#22345d' : '#9fb2d7';
      ctx.font = '12px sans-serif';
      ctx.fillText('m'+idx, x+8, y+14);
    }
  }
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url; a.download = 'kmap.png';
  a.click();
}

/* ===== Benchmark QM ===== */
async function benchmarkQM(){
  let n = parseInt(prompt('Jumlah variabel untuk benchmark QM (2-6):', '4'));
  if (!Number.isInteger(n) || n < 2 || n > 6) n = 4;
  let trials = parseInt(prompt('Jumlah percobaan acak:', '20'));
  if (!Number.isInteger(trials) || trials < 1) trials = 20;
  const times = [];
  for (let t=0;t<trials;t++){
    const max = 1 << n;
    const mins = [];
    for (let i=0;i<max;i++) if (Math.random() < 0.28) mins.push(i);
    const st = performance.now();
    qmSimplify(mins, Array.from({length:n}, (_,i)=>String.fromCharCode(65+i)), []);
    const ed = performance.now();
    times.push(ed-st);
    if (t%30 === 0) await new Promise(r=>setTimeout(r,0));
  }
  const avg = times.reduce((a,b)=>a+b,0) / times.length;
  $('bench-result').textContent = `Benchmark QM (${n} var, ${trials} runs): avg ${(avg).toFixed(2)} ms`;
}

/* ===== UI helper: set pills & render truth table ===== */
function setPills(vars, mins, dcs, sopStr){
  $('vars-pill').textContent = `Variabel: ${vars.length ? vars.join(', ') : '—'}`;
  $('minterms-pill').textContent = `Minterm: ${mins.length ? mins.join(',') : '—'}`;
  $('dc-pill').textContent = `Don't-care: ${dcs.length ? dcs.join(',') : '—'}`;
  $('simp-pill').textContent = `Sederhana: ${sopStr || '—'}`;
}
function updatePills(){
  setPills(currentKMap.vars || [], collectMintermsFromKMap(), collectDontCaresFromKMap(), $('out-simplified').textContent || '—');
}

function renderTruthTable(vars, rows){
  const ths = vars.map(v=>`<th>${v}</th>`).join('');
  $('ttbl').querySelector('thead').innerHTML = `<tr>${ths}<th>Y</th><th class="muted">m</th></tr>`;
  const body = rows.map(r=>{
    const vs = vars.map(v => `<td>${r.env[v]}</td>`).join('');
    return `<tr>${vs}<td><b>${r.y}</b></td><td class="muted">${r.m}</td></tr>`;
  }).join('');
  $('ttbl').querySelector('tbody').innerHTML = body;
}

/* ===== Import/Export handlers ===== */
function importMintermsFromInput(){
  const txt = $('minterm-io').value.trim();
  if (!txt){ paintKMapFromMinterms([], []); setPills(currentKMap.vars || [], [], [], '—'); return; }
  const parsed = parseMintermInput(txt);
  paintKMapFromMinterms(parsed.minterms, parsed.dontCares);
  simplifyFromKMap();
}
function exportMintermsToInput(){
  const ms = collectMintermsFromKMap();
  const ds = collectDontCaresFromKMap();
  const tokens = [];
  for (const m of ms) tokens.push(String(m));
  for (const d of ds) tokens.push('d' + String(d));
  $('minterm-io').value = tokens.join(',');
}

/* ===== wiring UI events ===== */
function wireUI(){
  $('btn-eval').addEventListener('click', ()=>{
    try {
      const expr = ($('expr').value || '').trim();
      if (!expr) { alert('Masukkan ekspresi terlebih dahulu.'); return; }
      // extract variables automatically
      const varsFound = (expr.match(/[A-Za-z]/g) || []).map(ch => ch.toUpperCase());
      const uniq = Array.from(new Set(varsFound)).sort();
      if (!uniq.length) { alert('Tidak ada variabel terdeteksi. Gunakan huruf A..Z.'); return; }
      currentVars = uniq.slice(0, 26);
      // parse to rpn
      let rpn;
      try { rpn = toRPN(tokenize(expr)); } catch(e){ alert('Kesalahan parsing: ' + e.message); return; }
      currentRPN = rpn;
      // truth table
      const rows = buildTruthTable(currentVars, currentRPN);
      renderTruthTable(currentVars, rows);
      const minFull = rows.filter(r => r.y === 1).map(r => r.m);
      const kVars = currentVars.slice(0, MAX_VARS);
      initKMap(kVars);
      if (currentVars.length <= MAX_VARS) paintKMapFromMinterms(minFull, []);
      if (currentVars.length <= MAX_VARS){
        const { sop } = qmSimplify(minFull, kVars, []);
        $('out-simplified').textContent = sop || '—';
        setPills(kVars, minFull, [], sop || '—');
      } else {
        $('out-simplified').textContent = '— (K-Map sampai 4 variabel)';
        setPills(currentVars, minFull, [], '—');
      }
    } catch (err){ alert('Kesalahan: ' + err.message); }
  });

  $('btn-clear').addEventListener('click', ()=>{
    $('expr').value = '';
    currentVars = []; currentRPN = null;
    $('ttbl').querySelector('thead').innerHTML = '';
    $('ttbl').querySelector('tbody').innerHTML = '';
    initKMap([]);
    $('out-simplified').textContent = '—';
    setPills([], [], [], '—');
    $('minterm-io').value = '';
    $('bench-result').textContent = '';
  });

  $('btn-reset').addEventListener('click', ()=>{
    paintKMapFromMinterms([], []);
    $('out-simplified').textContent = '—';
    setPills(currentKMap.vars || [], [], [], '—');
  });

  $('btn-simplify').addEventListener('click', ()=> simplifyFromKMap());
  $('btn-import').addEventListener('click', ()=> importMintermsFromInput());
  $('btn-export').addEventListener('click', ()=> exportMintermsToInput());
  $('btn-png').addEventListener('click', ()=> exportKMapPNG());
  $('btn-benchmark').addEventListener('click', ()=> benchmarkQM());
  $('theme-toggle').addEventListener('click', ()=> toggleTheme());
  $('btn-print').addEventListener('click', ()=> window.print());

  $('btn-sample').addEventListener('click', ()=>{
    const samples = ["A'B + AC","A(B + C) + A'B'","~(A ^ B)C","A'B'C + ABC'","A(B + C') + B'C"];
    const pick = samples[Math.floor(Math.random()*samples.length)];
    $('expr').value = pick;
    $('btn-eval').click();
  });

  // example quick buttons
  document.querySelectorAll('.example').forEach(btn=>{
    btn.addEventListener('click', ()=> {
      $('expr').value = btn.textContent.trim();
      $('btn-eval').click();
    });
  });

  // mode toggle
  $('mode-toggle').addEventListener('click', ()=>{
    mode = (mode === 'SOP') ? 'POS' : 'SOP';
    $('mode-label').textContent = mode;
    simplifyFromKMap();
  });

  // disable text selection context menu on kmap children via delegation
  $('kmap').addEventListener('contextmenu', (ev)=>{
    // allow our per-cell handler to preventDefault; this just stops bubbling default when clicking empty grid
    ev.preventDefault();
  });
}

/* ===== Parse import strings & helpers ===== */
function parseMintermString(txt){
  // Accept tokens like: 0,1,3,d4,5d,D6,7D
  const parts = String(txt || '').split(/[,;\s]+/).map(s=>s.trim()).filter(Boolean);
  const mins = [], dcs = [];
  for (const token of parts){
    const m = token.match(/^([dD]?)(\d+)([dD]?)$/);
    if (!m) continue;
    const isD = !!(m[1] || m[3]);
    const num = Number(m[2]);
    if (isD) dcs.push(num); else mins.push(num);
  }
  return { minterms: Array.from(new Set(mins)).sort((a,b)=>a-b), dontCares: Array.from(new Set(dcs)).sort((a,b)=>a-b) };
}

/* ===== Helper to set UI pills quickly ===== */
function setPills(vars, mins, dcs, sopStr){
  $('vars-pill').textContent = `Variabel: ${vars.length ? vars.join(', ') : '—'}`;
  $('minterms-pill').textContent = `Minterm: ${mins.length ? mins.join(',') : '—'}`;
  $('dc-pill').textContent = `Don't-care: ${dcs.length ? dcs.join(',') : '—'}`;
  $('simp-pill').textContent = `Sederhana: ${sopStr || '—'}`;
}

/* ===== init page ===== */
function init(){
  applyThemeFromStorage();
  wireUI();
  initKMap([]); // empty initial
  setPills([], [], [], '—');
}

/* run init on DOM ready */
document.addEventListener('DOMContentLoaded', init);
