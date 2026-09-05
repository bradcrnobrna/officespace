const express = require('express');
const path = require('path');
const store = require('./data/store');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const IDENTITY_COOKIE = 'hh_identity';
const IDENTITY_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 180; // 180 days

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

// Identifies who is using this browser, based on a signed cookie set at /api/me.
// This is a lightweight "which therapist is this" check for a small trusted team,
// not a password-protected login.
app.use((req, res, next) => {
  const token = parseCookies(req)[IDENTITY_COOKIE];
  const therapistId = token ? store.verifyIdentity(token) : null;
  req.currentTherapist = therapistId ? store.getTherapist(therapistId) : null;
  next();
});

app.get('/api/offices', (req, res) => {
  res.json(store.getOffices());
});

app.get('/api/therapists', (req, res) => {
  res.json(store.getTherapists());
});

app.post('/api/therapists', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  res.status(201).json(store.addTherapist(name));
});

app.patch('/api/therapists/:id', (req, res) => {
  const updated = store.updateTherapist(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Therapist not found' });
  res.json(updated);
});

// ---- Identity ----
app.get('/api/me', (req, res) => {
  res.json({ therapist: req.currentTherapist });
});

app.post('/api/me', (req, res) => {
  const therapist = store.getTherapist(req.body.therapist_id);
  if (!therapist || !therapist.active) {
    return res.status(400).json({ error: 'Unknown or inactive therapist' });
  }
  res.cookie(IDENTITY_COOKIE, store.signIdentity(therapist.id), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: IDENTITY_MAX_AGE_MS
  });
  res.json({ therapist });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(IDENTITY_COOKIE);
  res.status(204).end();
});

// ---- Bookings ----
app.get('/api/bookings', (req, res) => {
  const { date, start, end } = req.query;
  res.json(store.getBookings({ date, start, end }));
});

const RECURRENCE_FREQUENCIES = new Set(['weekly', 'biweekly']);

app.post('/api/bookings', (req, res) => {
  const therapist = req.currentTherapist;
  if (!therapist) {
    return res.status(401).json({ error: 'Please sign in as yourself before booking an office.' });
  }

  const { office_id, date, start_time, end_time, note, recurrence } = req.body;
  if (!office_id || !date || !start_time || !end_time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (start_time >= end_time) {
    return res.status(400).json({ error: 'End time must be after start time' });
  }

  if (recurrence && recurrence.frequency) {
    if (!RECURRENCE_FREQUENCIES.has(recurrence.frequency)) {
      return res.status(400).json({ error: 'Unknown repeat frequency' });
    }
    if (!recurrence.until || recurrence.until < date) {
      return res.status(400).json({ error: 'Repeat-until date must be on or after the start date' });
    }
    const result = store.addBookingSeries({
      office_id,
      therapist_id: therapist.id,
      start_time,
      end_time,
      note,
      firstDate: date,
      frequency: recurrence.frequency,
      until: recurrence.until
    });
    if (result.created.length === 0) {
      return res.status(409).json({
        error: `Every occurrence conflicted with an existing booking: ${result.skipped.map((s) => s.date).join(', ')}`
      });
    }
    return res.status(201).json(result);
  }

  const conflict = store.findConflict({ office_id, date, start_time, end_time });
  if (conflict) {
    return res.status(409).json({
      error: `${conflict.therapist_name} already has the ${conflict.office_name} booked ${conflict.start_time}-${conflict.end_time}`
    });
  }
  res.status(201).json(
    store.addBooking({ office_id, therapist_id: therapist.id, date, start_time, end_time, note })
  );
});

app.put('/api/bookings/:id', (req, res) => {
  const existing = store.getBooking(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Booking not found' });

  const me = req.currentTherapist;
  if (!me || me.id !== existing.therapist_id) {
    return res.status(403).json({ error: 'You can only edit your own bookings.' });
  }

  const merged = { ...existing, ...req.body };
  if (merged.start_time >= merged.end_time) {
    return res.status(400).json({ error: 'End time must be after start time' });
  }
  const conflict = store.findConflict({
    office_id: merged.office_id,
    date: merged.date,
    start_time: merged.start_time,
    end_time: merged.end_time,
    excludeId: req.params.id
  });
  if (conflict) {
    return res.status(409).json({
      error: `${conflict.therapist_name} already has the ${conflict.office_name} booked ${conflict.start_time}-${conflict.end_time}`
    });
  }
  res.json(store.updateBooking(req.params.id, req.body));
});

app.delete('/api/bookings/:id', (req, res) => {
  const existing = store.getBooking(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Booking not found' });

  const me = req.currentTherapist;
  if (!me || me.id !== existing.therapist_id) {
    return res.status(403).json({ error: 'You can only delete your own bookings.' });
  }

  if (req.query.scope === 'series' && existing.series_id) {
    store.deleteBookingSeries(req.params.id);
  } else {
    store.deleteBooking(req.params.id);
  }
  res.status(204).end();
});

app.get('/api/status', (req, res) => {
  res.json({ today: store.todayStr(), offices: store.getCurrentStatus() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`The Healing Hideout scheduler running on http://localhost:${PORT}`);
});
