const express = require('express');
const path = require('path');
const store = require('./data/store');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

app.get('/api/bookings', (req, res) => {
  res.json(store.getBookings({ date: req.query.date }));
});

app.post('/api/bookings', (req, res) => {
  const { office_id, therapist_id, date, start_time, end_time, note } = req.body;
  if (!office_id || !therapist_id || !date || !start_time || !end_time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (start_time >= end_time) {
    return res.status(400).json({ error: 'End time must be after start time' });
  }
  const conflict = store.findConflict({ office_id, date, start_time, end_time });
  if (conflict) {
    return res.status(409).json({
      error: `${conflict.therapist_name} already has the ${conflict.office_name} booked ${conflict.start_time}-${conflict.end_time}`
    });
  }
  res.status(201).json(store.addBooking({ office_id, therapist_id, date, start_time, end_time, note }));
});

app.put('/api/bookings/:id', (req, res) => {
  const existing = store.getBooking(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Booking not found' });

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
  const ok = store.deleteBooking(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Booking not found' });
  res.status(204).end();
});

app.get('/api/status', (req, res) => {
  res.json({ today: store.todayStr(), offices: store.getCurrentStatus() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`The Healing Hideout scheduler running on http://localhost:${PORT}`);
});
