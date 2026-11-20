import { SCRIPT_URL, TRIP_NAME } from './config.js';

/* ================================================================== */
/* Storage (IndexedDB)                                                 */
/* ================================================================== */
const db = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('trip-app', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('files'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode); const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => res(out && 'result' in out ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    get: (store, k) => tx(store, 'readonly', s => s.get(k)),
    set: (store, k, v) => tx(store, 'readwrite', s => s.put(v, k)),
    del: (store, k) => tx(store, 'readwrite', s => s.delete(k)),
    keys: (store) => tx(store, 'readonly', s => s.getAllKeys()),
    clear: (store) => tx(store, 'readwrite', s => s.clear())
  };
})();

/* ================================================================== */
/* State                                                               */
/* ================================================================== */
const S = {
  passcode: null, data: null, lastSync: null, preview: null,
  status: 'idle', statusText: '', fileProgress: null,
  cached: new Set(), index: 0
};
const view = () => S.preview || S.data;
const $ = (sel, el = document) => el.querySelector(sel);

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MO = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ymd = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmtLong = (iso) => { const d = ymd(iso); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]}`; };
const fmtShort = (iso) => { const d = ymd(iso); return `${WD[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MO[d.getUTCMonth()].slice(0, 3)}`; };
const fmtDM = (iso) => { const d = ymd(iso); return `${d.getUTCDate()} ${MO[d.getUTCMonth()].slice(0, 3)}`; };
const fmtInstant = (ms) => {
  const d = new Date(ms);
  return `${WD[d.getDay()].slice(0, 3)} ${d.getDate()} ${MO[d.getMonth()].slice(0, 3)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const fmtClock = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const daysBetween = (a, b) => Math.round((ymd(b) - ymd(a)) / 86400000);
const rowNo = (id) => parseInt(String(id).replace(/\D/g, ''), 10) || 0;

const ICONS = {
  flight: '<path d="M10.5 13.5 3 11l1.5-1.5 8 1 4.5-4.5c.8-.8 2.2-.8 3 0s.8 2.2 0 3L15.5 13.5l1 8L15 23l-2.5-7.5L9 19v2.5L7.5 23 6 18l-5-1.5L2.5 15H5z" transform="scale(.92) translate(1 -1)"/>',
  train: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l-2-3M15 21l2-3"/><circle cx="9" cy="14" r=".6"/><circle cx="15" cy="14" r=".6"/>',
  bus: '<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 10h16M7 21v-3M17 21v-3"/><circle cx="8" cy="14" r=".6"/><circle cx="16" cy="14" r=".6"/>',
  car: '<path d="M5 16V11l2-5h10l2 5v5M3 16h18v3H3zM7 19v2M17 19v2M5 11h14"/>',
  travel: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  ferry: '<path d="M3 17c2 2 4 2 6 0 2 2 4 2 6 0 2 2 4 2 6 0M5 14l1-5h12l1 5M9 9V5h6v4"/>',
  bed: '<path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.6"/>',
  out: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
  in: '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H8"/>',
  land: '<path d="M3 20h18M5 15l4-1 9-3c1.2-.4 2.4.3 2.6 1.4.1.7-.4 1.4-1.1 1.6L8 17l-3-2zM6 13l-2-4 2-.5 3 3"/>',
  star: '<path d="M12 3.5 14.6 9l5.9.6-4.5 3.9 1.4 5.8L12 16.3l-5.4 3 1.4-5.8-4.5-3.9 5.9-.6z"/>',
  gift: '<rect x="3.5" y="9" width="17" height="11" rx="2"/><path d="M3.5 13h17M12 9v11M12 9c-2 0-5-1-5-3s3-2 5 3c2-5 5-5 5-3s-3 3-5 3"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  map: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  car2: '<path d="M4 12h16M7 6h10l3 6v6H4v-6z"/><circle cx="8" cy="15" r=".7"/><circle cx="16" cy="15" r=".7"/>',
  menu: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5M5 13v7h14v-7"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  home: '<path d="M4 11 12 4l8 7M6 9.5V20h12V9.5"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5 7.5 7.5 0 1 0 19 14.5z"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  alert: '<path d="M12 4 2.5 20h19zM12 10v4M12 17v.5"/>',
  out2: '<path d="M15 4h4v16h-4M10 8l4 4-4 4M14 12H4"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>'
};
const icon = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ICONS.travel}</svg>`;

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Couldn’t copy'); }
}

/* ================================================================== */
/* Server                                                              */
/* ================================================================== */
async function api(body) {
  if (!SCRIPT_URL || SCRIPT_URL.startsWith('PASTE')) throw new Error('not_configured');
  const res = await fetch(SCRIPT_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('http_' + res.status);
  return res.json();
}

function b64ToBlob(b64, type) {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

let syncing = false;
async function sync({ quiet = false } = {}) {
  if (syncing || !S.passcode) return;
  if (!navigator.onLine) { setStatus('offline'); return; }
  syncing = true; setStatus('busy', 'Updating…');
  try {
    const r = await api({ action: 'data', passcode: S.passcode });
    if (!r.ok) {
      if (r.error === 'wrong_passcode') { setStatus('error', 'Passcode no longer works'); toast('The passcode has changed. Sign in again.'); }
      else if (r.error === 'locked') setStatus('error', 'Too many tries, wait 15 min');
      else setStatus('error', 'Couldn’t update');
      return;
    }
    const changed = !S.data || JSON.stringify({ ...S.data, generatedAt: 0 }) !== JSON.stringify({ ...r, generatedAt: 0 });
    S.data = r; S.lastSync = Date.now();
    await db.set('kv', 'data', r); await db.set('kv', 'lastSync', S.lastSync);
    if (changed && !S.preview) renderMain(true);
    setStatus('ok');
    await syncFiles(r.files);
  } catch (e) {
    setStatus(navigator.onLine ? 'error' : 'offline', e.message === 'not_configured' ? 'App not set up yet' : undefined);
    if (!quiet && e.message !== 'not_configured') console.warn(e);
  } finally { syncing = false; }
}

async function syncFiles(list) {
  const have = new Set(await db.keys('files'));
  const want = new Set(list.map(f => f.id));
  for (const id of have) if (!want.has(id)) await db.del('files', id);
  const todo = [];
  for (const f of list) {
    const c = have.has(f.id) ? await db.get('files', f.id) : null;
    if (!c || c.modified !== f.modified) todo.push(f);
  }
  let n = 0;
  for (const f of todo) {
    n++; setStatus('busy', `Saving documents ${n}/${todo.length}`);
    try {
      const r = await api({ action: 'file', passcode: S.passcode, fileId: f.id });
      if (r.ok) await db.set('files', f.id, { blob: b64ToBlob(r.data, r.mimeType), name: r.name, mimeType: r.mimeType, modified: f.modified });
    } catch (e) { console.warn('file', f.id, e); }
  }
  S.cached = new Set(await db.keys('files'));
  setStatus('ok');
}

function setStatus(kind, text) {
  S.status = kind; S.statusText = text || '';
  const el = $('#status'); if (!el) return;
  el.className = 'pill ' + (kind === 'ok' || kind === 'idle' ? '' : kind);
  el.innerHTML = `<span class="dot"></span>${esc(pillLabel())}`;
}
function pillLabel() {
  if (S.status === 'busy') return 'Updating';
  if (S.status === 'error') return 'Not updated';
  if (S.status === 'offline') return 'Offline';
  return S.lastSync ? fmtClock(S.lastSync) : '';
}
function statusLabel() {
  if (S.statusText) return S.statusText;
  if (S.status === 'offline') return S.lastSync ? `Offline · ${fmtWhen(S.lastSync)}` : 'Offline';
  return S.lastSync ? `Updated ${fmtWhen(S.lastSync)}` : 'Not updated yet';
}
function fmtWhen(ms) {
  const d = new Date(ms), now = new Date();
  return d.toDateString() === now.toDateString() ? fmtClock(ms) : fmtInstant(ms);
}

/* ================================================================== */
/* Building a day                                                      */
/* ================================================================== */
function eventsFor(data, date) {
  const items = data.items;
  const ev = [];
  const travelToday = items.filter(i => i.kind === 'travel' && i.date === date).sort((a, b) => rowNo(a.id) - rowNo(b.id));
  const timed = travelToday.filter(i => i.time);
  const firstDep = timed.length ? Math.min(...timed.map(i => i.startsAt)) : Infinity;

  // check-outs
  items.filter(i => i.kind === 'stay' && i.checkOut && i.checkOut.date === date).forEach(s => {
    const sort = Math.min(s.checkOutAt, firstDep - 60000);
    ev.push({ type: 'checkout', item: s, sort, time: sort < s.checkOutAt ? null : s.checkOut.time, by: s.checkOut.time });
  });
  const checkoutSort = ev.length ? Math.max(...ev.map(e => e.sort)) : -Infinity;

  // arrivals from overnight travel
  items.filter(i => i.kind === 'travel' && !i.surprise && i.arriveDate === date && i.date !== date).forEach(t => {
    ev.push({ type: 'arrive', item: t, sort: t.arriveAt, time: t.arrive });
  });

  // travel, in sheet order; untimed legs follow the previous leg
  let last = Math.max(checkoutSort, ...ev.filter(e => e.type === 'arrive').map(e => e.sort), -Infinity);
  travelToday.forEach(t => {
    let sort;
    if (t.time) sort = t.startsAt;
    else sort = (isFinite(last) ? last : ymd(date).getTime()) + 60000;
    ev.push({ type: 'travel', item: t, sort, time: t.time });
    const end = t.arriveAt && t.arriveDate === date ? t.arriveAt : sort;
    last = Math.max(last, end, sort);
  });

  // plans
  items.filter(i => i.kind === 'plan' && i.date === date).forEach(p => {
    ev.push({ type: 'plan', item: p, sort: p.time ? p.startsAt : Number.MAX_SAFE_INTEGER - 1, time: p.time });
  });

  // check-ins come after the day's travel
  const lastTravel = Math.max(-Infinity, ...ev.filter(e => e.type === 'travel' || e.type === 'arrive').map(e => e.item.arriveAt && (e.item.arriveDate === date) ? e.item.arriveAt : e.sort));
  items.filter(i => i.kind === 'stay' && i.checkIn && i.checkIn.date === date).forEach(s => {
    const sort = Math.max(s.startsAt, lastTravel + 60000);
    ev.push({ type: 'checkin', item: s, sort, time: sort > s.startsAt ? null : s.checkIn.time, from: s.checkIn.time });
  });

  return ev.sort((a, b) => a.sort - b.sort);
}

/* ================================================================== */
/* Rendering                                                           */
/* ================================================================== */
const app = () => $('#app');

function renderLogin(msg = '') {
  app().innerHTML = `
    <form class="login" id="login" autocomplete="off">
      <img src="icons/icon-192.png" alt="">
      <h1>${esc(TRIP_NAME)}</h1>
      <p>Enter your passcode to load the trip. After that it works offline.</p>
      <input id="pc" type="password" inputmode="text" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Passcode" required>
      <button class="btn primary" type="submit">Open</button>
      <div class="err" id="err">${esc(msg)}</div>
    </form>`;
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pc = $('#pc').value.trim(); if (!pc) return;
    const err = $('#err'); err.textContent = 'Checking…';
    try {
      const r = await api({ action: 'data', passcode: pc });
      if (!r.ok) { err.textContent = r.error === 'locked' ? 'Too many attempts. Try again in 15 minutes.' : 'That passcode didn’t work.'; return; }
      S.passcode = pc; S.data = r; S.lastSync = Date.now();
      await db.set('kv', 'passcode', pc); await db.set('kv', 'data', r); await db.set('kv', 'lastSync', S.lastSync);
      try { await navigator.storage?.persist?.(); } catch {}
      renderMain();
      setStatus('ok');
      syncFiles(r.files);
    } catch (e2) {
      err.textContent = e2.message === 'not_configured' ? 'The app isn’t connected to the sheet yet (config.js).' : navigator.onLine ? 'Couldn’t reach the server. Try again.' : 'You’re offline. Connect once to load the trip.';
    }
  });
}

function startIndex(data) {
  const t = todayISO();
  const i = data.days.findIndex(d => d.date === t);
  if (i >= 0) return i;
  return t < data.start ? 0 : data.days.length - 1;
}

function renderMain(keepPosition = false) {
  const data = view(); if (!data) return renderLogin();
  const prevDate = keepPosition && data.days[S.index] ? data.days[S.index].date : null;
  const t = todayISO();
  S._renderedFor = t;
  const inTrip = t >= data.start && t <= data.end;

  app().innerHTML = `
    <div class="shell">
      <header class="top">
        <h1>${esc(TRIP_NAME)}</h1>
        <button class="todaybtn" id="todayBtn">${inTrip ? 'Today' : t < data.start ? 'Start' : 'End'}</button>
        <button class="pill" id="status"><span class="dot"></span></button>
        <button class="iconbtn" id="menuBtn" aria-label="Menu">${icon('menu')}</button>
      </header>
      ${S.preview ? `<div class="banner">${icon('eye')} Previewing Alex’s view right now <button id="exitPreview">Exit</button></div>` : ''}
      <nav class="strip" id="strip">${data.days.map((d, i) => chip(d, i, t)).join('')}</nav>
      <main class="pager" id="pager">${data.days.map((d, i) => dayPanel(data, d, i, t)).join('')}</main>
    </div>`;
  setStatus(S.status === 'idle' ? 'ok' : S.status, S.statusText);

  const pager = $('#pager');
  let idx = prevDate ? Math.max(0, data.days.findIndex(d => d.date === prevDate)) : startIndex(data);
  requestAnimationFrame(() => { pager.scrollLeft = idx * pager.clientWidth; setActive(idx, false); });

  let raf;
  pager.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const i = Math.round(pager.scrollLeft / pager.clientWidth);
      if (i !== S.index) setActive(i, true);
    });
  }, { passive: true });
  $('#strip').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    goTo(Number(c.dataset.i), true);
  });
  $('#todayBtn').addEventListener('click', () => goTo(startIndex(data), true));
  $('#menuBtn').addEventListener('click', openMenu);
  $('#status').addEventListener('click', () => sync());
  $('#exitPreview')?.addEventListener('click', () => { S.preview = null; renderMain(true); });
  pager.addEventListener('click', onPagerClick);
}

function goTo(i, smooth) {
  const pager = $('#pager');
  pager.scrollTo({ left: i * pager.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  setActive(i, smooth);
}

function setActive(i, smooth) {
  S.index = i;
  document.querySelectorAll('.chip.active').forEach(c => c.classList.remove('active'));
  const c = document.querySelector(`.chip[data-i="${i}"]`);
  if (c) {
    c.classList.add('active');
    const strip = $('#strip');
    const left = c.offsetLeft - strip.clientWidth / 2 + c.clientWidth / 2;
    strip.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  }
}

function chip(d, i, today) {
  const dt = ymd(d.date);
  const firstOfMonth = i === 0 || dt.getUTCDate() === 1;
  return `<button class="chip${d.date === today ? ' today' : ''}${d.surprise ? ' surprise' : ''}" data-i="${i}">
    <div class="wd">${WD[dt.getUTCDay()].slice(0, 3)}</div>
    <div class="dn">${dt.getUTCDate()}</div>
    <div class="mo">${firstOfMonth ? MO[dt.getUTCMonth()].slice(0, 3) : ''}</div>
  </button>`;
}

function dayPanel(data, d, i, today) {
  const evs = eventsFor(data, d.date);
  const isFocus = d.date === today || (today < data.start && i === 0);
  const travelled = d.from && d.location && d.from !== d.location;
  const where = travelled
    ? `${esc(d.from || '')} <span style="color:var(--faint)">→</span> <b>${esc(d.location)}</b>`
    : `<b>${esc(d.location || d.from || '')}</b>`;

  let pre = '';
  if (i === 0 && today < data.start) {
    const n = daysBetween(today, data.start);
    pre += `<div class="card tonight" style="margin-bottom:12px"><div class="label">Countdown</div><div class="name">${n} day${n === 1 ? '' : 's'} to go</div></div>`;
  }
  if (isFocus) pre += deadlinesCard(data, 3);

  const timed = evs.filter(e => e.time || e.type === 'travel' || e.type === 'checkout' || e.type === 'checkin' || e.type === 'arrive');
  const anytime = evs.filter(e => !timed.includes(e));

  return `<section class="day" data-date="${d.date}">
    <div class="dayhead">
      <div class="date">${fmtLong(d.date)}</div>
      <div class="where">${where}</div>
      <div class="count">Day ${i + 1} of ${data.days.length}</div>
    </div>
    ${pre}
    <div class="timeline">
      ${timed.length ? timed.map(e => eventRow(data, e)).join('') : '<div class="empty">Nothing booked. A free day.</div>'}
    </div>
    ${anytime.length ? `<div class="section-label">Any time</div><div class="timeline">${anytime.map(e => eventRow(data, e)).join('')}</div>` : ''}
    <div class="section-label">Tonight</div>
    ${tonightCard(data, d)}
  </section>`;
}

function timeCol(e) {
  if (!e.time) return '<div class="t"></div>';
  const lbl = e.type === 'checkin' ? 'from' : e.type === 'checkout' ? 'by' : e.type === 'arrive' ? 'arrive' : '';
  return `<div class="t">${esc(e.time)}${lbl ? `<small>${lbl}</small>` : ''}</div>`;
}

function eventRow(data, e) {
  const it = e.item;
  if (it.surprise) return `<div class="ev">${timeCol(e)}${surpriseCard(e)}</div>`;
  if (e.type === 'checkout') {
    return `<div class="ev">${timeCol(e)}<div class="card minor"><div class="title">${icon('out')}<span class="grow">Check out · ${esc(it.name)}${!e.time && e.by ? ` <span style="white-space:nowrap">(by ${esc(e.by)})</span>` : ''}</span></div></div></div>`;
  }
  if (e.type === 'arrive') {
    return `<div class="ev">${timeCol(e)}<div class="card minor"><div class="title">${icon('land')}<span class="grow">Arrive ${esc(it.to)}${it.service ? ' · ' + esc(it.service) : ''}</span></div></div></div>`;
  }
  if (e.type === 'checkin') return `<div class="ev">${timeCol(e)}${stayCard(it, 'Check in', !e.time && e.from ? `Check-in from ${e.from}` : '')}</div>`;
  if (e.type === 'travel') return `<div class="ev">${timeCol(e)}${travelCard(it)}</div>`;
  return `<div class="ev">${timeCol(e)}${planCard(it)}</div>`;
}

function secretTags(it) {
  if (!it.secret || !it.revealAt) return '';
  return `<div class="tags"><span class="tag pink">${icon('gift')} Secret · Alex sees it ${esc(fmtInstant(it.revealAt))}</span></div>
    ${it.alexNote ? `<div class="note alex">Alex sees until then: “${esc(it.alexNote)}”</div>` : ''}`;
}

function docButtons(it) {
  if (!it.files || !it.files.length) return '';
  return `<div class="btnrow">${it.files.map(f => {
    const meta = view().files.find(x => x.id === f.id);
    const label = f.label || (meta ? meta.name.replace(/\.[a-z0-9]+$/i, '') : 'Document');
    return `<button class="btn" data-doc="${esc(f.id)}">${icon('doc')} ${esc(f.label ? f.label + '’s ticket' : (it.files.length > 1 ? label : 'Ticket / confirmation'))}</button>`;
  }).join('')}</div>`;
}

function refChip(ref) {
  return ref ? `<button class="ref" data-copy="${esc(ref)}">${esc(ref)} ${icon('copy')}</button>` : '';
}

function travelCard(t) {
  const route = t.from
    ? `<div class="route"><b>${esc(t.from)}</b> ${esc(t.time || '')}<span class="arrow">→</span><b>${esc(t.to)}</b> ${esc(t.arrive || '')}${t.arriveDate && t.arriveDate !== t.date ? ` <span class="tag">+${daysBetween(t.date, t.arriveDate)} day</span>` : ''}</div>`
    : (t.description ? `<div class="sub">${esc(t.description)}</div>` : '');
  const flexible = !t.time && !t.ref ? '<div class="tags"><span class="tag">Flexible · not booked</span></div>' : '';
  const sub = [t.service, t.carrier].filter(Boolean).join(' · ');
  const hasMore = t.baggage || t.notes.length || (t.description && t.from);
  return `<div class="card${hasMore ? ' tap' : ''}" ${hasMore ? 'data-toggle' : ''}>
    <div class="title">${icon(t.mode)}<span class="grow">${esc(t.title)}</span>${hasMore ? `<span class="chev">${icon('chev')}</span>` : ''}</div>
    ${route}
    ${sub || t.ref ? `<div class="sub" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${esc(sub)} ${refChip(t.ref)}</div>` : ''}
    ${flexible}
    ${docButtons(t)}
    ${secretTags(t)}
    ${hasMore ? `<div class="more"><dl class="kv">
      ${t.description && t.from ? `<dt>Details</dt><dd>${esc(t.description)}</dd>` : ''}
      ${t.baggage ? `<dt>Baggage</dt><dd>${esc(t.baggage)}</dd>` : ''}
      ${t.notes.map(n => `<dt>Note</dt><dd>${esc(n)}</dd>`).join('')}
    </dl></div>` : ''}
  </div>`;
}

function addressBlock(name, address, local) {
  if (!address && !local) return '';
  const q = encodeURIComponent([name, address].filter(Boolean).join(', '));
  return `<div class="addr">${esc(address)}${local ? `<div class="local">${esc(local)}</div>` : ''}</div>
    <div class="btnrow">
      ${local ? `<button class="btn pink" data-driver="${esc(local)}" data-driver-en="${esc(address)}">${icon('car2')} Show driver</button>` : ''}
      ${address ? `<button class="btn" data-copy="${esc(address)}">${icon('copy')} Copy</button>` : ''}
      ${address ? `<a class="btn" href="https://maps.apple.com/?q=${q}" target="_blank" rel="noopener">${icon('map')} Map</a>` : ''}
    </div>`;
}

function stayCard(s, heading, extra = '') {
  const c = s.cancellation || {};
  const tags = [];
  if (c.payAtProperty) tags.push('<span class="tag">Pay at property</span>');
  if (c.localTax) tags.push('<span class="tag">Local tax payable</span>');
  if (c.nonRefundable) tags.push('<span class="tag">Non-refundable</span>');
  return `<div class="card">
    <div class="title">${icon('bed')}<span class="grow">${heading ? esc(heading) + ' · ' : ''}${esc(s.name)}</span></div>
    ${extra ? `<div class="sub">${esc(extra)}</div>` : ''}
    <div class="sub">${s.firstNight !== s.lastNight ? `${daysBetween(s.firstNight, s.checkOut.date)} nights · ` : ''}check out ${fmtShort(s.checkOut.date)}${s.checkOut.time ? ' by ' + esc(s.checkOut.time) : ''}</div>
    ${s.agent || s.ref ? `<div class="sub" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${esc(s.agent)} ${refChip(s.ref)}</div>` : ''}
    ${addressBlock(s.name, s.address, s.localAddress)}
    ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
    ${s.notes.length ? `<div class="note">${s.notes.map(esc).join('\n')}</div>` : ''}
    ${docButtons(s)}
    ${secretTags(s)}
  </div>`;
}

function planCard(p) {
  return `<div class="card">
    <div class="title">${icon('star')}<span class="grow">${esc(p.title)}</span>${p.type ? `<span class="tag">${esc(p.type)}</span>` : ''}</div>
    ${p.ref ? `<div class="sub" style="margin-top:6px">Booking ${refChip(p.ref)}</div>` : ''}
    ${addressBlock(p.title, p.address, p.localAddress)}
    ${p.notes.length ? `<div class="note">${p.notes.map(esc).join('\n')}</div>` : ''}
    ${docButtons(p)}
    ${secretTags(p)}
  </div>`;
}

function surpriseCard(e) {
  const it = e.item;
  const what = it.kind === 'stay'
    ? (e.type === 'checkout' ? 'Leaving the surprise stay' : 'A surprise place to stay')
    : it.kind === 'plan' ? 'A surprise plan' : 'Surprise departure';
  return `<div class="card surprise">
    <div class="title">${icon('gift')}<span class="grow">${what}</span></div>
    ${it.note && e.type !== 'checkout' ? `<div class="note alex" style="color:var(--ink)">${esc(it.note)}</div>` : ''}
    <div class="sub" style="font-size:13px">Details appear ${esc(fmtInstant(it.revealAt))}</div>
  </div>`;
}

function tonightCard(data, d) {
  if (d.home) return `<div class="card tonight"><div class="label">${icon('home')}</div><div class="name">Home</div></div>`;
  if (d.transit) return `<div class="card tonight"><div class="label">Overnight</div><div class="name">On the move</div><div class="sub">Sleeping on the plane or train tonight.</div></div>`;
  if (d.stayId && d.stayId.startsWith('surprise-')) {
    const s = data.items.find(x => x.id === d.stayId.slice(9));
    return `<div class="card tonight"><div class="label">Tonight</div><div class="name">${icon('gift')} Surprise</div>${s && s.note ? `<div class="note" style="color:var(--ink)">${esc(s.note)}</div>` : ''}</div>`;
  }
  const s = d.stayId && data.items.find(x => x.id === d.stayId);
  if (!s) return `<div class="card tonight"><div class="name">${esc(d.location || 'Not booked yet')}</div></div>`;
  const night = daysBetween(s.firstNight, d.date) + 1, total = daysBetween(s.firstNight, s.checkOut.date);
  return `<div class="card tonight">
    <div class="label">Night ${night} of ${total}</div>
    <div class="name">${esc(s.name)}</div>
    ${addressBlock(s.name, s.address, s.localAddress)}
  </div>`;
}

function deadlinesCard(data, max) {
  const t = todayISO();
  const up = data.deadlines.filter(x => x.date >= t);
  if (!up.length) return '';
  return `<div class="card" style="margin-bottom:12px">
    <div class="title">${icon('cal')}<span class="grow">Coming up</span>${up.length > max ? `<button class="tag" data-open="deadlines">All ${up.length}</button>` : ''}</div>
    <div style="margin-top:6px">${up.slice(0, max).map(deadlineRow).join('')}</div>
  </div>`;
}
const deadlineRow = (x) => `<div class="deadline"><div class="d">${fmtDM(x.date)}</div><div><div>${esc(x.title)}</div><div class="s">${esc(x.subject)}</div></div></div>`;

/* ================================================================== */
/* Interaction                                                         */
/* ================================================================== */
function onPagerClick(e) {
  const c = e.target.closest('[data-copy]'); if (c) { e.stopPropagation(); return copy(c.dataset.copy); }
  const d = e.target.closest('[data-doc]'); if (d) { e.stopPropagation(); return openDoc(d.dataset.doc); }
  const dr = e.target.closest('[data-driver]'); if (dr) { e.stopPropagation(); return openDriver(dr.dataset.driver, dr.dataset.driverEn); }
  const o = e.target.closest('[data-open]'); if (o) { e.stopPropagation(); return openDeadlines(); }
  if (e.target.closest('a')) return;
  const tgl = e.target.closest('[data-toggle]'); if (tgl) tgl.classList.toggle('open');
}

function openSheet(html) {
  const ov = $('#overlay');
  ov.innerHTML = `<div class="sheet" role="dialog"><div class="grab"></div>${html}</div>`;
  ov.hidden = false;
  ov.onclick = (e) => { if (e.target === ov) closeSheet(); };
  return ov.firstElementChild;
}
function closeSheet() { const ov = $('#overlay'); ov.hidden = true; ov.innerHTML = ''; }

function openMenu() {
  const data = view();
  const isDan = S.data && S.data.user === 'dan';
  const up = data.deadlines.filter(x => x.date >= todayISO()).length;
  const el = openSheet(`
    <h2>${esc(TRIP_NAME)}</h2>
    <button class="menu-item" data-m="sync">${icon('sync')} Update now <span class="meta">${esc(statusLabel())}</span></button>
    <button class="menu-item" data-m="deadlines">${icon('cal')} Deadlines <span class="meta">${up} coming up</span></button>
    <button class="menu-item" data-m="docs">${icon('doc')} Documents <span class="meta">${S.cached.size}/${data.files.length} saved offline</span></button>
    ${isDan && !S.preview ? `<button class="menu-item" data-m="preview">${icon('eye')} Preview Alex’s view</button>` : ''}
    ${isDan && S.data.warnings.length ? `<button class="menu-item" data-m="warn">${icon('alert')} Sheet check <span class="meta">${S.data.warnings.length} to look at</span></button>` : ''}
    <button class="menu-item" data-m="signout">${icon('out2')} Sign out of this phone</button>
  `);
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const m = b.dataset.m;
    if (m === 'sync') { closeSheet(); sync(); }
    if (m === 'deadlines') openDeadlines();
    if (m === 'docs') openDocs();
    if (m === 'warn') openWarnings();
    if (m === 'preview') {
      if (!navigator.onLine) return toast('Preview needs internet');
      b.innerHTML = `${icon('eye')} Loading…`;
      try {
        const r = await api({ action: 'data', passcode: S.passcode, preview: 'alex' });
        if (r.ok) { S.preview = r; closeSheet(); renderMain(true); } else toast('Couldn’t load preview');
      } catch { toast('Couldn’t load preview'); }
    }
    if (m === 'signout') {
      if (!confirm('Sign out and remove the trip from this phone?')) return;
      await db.clear('kv'); await db.clear('files');
      Object.assign(S, { passcode: null, data: null, preview: null, lastSync: null, cached: new Set() });
      closeSheet(); renderLogin();
    }
  });
}

function openDeadlines() {
  const data = view(); const t = todayISO();
  const up = data.deadlines.filter(x => x.date >= t), past = data.deadlines.filter(x => x.date < t);
  openSheet(`<h2>Deadlines</h2>
    ${up.length ? up.map(deadlineRow).join('') : '<div class="empty">Nothing coming up.</div>'}
    ${past.length ? `<div class="section-label">Passed</div><div style="opacity:.55">${past.map(deadlineRow).join('')}</div>` : ''}`);
}

function openWarnings() {
  openSheet(`<h2>Sheet check</h2>
    <p style="color:var(--muted);margin-top:-6px;font-size:14px">Things in the spreadsheet the app couldn’t read cleanly. Only you see this.</p>
    ${S.data.warnings.map(w => `<div class="warn">${esc(w)}</div>`).join('')}`);
}

function openDocs() {
  const data = view();
  const rows = [];
  data.items.filter(i => i.files && i.files.length && !i.surprise)
    .sort((a, b) => (a.date + rowNo(a.id)).localeCompare(b.date + rowNo(b.id)))
    .forEach(it => it.files.forEach(f => {
      const meta = data.files.find(x => x.id === f.id); if (!meta) return;
      rows.push(`<button class="doc" data-doc="${esc(f.id)}">${icon('doc')}
        <div class="n"><div>${fmtDM(it.date)} · ${esc(it.title || it.name)}${f.label ? ' · ' + esc(f.label) : ''}</div><div>${esc(meta.name)}</div></div>
        <span class="st">${S.cached.has(f.id) ? 'Offline' : 'Not saved'}</span></button>`);
    }));
  const el = openSheet(`<h2>Documents</h2>${rows.length ? rows.join('') : '<div class="empty">No documents linked yet.</div>'}`);
  el.addEventListener('click', (e) => { const d = e.target.closest('[data-doc]'); if (d) openDoc(d.dataset.doc); });
}

function openDriver(local, en) {
  closeSheet();
  const el = document.createElement('div');
  el.className = 'full driver';
  el.innerHTML = `<button class="iconbtn close" aria-label="Close">${icon('close')}</button>
    <div class="big" lang="ja">${esc(local)}</div><div class="small">${esc(en)}</div>`;
  el.querySelector('.close').onclick = () => el.remove();
  document.body.appendChild(el);
}

let pdfjs;
async function openDoc(id) {
  closeSheet();
  let rec = await db.get('files', id);
  if (!rec) {
    if (!navigator.onLine) return toast('Not saved offline yet');
    toast('Downloading…');
    try {
      const r = await api({ action: 'file', passcode: S.passcode, fileId: id });
      if (!r.ok) return toast('Couldn’t open document');
      rec = { blob: b64ToBlob(r.data, r.mimeType), name: r.name, mimeType: r.mimeType, modified: r.modified };
      if (!S.preview) { await db.set('files', id, rec); S.cached.add(id); }
    } catch { return toast('Couldn’t open document'); }
  }
  const el = document.createElement('div');
  el.className = 'full';
  el.innerHTML = `<div class="bar">
      <button class="iconbtn" data-x aria-label="Close">${icon('close')}</button>
      <div class="ttl">${esc(rec.name)}</div>
      <button class="iconbtn" data-share aria-label="Share">${icon('share')}</button>
    </div><div class="body"></div>`;
  document.body.appendChild(el);
  el.querySelector('[data-x]').onclick = () => el.remove();
  el.querySelector('[data-share]').onclick = async () => {
    const file = new File([rec.blob], rec.name, { type: rec.mimeType });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: rec.name }); } catch {}
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(rec.blob); a.download = rec.name; a.click();
    }
  };
  const body = el.querySelector('.body');
  if (rec.mimeType.startsWith('image/')) {
    const img = document.createElement('img'); img.src = URL.createObjectURL(rec.blob); body.appendChild(img); return;
  }
  if (rec.mimeType !== 'application/pdf') {
    body.innerHTML = `<div class="empty" style="padding:24px">This file type can’t be shown here. Use the share button to open it in another app.</div>`; return;
  }
  try {
    if (!pdfjs) {
      pdfjs = await import('./vendor/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
    }
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await rec.blob.arrayBuffer()) }).promise;
    const width = Math.min(body.clientWidth, 900) - 16;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (width / v1.width) * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      canvas.style.width = width + 'px';
      body.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    }
  } catch (e) {
    console.warn(e);
    body.innerHTML = `<div class="empty" style="padding:24px">Couldn’t display this PDF. Use the share button to open it in Files or Books.</div>`;
  }
}

/* ================================================================== */
/* Start                                                               */
/* ================================================================== */
async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('sw', e));
  }
  try {
    S.passcode = await db.get('kv', 'passcode');
    S.data = await db.get('kv', 'data');
    S.lastSync = await db.get('kv', 'lastSync');
    S.cached = new Set(await db.keys('files'));
  } catch (e) { console.warn(e); }

  window.addEventListener('online', () => sync({ quiet: true }));
  window.addEventListener('offline', () => setStatus('offline'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!S.lastSync || Date.now() - S.lastSync > 5 * 60 * 1000) sync({ quiet: true });
      else if (S.data && todayISO() !== S._renderedFor) renderMain(true);
    }
  });
  window.addEventListener('resize', () => { const p = $('#pager'); if (p) p.scrollLeft = S.index * p.clientWidth; });

  if (!S.passcode || !S.data) return renderLogin();
  S.status = navigator.onLine ? 'ok' : 'offline';
  renderMain();
  sync({ quiet: true });
}
init();
