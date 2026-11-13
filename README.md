# Precious Moments

A booking and operations platform for a print, photo, and photobooth studio. Customers
request dates and follow their bookings, the owner and two branch heads run the calendar
and the counter, and crew are assignment records rather than login accounts.

The public catalog is a **React 18 + Vite** storefront mounted at `/shop`. The existing
operations dashboard remains the original **HTML, CSS, and JavaScript** app at `/app`,
so every existing workflow is preserved. The API is **Node.js / Express**, scheduled
reporting is **Python**, and production data and product images live in **Supabase**
(Postgres and Storage).

---

## What each role can do

**Customer**

- Browse the public catalog at `/shop` without an account, with search, category
  filters, product previews, and a cart saved on the device
- Add products and booths as a guest; create an account or sign in only when ready to
  confirm the booking, with the cart preserved across that handoff
- Build a booking from the live price catalog: tarpaulin, signboards, shirts, mugs,
  stickers, IDs, souvenirs, invitations, photo/video coverage, and every booth
- Choose **Event** or **Pickup** and see only the fields that belong to that type
- See the server-calculated subtotal, any assigned discount, the total, and the 50%
  reservation fee
- Track status, timeline, crew, and recorded payments; cancel a pending request

**Crew (records, no sign-in)**

- Added by the owner or a branch head as an assignable person
- No password is issued and there is no crew login page
- Their name, branch, phone, and active state are stored for assignment and reports

**Branch head** (one account per branch)

- Only ever see their own branch's bookings, payments, and crew — enforced on the server
- Confirm dates, assign crew from their branch, and move bookings through the statuses
- Create crew records for their branch
- Get an alert for every new booking routed to their branch
- Change their own password and turn on two-factor authentication

**Owner**

- Everything both branch heads can do, across both branches
- Resolve bookings flagged for branch review by assigning the branch
- Create, deactivate, and reset the owner/branch-head accounts from **Team**
- Assign customer discounts from **Discounts**
- See studio-wide stats, the "needs attention" queue, and recent activity
- Generate reports for any period and download them as CSV

Role-based access is enforced on the server for every endpoint, not just in the UI.

---

## Booking types

The booking form switches between two shapes, and the server enforces the difference.

| Pickup | Event |
| --- | --- |
| Pickup branch (Batangas or Bauan) | Event venue and full service address |
| Pickup date and optional time | Event date and start time |
| Printing normally ready in 1–2 days | Duration, 1–12 hours |
| No event address, venue, or duration | Optional assigned branch; otherwise nearest to the address |
| Does not consume a booth slot | Booth/coverage services do consume a slot |

Both types store `booking_type` on the booking. A pickup stores `pickup_date` and
`pickup_time`; an event stores `event_date`, `event_time`, and `duration_hours`. The
drawer shows only the matching fields, and the admin form edits only those fields.

---

## Five simultaneous services, not five bookings a day

Each branch can run at most **five booth or crew services at the same time**
(`MAX_SIMULTANEOUS_SERVICES`). A booking's window is its start time plus its duration.

- A window with five overlapping booths is full; a sixth request is rejected with the
  next open start on that date (for example `12:00 PM`).
- Later time windows on the same day stay bookable.
- Print-only work (tarpaulin, shirts, mugs, invitations) does not take a booth slot.
- Pending, confirmed, in-progress, and ready bookings all hold a slot; cancelled and
  completed bookings do not.
- Changing a booking's date, time, duration, branch, or reactivating its status re-runs
  the same check on the server.
- `GET /api/availability` exposes the same calculation to the booking form.

---

## Two branches, manual choice, and automatic routing

There are two registered branches in `pm_branches`, each with its own coordinates:

| Branch | Location | Coordinates |
| ------ | -------- | ----------- |
| Batangas City | P. Burgos Street, Barangay 12, Pallocan Kanluran, Batangas City 4200 | 13.7606916, 121.0573095 |
| Bauan | Poblacion 4, New Danglayan, Bauan, Batangas 4201 | 13.7923305, 121.0103575 |

