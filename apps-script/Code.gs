/**
 * Trip app backend – Google Apps Script bound to the "!Europe 2026 Trip" sheet.
 *
 * Setup (once):
 *   1. Extensions > Apps Script in the sheet, paste this file over Code.gs.
 *   2. Project Settings > Script properties: add DAN_PASSCODE and ALEX_PASSCODE.
 *   3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 *   4. Copy the Web app URL (ends in /exec) into config.js in the app.
 *
 * The sheet stays private. This script reads it as you, and only returns data to
 * the app when it's sent a valid passcode. Items marked secret are removed from
 * Alex's data on the server until 24 hours before they start.
 */

var CONFIG = {
  HOME: 'Wellington',
  HOME_TZ: 'Pacific/Auckland',
  TRAVEL_SHEET: 'Flights and Accommodation',
  PLANS_SHEET: 'Plans',
  REVEAL_HOURS: 24,
  DEFAULT_CHECKIN: '15:00',
  MAX_FAILS: 10,
  LOCK_SECONDS: 900
};

/* ------------------------------------------------------------------ */
/* Web entry points                                                    */
/* ------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true, service: 'trip-app' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_request' }); }

  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('fails') || 0);
  if (fails >= CONFIG.MAX_FAILS) return json_({ ok: false, error: 'locked' });

  var props = PropertiesService.getScriptProperties();
  var who = whoIs_(req.passcode, props.getProperty('DAN_PASSCODE'), props.getProperty('ALEX_PASSCODE'));
  if (!who) {
    cache.put('fails', String(fails + 1), CONFIG.LOCK_SECONDS);
    Utilities.sleep(800);
    return json_({ ok: false, error: 'wrong_passcode' });
  }

  var viewer = who;
  if (who === 'dan' && req.preview === 'alex') viewer = 'alex';

  var src = readSources_();
  var trip = buildTrip(src, new Date().getTime(), viewer);

  if (req.action === 'file') {
    var allowed = trip.files.some(function (f) { return f.id === req.fileId; });
    if (!allowed) return json_({ ok: false, error: 'not_found' });
    var file = DriveApp.getFileById(req.fileId);
    var blob = file.getBlob();
    return json_({
      ok: true,
      id: req.fileId,
      name: file.getName(),
      mimeType: blob.getContentType(),
      modified: file.getLastUpdated().getTime(),
      data: Utilities.base64Encode(blob.getBytes())
    });
  }

  trip.ok = true;
  trip.user = who;
  return json_(trip);
}

/** Run this from the editor to check the sheet parses cleanly. */
function testBuild() {
  var src = readSources_();
  var dan = buildTrip(src, new Date().getTime(), 'dan');
  var alex = buildTrip(src, new Date().getTime(), 'alex');
  Logger.log('Days: %s, items: %s, files: %s', dan.days.length, dan.items.length, dan.files.length);
  Logger.log('Alex sees %s items, %s surprises', alex.items.length,
    alex.items.filter(function (i) { return i.surprise; }).length);
  Logger.log('Warnings:\n%s', dan.warnings.join('\n') || 'none');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function whoIs_(given, dan, alex) {
  if (!given || typeof given !== 'string') return null;
  if (dan && safeEqual_(given, dan)) return 'dan';
  if (alex && safeEqual_(given, alex)) return 'alex';
  return null;
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Reads the sheet (display values + hyperlinks) and the files in its folder. */
function readSources_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var folder = DriveApp.getFileById(ss.getId()).getParents().next();
  var files = {};
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    files[f.getId()] = { name: f.getName(), mimeType: f.getMimeType(), size: f.getSize(), modified: f.getLastUpdated().getTime() };
  }
  return {
    travel: readCells_(ss.getSheetByName(CONFIG.TRAVEL_SHEET)),
    plans: readCells_(ss.getSheetByName(CONFIG.PLANS_SHEET)),
    files: files
  };
}

