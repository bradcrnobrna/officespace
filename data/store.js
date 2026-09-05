const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Runtime data lives in its own directory, separate from the application
// code in this folder, so a mounted volume (e.g. Railway's persistent disk)
// can be pointed at just the data directory without hiding store.js itself.
const STORAGE_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'storage');
const DB_FILE = path.join(STORAGE_DIR, 'db.json');
const SECRET_FILE = path.join(STORAGE_DIR, 'session-secret.txt');

const THERAPIST_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f97316', // orange
  '#a855f7', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#ef4444', // red
  '#6366f1'  // indigo
];

const DEFAULT_DB = {
  offices: [
    { id: 'black', name: 'Black Office', color: '#1c1c1c', textColor: '#ffffff' },
    { id: 'yellow', name: 'Yellow Office', color: '#f5b301', textColor: '#1c1c1c' },
    { id: 'brown', name: 'Brown Office', color: '#7b4b27', textColor: '#ffffff' }
  ],
  therapists: [],
  bookings: []
};

function load() {
  if (!fs.existsSync(DB_FILE)) {
    save(DEFAULT_DB);
    return structuredClone(DEFAULT_DB);
  }
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${DB_FILE} is corrupted: ${err.message}`);
  }
}

function save(db) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowTimeStr(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function timesOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

// Pure calendar-date arithmetic in UTC, so stepping by days never shifts
// under DST regardless of the server's own time zone.
function isoToUtcMs(str) {
  const [y, m, d] = str.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcMsToIso(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addDaysIso(str, days) {
  return utcMsToIso(isoToUtcMs(str) + days * 86400000);
}

// ---- Identity (lightweight "who's using this browser" sign-in) ----
function getSecret() {
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
  fs.writeFileSync(SECRET_FILE, secret);
  return secret;
}
const SESSION_SECRET = getSecret();

function signIdentity(therapistId) {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(therapistId).digest('hex');
  return `${therapistId}.${sig}`;
}

function verifyIdentity(token) {
  if (!token) return null;
  const idx = token.lastIndexOf('.');
  if (idx === -1) return null;
  const id = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(id).digest('hex');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  return id;
}

// ---- Offices ----
function getOffices() {
  return load().offices;
}

// ---- Therapists ----
function getTherapists() {
  return load().therapists;
}

function getTherapist(id) {
  return load().therapists.find((t) => t.id === id) || null;
}

function addTherapist(name) {
  const db = load();
  const usedColors = new Set(db.therapists.map((t) => t.color));
  const color =
    THERAPIST_COLORS.find((c) => !usedColors.has(c)) ||
    THERAPIST_COLORS[db.therapists.length % THERAPIST_COLORS.length];
  const therapist = {
    id: crypto.randomUUID(),
    name,
    color,
    active: true
  };
  db.therapists.push(therapist);
  save(db);
  return therapist;
}

function updateTherapist(id, patch) {
  const db = load();
  const therapist = db.therapists.find((t) => t.id === id);
  if (!therapist) return null;
  if (typeof patch.active === 'boolean') therapist.active = patch.active;
  if (typeof patch.name === 'string' && patch.name.trim()) therapist.name = patch.name.trim();
  save(db);
  return therapist;
}

// ---- Bookings ----
function getBookings({ date, start, end } = {}) {
  const db = load();
  let bookings = db.bookings;
  if (date) {
    bookings = bookings.filter((b) => b.date === date);
  } else if (start && end) {
    bookings = bookings.filter((b) => b.date >= start && b.date <= end);
  }
  return bookings
    .map((b) => enrich(b, db))
    .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
}

function getBooking(id) {
  const db = load();
  const booking = db.bookings.find((b) => b.id === id);
  return booking ? enrich(booking, db) : null;
}

function enrich(booking, db) {
  const therapist = db.therapists.find((t) => t.id === booking.therapist_id);
  const office = db.offices.find((o) => o.id === booking.office_id);
  return {
    ...booking,
    therapist_name: therapist ? therapist.name : 'Unknown',
    therapist_color: therapist ? therapist.color : '#999999',
    office_name: office ? office.name : 'Unknown'
  };
}

function findConflict({ office_id, date, start_time, end_time, excludeId }) {
  const db = load();
  const clash = db.bookings.find(
    (b) =>
      b.office_id === office_id &&
      b.date === date &&
      b.id !== excludeId &&
      timesOverlap(start_time, end_time, b.start_time, b.end_time)
  );
  return clash ? enrich(clash, db) : null;
}

function addBooking({ office_id, therapist_id, date, start_time, end_time, note }) {
  const db = load();
  const booking = {
    id: crypto.randomUUID(),
    office_id,
    therapist_id,
    date,
    start_time,
    end_time,
    note: note || '',
    created_at: new Date().toISOString()
  };
  db.bookings.push(booking);
  save(db);
  return enrich(booking, db);
}

function updateBooking(id, patch) {
  const db = load();
  const booking = db.bookings.find((b) => b.id === id);
  if (!booking) return null;
  Object.assign(booking, {
    office_id: patch.office_id ?? booking.office_id,
    date: patch.date ?? booking.date,
    start_time: patch.start_time ?? booking.start_time,
    end_time: patch.end_time ?? booking.end_time,
    note: patch.note ?? booking.note
  });
  save(db);
  return enrich(booking, db);
}

function deleteBooking(id) {
  const db = load();
  const idx = db.bookings.findIndex((b) => b.id === id);
  if (idx === -1) return false;
  db.bookings.splice(idx, 1);
  save(db);
  return true;
}

// ---- Recurring bookings ----
// Recurring appointments are materialized as ordinary booking rows sharing a
// series_id, rather than a stored recurrence rule. That keeps every existing
// query, conflict check, and ownership rule working unchanged - a recurring
// booking is just several normal bookings with a shared tag.
const MAX_RECURRING_OCCURRENCES = 52;

function addBookingSeries({ office_id, therapist_id, start_time, end_time, note, firstDate, intervalWeeks, until }) {
  const stepDays = intervalWeeks * 7;
  const dates = [];
  let cursor = firstDate;
  let truncated = false;
  while (cursor <= until) {
    if (dates.length >= MAX_RECURRING_OCCURRENCES) {
      truncated = true;
      break;
    }
    dates.push(cursor);
    cursor = addDaysIso(cursor, stepDays);
  }

  const db = load();
  const seriesId = crypto.randomUUID();
  const created = [];
  const skipped = [];

  dates.forEach((date) => {
    const clash = db.bookings.find(
      (b) => b.office_id === office_id && b.date === date && timesOverlap(start_time, end_time, b.start_time, b.end_time)
    );
    if (clash) {
      const clashInfo = enrich(clash, db);
      skipped.push({
        date,
        reason: `${clashInfo.therapist_name} already has the ${clashInfo.office_name} booked ${clash.start_time}-${clash.end_time}`
      });
      return;
    }
    const booking = {
      id: crypto.randomUUID(),
      series_id: seriesId,
      office_id,
      therapist_id,
      date,
      start_time,
      end_time,
      note: note || '',
      created_at: new Date().toISOString()
    };
    db.bookings.push(booking);
    created.push(booking);
  });

  save(db);
  return {
    created: created.map((b) => enrich(b, db)),
    skipped,
    truncated
  };
}

function deleteBookingSeries(id) {
  const db = load();
  const booking = db.bookings.find((b) => b.id === id);
  if (!booking) return false;
  const before = db.bookings.length;
  if (booking.series_id) {
    db.bookings = db.bookings.filter(
      (b) => !(b.series_id === booking.series_id && b.date >= booking.date)
    );
  } else {
    db.bookings = db.bookings.filter((b) => b.id !== id);
  }
  save(db);
  return db.bookings.length < before;
}

// ---- Live status ----
function getCurrentStatus() {
  const db = load();
  const date = todayStr();
  const now = nowTimeStr();
  const todaysBookings = db.bookings.filter((b) => b.date === date);

  return db.offices.map((office) => {
    const officeBookings = todaysBookings
      .filter((b) => b.office_id === office.id)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));

    const current = officeBookings.find((b) => b.start_time <= now && now < b.end_time);
    const next = officeBookings.find((b) => b.start_time > now);

    return {
      office_id: office.id,
      office_name: office.name,
      occupied: Boolean(current),
      current: current ? enrich(current, db) : null,
      next: next ? enrich(next, db) : null
    };
  });
}

module.exports = {
  getOffices,
  getTherapists,
  getTherapist,
  addTherapist,
  updateTherapist,
  getBookings,
  getBooking,
  findConflict,
  addBooking,
  addBookingSeries,
  updateBooking,
  deleteBooking,
  deleteBookingSeries,
  getCurrentStatus,
  todayStr,
  signIdentity,
  verifyIdentity
};