For a pickup booking the customer chooses the branch. The booking form can use the
browser's location to **suggest** the nearer branch, but a manual selection is kept and
always wins. For an event booking:

1. the request is validated, including the event address;
2. if the customer chose a branch, that branch is used;
3. otherwise the address is geocoded (Nominatim by default — no key needed) and the
   nearest branch is assigned;
4. the branch is stored on the booking so it stays put when viewed or updated later;
5. that branch's head is notified.

If no branch was chosen and the address cannot be geocoded, or the two branches are
within `BRANCH_TIE_KM` of each other, the booking is stored with `needs_review` and no
branch: both branch heads are locked out and the owner gets the notification, then
assigns the branch from the booking drawer.

---

## Products and services

The catalog lives in [server/catalog.js](server/catalog.js) and is seeded into Supabase
automatically when the `pm_services` table is empty. On later startups the app inserts
only products that are missing, so a newly released item reaches an existing database
without overwriting prices or owner edits. It holds the 2026 price sheet in Philippine
pesos: 137 services in ten public categories, quantity price breaks, a separate
admin-only client rate list, and measurement-priced Tarpaulin and Blackout.

| Category | Examples |
| --- | --- |
| Stickers and Decals | pre-cut and print-only stickers, 3M, decals, cut stickers |
| Souvenirs and Personalized Items | ref magnets, mugs, key holders, totes, fans, puzzles |
| Photo Printing and Frames | 2R–16×20 prints, sintra boards, frames with and without pictures |
| Invitations and Printing | 3R/4R/5R invitations, passport invites, button pins, bond pads |
| Business Cards and IDs | calling cards, PVC IDs, vellum, laces, lanyard packages |
| Plates and Sintra | temporary and motorcycle plates, standees, stands |
| T-shirt and Apparel Printing | shirt prints by brand and size run |
| Tarpaulin and Signage | measured Tarpaulin and Blackout, roll-ups, X-banners, panaflex |
| Photography and Videography | coverage, prenup, photoman, and the existing booth packages |
| Albums and Other Services | albums, 12R prints, laminate, SDE, LED wall, frames |

Area-priced items (Tarpaulin, Blackout, panaflex, 3M, frosted sticker, decals) use a
measured length × height with a minimum billable area. Tarpaulin is ₱20/sq ft and
Blackout is ₱30/sq ft, each with its own configuration. Decimal sides are rounded up
individually before billing: 2.3 × 5 ft becomes 3 × 5 = 15 sq ft, while the customer's
original 2.3 and 5 are still stored on the order. Fixed items use a unit price, an
optional hard minimum, and `tiers` where the sheet has quantity breaks (for example a
ref magnet at ₱35 below 30 pieces and ₱30 from 30 pieces). A quantity that falls in a
published gap, such as 51–99 key holders, is refused with a quote request instead of
being guessed.

The customer catalog is image-first: cards show a photo, name, starting rate, a short
description, and View details / Select actions. Double-clicking a photo opens the
full image; Escape or the close button returns to the catalog. The previous standard
tarp sizes remain intact in the database for existing orders but are hidden from the
new-booking catalog by the measured Tarpaulin product.

**Product images.** Main Admin and Branch Admin share one Product images screen. Either
role can upload, preview, replace, or remove a product image for any product. Files are
validated as JPG, PNG, or WEBP by magic bytes and dimensions (minimum 300 × 300, maximum
4 MB), saved under a unique name to Supabase Storage in production (local disk in
development), and audited with the actor and timestamp. The old
image stays live until the replacement database write succeeds. Removing an image hides
that product from the customer catalog. New products start hidden until an image is
uploaded. Existing catalog rows predate the image requirement and remain visible during
the photo migration; they are flagged **Image needed** on the Pricing and Product images
screens and should be photographed before launch.

