const START_MIN = 7 * 60; // 7:00 AM
const END_MIN = 21 * 60; // 9:00 PM
const STEP = 30; // minutes per row

const state = {
  offices: [],
  therapists: [],
  bookings: [],
  date: todayStr()
};

function pad(n) { return String(n).padStart(2, '0'); }

function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

function slotList() {
  const slots = [];
  for (let m = START_MIN; m < END_MIN; m += STEP) slots.push(m);
  return slots;
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

async function loadBookings() {
  state.bookings = await api(`/api/bookings?date=${state.date}`);
}

async function loadStatus() {
  const status = await api('/api/status');
  renderStatus(status.offices);
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

function formatTimeLabel(val) {
  return minutesToLabel(timeValueToMinutes(val));
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
      renderTherapistOptions();
    });

    chip.append(dot, name, toggle);
    el.appendChild(chip);
  });
}

function renderTherapistOptions() {
  const select = document.getElementById('modalTherapist');
  select.innerHTML = '';
  state.therapists
    .filter((t) => t.active)
    .forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      select.appendChild(opt);
    });
}

// ---- Rendering: schedule grid ----
function renderGrid() {
  const wrapper = document.getElementById('gridWrapper');
  wrapper.innerHTML = '';

  const slots = slotList();
  const grid = document.createElement('div');
  grid.className = 'schedule-grid';
  grid.style.gridTemplateColumns = `70px repeat(${state.offices.length}, 1fr)`;
  grid.style.gridTemplateRows = `40px repeat(${slots.length}, 32px)`;

  // header row
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

  // build a lookup of covered slots per office so multi-slot bookings render as one block
  const bookingsByOffice = {};
  state.offices.forEach((o) => { bookingsByOffice[o.id] = []; });
  state.bookings.forEach((b) => {
    if (bookingsByOffice[b.office_id]) bookingsByOffice[b.office_id].push(b);
  });

  const coveredUntil = {};
  state.offices.forEach((o) => { coveredUntil[o.id] = -1; });

  slots.forEach((slotMin, rowIdx) => {
    const gridRow = rowIdx + 2; // +1 for header row, +1 for 1-index
    const isHour = slotMin % 60 === 0;

    const timeLabel = document.createElement('div');
    timeLabel.className = 'time-label' + (isHour ? ' hour-mark' : '');
    timeLabel.style.gridRow = String(gridRow);
    timeLabel.style.gridColumn = '1';
    timeLabel.textContent = isHour ? minutesToLabel(slotMin) : '';
    grid.appendChild(timeLabel);

    state.offices.forEach((office, colIdx) => {
      const gridCol = colIdx + 2;

      if (slotMin < coveredUntil[office.id]) return; // covered by a booking block already placed

      const booking = bookingsByOffice[office.id].find(
        (b) => timeValueToMinutes(b.start_time) === slotMin
      );

      if (booking) {
        const startMin = timeValueToMinutes(booking.start_time);
        const endMin = Math.min(timeValueToMinutes(booking.end_time), END_MIN);
        const span = Math.max(1, Math.round((endMin - startMin) / STEP));
        coveredUntil[office.id] = startMin + span * STEP;

        const block = document.createElement('div');
        block.className = 'booking-block';
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
        cell.addEventListener('click', () => openModal({ officeId: office.id, startMin: slotMin }));
        grid.appendChild(cell);
      }
    });
  });

  wrapper.appendChild(grid);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Modal ----
function populateTimeSelects(startMin) {
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
}

function openModal({ officeId, startMin, booking } = {}) {
  const overlay = document.getElementById('modalOverlay');
  const title = document.getElementById('modalTitle');
  const officeSelect = document.getElementById('modalOffice');
  const noteInput = document.getElementById('modalNote');
  const idInput = document.getElementById('bookingId');
  const deleteBtn = document.getElementById('deleteBookingBtn');
  const errorEl = document.getElementById('modalError');

  errorEl.classList.add('hidden');
  renderTherapistOptions();

  officeSelect.innerHTML = '';
  state.offices.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.name;
    officeSelect.appendChild(opt);
  });

  if (booking) {
    title.textContent = 'Edit Booking';
    idInput.value = booking.id;
    officeSelect.value = booking.office_id;
    populateTimeSelects(timeValueToMinutes(booking.start_time));
    document.getElementById('modalStart').value = booking.start_time;
    document.getElementById('modalEnd').value = booking.end_time;
    document.getElementById('modalTherapist').value = booking.therapist_id;
    noteInput.value = booking.note || '';
    deleteBtn.classList.remove('hidden');
  } else {
    title.textContent = 'Book an Office';
    idInput.value = '';
    officeSelect.value = officeId;
    populateTimeSelects(startMin);
    noteInput.value = '';
    deleteBtn.classList.add('hidden');
  }

  overlay.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
}

async function refresh() {
  await loadBookings();
  renderGrid();
  await loadStatus();
}

function setupEvents() {
  document.getElementById('prevDay').addEventListener('click', () => shiftDate(-1));
  document.getElementById('nextDay').addEventListener('click', () => shiftDate(1));
  document.getElementById('todayBtn').addEventListener('click', () => setDate(todayStr()));
  document.getElementById('datePicker').addEventListener('change', (e) => setDate(e.target.value));

  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeModal();
  });

  document.getElementById('bookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('bookingId').value;
    const payload = {
      office_id: document.getElementById('modalOffice').value,
      therapist_id: document.getElementById('modalTherapist').value,
      date: state.date,
      start_time: document.getElementById('modalStart').value,
      end_time: document.getElementById('modalEnd').value,
      note: document.getElementById('modalNote').value.trim()
    };
    const errorEl = document.getElementById('modalError');
    errorEl.classList.add('hidden');
    try {
      if (id) {
        await api(`/api/bookings/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
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
    await api(`/api/bookings/${id}`, { method: 'DELETE' });
    closeModal();
    await refresh();
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

function shiftDate(days) {
  const d = new Date(state.date + 'T00:00:00');
  d.setDate(d.getDate() + days);
  setDate(todayStr(d));
}

function setDate(dateStr) {
  state.date = dateStr;
  document.getElementById('datePicker').value = dateStr;
  refresh();
}

async function init() {
  document.getElementById('datePicker').value = state.date;
  setupEvents();
  await loadStaticData();
  renderTherapists();
  await refresh();

  // keep the dashboard live without requiring a manual refresh
  setInterval(loadStatus, 60000);
  setInterval(() => { if (state.date === todayStr()) loadBookings().then(renderGrid); }, 60000);
}

init();
