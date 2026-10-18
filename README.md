# Precious Moments

A booking and operations platform for a print, photo, and photobooth studio. Customers
request dates and follow their bookings, staff see assigned events and move the work
forward, and administrators coordinate the calendar, record payments, manage crew
accounts, and generate operational reports.

Built with plain **HTML, CSS, and JavaScript** on the front end, **Node.js / Express**
for the web API, **Python** for scheduled reporting, and **Supabase** (Postgres) for
production data.

---

## What each role can do

**Customer**

- Create an account and sign in
- Build a booking from the live price catalog: tarpaulin, signboards, shirts, mugs,
  stickers, IDs, souvenirs, invitations, photo/video coverage, and every booth
- Send the event date, time, venue, and notes; see the server-calculated estimate and
  the 50% reservation fee
- Track status, timeline, crew, and recorded payments; cancel a pending request

**Staff**

- See only the bookings assigned to them, grouped by date
- Update service progress: in progress → ready → completed, with a short note
- See client contact details; payment records stay read-only

**Administrator**

- Create, confirm, reschedule, assign crews, and close bookings
- Record deposits, balances, methods, and references; mark refunds
- Create and list crew accounts from the **Team** page
- See studio-wide stats, the "needs attention" queue, and recent activity
- Generate reports for any period and download them as CSV

Role-based access is enforced on the server for every endpoint, not just in the UI.

---

## Products and services

The catalog lives in [server/catalog.js](server/catalog.js) and is seeded into Supabase
automatically when the `pm_services` table is empty. Prices are starting rates in
Philippine pesos and can be edited in one place.

| Group             | Items                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Print & signage   | Tarpaulin (₱25/sq ft, 2×3 ft up), Panaflex signboard with/without lights, vinyl and DTF shirts, stickers, mugs, PVC IDs |
| Paper & keepsakes | ID pictures, lamination, ID lace, graphic layouts, black/color print and photocopy, ref magnets, invitations |
| Photo & booth     | Photo coverage, video coverage, 4R and strip photobooths (regular and magnetic), 360 video booth, mirror booth, studio booth, photo man |

Area-priced items (tarpaulin, signboards) are priced per square foot with a minimum
area. Everything else is priced per piece, page, hour block, or layout, with minimum
quantities where they matter (for example 20 invitations).

---

## First-time setup

```bash
npm ci
```

1. Create a Supabase project.
2. Open the SQL editor and run [supabase/schema.sql](supabase/schema.sql). The app uses
   `pm_` prefixed tables, so it can share a project with other work without collisions.
3. Create `.env` from [.env.example](.env.example) and fill in:

   ```
   PORT=3000
   NODE_ENV=development
   APP_ORIGIN=http://localhost:3000
   SESSION_SECRET=<a long random string>
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   SEED_DEMO=false
   ```

4. Create the first administrator:

   ```bash
   npm run setup -- admin@yourstudio.com "a-strong-password" "Studio Admin"
   ```

5. Start the app:

   ```bash
   npm start
   ```

Open <http://localhost:3000>. The product catalog is seeded on first start; no sample
bookings or customer accounts are created. Add crew from **Team** in the admin
dashboard, and customers register from the sign-in page.

### Environment variables

| Variable                    | Default                 | Purpose                                          |
| --------------------------- | ----------------------- | ------------------------------------------------ |
| `PORT`                      | `3000`                  | HTTP port                                        |
| `NODE_ENV`                  | `development`           | `production` enables secure cookies and HSTS     |
| `SESSION_SECRET`            | generated in `data/`    | Signs session cookies                            |
| `DATA_DIR`                  | `data`                  | Local store and generated secret                 |
| `APP_ORIGIN`                | `http://localhost:3000` | Canonical public origin                          |
| `SUPABASE_URL`              | —                       | Supabase project URL                             |
| `SUPABASE_SERVICE_ROLE_KEY` | —                       | Server-side database key                         |
| `SEED_DEMO`                 | `false`                 | Test fixtures only; never enable in production   |

Without Supabase credentials the app falls back to `data/store.json`. That mode exists
for the automated test suite and offline development; use Supabase for the real site.

---

## Accounts and access

- Customers self-register.
- Administrators create staff accounts from **Team**; there is no public staff sign-up.
- Passwords are hashed with scrypt; roles are checked on every API request.
- The service-role key stays on the server. Tables have RLS enabled with no client
  policies, so the browser can never read the database directly.

### Security notes

- Passwords are hashed with scrypt; sessions are signed, HttpOnly, SameSite=Lax cookies
  with a 7-day expiry.
- Prices, totals, discounts, and amounts are always recalculated on the server. The
  browser estimate is display only.
