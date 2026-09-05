const START_MIN = 7 * 60; // 7:00 AM
const END_MIN = 21 * 60; // 9:00 PM
const STEP = 30; // minutes per row
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const state = {
  offices: [],
  therapists: [],
  bookings: [],
  date: todayStr(),
  view: 'day',
  me: null
};

let pendingAfterSignIn = null;

function pad(n) { return String(n).padStart(2, '0'); }

function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayStr(d = new Date()) { return fmtDate(d); }

function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d, n) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}

function weekStartDate(dateStr) {
  const d = parseLocalDate(dateStr);
  return addDays(d, -d.getDay());
}

function minutesToLabel(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${period}`;
}

function minutesToTimeValue(mins) {
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

function timeValueToMinutes(val) {
  const [h, m] = val.split(':').map(Number);
  return h * 60 + m;
}

function formatTimeLabel(val) {
  return minutesToLabel(timeValueToMinutes(val));
}

function slotList() {
  const slots = [];
  for (let m = START_MIN; m < END_MIN; m += STEP) slots.push(m);
  return slots;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Something went wrong');
  return body;
}

// ---- Data loading ----
async function loadStaticData() {
  const [offices, therapists] = await Promise.all([
    api('/api/offices'),
    api('/api/therapists')
  ]);
  state.offices = offices;
  state.therapists = therapists;
}

async function loadMe() {
  const res = await api('/api/me');
  state.me = res.therapist;
  renderIdentityBar();
}

function getRange() {
  if (state.view === 'day') return { start: state.date, end: state.date };
  if (state.view === 'week') {
    const s = weekStartDate(state.date);
    return { start: fmtDate(s), end: fmtDate(addDays(s, 6)) };
  }
  const first = parseLocalDate(state.date);
  first.setDate(1);
  const gridStart = addDays(first, -first.getDay());
  return { start: fmtDate(gridStart), end: fmtDate(addDays(gridStart, 41)) };
}

async function loadBookings() {
  const { start, end } = getRange();
  state.bookings = await api(`/api/bookings?start=${start}&end=${end}`);
}

async function loadStatus() {
  const status = await api('/api/status');
  renderStatus(status.offices);
}

// ---- Identity bar & sign-in ----
function renderIdentityBar() {
  const status = document.getElementById('identityStatus');
  const btn = document.getElementById('identityBtn');
  if (state.me) {
    status.innerHTML = `Signed in as <strong>${escapeHtml(state.me.name)}</strong>`;
    btn.textContent = 'Switch User';
  } else {
    status.textContent = 'Not signed in';
    btn.textContent = 'Sign in';
  }
}

function openIdentityModal(onDone) {
  pendingAfterSignIn = onDone || null;
  const list = document.getElementById('identityList');
  list.innerHTML = '';
  const active = state.therapists.filter((t) => t.active);
  if (active.length === 0) {
    list.innerHTML = '<p class="hint">Add a therapist below first, then sign in.</p>';
  }
  active.forEach((t) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'identity-option';
    btn.innerHTML = `<span class="color-dot" style="background:${t.color}"></span><span>${escapeHtml(t.name)}</span>`;
    btn.addEventListener('click', async () => {
      const res = await api('/api/me', { method: 'POST', body: JSON.stringify({ therapist_id: t.id }) });
      state.me = res.therapist;
      renderIdentityBar();
      const cb = pendingAfterSignIn;
      closeIdentityModal();
      if (cb) cb();
    });
    list.appendChild(btn);
  });
  document.getElementById('identityOverlay').classList.remove('hidden');
}

function closeIdentityModal() {
  document.getElementById('identityOverlay').classList.add('hidden');
  pendingAfterSignIn = null;
}

// ---- Rendering: status cards ----
function renderStatus(offices) {
  const el = document.getElementById('statusCards');
  el.innerHTML = '';
  offices.forEach((o) => {
    const office = state.offices.find((x) => x.id === o.office_id) || {};
    const card = document.createElement('div');
    card.className = 'status-card' + (o.occupied ? '' : ' free');
    card.style.background = office.color || '#555';
    card.style.color = office.textColor || '#fff';

    const nameEl = document.createElement('div');
    nameEl.className = 'office-name';
    nameEl.textContent = o.office_name;

    const statusEl = document.createElement('div');
    statusEl.className = 'status-line';
    statusEl.textContent = o.occupied
      ? `In use: ${o.current.therapist_name} until ${formatTimeLabel(o.current.end_time)}`
      : 'Free right now';

    const nextEl = document.createElement('div');
    nextEl.className = 'next-line';
    nextEl.textContent = o.next
      ? `Next: ${o.next.therapist_name} at ${formatTimeLabel(o.next.start_time)}`
      : 'No more bookings today';

    card.append(nameEl, statusEl, nextEl);
    el.appendChild(card);
  });
}

// ---- Rendering: therapist list ----
function renderTherapists() {
  const el = document.getElementById('therapistList');
  el.innerHTML = '';
  if (state.therapists.length === 0) {
    el.innerHTML = '<p class="hint">No therapists yet — add one below.</p>';
    return;
  }
  state.therapists.forEach((t) => {
    const chip = document.createElement('div');
    chip.className = 'therapist-chip' + (t.active ? '' : ' inactive');

    const dot = document.createElement('span');
    dot.className = 'color-dot';
    dot.style.background = t.color;

    const name = document.createElement('span');
    name.textContent = t.name;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = t.active ? 'Deactivate' : 'Reactivate';
    toggle.addEventListener('click', async () => {
      await api(`/api/therapists/${t.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !t.active })
      });
      await loadStaticData();
      renderTherapists();
    });

    chip.append(dot, name, toggle);
    el.appendChild(chip);
  });
}

