# The Healing Hideout — Office Scheduler

A small, purpose-built web app for coordinating the 3 shared private offices
(**Black**, **Yellow**, **Brown**) across the practice's therapists. It replaces
the clunky Office 365 workarounds with two things:

1. A **live dashboard** showing which office is occupied right now, by whom,
   and until when — plus what's coming up next.
2. A **click-to-book schedule grid** where a therapist picks a day, clicks an
   open time slot for an office, and punches in their time. Double-bookings
   are blocked automatically.

No logins, no Outlook add-ins, no shared mailboxes — just open the page.

## Running it

Requires [Node.js](https://nodejs.org) 18 or later.

```bash
npm install
npm start
```

Then open `http://localhost:3000` (or the machine's address on your office
Wi-Fi, e.g. `http://192.168.1.50:3000`, so any therapist's phone or laptop can
reach it).

Data is stored in `data/db.json`, created automatically on first run with the
three offices pre-loaded and no therapists yet — add your 4 (up to 6)
therapists from the "Therapists" panel at the bottom of the page.

### Time zone

The "Right Now" dashboard uses the server's local clock. If you deploy this
to a cloud host, set the `TZ` environment variable to your office's time
zone, e.g.:

```bash
TZ="America/New_York" npm start
```

## Deploying so everyone can reach it

Pick whichever is easiest for your practice:

- **A spare office computer or mini-PC**: run `npm start` there (e.g. with
  [pm2](https://pm2.keymetrics.io/) to keep it running, or as a startup
  task), and have everyone bookmark `http://<that-computer's-IP>:3000` on
  the office network.
- **A small always-on host** (Render, Railway, Fly.io, a $5 VPS, etc.):
  deploy this repo and run `npm start`. Since bookings are stored in a
  local file (`data/db.json`), make sure whatever host you pick gives the
  app a **persistent disk/volume** at the `data/` folder — most free
  serverless tiers wipe local files on redeploy, so avoid those unless you
  attach persistent storage.

There's no external database to set up either way — the app manages its own
data file.

## Using it day to day

- **Dashboard ("Right Now")**: at a glance, see which of the three offices
  are occupied and by whom, and when each will free up.
- **Schedule grid**: use the arrows or date picker to pick a day. Click any
  empty slot under an office column to book it — pick your name, start/end
  time, and an optional note (e.g. "client session"). Click an existing
  colored block to edit the time or delete it.
- **Therapists panel**: add a therapist once and they show up in the booking
  form from then on. "Deactivate" hides someone from the booking dropdown
  (e.g. if they leave the practice) without deleting their history from past
  schedules; "Reactivate" brings them back.

## Notes on scale

Built for a small team (4, growing to up to 6, therapists) sharing 3 rooms.
If the practice grows well beyond that or needs features like recurring
weekly bookings, client-facing booking, or multi-location support, this is a
good foundation to extend, but it intentionally keeps the current scope
simple.
