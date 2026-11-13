# Project structure

A file-by-file guide to Precious Moments. It explains what each file owns, how
the pieces connect, and where to make a change without touching anything else.

---

## Top level

```
.
├── server.js                 HTTP entry point: load env, build store, listen
├── package.json              scripts, engines (Node >= 20.12), two dependencies
├── .env.example              every supported environment variable
├── public/                   everything the browser downloads
├── server/                   Express app, persistence, security, business rules
├── scripts/                  setup, reporting, and the smoke test
├── supabase/                 SQL schema and migrations
├── docs/                     this guide
├── .github/workflows/        CI and the monthly report job
├── render.yaml               Render deployment definition
└── data/                     local JSON store + generated session secret
```

Two runtime dependencies only: **Express** (HTTP) and **@supabase/supabase-js**
(production database). Everything else is the Node standard library.

---

## Request lifecycle

```
browser
  │  fetch('/api/...')            cookies sent automatically
  ▼
server.js                        loads .env, creates the store
  ▼
server/app.js
  ├─ security headers            CSP, nosniff, frame-options, HSTS in prod
  ├─ sameOrigin()                blocks cross-site state changes
  ├─ session hydration           signed cookie -> req.user (active users only)
  ├─ requireAuth / requireRole   per-route authorization
  └─ store.*                     the only data access
        ├─ local     data/store.json
        └─ supabase  pm_* tables
```

The browser never talks to Supabase. The service-role key stays on the server,
and every read and write passes through the route handlers, which enforce the
role and branch rules.

---

## `server/` — the backend

| File | Responsibility | Main exports | Used by |
| --- | --- | --- | --- |
| `app.js` | Every HTTP route, middleware, and permission rule. | `createApp(store)` | `server.js`, `scripts/smoke.mjs` |
| `config.js` | Reads `process.env` once into typed constants. | `PORT`, `DATA_DIR`, `STORE_MODE`, `SEED_DEMO`, `MAX_SIMULTANEOUS_SERVICES`, geocoder settings | all server modules |
| `store.js` | Persistence behind one interface: `list/listWhere/get/insert/insertMany/update/remove`. | `createStore()` | routes, scripts, reports |
| `security.js` | Password hashing, signed session/MFA cookies, TOTP, and AES-256-GCM encryption of stored factor secrets. | `hashPassword`, `verifyPassword`, `createSessionToken`, `verifyTotp`, `encryptMfaSecret`, `decryptMfaSecret`, `sanitizeUser` | routes, seed, setup scripts |
| `catalog.js` | The 2026 price catalog, quantity breaks, client-only rates, and server-side line pricing. | `CATEGORIES`, `SERVICES`, `CLIENT_PRICES`, `PRICE_REVIEWS`, `tierFor`, `priceLine` | routes, seed, availability, assistant |
| `availability.js` | Booth/crew concurrency rules and next-free-slot search. | `checkCapacity`, `nextAvailableStart`, `capacityUnits` | bookings routes, assistant |
| `inventory.js` | Studio-wide physical booth units, overlapping commitments, maintenance blocks, and dashboard snapshots. | `BOOTH_TYPES`, `boothUnitsForItems`, `checkBoothInventory`, `inventoryUsage`, `buildInventorySnapshot` | bookings routes, `/api/inventory` |
| `logistics.js` | Deployment statuses, assigned-unit validation, and the setup/event/pickup calendar builder. | `DEPLOYMENT_STATUSES`, `assignedUnitsOf`, `validateAssignedUnits`, `buildCalendar` | booking logistics route, `/api/logistics`, assistant, reports |
| `geo.js` | Geocodes an address and picks the nearest branch. | `locateBookingAddress`, `assignBranch` | bookings routes |
| `assistant.js` | Deterministic in-app Q&A over catalog, branches, policies, own bookings, scoped inventory, deployments, and schedules. | `answerQuestion`, `OUT_OF_SCOPE` | `/api/assistant` |
| `ai.js` | Hosted-model layer that calls the deterministic engine through a scoped tool, validates every draft against trusted data, and falls back safely. | `answerQuestionWithAi`, `validateAiAnswer`, `AI_ENABLED` | `/api/assistant` |
| `assistant-history.js` | Owner-scoped conversation and message persistence. Every read and write takes the session user id; foreign ids return no record. | `listConversations`, `getConversation`, `createConversation`, `appendMessage`, `aiHistory` | `/api/assistant`, `/api/assistant/conversations` |
| `images.js` | Validates JPG/PNG/WEBP uploads and persists them to Supabase Storage, with local disk as the development fallback. | `saveProductImage`, `removeProductImage`, `inspectProductImage` | service-image routes |
| `mail.js` | Delivers password-reset email through Resend with a request timeout; prints the link in development. | `sendPasswordResetEmail` | auth routes |
| `reports.js` | Aggregates bookings into summary/trend/logistics data and renders CSV or PDF. | `buildReport`, `reportCsv`, `reportPdf` | report routes, `scripts/report.mjs` |
| `seed.js` | Branches, studio accounts, demo bookings with fixed ids. | `buildSeed`, `SEED_BRANCHES` | `store.js`, setup scripts |

