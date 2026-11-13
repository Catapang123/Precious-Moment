# Presenting Precious Moments — demo runbook

Everything you need to show the system to the client in about 15 minutes,
including what to click, what to say, and the questions they will ask.

---

## 1. The 30-second opening

Say this before you touch the keyboard:

> "The system opens on a sign-up screen, so a customer can start immediately. They choose
> **Pickup** or **Event** — pickup asks only for a branch and a date, an event asks for the
> venue, address, time, and duration. The server prices it, checks how many booths are
> already running in that window, applies any loyalty discount, and routes the job to the
> right branch. Only that branch's head is alerted. Crew don't get logins — they're
> assignment records."

Then open `/shop`: **prices are public**, so customers arrive already knowing the cost.

## 2. The flow, in one picture

```
CUSTOMER                    SERVER                         BRANCH
────────                    ──────                         ──────
signs up              →     validates and prices
picks Pickup or Event       checks 5-service capacity
chooses a branch            applies any discount
or asks for nearest    →     routes to a branch       →    branch head gets an alert
sends the request           stores booking_type
                                                            │
                        ←   confirms date, assigns crew ────┘
                                                            │
sees status, discount,      updates progress           ←────┘
balance, and pickup time    records the deposit
```

The selling sentence: **the server owns the price, the branch, and the capacity check.**

## 3. Who logs in and sees what

| Login | Tabs they see |
| --- | --- |
| Customer | Overview · New booking · My bookings · Account & security |
| Branch head | Overview · Bookings · Payments · Team · Alerts · Account & security |
| Owner | Overview · Bookings · Payments · Discounts · Reports · Team · Alerts · Account & security |
| Crew | **No login.** They are records the owner or branch head assigns. |

Passwords are in `data/branch-admins.txt`. **Copy from that file — never open it on a
shared screen.** Three logins: owner, Batangas head, Bauan head. Demo customer passwords
come from the database; create a fresh customer during the demo instead.

---

## 4. Before the call — 10-minute checklist

1. In the VS Code terminal: `npm start`, then open <http://localhost:3000>. That opens
   the shop; the account buttons in the header open the single sign-in/sign-up form.
2. Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> so the browser isn't using cached
   files. Zoom to ~110% (<kbd>Ctrl</kbd>+<kbd>+</kbd>).
3. **Create one crew record for each branch** (owner → **Team** → Add crew). There is no
   password field — that is the point.
4. Optional: assign a loyalty discount to your demo customer under **Discounts**.
5. Optional: send one booking yourself so the dashboard isn't empty, then cancel it.
6. Close VS Code's terminal panel and any tab showing `.env` or `data/`.
7. Test each of the three logins once.

---

## 5. The demo — scene by scene

### Scene 1 · The customer starts (2 min)

**Click:** open `/` — the system lands on **Create account**, not a login wall. Create
`Ana Reyes`, a phone number, and a password that satisfies the checklist (uppercase,
lowercase, number, symbol). Point at the live rules ticking green.

**Say:** "Sign-up is the front door, but existing customers can switch to Sign in with
one click. The password rule is enforced again on the server, not just here."

### Scene 2 · Pickup vs Event (3 min)

In **New booking**, add a tarpaulin and a photobooth.

- Click **Pickup booking**: only pickup branch, date, and optional time appear. No venue,
  no address, no duration. The note says **ready in 1–2 days**.
- Choose **Bauan** manually. If the browser offers a location suggestion, point out that
  the manual choice stays selected.
- Switch to **Event booking**: venue, full address, start time, duration (1–12 hours), and
  an optional branch appear.
- Choose the venue and address. Leave branch on **Nearest to the address**, then overrule
  it with **Bauan** to show manual priority.

**Say:** "A customer ordering a tarpaulin for pickup is never asked for an event address
or duration. If they pick a branch, that choice wins over the map."

Send the request. The confirmation names the pickup branch or the routed event branch.

### Scene 3 · The five-booth rule (2 min)

Still as the customer, book **five photobooths** for one branch in the same 7:00 AM–12:00 PM
window (one booking with quantity 5 is fine). Then try a sixth overlapping booth.