// ---- Rendering: schedule dispatch ----
function renderSchedule() {
  const wrapper = document.getElementById('gridWrapper');
  wrapper.innerHTML = '';
  if (state.view === 'day') renderDayView(wrapper);
  else if (state.view === 'week') renderWeekView(wrapper);
  else renderMonthView(wrapper);
  renderRangeLabel();
}

function renderRangeLabel() {
  const el = document.getElementById('rangeLabel');
  if (state.view === 'day') {
    el.textContent = parseLocalDate(state.date).toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
  } else if (state.view === 'week') {
    const s = weekStartDate(state.date);
    const e = addDays(s, 6);
    const sameMonth = s.getMonth() === e.getMonth();
    el.textContent = `${s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString(undefined, sameMonth ? { day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })}`;
  } else {
    el.textContent = parseLocalDate(state.date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
}

// ---- Day view ----
function renderDayView(wrapper) {
  const slots = slotList();
  const grid = document.createElement('div');
  grid.className = 'schedule-grid';
  grid.style.gridTemplateColumns = `70px repeat(${state.offices.length}, 1fr)`;
  grid.style.gridTemplateRows = `40px repeat(${slots.length}, 32px)`;

  const corner = document.createElement('div');
  corner.className = 'grid-header-cell';
  grid.appendChild(corner);

  state.offices.forEach((office) => {
    const cell = document.createElement('div');
    cell.className = 'grid-header-cell';
    cell.style.background = office.color;
    cell.style.color = office.textColor;
    cell.textContent = office.name;
    grid.appendChild(cell);
  });

  const bookingsByOffice = {};
  state.offices.forEach((o) => { bookingsByOffice[o.id] = []; });
  state.bookings
    .filter((b) => b.date === state.date)
    .forEach((b) => { if (bookingsByOffice[b.office_id]) bookingsByOffice[b.office_id].push(b); });

  const coveredUntil = {};
  state.offices.forEach((o) => { coveredUntil[o.id] = -1; });

  slots.forEach((slotMin, rowIdx) => {
    const gridRow = rowIdx + 2;
    const isHour = slotMin % 60 === 0;

    const timeLabel = document.createElement('div');
    timeLabel.className = 'time-label' + (isHour ? ' hour-mark' : '');
    timeLabel.style.gridRow = String(gridRow);
    timeLabel.style.gridColumn = '1';
    timeLabel.textContent = isHour ? minutesToLabel(slotMin) : '';
    grid.appendChild(timeLabel);

    state.offices.forEach((office, colIdx) => {
      const gridCol = colIdx + 2;
      if (slotMin < coveredUntil[office.id]) return;

      const booking = bookingsByOffice[office.id].find(
        (b) => timeValueToMinutes(b.start_time) === slotMin
      );

      if (booking) {
        const startMin = timeValueToMinutes(booking.start_time);
        const endMin = Math.min(timeValueToMinutes(booking.end_time), END_MIN);
        const span = Math.max(1, Math.round((endMin - startMin) / STEP));
        coveredUntil[office.id] = startMin + span * STEP;

        const mine = state.me && booking.therapist_id === state.me.id;
        const block = document.createElement('div');
        block.className = 'booking-block' + (mine ? '' : ' not-mine');
        block.style.gridRow = `${gridRow} / span ${span}`;
        block.style.gridColumn = String(gridCol);
        block.style.background = booking.therapist_color;
        block.innerHTML = `<span class="b-name">${escapeHtml(booking.therapist_name)}</span><span class="b-time">${formatTimeLabel(booking.start_time)}-${formatTimeLabel(booking.end_time)}</span>`;
        block.addEventListener('click', () => openModal({ booking }));
        grid.appendChild(block);
      } else {
        const cell = document.createElement('div');
        cell.className = 'slot-cell' + (isHour ? ' hour-mark' : '');
        cell.style.gridRow = String(gridRow);
        cell.style.gridColumn = String(gridCol);
        cell.addEventListener('click', () => openModal({ officeId: office.id, dateStr: state.date, startMin: slotMin }));
        grid.appendChild(cell);
      }
    });
  });

  wrapper.appendChild(grid);
}

// ---- Week view ----
function renderWeekView(wrapper) {
  const start = weekStartDate(state.date);
  const days = [...Array(7)].map((_, i) => addDays(start, i));
  const today = todayStr();

  const table = document.createElement('table');
  table.className = 'week-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(document.createElement('th'));
  days.forEach((d) => {
    const th = document.createElement('th');
    if (fmtDate(d) === today) th.classList.add('today-col');
    th.innerHTML = `${d.toLocaleDateString(undefined, { weekday: 'short' })}<br>${d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}`;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  state.offices.forEach((office) => {
    const row = document.createElement('tr');
    const label = document.createElement('td');
    label.className = 'week-office-cell';
    label.style.background = office.color;
    label.style.color = office.textColor;
    label.textContent = office.name;
    row.appendChild(label);

    days.forEach((d) => {
      const ds = fmtDate(d);
      const td = document.createElement('td');
      td.className = 'week-day-cell';

      state.bookings
        .filter((b) => b.date === ds && b.office_id === office.id)
        .sort((a, b) => a.start_time.localeCompare(b.start_time))
        .forEach((b) => {
          const mine = state.me && b.therapist_id === state.me.id;
          const chip = document.createElement('div');
          chip.className = 'week-chip' + (mine ? '' : ' not-mine');
          chip.style.background = b.therapist_color;
          chip.innerHTML = `<strong>${escapeHtml(b.therapist_name)}</strong><br>${formatTimeLabel(b.start_time)}-${formatTimeLabel(b.end_time)}`;
          chip.addEventListener('click', () => openModal({ booking: b }));
          td.appendChild(chip);
        });

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'week-add-btn';
      addBtn.textContent = '+ Add';
      addBtn.addEventListener('click', () => openModal({ officeId: office.id, dateStr: ds, startMin: 9 * 60 }));
      td.appendChild(addBtn);

      row.appendChild(td);
    });
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  wrapper.appendChild(table);
}

// ---- Month view ----
function renderMonthView(wrapper) {
  const first = parseLocalDate(state.date);
  first.setDate(1);
  const gridStart = addDays(first, -first.getDay());
  const today = todayStr();
  const currentMonth = first.getMonth();

  const container = document.createElement('div');
  container.className = 'month-grid';

  WEEKDAY_LABELS.forEach((w) => {
    const el = document.createElement('div');
    el.className = 'month-weekday';
    el.textContent = w;
    container.appendChild(el);
  });

  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const ds = fmtDate(d);
    const cell = document.createElement('div');
    cell.className = 'month-day';
    if (d.getMonth() !== currentMonth) cell.classList.add('outside');
    if (ds === today) cell.classList.add('today');

    const num = document.createElement('div');
    num.className = 'month-day-num';
    num.textContent = d.getDate();
    cell.appendChild(num);

    const dayBookings = state.bookings
      .filter((b) => b.date === ds)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));

    const maxShow = 3;
    dayBookings.slice(0, maxShow).forEach((b) => {
      const entry = document.createElement('div');
      entry.className = 'month-entry';
      entry.style.background = b.therapist_color;
      entry.textContent = `${formatTimeLabel(b.start_time)} ${b.therapist_name.split(' ')[0]}`;
      cell.appendChild(entry);
    });
    if (dayBookings.length > maxShow) {
      const more = document.createElement('div');
      more.className = 'month-more';
      more.textContent = `+${dayBookings.length - maxShow} more`;
      cell.appendChild(more);
    }

    cell.addEventListener('click', () => {
      setView('day');
      setDate(ds);
    });
    container.appendChild(cell);
  }

  wrapper.appendChild(container);
}

// ---- Booking modal ----
function populateTimeSelects(startMin, disabled) {
  const startSelect = document.getElementById('modalStart');
  const endSelect = document.getElementById('modalEnd');
  startSelect.innerHTML = '';
  endSelect.innerHTML = '';

  slotList().forEach((m) => {
    const opt = document.createElement('option');
    opt.value = minutesToTimeValue(m);
    opt.textContent = minutesToLabel(m);
    startSelect.appendChild(opt);
  });

  for (let m = START_MIN + STEP; m <= END_MIN; m += STEP) {
    const opt = document.createElement('option');
    opt.value = minutesToTimeValue(m);
    opt.textContent = minutesToLabel(m);
    endSelect.appendChild(opt);
  }

  const defaultStart = startMin ?? START_MIN;
  startSelect.value = minutesToTimeValue(defaultStart);
  endSelect.value = minutesToTimeValue(Math.min(defaultStart + 60, END_MIN));
  startSelect.disabled = Boolean(disabled);
  endSelect.disabled = Boolean(disabled);
}

function openModal({ officeId, dateStr, startMin, booking } = {}) {
  if (!booking && !state.me) {
    openIdentityModal(() => openModal({ officeId, dateStr, startMin }));
    return;
  }

  const overlay = document.getElementById('modalOverlay');
  const title = document.getElementById('modalTitle');
  const officeSelect = document.getElementById('modalOffice');
  const dateInput = document.getElementById('modalDate');
  const noteInput = document.getElementById('modalNote');
  const idInput = document.getElementById('bookingId');
  const deleteBtn = document.getElementById('deleteBookingBtn');
  const deleteSeriesBtn = document.getElementById('deleteSeriesBtn');
  const saveBtn = document.getElementById('saveBookingBtn');
  const cancelBtn = document.getElementById('cancelModalBtn');
  const errorEl = document.getElementById('modalError');
  const ownerNote = document.getElementById('modalOwnerNote');
  const seriesNote = document.getElementById('modalSeriesNote');
  const bookingAs = document.getElementById('modalBookingAs');
  const repeatRow = document.getElementById('repeatRow');
  const repeatCustomRow = document.getElementById('repeatCustomRow');
  const repeatUntilRow = document.getElementById('repeatUntilRow');
  const repeatSelect = document.getElementById('modalRepeat');
  const repeatIntervalInput = document.getElementById('modalRepeatInterval');
  const repeatUntilInput = document.getElementById('modalRepeatUntil');

  errorEl.classList.add('hidden');
  ownerNote.classList.add('hidden');
  seriesNote.classList.add('hidden');

  officeSelect.innerHTML = '';
  state.offices.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.name;
    officeSelect.appendChild(opt);
  });

  const readOnly = Boolean(booking) && !(state.me && booking.therapist_id === state.me.id);
  officeSelect.disabled = readOnly;
  dateInput.disabled = readOnly;
  noteInput.disabled = readOnly;

  if (booking) {
    title.textContent = readOnly ? 'Booking Details' : 'Edit Booking';
    idInput.value = booking.id;
    officeSelect.value = booking.office_id;
    dateInput.value = booking.date;
    populateTimeSelects(timeValueToMinutes(booking.start_time), readOnly);
    document.getElementById('modalStart').value = booking.start_time;
    document.getElementById('modalEnd').value = booking.end_time;
    noteInput.value = booking.note || '';
    bookingAs.textContent = readOnly ? '' : `Booked by: ${booking.therapist_name}`;
    if (readOnly) {
      ownerNote.textContent = `Booked by ${booking.therapist_name}. You can only edit your own bookings.`;
      ownerNote.classList.remove('hidden');
    }
    if (booking.series_id) seriesNote.classList.remove('hidden');

    // Repeat is only offered when creating a new booking, not editing an occurrence.
    repeatRow.classList.add('hidden');
    repeatCustomRow.classList.add('hidden');
    repeatUntilRow.classList.add('hidden');

    deleteBtn.textContent = booking.series_id ? 'Delete this occurrence' : 'Delete';
    deleteBtn.classList.toggle('hidden', readOnly);
    deleteSeriesBtn.classList.toggle('hidden', readOnly || !booking.series_id);
    saveBtn.classList.toggle('hidden', readOnly);
    cancelBtn.textContent = readOnly ? 'Close' : 'Cancel';
  } else {
    title.textContent = 'Book an Office';
    idInput.value = '';
    officeSelect.value = officeId;
    dateInput.value = dateStr || state.date;
    populateTimeSelects(startMin, false);
    noteInput.value = '';
    bookingAs.textContent = `Booking as: ${state.me.name}`;
    repeatRow.classList.remove('hidden');
    repeatCustomRow.classList.add('hidden');
    repeatUntilRow.classList.add('hidden');
    repeatSelect.value = 'none';
    repeatIntervalInput.value = '3';
    repeatUntilInput.value = '';
    deleteBtn.classList.add('hidden');
    deleteSeriesBtn.classList.add('hidden');
    saveBtn.classList.remove('hidden');
    cancelBtn.textContent = 'Cancel';
  }

  overlay.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
}

async function refresh() {
  await loadBookings();
  renderSchedule();
  await loadStatus();
}

function shiftView(delta) {
  const d = parseLocalDate(state.date);
  if (state.view === 'day') d.setDate(d.getDate() + delta);
  else if (state.view === 'week') d.setDate(d.getDate() + delta * 7);
  else d.setMonth(d.getMonth() + delta);
  setDate(fmtDate(d));
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.view-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  document.getElementById('viewHint').textContent = view === 'month'
    ? 'Click a day to see and manage its schedule.'
    : 'Click any open slot to book an office. Click an existing booking to view or edit it.';
  refresh();
}

function setDate(dateStr) {
  state.date = dateStr;
  document.getElementById('datePicker').value = dateStr;
  refresh();
}

function setupEvents() {
  document.getElementById('prevBtn').addEventListener('click', () => shiftView(-1));
  document.getElementById('nextBtn').addEventListener('click', () => shiftView(1));
  document.getElementById('todayBtn').addEventListener('click', () => setDate(todayStr()));
  document.getElementById('datePicker').addEventListener('change', (e) => setDate(e.target.value));

  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  });

  document.getElementById('identityBtn').addEventListener('click', () => openIdentityModal());
  document.getElementById('cancelIdentityBtn').addEventListener('click', closeIdentityModal);
  document.getElementById('identityOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'identityOverlay') closeIdentityModal();
  });

  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeModal();
  });

  document.getElementById('modalRepeat').addEventListener('change', (e) => {
    const customRow = document.getElementById('repeatCustomRow');
    const untilRow = document.getElementById('repeatUntilRow');
    const untilInput = document.getElementById('modalRepeatUntil');
    if (e.target.value === 'none') {
      customRow.classList.add('hidden');
      untilRow.classList.add('hidden');
      return;
    }
    customRow.classList.toggle('hidden', e.target.value !== 'custom');
    untilRow.classList.remove('hidden');
    if (!untilInput.value) {
      const base = document.getElementById('modalDate').value || state.date;
      untilInput.value = fmtDate(addDays(parseLocalDate(base), 56)); // default to 8 weeks out
    }
  });

  document.getElementById('bookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('bookingId').value;
    const payload = {
      office_id: document.getElementById('modalOffice').value,
      date: document.getElementById('modalDate').value,
      start_time: document.getElementById('modalStart').value,
      end_time: document.getElementById('modalEnd').value,
      note: document.getElementById('modalNote').value.trim()
    };
    const errorEl = document.getElementById('modalError');
    errorEl.classList.add('hidden');

    if (!id) {
      const repeat = document.getElementById('modalRepeat').value;
      if (repeat !== 'none') {
        const intervalWeeks = repeat === 'custom'
          ? parseInt(document.getElementById('modalRepeatInterval').value, 10)
          : parseInt(repeat, 10);
        if (!Number.isInteger(intervalWeeks) || intervalWeeks < 1 || intervalWeeks > 26) {
          errorEl.textContent = 'Repeat interval must be a whole number of weeks between 1 and 26.';
          errorEl.classList.remove('hidden');
          return;
        }
        const until = document.getElementById('modalRepeatUntil').value;
        if (!until || until < payload.date) {
          errorEl.textContent = 'Pick a valid "repeat until" date on or after the start date.';
          errorEl.classList.remove('hidden');
          return;
        }
        payload.recurrence = { intervalWeeks, until };
      }
    }

    try {
      if (id) {
        await api(`/api/bookings/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else if (payload.recurrence) {
        const result = await api('/api/bookings', { method: 'POST', body: JSON.stringify(payload) });
        const total = result.created.length + result.skipped.length;
        if (result.skipped.length) {
          const details = result.skipped.map((s) => `${s.date}: ${s.reason}`).join('\n');
          alert(`Booked ${result.created.length} of ${total} occurrences.\n\nSkipped:\n${details}`);
        } else if (result.truncated) {
          alert(`Booked ${result.created.length} occurrences (stopped at the yearly limit).`);
        }
      } else {
        await api('/api/bookings', { method: 'POST', body: JSON.stringify(payload) });
      }
      closeModal();
      await refresh();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  });

  document.getElementById('deleteBookingBtn').addEventListener('click', async () => {
    const id = document.getElementById('bookingId').value;
    if (!id) return;
    if (!confirm('Remove this booking?')) return;
    try {
      await api(`/api/bookings/${id}`, { method: 'DELETE' });
      closeModal();
      await refresh();
    } catch (err) {
      const errorEl = document.getElementById('modalError');
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  });

  document.getElementById('deleteSeriesBtn').addEventListener('click', async () => {
    const id = document.getElementById('bookingId').value;
    if (!id) return;
    if (!confirm('Remove this occurrence and all future ones in this series?')) return;
    try {
      await api(`/api/bookings/${id}?scope=series`, { method: 'DELETE' });
      closeModal();
      await refresh();
    } catch (err) {
      const errorEl = document.getElementById('modalError');
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  });

  document.getElementById('addTherapistForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('newTherapistName');
    const name = input.value.trim();
    if (!name) return;
    await api('/api/therapists', { method: 'POST', body: JSON.stringify({ name }) });
    input.value = '';
    await loadStaticData();
    renderTherapists();
  });
}

async function init() {
  document.getElementById('datePicker').value = state.date;
  setupEvents();
  await Promise.all([loadStaticData(), loadMe()]);
  renderTherapists();
  await refresh();

  setInterval(refresh, 60000);
}

init();