**Where a rule belongs.** Prices: `catalog.js`. Capacity: `availability.js`.
Physical booth units and blocks: `inventory.js`. Deployment status, unit
assignment, and schedule calendar: `logistics.js`.
Branch routing: `geo.js`. Authorization: `app.js`. Anything that persists:
`store.js`. Keeping those boundaries is what lets the JSON store and Supabase
stay interchangeable.

### API surface

| Area | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/register`, `/login`, `/mfa`, `/logout`, `/password`, `/mfa/setup`, `/mfa/enable`, `/mfa/disable`, `GET /api/auth/me` |
| Catalog | `GET /api/services`, `GET /api/health`, `GET /api/ready` |
| Owner pricing | `GET /api/pricing`, `PATCH /api/services/:id` |
| Images | `GET /api/product-images`, `POST/DELETE /api/services/:id/image` |
| Audit | `GET /api/audit-logs` |
| Bookings | `GET/POST /api/bookings`, `GET /api/bookings/:id`, `PATCH /api/bookings/:id`, `PATCH /api/bookings/:id/payment`, `PATCH /api/bookings/:id/logistics` |
| Availability and assistant | `GET /api/availability`, `POST /api/assistant`, `GET /api/assistant/conversations`, `GET /api/assistant/conversations/:id` |
| Logistics | `GET /api/logistics` (month range, role/branch scoped) |
| Inventory | `GET /api/inventory`, `POST /api/inventory/blocks`, `PATCH /api/inventory/blocks/:id` |
| Discounts | `GET /api/discounts/mine`, `GET/POST /api/discounts`, `PATCH /api/discounts/:id` |
| Studio | `GET /api/branches`, `GET /api/notifications`, `POST /api/notifications/read` |
| Accounts | `GET/POST /api/accounts`, `PATCH /api/accounts/:id`, `POST /api/accounts/:id/reset`, `POST /api/accounts/:id/mfa-reset` |
| Crew | `GET/POST /api/staff`, `PATCH /api/staff/:id` |
| Reports | `GET /api/reports`, `GET /api/reports.csv`, `GET /api/reports.pdf` |

---

## `public/` — the browser

No build step and no framework: ES modules are served directly.

| File | Responsibility | Connects to |
| --- | --- | --- |
| `index.html` | Marketing page markup (`/welcome`). Prices render into `#price-board`. | `js/home.js`, `css/styles.css` |
| `auth.html` | Sign-in / sign-up / two-factor panels (`/login`). | `js/auth.js` |
| `app.html` | Dashboard shell: sidebar, header, `#view`, drawer and modal roots. | `js/app.js` |
| `404.html` | Not-found page used by the Express fallback. | `css/styles.css` |
| `css/styles.css` | All styling, in three runs: marketing, dashboard, motion. Tokens in `:root`. | every page |
| `js/api.js` | Shared fetch wrapper, formatters, escaping, toast, rate-card markup. | all three page scripts |
| `js/home.js` | Rate board, mobile nav, personalised links. | `/api/services`, `/api/auth/me` |
| `js/auth.js` | Panel switching, client validation, three form submissions. | `/api/auth/*` |
| `js/app.js` | The whole dashboard: views per role, booking flow, drawer, events. | every API route |

### `js/app.js` layout

The file is ordered so a change has one obvious home:

1. DOM roots, labels, icons, `NAV`, `PAGE_META`, `state`
2. Small helpers and shared fragments (`statusBadge`, `bookingRow`, `emptyState`)
3. Shell and routing (`renderChrome`, `navigate`, `renderView`)
4. Views: customer, staff, owner/branch head
5. Booking flow: catalog, cart, availability, submit
6. Management views: bookings table, logistics calendar, team, discounts, account, assistant
7. Payments, report graphs and exports, alerts
8. Drawer and modal templates, motion, open/close, record actions
9. Delegated event listeners and `init()`

State is a single object. A handler mutates it, then calls `renderView()` (or a
narrower render such as `syncCart()`), and the view is rebuilt from `state`.

### Escaping rule

Every value interpolated into a template literal goes through `esc()` from
`api.js`. There are no exceptions — that is the project's XSS boundary.

---

## `scripts/` — operations

| File | Purpose | Command |
| --- | --- | --- |
| `bootstrap.mjs` | Create the first studio owner. | `npm run setup -- email "password" "Name"` |
| `setup-branches.mjs` | Create/reset the two branch heads; optional owner reset. | `npm run setup:branches [-- --reset-owner]` |
| `report.mjs` | CSV operations report for a date range. | `npm run report -- [from to]` |
| `report.py` | The same report using only the Python standard library (for scheduled jobs without Node). | `npm run report:py` |
| `smoke.mjs` | End-to-end HTTP test suite on a throwaway store. | `npm test` |

---

## `supabase/`

| File | Purpose |
| --- | --- |
| `schema.sql` | Base tables: `pm_users`, `pm_services`, `pm_bookings`, `pm_booking_updates`, `pm_branches`, `pm_notifications`, `pm_discounts`, `pm_assistant_conversations`, `pm_assistant_messages`, `pm_password_resets`, `pm_audit_logs`. |
| `migrate-branches.sql` | Branch columns and branch-head accounts. |
| `migrate-features.sql` | Booking types, discounts, notifications, two-factor columns. |
| `migrate-pricing.sql` | Adds tier, setup-fee, capacity, and review columns to `pm_services` on an existing project. |
| `migrate-booking-availability.sql` | Booking availability and product-management fields. |
| `migrate-catalog-images-auth.sql` | Images, measured pricing, resets, and audit logs. |
| `migrate-inventory.sql` | Additive `pm_inventory_blocks` table, RLS, and indexes for maintenance blocks. |
| `migrate-logistics.sql` | Additive deployment status, assigned units, setup/pickup schedules, logistics notes, timestamps, and indexes on `pm_bookings`. |
| `migrate-assistant-history.sql` | Additive private `pm_assistant_conversations` and `pm_assistant_messages` tables, RLS, composite ownership key, and indexes. |

`server/store.js` maps the short names (`bookings`) to the `pm_` tables, so SQL
changes should be paired with that map.

---

## Conventions

- **Money** is whole pesos, computed on the server. The browser only displays.
- **Dates** are `YYYY-MM-DD` strings; timestamps are ISO strings. Client-side
  date formatting avoids `new Date('YYYY-MM-DD')` so timezones cannot shift a day.
- **Statuses** are a closed set: `pending`, `confirmed`, `in_progress`, `ready`,
  `completed`, `cancelled`. Only the first four hold capacity or count as owed.
- **Roles** are `customer`, `branch_admin`, `admin`. Crew are `staff` records
  without passwords and never sign in.
- **Concurrency:** booking creation and schedule edits run through an in-process
  promise-chain mutex (`serialQueue` in `app.js`). Capacity is re-read inside the lock
  and the unique booking reference is the cross-process backstop. A deployment with
  more than one app instance still needs a database-level lock for capacity.
- **Audit:** `audit()` writes auth, booking, payment, account, MFA, discount, and image
  events. It never receives passwords, reset tokens, or factor secrets, and a failed
  audit write is logged without failing the completed action.
- **Comments** explain why a rule exists, not what a line does. Section banners
  mark the major blocks so long files stay navigable.

---

## Adding a feature

1. Data: extend `server/store.js` (`TABLES` if Supabase is involved) and the SQL.
2. Rule: put pricing in `catalog.js`, capacity in `availability.js`, physical
   inventory in `inventory.js`, and permissions in `app.js`.
3. Route: add it to the matching section of `server/app.js`, with
   `requireAuth` / `requireRole` and the same-origin check already applied.
4. UI: add the view function and a `NAV`/`PAGE_META` entry in `public/js/app.js`.
5. Test: extend `scripts/smoke.mjs` — the suite is the contract for role access.