- The system refuses it and names the **next open start, 12:00 PM**.
- Book 12:00 PM–3:00 PM successfully.
- A six-booth day is still bookable in later windows — this is a concurrency limit, not a
  daily limit.

**Say:** "This is the thing a notebook cannot do. Five booths at once is the limit; the
rest of the day stays open."

### Scene 4 · The branch head (3 min)

Sign out → sign in as the **Batangas branch head**.

- **Alerts** shows the new booking with customer, service, and address.
- **Bookings** → open it → confirm the date and assign a Batangas crew record.
- **Payments** → record **Deposit paid** (auto-fills 50%) with GCash and a reference.
- **Team** → add a crew record; note there is **no password** and no crew login.

**Say:** "The Bauan head's bell stays at zero for this job. Crew are people we assign, not
accounts we hand out — that was the login confusion before."

### Scene 5 · The trust moment (2 min) — do not skip

Sign in as the **other branch head** (Bauan).

- Bookings: that Batangas job is absent. Alerts: zero.
- Open `/api/bookings/<the Batangas id>` in a new tab → **403**.

**Say:** "Branch isolation is enforced by the server. Even a developer with the link can't
cross over."

### Scene 6 · Owner controls (3 min)

Sign in as the owner.

- **Team → Studio accounts**: only the owner and two branch heads. Show **Deactivate** and
  **Reset password**. A reset shows a one-time temporary password and clears two-factor.
- **Discounts**: assign 10% to the demo customer's email. Sign in as that customer and show
  the subtotal, the −10% line, and the reduced total in the cart.
- **Reports**: pick this month → **Download CSV**.

**Say:** "The owner controls who can sign in, who gets a discount, and what the month
actually earned."

### Scene 7 · Assistant and account security (2 min)

Open **Ask the studio** (bottom-right) and ask:

- "How much is a tarpaulin?" → answers from the live catalog with the real price.
- "Who is the president of France?" → exactly **"Out of scope. Please ask another
  question."**

Then open **Account & security** → **Set up two-factor** → show the manual key and the
authenticator link. (Do not enable it on the demo owner unless you are ready to use the
code for the rest of the call.)

**Say:** "The assistant can only speak from this system, so it cannot invent a price. And
the owner can protect their login with an authenticator app."

---

## 6. Questions they will ask

| Question | Your answer |
| --- | --- |
| Can customers pay online? | Not yet. It records payments received; collecting them is phase 2 (GCash/Maya via PayMongo, ~1.3–3.1% per transaction). |
| How will I know a booking came in? | The Alerts page today; email alerts are phase 2. |
| Who sees my customer list? | Each branch sees only its own. Only the owner sees both. |
| What if the address is wrong? | It goes to manual review and the owner assigns the branch — never a silent mis-route. |
| Can a customer choose the other branch? | Yes. For pickup they choose; for an event they can overrule the nearest-branch suggestion. |
| Can crew log in? | No, by design. Only the owner and the two branch heads have accounts. Crew are assigned records. |
| Can we add a third branch? | Yes — a branch is a database row with coordinates, plus one branch-head account. |
| Can we change prices? | Yes, one file the developer edits; the server is the only thing that prices a booking. |
| What if someone forgets their password? | The owner resets it in Team and hands over the one-time password. There is no email reset yet. |
| Is it mobile friendly? | Yes, the whole flow works on a phone. |
| Where is the data? | A hosted Postgres database (Supabase). For production, a paid tier adds backups. |

## 7. What is deliberately not in yet — say it before they ask

- **No online payment collection** (recorded, not collected).
- **No email/SMS** — alerts and password resets live inside the dashboard.
- **No photo uploads** for payment proofs or venue references.
- **Two-factor is optional**, not forced. Recommended for the owner and branch heads.
- Capacity counts booth/coverage services; print production is queued separately.

Then offer them, in cost order: email alerts (free tier), photo uploads, forced two-factor
for admin accounts, payments (percentage per transaction, needs DTI + BIR documents).

## 8. Sharing options

- **Screen share `localhost:3000`** — simplest, nothing to set up, and the port stays
  3000, so no new URL for you to manage.
- **A public link** — needs a deploy to Render (~15 min) with the Supabase keys set as
  environment variables. Do that only if the client must click it themselves; a public
  demo URL is also open to the internet.