- Cross-site mutations are rejected using `Origin` / `Sec-Fetch-Site` checks, and JSON
  bodies are size-limited.
- Content Security Policy, `X-Frame-Options`, `X-Content-Type-Options`, and a
  permissions policy are set on every response.
- Login, registration, and account creation are rate-limited per IP.

---

## Reports

- **On demand:** open **Reports** in the admin dashboard, choose a period, and download
  the CSV.
- **Node CLI:** `npm run report -- [from to]` writes
  `reports/precious-moments-<from>-to-<to>.csv`.
- **Python CLI:** `python scripts/report.py [from to]` produces the same report using
  only the standard library. Both default to the previous calendar month.
- **Scheduled:** the [Monthly operations report](.github/workflows/monthly-report.yml)
  workflow runs the Python report on the first of each month and uploads the CSV as a
  workflow artifact. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` under
  **Settings → Secrets and variables → Actions**; the workflow skips cleanly when they
  are missing.

---

## Deploying

The repository includes a [Render blueprint](render.yaml).

1. Push the repository to GitHub.
2. In Render, choose **New → Blueprint** and select the repository. Render reads
   `render.yaml` and creates a Node web service with a health check at `/api/health`.
3. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `APP_ORIGIN` (the public Render
   URL) in the service's environment. `SESSION_SECRET` is generated by Render.
4. Deploy. The first request seeds the service catalog if needed.

Any Node host works (Render, Railway, Fly.io, or a VPS) with `npm ci` as the build and
`npm start` as the start command. Use Supabase for storage so records survive restarts.

The [CI workflow](.github/workflows/ci.yml) runs the smoke test and compiles the Python
reporter on every push and pull request.

---

## Tech and layout

```
server.js                 Express entrypoint
server/app.js             REST API, sessions, RBAC, pricing, reports
server/store.js           Supabase (pm_ tables) or local JSON data layer
server/seed.js            Catalog seed and test fixtures
server/catalog.js         Products, services, and pricing rules
server/security.js        scrypt passwords, signed session cookies
server/reports.js         Node report builder
supabase/schema.sql       Postgres tables, constraints, indexes, RLS
public/                   Landing page, auth page, dashboards, styles, JS
scripts/bootstrap.mjs     First administrator
scripts/report.mjs        Node report CLI
scripts/report.py         Python report CLI
scripts/smoke.mjs         API and RBAC smoke test
render.yaml               Render deployment blueprint
```

### API

All mutating requests must come from the same origin and carry the session cookie.
JSON bodies only.

| Method | Path                          | Access            | Purpose                                  |
| ------ | ----------------------------- | ----------------- | ---------------------------------------- |
| POST   | `/api/auth/register`          | public            | Create a customer account                |
| POST   | `/api/auth/login`             | public            | Sign in                                  |
| POST   | `/api/auth/logout`            | session           | Sign out                                 |
| GET    | `/api/auth/me`                | session           | Current user                             |
| GET    | `/api/services`               | public            | Catalog and categories                   |
| GET    | `/api/bookings`               | session           | Role-scoped booking list                 |
| POST   | `/api/bookings`               | customer, admin   | Create a booking (re-priced server-side) |
| GET    | `/api/bookings/:id`           | session, scoped   | One booking with items and timeline      |
| PATCH  | `/api/bookings/:id`           | session, scoped   | Customer cancel, staff progress, admin edits |
| PATCH  | `/api/bookings/:id/payment`   | admin             | Record or correct a payment              |
| GET    | `/api/staff`                  | admin             | Crew list for assignment                 |
| POST   | `/api/staff`                  | admin             | Create a staff account                   |
| GET    | `/api/reports`                | admin             | JSON operations report for a period      |
| GET    | `/api/reports.csv`            | admin             | CSV export of the same report            |
| GET    | `/api/health`                 | public            | Liveness and store mode                  |

---

## Testing

```bash
npm test
python -m py_compile scripts/report.py
```

The smoke test starts an isolated server on a temporary data directory, seeds local
fixtures, and checks public pages, registration, login, server-side pricing, every role
boundary, crew creation, payment recording, cross-origin protection, reports, and CSV
export. It exits non-zero on the first failure and leaves production data untouched.

---

## Known limits

- Payments are recorded, not collected: there is no payment gateway, receipt upload, or
  automatic email/SMS notification.
- Availability is coordinated by the studio rather than an automatic conflict checker,
  which matches how a small shop actually books dates.
- Reports are CSV only. Scheduled delivery is a GitHub Actions artifact, not email.
- Photographs on the landing and sign-in pages are from Unsplash, and contact details
  such as `hello@preciousmoments.ph` are placeholders. Prices are illustrative starting
  rates for a Philippine print and events studio.