function readCells_(sheet) {
  if (!sheet) return [];
  var range = sheet.getDataRange();
  var values = range.getDisplayValues();
  var rich = range.getRichTextValues();
  return values.map(function (row, r) {
    return row.map(function (v, c) {
      var links = [];
      var rt = rich[r][c];
      if (rt) {
        rt.getRuns().forEach(function (run) {
          var url = run.getLinkUrl();
          if (url) links.push({ url: url, label: run.getText().trim() });
        });
      }
      if (!links.length) {
        var m = String(v).match(/https?:\/\/\S+/);
        if (m) links.push({ url: m[0], label: '' });
      }
      return { v: String(v), links: links };
    });
  });
}

/* ------------------------------------------------------------------ */
/* Core logic (no Apps Script services below this line – testable)     */
/* ------------------------------------------------------------------ */

var AIRPORT_TZ = {
  WLG: 'Pacific/Auckland', AKL: 'Pacific/Auckland', SFO: 'America/Los_Angeles', LAX: 'America/Los_Angeles',
  EWR: 'America/New_York', JFK: 'America/New_York', LGA: 'America/New_York',
  LHR: 'Europe/London', LCY: 'Europe/London', LGW: 'Europe/London', STP: 'Europe/London',
  AMS: 'Europe/Amsterdam', PRG: 'Europe/Prague', CSK: 'Europe/Prague',
  MUC: 'Europe/Berlin', MUN: 'Europe/Berlin', TLL: 'Europe/Tallinn', HEL: 'Europe/Helsinki',
  BRU: 'Europe/Brussels', HND: 'Asia/Tokyo', NRT: 'Asia/Tokyo', KIX: 'Asia/Tokyo', ITM: 'Asia/Tokyo'
};

var PLACE_TZ = [
  [/new zealand|wellington|auckland/i, 'Pacific/Auckland'],
  [/san francisco|los angeles|california/i, 'America/Los_Angeles'],
  [/united states|usa|new york|newark|\bNJ\b/i, 'America/New_York'],
  [/united kingdom|england|london/i, 'Europe/London'],
  [/netherlands|amsterdam/i, 'Europe/Amsterdam'],
  [/czech|prague|krumlov/i, 'Europe/Prague'],
  [/germany|munich|münchen|rothenburg|bavaria/i, 'Europe/Berlin'],
  [/estonia|tallinn/i, 'Europe/Tallinn'],
  [/finland|helsinki/i, 'Europe/Helsinki'],
  [/belgium|brussels|bruges|brugge|ghent|gent/i, 'Europe/Brussels'],
  [/japan|tokyo|osaka|kyoto|東京|大阪|京都/i, 'Asia/Tokyo']
];

function placeTz_(text) {
  for (var i = 0; i < PLACE_TZ.length; i++) if (PLACE_TZ[i][0].test(text || '')) return PLACE_TZ[i][1];
  return null;
}

/** "10/12/26" -> "2026-12-10" (day/month/year). */
function parseDMY(s) {
  var m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  var y = Number(m[3]); if (y < 100) y += 2000;
  return y + '-' + pad2_(m[2]) + '-' + pad2_(m[1]);
}

/** "0920", "920", "9:20", "19.30", "7:30pm" -> "09:20". Returns null if unreadable. */
function parseTime(s) {
  var t = String(s || '').trim().toLowerCase();
  var m = t.match(/^(\d{1,2})(?:[:.]?(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  var h = Number(m[1]), min = m[2] ? Number(m[2]) : 0;
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return pad2_(h) + ':' + pad2_(min);
}

function pad2_(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

function addDays(iso, n) {
  var d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function tzOffsetMin_(utcMs, tz) {
  if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
    var z = Utilities.formatDate(new Date(utcMs), tz, 'Z'); // e.g. +1300
    var sign = z[0] === '-' ? -1 : 1;
    return sign * (Number(z.substr(1, 2)) * 60 + Number(z.substr(3, 2)));
  }
  var parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(utcMs));
  var p = {}; parts.forEach(function (x) { p[x.type] = x.value; });
  var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - utcMs) / 60000);
}

/** Local wall time in a time zone -> UTC milliseconds. */
function zonedToUtc(iso, time, tz) {
  var hm = (time || '00:00').split(':');
  var guess = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), +hm[0], +hm[1]);
  var off = tzOffsetMin_(guess, tz);
  var utc = guess - off * 60000;
  var off2 = tzOffsetMin_(utc, tz);
  if (off2 !== off) utc = guess - off2 * 60000;
  return utc;
}