The owner edits retail prices from **Pricing** in the dashboard; the changes apply to
the marketing rate card, booking form, checkout, assistant, and all new bookings. The
client-specific tarpaulin and standee rates are stored separately (`CLIENT_PRICES`),
shown on the same page, and never overwrite a retail price. Existing bookings keep the
name and price they were booked at. When the catalog source changes, run
`npm run sync:prices`: it updates rows by id, inserts new ones, deactivates removed
ones, and never deletes a record or rewrites a booking. Owner-edited rows and custom
products are preserved on later syncs, and each service stores its own booking
availability (pickup, event, both, or unassigned).

---

## Customer discounts

- The owner assigns a percentage or fixed-amount discount to a customer account from
  **Discounts**, using the customer's email.
- A customer can have one active discount. Re-saving replaces it; **Deactivate** stops it.
- The discount is applied by the server when the booking is created, stored as
  `discount_label` and `discount_amount`, and subtracted from `subtotal` to produce
  `total`. The cart, booking drawer, payment screen, and reports use that total.
- Only the owner can read the full discount list; branch heads are refused. A customer
  can only read their own active discount (`/api/discounts/mine`).

---

## Assistant scope

The dashboard's **Ask the studio** panel answers questions only from this system:

- live service names, units, and starting prices;
- the two branch records and studio hours;
- the studio's own policies (50% reservation, payment methods, 1–2 day pickup, 2–5 day
  print work, travel fee, one free move when made at least 7 days ahead);
- the five-simultaneous-service rule;
- the signed-in customer's own bookings and balance, or the active bookings in a branch
  head/owner's scope;
- the customer's active discount.

Anything outside that set returns exactly:

> Out of scope. Please ask another question.

There is no external model call, so it cannot invent a price, a policy, or an answer.

---

## Entry points

| URL | What it does |
| --- | --- |
| `/` | Signed out: redirects to the public `/shop` catalog. Signed in: `/app` |
| `/shop` | React public catalog, cart, account gate, and booking request |
| `/login` | Sign-up is the default tab; `?mode=login` opens sign-in |
| `/welcome` | The public marketing page and rate card |
| `/app` | Customer, branch head, and owner dashboard (sign-in required) |

Crew cannot sign in. The sign-in page says so, and the server refuses any staff-role
login with a clear message.

---

## First-time setup

```bash
npm ci
```

1. Create a Supabase project.
2. Open the SQL editor and **paste the contents** of
   [supabase/schema.sql](supabase/schema.sql) — the file path itself is not SQL. The app
   uses `pm_` prefixed tables, so it can share a project with other work without
   collisions. On an existing project, paste the contents of
   [supabase/migrate-branches.sql](supabase/migrate-branches.sql), then
   [supabase/migrate-features.sql](supabase/migrate-features.sql), and then
   [supabase/migrate-pricing.sql](supabase/migrate-pricing.sql), and finally
   [supabase/migrate-booking-availability.sql](supabase/migrate-booking-availability.sql),
   and then [supabase/migrate-catalog-images-auth.sql](supabase/migrate-catalog-images-auth.sql)
   instead.
3. Create `.env` from [.env.example](.env.example) and fill in:

   ```
   PORT=3000
   NODE_ENV=development
   APP_ORIGIN=http://localhost:3000
   SESSION_SECRET=<a long random string>
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   SUPABASE_STORAGE_BUCKET=product-images
   SEED_DEMO=false
   ```

4. Create the two branch administrator accounts (generates the passwords and writes
   them to `data/branch-admins.txt`, which is git-ignored — read them from there):

   ```bash
   npm run setup:branches
   ```

   To also reset the studio owner password, add `-- --reset-owner`.

5. Start the app:

   ```bash
   npm start
   ```

Build the storefront once (or after changing files under `client/`):

```bash
npm run build:shop
```

Then open <http://localhost:3000>. That lands on the public catalog at `/shop`. The
rate card and marketing page are at `/welcome`; sign-up and sign-in are at `/login`.
The product catalog is seeded on first start and newly released products are added on
later starts; no sample bookings or customer accounts are created.

