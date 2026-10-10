'use strict';

/* =====================================================================
   PART 1 — Pure card logic (no DOM, no network, no storage)
   ===================================================================== */

const BRANDS = Object.freeze([
  Object.freeze({ id: 'visa',       name: 'Visa',             short: 'Visa',     mark: 'VISA',        ranges: [['4', '4']],                                          lengths: [16, 19],         cvv: 3 }),
  Object.freeze({ id: 'mastercard', name: 'Mastercard',       short: 'Mastercard', mark: 'mastercard', ranges: [['51', '55'], ['2221', '2720']],                        lengths: [16],             cvv: 3 }),
  Object.freeze({ id: 'amex',       name: 'American Express', short: 'Amex',     mark: 'AMEX',        ranges: [['34', '34'], ['37', '37']],                          lengths: [15],             cvv: 4 }),
  Object.freeze({ id: 'diners',     name: 'Diners Club',      short: 'Diners',   mark: 'Diners Club', ranges: [['300', '305'], ['36', '36'], ['38', '39']],           lengths: [14, 16, 19],     cvv: 3 }),
  Object.freeze({ id: 'discover',   name: 'Discover',         short: 'Discover', mark: 'DISCOVER',    ranges: [['6011', '6011'], ['644', '649'], ['65', '65'], ['622126', '622925']], lengths: [16, 17, 18, 19], cvv: 3 }),
  Object.freeze({ id: 'jcb',        name: 'JCB',              short: 'JCB',      mark: 'JCB',         ranges: [['3528', '3589']],                                    lengths: [16, 17, 18, 19], cvv: 3 }),
]);

/** Strict ASCII digits only — everything else is dropped. */
const onlyDigits = (s) => String(s).replace(/\D+/g, '');

/** Letters (any language), combining marks, space . ' ’ - only. Strips control + bidi characters. */
const sanitizeName = (s) =>
  String(s).normalize('NFKC').replace(/[^\p{L}\p{M} .'’-]/gu, '').replace(/\s{2,}/g, ' ').slice(0, 26);

/** Does the (possibly partial) number match a [lo, hi] prefix range? */
function prefixMatches(digits, [lo, hi]) {
  const n = Math.min(digits.length, lo.length);
  if (n === 0) return false;
  const p = Number(digits.slice(0, n));
  return p >= Number(lo.slice(0, n)) && p <= Number(hi.slice(0, n));
}

/** Returns { brand, candidates }. brand is set only when exactly one network fits. */
function detectBrand(digits) {
  const candidates = BRANDS.filter((b) => b.ranges.some((r) => prefixMatches(digits, r)));
  return { brand: candidates.length === 1 ? candidates[0] : null, candidates };
}

const maxLength = (brand) => (brand ? Math.max(...brand.lengths) : 19);

/** How many digit slots to show on the card for the current length. */
function slotCount(brand, len) {
  const ls = brand ? brand.lengths : [16, 19];
  return ls.find((l) => l >= len) ?? ls[ls.length - 1];
}

function groupEnds(brand, count) {
  if (brand && (brand.id === 'amex' || (brand.id === 'diners' && count === 14))) return [4, 10];
  return count > 16 ? [4, 8, 12, 16] : [4, 8, 12];
}

function formatNumber(digits, brand) {
  const ends = groupEnds(brand, slotCount(brand, digits.length));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    out += digits[i];
    if (ends.includes(i + 1) && i + 1 < digits.length) out += ' ';
  }
  return out;
}

/** Luhn: from the right, double every second digit (subtract 9 if > 9), sum, must be divisible by 10. */
function luhnSteps(digits) {
  const steps = [];
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = digits.charCodeAt(i) - 48;
    const doubled = (digits.length - 1 - i) % 2 === 1;
    let value = digit;
    if (doubled) { value = digit * 2; if (value > 9) value -= 9; }
    sum += value;
    steps.push({ digit, doubled, value });
  }
  return { steps, sum, valid: digits.length > 0 && sum % 10 === 0 };
}
const luhn = (digits) => luhnSteps(digits).valid;

