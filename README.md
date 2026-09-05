# The Healing Hideout — Office Scheduler

A small, purpose-built web app for coordinating the 3 shared private offices
(**Black**, **Yellow**, **Brown**) across the practice's therapists. It replaces
the clunky Office 365 workarounds with two things:

1. A **live dashboard** showing which office is occupied right now, by whom,
   and until when — plus what's coming up next.
2. A **click-to-book schedule grid**, with Day/Week/Month views, where a
   therapist picks a slot and punches in their time. Double-bookings are
   blocked automatically.
3. Lightweight **sign-in**, so a therapist can only edit or delete their own
   bookings — everyone else's show up read-only.

No passwords, no Outlook add-ins, no shared mailboxes — just open the page.

## Running it

Requires [Node.js](https://nodejs.org) 18 or later.

```bash
npm install
npm start
```

Then open `http://localhost:3000` (or the machine's address on your office
Wi-Fi, e.g. `http://192.168.1.50:3000`, so any therapist's phone or laptop can
reach it).

Data is stored in `storage/db.json`, created automatically on first run with
the three offices pre-loaded and no therapists yet — add your 4 (up to 6)
therapists from the "Therapists" panel at the bottom of the page. The
`storage/` folder is separate from the application code on purpose (see
below), and is git-ignored.

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
  local file (`storage/db.json`), make sure whatever host you pick gives the
  app a **persistent disk/volume mounted at `storage/`** — most free
  serverless tiers wipe local files on redeploy, so avoid those unless you
  attach persistent storage.

There's no external database to set up either way — the app manages its own
data file.

### Railway specifically

If you're deploying on Railway: attach the volume (right-click the service
tile → **Attach Volume**, or its **⋯** menu) with mount path **`/app/storage`**
— not `/app/data`. `data/` holds this app's source code (`data/store.js`);
mounting a volume there would replace that whole folder with the empty
volume on every deploy and delete the code, crashing the app with
`Cannot find module './data/store'`. `storage/` only ever holds the runtime
`db.json` and session secret, so it's safe to mount a volume there.

If "Attach Volume" doesn't show up in that menu, it's usually because
volumes require a paid Hobby plan (or a payment method on file) rather than
a bare free trial — check **Settings → Billing**.

## Using it day to day

- **Dashboard ("Right Now")**: at a glance, see which of the three offices
  are occupied and by whom, and when each will free up.
- **Sign in**: click "Sign in" top-right and pick your name once per device
  (phone, laptop, the office computer). No password — this is a small
  trusted-team convenience, not a security login; it exists so the app knows
  whose booking is whose.
- **Day / Week / Month views**: switch with the tabs above the schedule.
  - *Day* is the click-to-book time grid.
  - *Week* lists each office's bookings per day with a "+ Add" button per
    cell.
  - *Month* is an overview — click a day to jump into its Day view.
- **Booking**: click any open slot (Day/Week) to book — it's automatically
  attributed to whoever is signed in. Click an existing booking to view it;
  if it's yours you can edit the time/office/note or delete it, if it's a
  colleague's you'll see the details read-only.
- **Therapists panel**: add a therapist once; they then appear in the sign-in
  list. "Deactivate" hides someone from sign-in (e.g. if they leave the
  practice) without deleting their history from past schedules; "Reactivate"
  brings them back.

## Branding

The header links to [www.healing-hideout.com](https://www.healing-hideout.com)
and is styled with the practice's olive-green/gold palette. To show the actual
logo (rather than just the text wordmark), export it as a PNG with a
transparent background and save it as `public/logo.png` — the header is
already wired to display it at that path, no code changes needed.

## Notes on scale

Built for a small team (4, growing to up to 6, therapists) sharing 3 rooms.
If the practice grows well beyond that or needs features like recurring
weekly bookings, client-facing booking, or multi-location support, this is a
good foundation to extend, but it intentionally keeps the current scope
simple.