### Environment variables

| Variable                    | Default                 | Purpose                                          |
| --------------------------- | ----------------------- | ------------------------------------------------ |
| `PORT`                      | `3000`                  | HTTP port                                        |
| `NODE_ENV`                  | `development`           | `production` enables secure cookies and HSTS     |
| `SESSION_SECRET`            | generated in `data/`    | Signs cookies and encrypts stored TOTP secrets   |
| `DATA_DIR`                  | `data`                  | Local store and generated secret                 |
| `APP_ORIGIN`                | `http://localhost:3000` | Canonical public origin                          |
| `SUPABASE_URL`              | —                       | Supabase project URL                             |
| `SUPABASE_SERVICE_ROLE_KEY` | —                       | Server-side database key                         |
| `SUPABASE_STORAGE_BUCKET`   | `product-images`        | Public Storage bucket for product images; required in production |
| `TRUST_PROXY`               | `0`                     | Set to `1` behind one trusted proxy (Render)     |
| `SEED_DEMO`                 | `false`                 | Test fixtures only; never enable in production   |
| `GEOCODER_URL`              | Nominatim search URL    | Address → coordinates service                     |
| `GEOCODER_ENABLED`          | `true`                  | Set `false` to force routed events into review    |
| `BRANCH_TIE_KM`             | `0.25`                  | Branches closer than this send a booking to review |
| `MAX_SIMULTANEOUS_SERVICES` | `5`                     | Booth/crew services allowed in one time window   |
| `UPLOAD_DIR`                | `public/uploads/products` | Local image fallback when Supabase Storage is not configured |
| `PASSWORD_RESET_TTL_MINUTES` | `30`                   | Lifetime of a single-use reset link              |
| `RESEND_API_KEY`            | —                       | Sends password-reset email through Resend        |
| `MAIL_FROM`                 | `Precious Moments <no-reply@preciousmoments.ph>` | Verified sender for reset email |
| `BRANCH1_ADMIN_EMAIL`       | `batangas@precious.ph`  | Email used by `setup:branches` for branch 1       |
| `BRANCH2_ADMIN_EMAIL`       | `bauan@precious.ph`     | Email used by `setup:branches` for branch 2       |

Without Supabase credentials the app falls back to `data/store.json`. That mode exists
for the automated test suite and offline development; use Supabase for the real site.

---

## Accounts and access

- Customers self-register.
- Only three kinds of login exist: **customer**, **branch head** (`branch_admin`), and
  **owner** (`admin`).
- The owner creates branch-head accounts from **Team → Studio accounts**, and can
  deactivate, reactivate, or reset them. Resetting returns a one-time temporary password,
  clears two-factor, and flags the account to choose a new password.
- Branch heads and the owner add **crew records** from Team. Crew have no password and
  no login; they exist so a booking can be assigned and reported on.
- Deactivating an account takes effect on its next request, not only its next sign-in.
- Passwords are hashed with scrypt; roles are checked on every API request.
- The service-role key stays on the server. Tables have RLS enabled with no client
  policies, so the browser can never read the database directly.

### Password and two-factor security

- Passwords must be at least 10 characters and include an uppercase letter, a lowercase
  letter, a number, and a symbol. The same rule and message are used on the server and in
  the browser.
- Passwords are never stored or displayed in plain text; scrypt hashes are the only value
  kept.
- Any signed-in account can change its password from **Account & security** by supplying
  the current one.
- If a password is forgotten, any customer, branch head, or owner can use **Forgot your
  password?** on the sign-in page. The backend always returns the same message so it
  cannot be used to discover registered emails. A 32-byte random token is stored only as
  an HMAC hash, expires after `PASSWORD_RESET_TTL_MINUTES` (30 by default), can be used
  once, and is checked again when the new password is saved. A successful reset revokes
  every existing session for that account and writes request/failure/completion entries
  to the audit log without storing passwords or tokens.