/** One call that answers "what state is the number in?" */
function evaluate(d) {
  const len = d.length;
  const { brand, candidates } = detectBrand(d);
  const base = { brand, candidates };
  if (!len) return { ...base, status: 'idle', msg: 'Enter a card number to begin' };

  const luhnOk = luhn(d);
  if (brand) {
    if (!brand.lengths.includes(len)) {
      const target = brand.lengths.find((l) => l > len);
      return target
        ? { ...base, status: 'typing', msg: `${brand.name} · ${len} of ${target} digits` }
        : { ...base, status: 'invalid', msg: `Too long for ${brand.name}` };
    }
    return luhnOk
      ? { ...base, status: 'valid', msg: `Valid ${brand.name} number — passes the Luhn check` }
      : { ...base, status: 'invalid', msg: 'Fails the Luhn check — a digit is probably wrong' };
  }
  if (candidates.length > 1) return { ...base, status: 'typing', msg: 'Keep going — the next digits narrow down the network' };
  if (len < 13) return { ...base, status: 'typing', msg: 'Network not recognised' };
  return luhnOk
    ? { ...base, status: 'unknown', msg: 'Passes Luhn, but the network isn’t one we recognise' }
    : { ...base, status: 'invalid', msg: 'Fails the Luhn check — a digit is probably wrong' };
}

/** Auto-prefixes a 0 for months 2–9 and inserts the slash. */
function formatExpiry(raw) {
  let d = onlyDigits(raw).slice(0, 4);
  if (d.length >= 1 && d[0] > '1') d = ('0' + d).slice(0, 4);
  return d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
}

function validateExpiry(str, now = new Date()) {
  if (str.length !== 5) return { ok: false, reason: 'Incomplete' };
  const mm = Number(str.slice(0, 2));
  const year = 2000 + Number(str.slice(3));
  if (mm < 1 || mm > 12) return { ok: false, reason: 'Month must be 01–12' };
  if (now >= new Date(year, mm, 1)) return { ok: false, reason: 'Card has expired' };
  if (year > now.getFullYear() + 20) return { ok: false, reason: 'Date is too far ahead' };
  return { ok: true, reason: 'Not expired' };
}

function validateCvv(cvv, brand) {
  const allowed = brand ? [brand.cvv] : [3, 4];
  return { ok: allowed.includes(cvv.length), allowed };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BRANDS, onlyDigits, sanitizeName, detectBrand, maxLength, slotCount, groupEnds, formatNumber, luhn, luhnSteps, evaluate, formatExpiry, validateExpiry, validateCvv };
}

/* =====================================================================
   PART 2 — UI. Everything user-supplied goes through textContent /
   .value only. No innerHTML, no eval, no storage, no network.
   ===================================================================== */

