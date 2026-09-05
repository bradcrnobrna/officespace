const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, 'db.json');

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
    throw new Error(`data/db.json is corrupted: ${err.message}`);
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

// ---- Offices ----
function getOffices() {
  return load().offices;
}

// ---- Therapists ----
function getTherapists() {
  return load().therapists;
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
function getBookings({ date } = {}) {
  const db = load();
  let bookings = db.bookings;
  if (date) bookings = bookings.filter((b) => b.date === date);
  return bookings
    .map((b) => enrich(b, db))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
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
    therapist_id: patch.therapist_id ?? booking.therapist_id,
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
  addTherapist,
  updateTherapist,
  getBookings,
  getBooking,
  findConflict,
  addBooking,
  updateBooking,
  deleteBooking,
  getCurrentStatus,
  todayStr
};