- Password-reset email is sent through Resend's HTTPS API when `RESEND_API_KEY` is set.
  In development without a key, the link is printed to the server console so the flow
  can be exercised; production requires the key and `MAIL_FROM`.
- Any account can enroll a TOTP authenticator app (Google Authenticator, Authy, 1Password,
  etc.). After enrollment, sign-in requires the 6-digit code, which is verified before a
  session cookie is issued. The challenge cookie lives five minutes and cannot act as a
  session.
- TOTP secrets are encrypted at rest with AES-256-GCM using a key derived from
  `SESSION_SECRET`; a database dump does not expose usable factors. Legacy plaintext
  factors are upgraded on the next successful sign-in. Rotating `SESSION_SECRET`
  invalidates existing factors, so those accounts need a 2FA reset.
- The owner can clear a lost authenticator from **Team** (account reset) or from the
  customer's booking drawer (**Reset 2FA**). The narrow reset clears only the factor,
  keeps the password, and revokes existing sessions.

Other security notes:

- Sessions are signed, HttpOnly, SameSite=Lax cookies with a 7-day expiry.
- Prices, totals, discounts, capacity, and amounts are always recalculated on the server.
  The browser estimate is display only.
- Cross-site mutations are rejected using `Origin` / `Sec-Fetch-Site` checks, and JSON
  bodies are size-limited.
- Content Security Policy, `X-Frame-Options`, `X-Content-Type-Options`, and a permissions
  policy are set on every response. Geolocation is allowed for this origin only, to
  suggest a pickup branch.
- Login, registration, and account creation are rate-limited per IP.

---

## Reports

- **On demand:** open **Reports** in the owner dashboard, choose a period, and download
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
   `render.yaml` and creates a Node web service with a health check at `/api/ready` (liveness is `/api/health`).
3. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`,
   `APP_ORIGIN` (the public Render URL), `RESEND_API_KEY`, and `MAIL_FROM` (a sender on
   a domain verified in Resend) in the service's environment. `SESSION_SECRET` is
   generated by Render, and `TRUST_PROXY=1` is set in the blueprint. Production refuses
   to start if a required variable is missing.
4. Deploy. The first request seeds the service catalog if needed, and later releases
   add new products without changing existing rows.

Without `RESEND_API_KEY`, the reset form still returns its generic success message
(so it cannot be used to discover accounts) but no email is delivered. Set the key
and a verified sender before relying on self-service recovery in production.

Any Node host works (Render, Railway, Fly.io, or a VPS). The build command is
`npm ci && npm run build:shop`; the start command is `npm start`. Use Supabase for
storage so records survive restarts. `render.yaml` already uses that build command.

The [CI workflow](.github/workflows/ci.yml) runs the smoke test and compiles the Python
reporter on every push and pull request.

---

## Tech and layout

For a file-by-file map — what each module owns, how a request travels, and
where to add a feature — see [docs/PROJECT-STRUCTURE.md](docs/PROJECT-STRUCTURE.md).

```
server.js                 Express entrypoint
server/app.js             REST API, sessions, RBAC, booking types, discounts, reports
server/availability.js    Five-simultaneous-service capacity and next free slot
server/assistant.js       Grounded, scoped answers from system data only
server/geo.js             Address geocoding and nearest-branch assignment
server/store.js           Supabase (pm_ tables) or local JSON data layer
server/seed.js            Catalog seed and test fixtures
server/catalog.js         Products, services, and pricing rules
server/security.js        scrypt, password policy, sessions, TOTP, secret encryption
server/images.js          Product-image validation and Supabase Storage (local fallback)
server/mail.js            Password-reset email (Resend or dev console)
server/reports.js         Node report builder
client/                   React storefront source (catalog, cart, auth gate, checkout)
public/shop/              Vite production build served at /shop
supabase/schema.sql       Postgres tables, constraints, indexes, RLS
supabase/migrate-branches.sql  Two-branch migration for an existing project
supabase/migrate-features.sql  Booking types, discounts, accounts, MFA migration
supabase/migrate-pricing.sql   Quantity breaks, setup fees, capacity, and review flags
supabase/migrate-booking-availability.sql  Booking availability and product-management fields
supabase/migrate-catalog-images-auth.sql  Images, measured pricing, resets, and audit logs
public/                   Marketing page, auth page, dashboards, styles, JS
scripts/bootstrap.mjs     First administrator
scripts/setup-branches.mjs  The two branch administrator accounts
scripts/report.mjs        Node report CLI
scripts/report.py         Python report CLI
scripts/smoke.mjs         API, auth, capacity, discount, and RBAC smoke test
render.yaml               Render deployment blueprint
```

### API

All mutating requests must come from the same origin and carry the session cookie when
they act on a signed-in record. JSON is used except for product-image uploads, which
send the raw image bytes with an `image/jpeg`, `image/png`, or `image/webp` content type.

| Method | Path                          | Access            | Purpose                                  |
| ------ | ----------------------------- | ----------------- | ---------------------------------------- |
| POST   | `/api/auth/register`          | public            | Create a customer account                |
| POST   | `/api/auth/login`             | public            | Sign in (may return `mfa_required`)      |
| POST   | `/api/auth/mfa`               | MFA challenge     | Finish sign-in with a 6-digit code       |
| POST   | `/api/auth/logout`            | session           | Sign out                                 |
| GET    | `/api/auth/me`                | session           | Current user and security flags          |
| POST   | `/api/auth/password`          | session           | Change password with the current one     |
| POST   | `/api/auth/forgot-password`   | public            | Request a single-use reset link (generic response) |
| POST   | `/api/auth/reset-password/validate` | public      | Check whether a reset link is still usable |
| POST   | `/api/auth/reset-password`    | public            | Consume a reset link and set a new password |
| POST   | `/api/auth/mfa/setup`         | session           | Start TOTP enrollment                    |
| POST   | `/api/auth/mfa/enable`        | session           | Confirm TOTP with a code                 |
| POST   | `/api/auth/mfa/disable`       | session           | Turn two-factor off with the password    |
| GET    | `/api/services`               | public            | Catalog and categories                   |
| GET    | `/api/pricing`                | admin             | Retail services, client rates, review flags |
| PATCH  | `/api/services/:id`           | admin             | Update a price, measurement rule, or confirmation flag |
| GET    | `/api/product-images`         | admin, branch admin | Shared catalog image console and recent changes |
| POST   | `/api/services/:id/image`     | admin, branch admin | Upload or replace a validated product image |
| DELETE | `/api/services/:id/image`     | admin, branch admin | Remove an image and hide the product |
| GET    | `/api/audit-logs`             | admin             | Recent auth, booking, payment, account, MFA, and image audit entries |
| GET    | `/api/bookings`               | session           | Role-scoped booking list                 |
| POST   | `/api/bookings`               | customer, admin   | Create an event or pickup booking        |
| GET    | `/api/bookings/:id`           | session, scoped   | One booking with items and timeline      |
| PATCH  | `/api/bookings/:id`           | session, scoped   | Customer cancel, staff progress, admin edits |
| PATCH  | `/api/bookings/:id/payment`   | admin, branch admin | Record or correct a payment            |
| GET    | `/api/availability`           | session           | Capacity and next open start for a window |
| GET    | `/api/branches`               | session           | The registered branch locations          |
| GET    | `/api/notifications`          | session           | Your booking alerts and unread count     |
| POST   | `/api/notifications/read`     | session           | Mark your alerts read                    |
| GET    | `/api/accounts`               | admin             | Owner and branch-head accounts           |
| POST   | `/api/accounts`               | admin             | Create an owner/branch-head account      |
| PATCH  | `/api/accounts/:id`           | admin             | Rename, move, activate, deactivate       |
| POST   | `/api/accounts/:id/reset`     | admin             | One-time password and MFA reset          |
| POST   | `/api/accounts/:id/mfa-reset` | admin             | Clear only a lost second factor          |
| GET    | `/api/staff`                  | admin, branch admin | Crew records (scoped to the branch)    |
| POST   | `/api/staff`                  | admin, branch admin | Create a crew record (no login)        |
| PATCH  | `/api/staff/:id`              | admin, branch admin | Rename, re-branch, activate, deactivate |
| GET    | `/api/discounts`              | admin             | All assigned discounts                   |
| POST   | `/api/discounts`              | admin             | Assign or replace a customer discount    |
| PATCH  | `/api/discounts/:id`          | admin             | Change value/note or activate/deactivate |
| GET    | `/api/discounts/mine`         | customer          | The customer's own active discount       |
| POST   | `/api/assistant`              | session           | Scoped answer from system data           |
| GET    | `/api/reports`                | admin             | JSON operations report for a period      |
| GET    | `/api/reports.csv`            | admin             | CSV export of the same report            |
| GET    | `/api/health`                 | public            | Liveness and store mode                  |
| GET    | `/api/ready`                  | public            | Readiness: proves the data store answers  |

---

## Testing

```bash
npm test
python -m py_compile scripts/report.py
```

The smoke test starts an isolated server on a temporary data directory, seeds local
fixtures, and checks public pages, the recovery entry point, the password policy, strong
registration, decimal measurement rounding and tamper rejection, event and pickup
bookings, manual branch priority, geocoded routing, review fallback, the
five-simultaneous-service limit and next open slot (including parallel requests with
unique references), encrypted two-factor secrets, audit coverage for sign-in, bookings,
payments, accounts, and MFA, print-only exemption, crew login
refusal, crew records, studio account creation/deactivation/reset, two-factor enrollment
and challenge, password change, discounts, the assistant's scope, branch isolation,
payments, quantity breaks and quote gaps, owner price edits, frozen order snapshots,
shared image permissions/validation/replacement/removal, hashed single-use password
resets with session revocation, client-rate confidentiality, cross-origin protection,
reports, and CSV export. It exits non-zero on the first failure and leaves production
data untouched.

---

## Known limits

- Notifications are in-app only (the **Alerts** page). Password-reset email is the only
  transactional email; SMS and push delivery are not configured.
- Product images use Supabase Storage when `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  and `SUPABASE_STORAGE_BUCKET` are configured; the storage bucket must be public for
  the catalog to display images. Without those values, images fall back to the local
  `UPLOAD_DIR`, which does not survive an ephemeral deploy. The database stores paths
  and metadata, not image bytes.