function init() {
  const $ = (id) => document.getElementById(id);
  const els = {
    shell: $('shell'), shaker: $('shaker'), tilt: $('tilt'), card: $('card'), slots: $('slots'),
    brandMark: $('brandMark'), ripple: $('ripple'), badge: $('badge'),
    cardName: $('cardName'), cardExp: $('cardExp'), cardCvv: $('cardCvv'),
    form: $('form'), number: $('number'), name: $('name'), exp: $('exp'), cvv: $('cvv'),
    fNumber: $('fNumber'), fExp: $('fExp'), fCvv: $('fCvv'),
    netTag: $('netTag'), meter: $('meter'), verdictText: $('verdictText'),
    luhnChips: $('luhnChips'), luhnSum: $('luhnSum'),
    results: $('results'), resultList: $('resultList'), resultTitle: $('resultTitle'), resultSub: $('resultSub'),
    btnClear: $('btnClear'), btnHide: $('btnHide'), samples: $('samples'),
  };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = { digits: '', name: '', exp: '', cvv: '', hidden: false, lastBrand: 'unknown', lastStatus: 'idle', lastLen: 0, lastNet: '', lastMsg: '' };

  const retrigger = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  const setValid = (field, v) => (v === null ? field.removeAttribute('data-valid') : field.setAttribute('data-valid', String(v)));

  // Build the 19 digit slots once
  const slotEls = Array.from({ length: 19 }, () => {
    const s = document.createElement('span');
    s.className = 'slot';
    s.textContent = '•';
    els.slots.appendChild(s);
    return s;
  });

  /* ---------- caret helpers (keep the cursor sane when we reformat) ---------- */
  const caretFor = (formatted, digitsBefore) => {
    if (digitsBefore <= 0) return 0;
    let c = 0;
    for (let i = 0; i < formatted.length; i++) {
      if (formatted[i] >= '0' && formatted[i] <= '9') c++;
      if (c === digitsBefore) return i + 1;
    }
    return formatted.length;
  };
  const digitsBeforeCaret = (input) => onlyDigits(input.value.slice(0, input.selectionStart ?? input.value.length)).length;
  const restoreCaret = (input, digitsBefore) => {
    if (document.activeElement !== input) return;
    const c = caretFor(input.value, digitsBefore);
    input.setSelectionRange(c, c);
  };

  /* ---------- render ---------- */
  function render() {
    const d = state.digits;
    const len = d.length;
    const ev = evaluate(d);
    const { brand, candidates } = ev;
    const count = slotCount(brand, len);
    const ends = groupEnds(brand, count);

    // slots
    slotEls.forEach((s, i) => {
      s.hidden = i >= count;
      s.classList.toggle('gap', ends.includes(i + 1) && i + 1 < count);
      if (i < len) {
        const masked = state.hidden && i < len - 4;
        s.textContent = masked ? '•' : d[i];
        s.classList.add('filled');
        if (i >= state.lastLen) retrigger(s, 'pop');
      } else {
        s.textContent = '•';
        s.classList.remove('filled', 'pop');
      }
    });

    // brand colours + mark
    const brandId = brand ? brand.id : 'unknown';
    if (brandId !== state.lastBrand) {
      els.card.dataset.brand = brandId;
      els.brandMark.textContent = brand ? brand.mark : '';
      if (brand) { retrigger(els.brandMark, 'swap'); retrigger(els.ripple, 'go'); }
      state.lastBrand = brandId;
    }

    // network tag above the input
    const netText = brand ? brand.name : candidates.length > 1 ? 'Could be ' + candidates.map((c) => c.short).join(' / ') : len ? 'Unknown network' : '';
    if (netText !== state.lastNet) {
      els.netTag.textContent = netText;
      els.netTag.dataset.k = brandId;
      els.netTag.classList.toggle('show', Boolean(netText));
      if (netText) retrigger(els.netTag, 'pop');
      state.lastNet = netText;
    }

    // progress + verdict
    els.meter.style.setProperty('--p', Math.min(100, Math.round((len / count) * 100)) + '%');
    els.shell.dataset.state = ev.status;
    if (ev.msg !== state.lastMsg) {
      els.verdictText.textContent = ev.msg;
      retrigger(els.verdictText, 'in');
      state.lastMsg = ev.msg;
    }
    setValid(els.fNumber, ev.status === 'valid' ? true : ev.status === 'invalid' ? false : null);

    if (ev.status !== state.lastStatus) {
      if (ev.status === 'invalid' && !reduceMotion) retrigger(els.shaker, 'shake');
      if (ev.status === 'valid' && !reduceMotion) burst();
      state.lastStatus = ev.status;
    }

    // luhn walkthrough
    renderLuhn(ev);

    // card side fields
    els.cardName.textContent = state.name ? state.name.toUpperCase() : 'FULL NAME';
    els.cardExp.textContent = state.exp || 'MM/YY';

    const cvvMax = brand ? brand.cvv : 4;
    if (state.cvv.length > cvvMax) { state.cvv = state.cvv.slice(0, cvvMax); els.cvv.value = state.cvv; }
    els.cardCvv.textContent = state.cvv ? (state.hidden ? '•'.repeat(state.cvv.length) : state.cvv) : '•'.repeat(cvvMax === 4 ? 4 : 3);

    if (state.exp.length === 5) setValid(els.fExp, validateExpiry(state.exp).ok); else setValid(els.fExp, null);
    if (state.cvv.length >= 3) setValid(els.fCvv, validateCvv(state.cvv, brand).ok); else setValid(els.fCvv, null);

    state.lastLen = len;
  }

  function renderLuhn(ev) {
    const { steps, sum } = luhnSteps(state.digits);
    els.luhnChips.textContent = '';
    steps.forEach((st, i) => {
      const c = document.createElement('span');
      c.className = 'lchip' + (st.doubled ? ' dbl' : '');
      if (i >= state.lastLen) { c.classList.add('new'); c.style.setProperty('--i', String(i - state.lastLen)); }
      const b = document.createElement('b');
      b.textContent = String(st.digit);
      const sm = document.createElement('small');
      sm.textContent = st.doubled ? '→' + st.value : '';
      c.append(b, sm);
      els.luhnChips.appendChild(c);
    });
    if (!steps.length) { els.luhnSum.textContent = ''; els.luhnSum.dataset.ok = ''; return; }
    const complete = ev.status === 'valid' || ev.status === 'invalid' || ev.status === 'unknown';
    const ok = ev.status === 'invalid' ? false : complete;
    els.luhnSum.dataset.ok = complete ? String(ok) : '';
    els.luhnSum.textContent = `Sum = ${sum} · ${sum} mod 10 = ${sum % 10}` + (complete ? (sum % 10 === 0 ? ' ✓ divisible by 10' : ' ✕ not divisible by 10') : ' (still typing)');
  }

  function burst() {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.className = 'spark';
      const a = (i / n) * Math.PI * 2;
      const r = 46 + Math.random() * 34;
      p.style.setProperty('--dx', Math.cos(a) * r + 'px');
      p.style.setProperty('--dy', Math.sin(a) * r + 'px');
      p.addEventListener('animationend', () => p.remove());
      els.badge.appendChild(p);
    }
  }

  /* ---------- state setters ---------- */
  function applyDigits(raw, caretDigits) {
    let d = onlyDigits(raw).slice(0, 19);
    const first = detectBrand(d).brand;
    if (first) d = d.slice(0, maxLength(first));
    state.digits = d;
    els.number.value = formatNumber(d, detectBrand(d).brand);
    if (caretDigits != null) restoreCaret(els.number, Math.min(caretDigits, d.length));
    render();
  }

  /* ---------- events ---------- */
  let typeToken = 0;
  els.number.addEventListener('input', () => { typeToken++; applyDigits(els.number.value, digitsBeforeCaret(els.number)); });

  els.name.addEventListener('input', () => { state.name = sanitizeName(els.name.value); els.name.value = state.name; render(); });

  els.exp.addEventListener('input', () => {
    const before = digitsBeforeCaret(els.exp);
    state.exp = formatExpiry(els.exp.value);
    els.exp.value = state.exp;
    restoreCaret(els.exp, before);
    render();
  });

  els.cvv.addEventListener('input', () => {
    const { brand } = detectBrand(state.digits);
    state.cvv = onlyDigits(els.cvv.value).slice(0, brand ? brand.cvv : 4);
    els.cvv.value = state.cvv;
    render();
  });
  els.cvv.addEventListener('focus', () => els.card.classList.add('flipped'));
  els.cvv.addEventListener('blur', () => els.card.classList.remove('flipped'));

  els.btnHide.addEventListener('click', () => {
    state.hidden = !state.hidden;
    els.btnHide.setAttribute('aria-pressed', String(state.hidden));
    els.btnHide.textContent = state.hidden ? 'Show digits' : 'Hide digits';
    state.lastLen = state.digits.length; // don't replay pop animations
    render();
  });

  // pointer tilt on the card
  if (!reduceMotion) {
    const stage = els.tilt.parentElement.parentElement;
    stage.addEventListener('pointermove', (e) => {
      const r = stage.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      els.tilt.style.transform = `rotateX(${(-y * 12).toFixed(2)}deg) rotateY(${(x * 16).toFixed(2)}deg)`;
    });
    stage.addEventListener('pointerleave', () => { els.tilt.style.transform = ''; });
  }

  // sample numbers: typed one digit at a time so the animations play
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function typeSample(str) {
    const mine = ++typeToken;
    applyDigits('');
    for (const ch of str) {
      await sleep(reduceMotion ? 0 : 60);
      if (mine !== typeToken) return;
      applyDigits(state.digits + ch);
    }
  }
  els.samples.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-n]');
    if (!btn) return;
    const n = btn.dataset.n;
    if (/^\d{12,19}$/.test(n)) typeSample(n); // validate even our own attribute
  });

  /* ---------- verify ---------- */
  els.form.addEventListener('submit', (e) => { e.preventDefault(); showResults(); });

  function showResults() {
    const d = state.digits;
    els.resultList.textContent = '';
    if (!d.length) {
      els.resultTitle.textContent = 'Nothing to check yet';
      els.resultSub.textContent = 'Enter a card number first — or tap one of the test numbers.';
      els.results.classList.add('open');
      return;
    }
    const ev = evaluate(d);
    const { brand } = ev;
    const sc = luhnSteps(d);
    const lengthOk = brand ? brand.lengths.includes(d.length) : d.length >= 13 && d.length <= 19;
    const rows = [];
    rows.push({ label: 'Card network', s: brand ? 'pass' : ev.candidates.length > 1 ? 'warn' : 'fail', det: brand ? brand.name : 'Not recognised' });
    rows.push({ label: 'Number length', s: lengthOk ? 'pass' : 'fail', det: `${d.length} digits` + (brand ? ` · expects ${brand.lengths.join(' or ')}` : '') });
    rows.push({ label: 'Luhn checksum', s: sc.valid ? 'pass' : 'fail', det: `sum ${sc.sum} · mod 10 = ${sc.sum % 10}` });

    let extraFail = false;
    if (state.exp) {
      const v = validateExpiry(state.exp);
      rows.push({ label: 'Expiry date', s: v.ok ? 'pass' : 'fail', det: v.reason });
      if (!v.ok) extraFail = true;
    } else rows.push({ label: 'Expiry date', s: 'skip', det: 'Not entered' });
    if (state.cvv) {
      const v = validateCvv(state.cvv, brand);
      rows.push({ label: 'Security code', s: v.ok ? 'pass' : 'fail', det: v.ok ? `${state.cvv.length} digits` : `expects ${v.allowed.join(' or ')} digits` });
      if (!v.ok) extraFail = true;
    } else rows.push({ label: 'Security code', s: 'skip', det: 'Not entered' });

    rows.forEach((r, i) => {
      const li = document.createElement('li');
      li.dataset.s = r.s;
      li.style.setProperty('--i', String(i));
      const ico = document.createElement('span'); ico.className = 'ico';
      const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = r.label;
      const det = document.createElement('span'); det.className = 'det'; det.textContent = r.det;
      li.append(ico, lbl, det);
      els.resultList.appendChild(li);
    });

    const numberOk = ev.status === 'valid';
    if (numberOk) {
      els.resultTitle.textContent = extraFail ? 'Number is valid — check the other details' : 'Looks like a valid card number';
      els.resultSub.textContent = 'It passes the format and checksum tests. That doesn’t confirm the card exists, is active or has funds.';
    } else if (ev.status === 'unknown') {
      els.resultTitle.textContent = 'Passes Luhn, but the network isn’t recognised';
      els.resultSub.textContent = 'The digits are consistent, but this tool only identifies Visa, Mastercard, Amex, Diners, Discover and JCB.';
    } else {
      els.resultTitle.textContent = 'This card number doesn’t check out';
      els.resultSub.textContent = ev.msg + '.';
    }
    els.results.classList.add('open');
    if (!reduceMotion) setTimeout(() => els.results.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 200);
  }

  /* ---------- clearing: button, idle timer, page leave ---------- */
  function clearAll() {
    typeToken++;
    state.name = state.exp = state.cvv = '';
    els.name.value = els.exp.value = els.cvv.value = '';
    els.results.classList.remove('open');
    els.card.classList.remove('flipped');
    state.lastLen = 0;
    applyDigits('');
  }
  els.btnClear.addEventListener('click', clearAll);
  window.addEventListener('pagehide', clearAll);

  let idleTimer;
  const bump = () => { clearTimeout(idleTimer); idleTimer = setTimeout(clearAll, 120000); };
  ['input', 'keydown', 'pointerdown'].forEach((ev) => els.form.addEventListener(ev, bump, { passive: true }));

  render();
}

if (typeof document !== 'undefined') init();