function driveId_(url) {
  var m = String(url || '').match(/\/d\/([A-Za-z0-9_-]{20,})/) || String(url || '').match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : null;
}

function isSecret_(v) { return /^(y|yes|true|secret)$/i.test(String(v || '').trim()); }
function isExcluded_(v) { return /^n\/?a$/i.test(String(v || '').trim()); }
function clean_(s) { s = String(s || '').trim(); return /^(see above|0|flight|link)$/i.test(s) ? '' : s; }

function headerIndex_(row, patterns, fallback) {
  for (var c = 0; c < row.length; c++) {
    for (var p = 0; p < patterns.length; p++) if (patterns[p].test(row[c].v)) return c;
  }
  return fallback;
}

/**
 * Builds the app's data from the sheet.
 * src = { travel: cells[][], plans: cells[][], files: {id: meta} }, cell = {v, links:[{url,label}]}
 * viewer = 'dan' | 'alex'
 */
function buildTrip(src, nowMs, viewer) {
  var warnings = [];
  var rows = src.travel || [];
  var cell = function (r, c) { return (rows[r] && rows[r][c]) || { v: '', links: [] }; };

  // ---- locate the two tables
  var accHdr = -1, otherRow = rows.length;
  for (var r = 0; r < rows.length; r++) {
    var a = cell(r, 0).v.trim();
    if (/^accommodation date$/i.test(a)) accHdr = r;
    else if (accHdr >= 0 && /^other$/i.test(a)) { otherRow = r; break; }
  }
  if (accHdr < 0) { warnings.push('Could not find the "Accommodation Date" header row.'); accHdr = rows.length; }

  var th = rows[0] || [];
  var T = {
    date: 0,
    secret: headerIndex_(th, [/^secret/i], 1),
    detail: headerIndex_(th, [/^detail$/i], 2),
    info: headerIndex_(th, [/^flight$/i], 3),
    ref: headerIndex_(th, [/^reference/i], 4),
    carrier: headerIndex_(th, [/^carrier$/i], 8),
    baggage: headerIndex_(th, [/^baggage/i], 9),
    notes: headerIndex_(th, [/^notes$/i], 10),
    link: headerIndex_(th, [/^confirmation$/i], 11),
    notes2: headerIndex_(th, [/^notes 2$/i], 12),
    alexNote: headerIndex_(th, [/^note for alex/i], 13)
  };
  var ah = rows[accHdr] || [];
  var A = {
    date: 0, secret: 1,
    city: headerIndex_(ah, [/^detail$/i], 2),
    name: headerIndex_(ah, [/^accommodation$/i], 3),
    address: headerIndex_(ah, [/^address$/i], 4),
    local: headerIndex_(ah, [/^local address$/i], 5),
    paid: 7,
    agent: headerIndex_(ah, [/^agent$/i], 8),
    inout: headerIndex_(ah, [/^check-in/i], 9),
    cancel: headerIndex_(ah, [/^cancellation/i], 10),
    link: headerIndex_(ah, [/^link$/i], 11),
    notes2: 12,
    alexNote: headerIndex_(ah, [/^note for alex/i], 13)
  };

  var fileRefs = []; // {id, label, itemId}
  var collectFiles = function (c, itemId, rowNo) {
    var out = [];
    c.links.forEach(function (l) {
      var id = driveId_(l.url);
      if (id && src.files[id]) { out.push({ id: id, label: l.label && !/^link$/i.test(l.label) ? l.label : '' }); fileRefs.push({ id: id, itemId: itemId }); }
      else if (id) warnings.push('Row ' + rowNo + ': linked file isn’t in the trip folder, so it won’t be available offline.');
    });
    return out;
  };

  // ---- transport
  var travels = [], dayRows = {};
  for (r = 1; r < accHdr; r++) {
    var date = parseDMY(cell(r, T.date).v);
    if (!date) continue;
    var secretV = cell(r, T.secret).v;
    if (isExcluded_(secretV)) continue;
    var detail = cell(r, T.detail).v.trim();
    var info = cell(r, T.info).v.trim();
    if (/^no travel$/i.test(detail)) {
      dayRows[date] = { location: info, secret: isSecret_(secretV) };
      continue;
    }
    var id = 't' + (r + 1);
    var seg = info.match(/([A-Z]{3})\s+(\d{3,4})\s*>\s*([A-Z]{3})\s+(\d{3,4})(?:\s*\+\s*(\d))?/);
    var t = {
      id: id, kind: 'travel', mode: modeOf_(detail), date: date, title: detail,
      service: '', from: '', to: '', time: null, arrive: null, arriveDate: null, description: '',
      ref: clean_(cell(r, T.ref).v), carrier: clean_(cell(r, T.carrier).v), baggage: clean_(cell(r, T.baggage).v),
      notes: [clean_(cell(r, T.notes).v), clean_(cell(r, T.notes2).v)].filter(String),
      alexNote: cell(r, T.alexNote).v.trim(), secret: isSecret_(secretV), files: [], row: r + 1
    };
    if (seg) {
      t.service = info.slice(0, seg.index).replace(/[\s-]+$/, '').trim();
      t.from = seg[1]; t.to = seg[3];
      t.time = parseTime(seg[2]); t.arrive = parseTime(seg[4]);
      t.arriveDate = addDays(date, Number(seg[5] || 0));
      if (!AIRPORT_TZ[t.from]) warnings.push('Row ' + (r + 1) + ': unknown station code "' + t.from + '" in "' + info + '".');
      var rest = info.slice(seg.index + seg[0].length).trim();
      if (rest) t.description = rest;
    } else {
      var tm = info.match(/\b(\d{4})\b/);
      t.time = tm ? parseTime(tm[1]) : null;
      t.description = info;
    }
    if (!t.time && t.ref) warnings.push('Row ' + (r + 1) + ': "' + detail + '" has a booking ref but no time I can read.');
    t.files = collectFiles(cell(r, T.link), id, r + 1);
    travels.push(t);
  }

  // ---- accommodation (one row per night, grouped into stays)
  var stays = [], cur = null;
  for (r = accHdr + 1; r < otherRow; r++) {
    date = parseDMY(cell(r, A.date).v);
    if (!date) continue;
    var name = cell(r, A.name).v.trim();
    if (!name || /^flight$/i.test(name)) { cur = null; continue; }
    if (cur && cur.name === name && addDays(cur.lastNight, 1) === date) {
      cur.lastNight = date;
      if (isSecret_(cell(r, A.secret).v)) cur.secret = true;
      cur.files = cur.files.concat(collectFiles(cell(r, A.link), cur.id, r + 1).filter(function (f) {
        return !cur.files.some(function (g) { return g.id === f.id; });
      }));
      var n2 = clean_(cell(r, A.notes2).v);
      if (n2 && cur.notes.indexOf(n2) < 0) cur.notes.push(n2);
      continue;
    }
    var agentRaw = clean_(cell(r, A.agent).v), agentRef = '';
    var am = agentRaw.match(/^(.*?)\s*(?:itinerary)?\s*[-:]\s*([A-Z0-9-]{5,})$/i);
    if (am) { agentRaw = am[1].replace(/\s*itinerary$/i, '').trim(); agentRef = am[2]; }
    cur = {
      id: 's' + (r + 1), kind: 'stay', date: date, firstNight: date, lastNight: date,
      city: cell(r, A.city).v.trim(), name: name, address: clean_(cell(r, A.address).v),
      localAddress: cell(r, A.local).v.trim(), agent: agentRaw, ref: agentRef,
      inoutRaw: cell(r, A.inout).v.trim(), cancelRaw: cell(r, A.cancel).v.trim(), paidRaw: cell(r, A.paid).v,
      notes: [clean_(cell(r, A.notes2).v)].filter(String), alexNote: cell(r, A.alexNote).v.trim(),
      secret: isSecret_(cell(r, A.secret).v), files: [], row: r + 1
    };
    cur.files = collectFiles(cell(r, A.link), cur.id, r + 1);
    stays.push(cur);
  }
  stays.forEach(function (s) {
    var ci = s.inoutRaw.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:after|from)\s*(\d{3,4}|\d{1,2}[:.]\d{2})/i);
    var co = s.inoutRaw.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:before|by)\s*(\d{3,4}|\d{1,2}[:.]\d{2})/i);
    s.checkIn = { date: s.firstNight, time: CONFIG.DEFAULT_CHECKIN };
    s.checkOut = { date: addDays(s.lastNight, 1), time: null };
    if (ci) {
      s.checkIn.time = parseTime(ci[2]) || CONFIG.DEFAULT_CHECKIN;
      if (!parseTime(ci[2])) warnings.push('Row ' + s.row + ': couldn’t read check-in time "' + ci[2] + '" for ' + s.name + '.');
    }
    if (co) {
      var coDate = parseDMY(co[1]);
      if (coDate && coDate !== s.checkOut.date) warnings.push('Row ' + s.row + ': ' + s.name + ' check-out date (' + co[1] + ') doesn’t match the nights listed.');
      s.checkOut.time = parseTime(co[2]);
      if (!s.checkOut.time) warnings.push('Row ' + s.row + ': couldn’t read check-out time "' + co[2] + '" for ' + s.name + '.');
    }
    var cr = s.cancelRaw;
    var until = cr.match(/(?:until|before)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    s.cancellation = {
      nonRefundable: /non-?refundable/i.test(cr),
      freeUntil: until ? parseDMY(until[1]) : null,
      payAtProperty: /pay at property/i.test(cr + ' ' + s.paidRaw),
      localTax: /tax/i.test(cr)
    };
    s.tz = placeTz_(s.address + ' ' + s.city) || null;
    if (!s.tz) warnings.push('Row ' + s.row + ': couldn’t work out the time zone for ' + s.name + '.');
    delete s.inoutRaw; delete s.cancelRaw; delete s.paidRaw;
  });

  // ---- plans
  var plans = [];
  var prow = src.plans || [];
  var ph = prow[0] || [];
  var P = {
    date: headerIndex_(ph, [/^date$/i], 0), time: headerIndex_(ph, [/^start time$/i, /^time$/i], 1),
    name: headerIndex_(ph, [/^name$/i], 2), type: headerIndex_(ph, [/^type$/i], 3),
    address: headerIndex_(ph, [/^address$/i], 4), local: headerIndex_(ph, [/^local address$/i], 5),
    ref: headerIndex_(ph, [/^booking ref/i], 6), notes: headerIndex_(ph, [/^notes$/i], 7),
    secret: headerIndex_(ph, [/^secret/i], 8), link: headerIndex_(ph, [/^file link$/i], 9),
    alexNote: headerIndex_(ph, [/^note for alex/i], 10)
  };
  var pc = function (r, c) { return (prow[r] && prow[r][c]) || { v: '', links: [] }; };
  for (r = 1; r < prow.length; r++) {
    date = parseDMY(pc(r, P.date).v);
    var pname = pc(r, P.name).v.trim();
    if (!date || !pname) { if (pname) warnings.push('Plans row ' + (r + 1) + ': date "' + pc(r, P.date).v + '" isn’t d/m/yy.'); continue; }
    var rawTime = pc(r, P.time).v.trim();
    var p = {
      id: 'p' + (r + 1), kind: 'plan', date: date, time: parseTime(rawTime), title: pname,
      type: pc(r, P.type).v.trim(), address: pc(r, P.address).v.trim(), localAddress: pc(r, P.local).v.trim(),
      ref: pc(r, P.ref).v.trim(), notes: [pc(r, P.notes).v.trim()].filter(String),
      alexNote: pc(r, P.alexNote).v.trim(), secret: isSecret_(pc(r, P.secret).v), files: [], row: r + 1
    };
    if (rawTime && !p.time) warnings.push('Plans row ' + (r + 1) + ': couldn’t read start time "' + rawTime + '".');
    p.files = collectFiles(pc(r, P.link), p.id, r + 1);
    plans.push(p);
  }

  // ---- days and where we sleep each night
  var allDates = travels.map(function (x) { return x.date; })
    .concat(stays.map(function (s) { return s.checkOut.date; }), Object.keys(dayRows), plans.map(function (x) { return x.date; }));
  allDates.sort();
  var start = allDates[0], end = allDates[allDates.length - 1];
  var days = [];
  if (start) {
    var prev = { location: CONFIG.HOME, tz: CONFIG.HOME_TZ, stay: null, secret: false };
    for (var d = start; d <= end; d = addDays(d, 1)) {
      var stay = stays.filter(function (s) { return s.firstNight <= d && d <= s.lastNight; })[0] || null;
      var dayTravel = travels.filter(function (x) { return x.date === d; });
      var overnight = dayTravel.filter(function (x) { return x.arriveDate && x.arriveDate > d; }).pop();
      var night;
      if (stay) night = { location: stay.city || stay.name, tz: stay.tz || prev.tz, stay: stay.id, secret: stay.secret };
      else if (overnight) night = { location: 'Overnight travel', tz: AIRPORT_TZ[overnight.to] || prev.tz, stay: null, secret: overnight.secret, transit: true };
      else if (dayRows[d] && dayRows[d].location) night = { location: dayRows[d].location, tz: placeTz_(dayRows[d].location) || prev.tz, stay: null, secret: dayRows[d].secret };
      else if (d === end) night = { location: CONFIG.HOME, tz: CONFIG.HOME_TZ, stay: null, secret: false, home: true };
      else night = { location: prev.transit ? '' : prev.location, tz: prev.tz, stay: null, secret: prev.secret };
      days.push({ date: d, from: prev, night: night });
      prev = night;
    }
  }
  var dayOf = {}; days.forEach(function (x) { dayOf[x.date] = x; });

  // ---- start times and reveal times
  var revealMs = REVEAL_MS_();
  travels.forEach(function (x) {
    var tz = AIRPORT_TZ[x.from] || (dayOf[x.date] ? dayOf[x.date].from.tz : CONFIG.HOME_TZ);
    x.tz = tz;
    x.startsAt = zonedToUtc(x.date, x.time || '00:00', tz);
    if (x.arrive) {
      var atz = AIRPORT_TZ[x.to] || (dayOf[x.arriveDate] ? dayOf[x.arriveDate].night.tz : tz);
      x.arriveAt = zonedToUtc(x.arriveDate, x.arrive, atz);
    }
  });
  stays.forEach(function (s) {
    s.startsAt = zonedToUtc(s.checkIn.date, s.checkIn.time, s.tz || CONFIG.HOME_TZ);
    s.checkOutAt = zonedToUtc(s.checkOut.date, s.checkOut.time || '10:00', s.tz || CONFIG.HOME_TZ);
  });
  plans.forEach(function (p) {
    var tz = placeTz_(p.address + ' ' + p.localAddress) || (dayOf[p.date] ? dayOf[p.date].night.tz || dayOf[p.date].from.tz : CONFIG.HOME_TZ);
    p.tz = tz;
    p.startsAt = zonedToUtc(p.date, p.time || '00:00', tz);
  });
  var items = [].concat(travels, stays, plans);
  items.forEach(function (x) {
    x.revealAt = x.secret ? x.startsAt - revealMs : null;
    x.hidden = viewer === 'alex' && x.secret && nowMs < x.revealAt;
  });
  var byId = {}; items.forEach(function (x) { byId[x.id] = x; });

  // ---- deadlines
  var deadlines = [];
  stays.forEach(function (s) {
    if (s.cancellation.freeUntil) deadlines.push({ date: s.cancellation.freeUntil, title: 'Last day to cancel for free', subject: s.name, itemId: s.id });
    s.notes.forEach(function (n) {
      var m = n.match(/(?:until|before|by)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
      if (m && /cancel/i.test(n)) {
        var dd = parseDMY(m[1]);
        var existing = deadlines.filter(function (x) { return x.itemId === s.id && x.date === dd; })[0];
        if (existing) existing.title = n; else deadlines.push({ date: dd, title: n, subject: s.name, itemId: s.id });
      }
    });
  });
  travels.forEach(function (x) {
    [x.baggage].concat(x.notes).forEach(function (n) {
      var m = String(n).match(/cancel\w*[^.;]*?(?:until|before|by)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
      if (m) deadlines.push({ date: parseDMY(m[1]), title: n, subject: x.title, itemId: x.id });
    });
  });
  deadlines.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

  // ---- leak check (Dan only): visible items mentioning a secret place
  var secretPlaces = stays.filter(function (s) { return s.secret; }).map(function (s) { return s.city; })
    .filter(function (c, i, arr) { return c && arr.indexOf(c) === i; })
    .filter(function (c) { return !stays.some(function (s) { return !s.secret && s.city === c; }); });
  items.forEach(function (x) {
    if (x.secret) return;
    var text = [x.title, x.description, x.notes && x.notes.join(' '), x.address, x.name].join(' ');
    secretPlaces.forEach(function (c) {
      if (text.toLowerCase().indexOf(c.toLowerCase()) >= 0) warnings.push('Row ' + x.row + ' isn’t secret but mentions ' + c + ', which is.');
    });
  });

  // ---- shape output for the viewer
  var outDays = days.map(function (x) {
    var n = x.night, hiddenNight = viewer === 'alex' && n.secret && (!n.stay || byId[n.stay].hidden);
    var hiddenFrom = viewer === 'alex' && x.from.secret && (!x.from.stay || byId[x.from.stay].hidden);
    return {
      date: x.date,
      from: hiddenFrom ? 'Surprise' : x.from.location,
      location: hiddenNight ? 'Surprise' : n.location,
      stayId: n.stay && !(viewer === 'alex' && byId[n.stay].hidden) ? n.stay : (n.stay ? 'surprise-' + n.stay : null),
      transit: !!n.transit, home: !!n.home, surprise: hiddenNight
    };
  });

  var outItems = items.map(function (x) {
    if (x.hidden) {
      var ph = { id: x.id, kind: x.kind, date: x.date, time: x.kind === 'stay' ? x.checkIn.time : x.time, startsAt: x.startsAt, surprise: true, note: x.alexNote, revealAt: x.revealAt };
      if (x.kind === 'stay') { ph.checkIn = x.checkIn; ph.checkOut = x.checkOut; ph.checkOutAt = x.checkOutAt; ph.firstNight = x.firstNight; ph.lastNight = x.lastNight; }
      return ph;
    }
    var o = {};
    Object.keys(x).forEach(function (k) {
      if (['hidden', 'row', 'tz'].indexOf(k) >= 0) return;
      if (viewer === 'alex' && (k === 'alexNote' || k === 'secret' || k === 'revealAt')) return;
      o[k] = x[k];
    });
    if (viewer === 'alex') o.secret = false;
    return o;
  });

  var visibleIds = {}; outItems.forEach(function (x) { if (!x.surprise) visibleIds[x.id] = true; });
  var outDeadlines = deadlines.filter(function (x) { return visibleIds[x.itemId]; });
  var fileIds = {};
  fileRefs.forEach(function (f) { if (visibleIds[f.itemId]) fileIds[f.id] = true; });
  var files = Object.keys(fileIds).map(function (id) {
    var m = src.files[id];
    return { id: id, name: m.name, mimeType: m.mimeType, size: m.size, modified: m.modified };
  });

  return {
    version: 1,
    generatedAt: nowMs,
    viewer: viewer,
    start: start, end: end,
    days: outDays,
    items: outItems,
    deadlines: outDeadlines,
    files: files,
    warnings: viewer === 'dan' ? warnings.filter(function (w, i, a) { return a.indexOf(w) === i; }) : []
  };
}

function REVEAL_MS_() { return CONFIG.REVEAL_HOURS * 3600 * 1000; }

function modeOf_(title) {
  var t = String(title).toLowerCase();
  if (/flight|fly/.test(t)) return 'flight';
  if (/train|rail|eurostar/.test(t)) return 'train';
  if (/bus|coach/.test(t)) return 'bus';
  if (/car|rental|drive/.test(t)) return 'car';
  if (/ferry|boat/.test(t)) return 'ferry';
  return 'travel';
}

if (typeof module !== 'undefined') module.exports = { buildTrip: buildTrip, parseTime: parseTime, parseDMY: parseDMY, zonedToUtc: zonedToUtc };