- Two-factor is available on every account and recommended for the owner and branch
  heads, but it is not forced. The owner can reset it from Team or from a customer's
  booking drawer.
- Booking capacity and reference allocation are serialised inside one Node process.
  Running more than one app instance requires a database-level lock so two processes
  cannot both fill the last slot; the unique reference constraint still prevents
  duplicate references.
- Email addresses are not verified at registration. A mistyped address can still book;
  password-reset email simply will not arrive for it.
- Booking lists return every role-visible row and the audit log is capped at 200 entries;
  neither endpoint exposes pagination yet.
- Geocoding uses the public Nominatim service, which asks for at most one request per
  second. For high booking volume, point `GEOCODER_URL` at a paid geocoder that returns
  the same `[{ lat, lon }]` shape.
- Payments are recorded, not collected: there is no payment gateway or receipt upload.
- The capacity guard counts booth/coverage services, not print production; print work is
  queued by the studio and is not limited by the five-slot rule.
- Reports are CSV only. Scheduled delivery is a GitHub Actions artifact, not email.
- Photographs on the landing and sign-in pages are from Unsplash, and contact details
  such as `hello@preciousmoments.ph` are placeholders. Prices come from the studio's
  2026 price sheet; conflicting workbook values and services not on the sheet are
  flagged on the Pricing page for owner confirmation.
