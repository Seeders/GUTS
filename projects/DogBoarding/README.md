# Dog Boarding

Management software for a dog boarding business, built as a GUTS project.

Two faces, one database:

- **A public website** where new clients register themselves — their contact details and
  address, an emergency contact, their vet (name, phone, address), a profile for every dog,
  and the vaccination certificates to go with them.
- **A back office** where staff run the place: bookings, what was done for which dog and
  when, invoices, payments, and what the business spends — including maintenance.

## Running it

```bash
# from the repo root
node build/build.js DogBoarding      # build the client bundle
node projects/DogBoarding/server.js  # serve it
```

Then open <http://localhost:3000/>. The back office is at
<http://localhost:3000/#/admin>.

One command does both:

```bash
node build/start-project.js DogBoarding
```

**Requires Node 22+** — it uses the built-in `node:sqlite`, so there is no native module to
compile and no database server to install. The whole business lives in one file:
`projects/DogBoarding/data/dogboard.db`.

### First login

On first run the server prints a generated admin password. Use it, then change it in
**Settings**. To set it yourself instead:

```bash
DOGBOARD_ADMIN_PASSWORD=something-long node projects/DogBoarding/server.js
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `DOGBOARD_ADMIN_PASSWORD` | *(generated)* | Admin password, on first run only |
| `DOGBOARD_DB` | `data/dogboard.db` | Database location |

## How the money works

This is the part worth understanding, because everything else follows from it.

```
service event  ──►  invoice item  ──►  payment
(work we did)      (frozen snapshot)   (money in)
```

- A **service event** is *"we did this thing, for this dog, on this day"*. It is both the
  unit of work and the unit of billing. It starts life **unbilled**.
- Boarding charges are generated from a booking: a 4-night stay for 2 dogs becomes 2 lines
  of quantity 4, which is how it should read on the invoice. Charging the same service twice
  on the same booking is refused, so you cannot double-bill by clicking twice.
- An **invoice** sweeps up every unbilled event for a client and *snapshots* them into
  invoice items. Changing a price later never rewrites an invoice that has already gone out.
- A **payment** may be applied to an invoice, or left on account as a credit. An invoice's
  balance is its total minus what has been paid against it; its status follows from that.
- **Voiding** an invoice returns its charges to unbilled so they can be re-invoiced, and
  turns its payments into account credit. Nothing is destroyed.

Money is stored as integer cents throughout. There are no floats anywhere in the ledger.

### Guard rails

The books resist being torn:

- A client with any invoice or payment history cannot be deleted, only archived — deleting
  them would cascade away money the business has actually received.
- A dog that appears on an invoice cannot be deleted, only marked inactive.
- A charge that is already on an invoice cannot be edited or removed; void the invoice first.
- A service that appears in past charges is retired rather than deleted.

## What the back office gives you

| Section | What it answers |
|---|---|
| **Today** | Who is on site, who arrives, who leaves, what needs attention |
| **Clients & Dogs** | The record system: owners, dogs, vets, vet records, care notes |
| **Bookings** | Stays, kennel assignment, check-in/out, turning nights into charges |
| **Billing** | Who is ready to bill, invoices, payments, the rate card |
| **Expenses** | What the business spends, including maintenance, with receipts |
| **Reports** | P&L, who owes us, services per dog, occupancy, vaccination compliance |

Reports export to CSV for an accountant. Invoices render to a printable page.

### Vaccination tracking

Every active dog is checked against the required vaccination list (configurable; rabies,
DHPP and bordetella by default). A dog is flagged if a required vaccine is **missing**,
**expired**, has **no expiry date**, or is **expiring** inside the warning window. The
dashboard shows the count; the Vaccinations report shows who to call.

Records uploaded through the public form arrive **unverified** — a human ticks the box after
actually looking at the certificate.

## Privacy and security

Vet records carry client names, home addresses and phone numbers, so:

- Uploads are stored **outside the web root** and are never served as static files. They come
  back out only through authenticated `/api/admin/files/...` routes.
- `data/` — the database and every uploaded file — is **gitignored**. Do not commit it.
- The public API is write-only. A member of the public can submit an intake form and read the
  price list. They cannot read anything back out.
- Intake is rate limited per IP.

**Know what this auth is.** It is a single shared staff password, scrypt-hashed, with random
session tokens. That is appropriate for a small business where the staff trust each other. It
is *not* per-user accounts and it gives you no audit trail of who changed what. If you grow to
the point where that matters, replace `server/auth.js`.

Also: this serves plain HTTP. Put it behind a reverse proxy with TLS before exposing it to the
internet, or the passwords and the vet records cross the network in the clear.

## Layout

```
projects/DogBoarding/
  index.html                 boot the GUTS engine
  server.js                  express app
  server/
    db.js                    schema, migrations, seed data, query helpers
    auth.js                  password hashing, sessions, the admin guard
    accounting.js            invoices, balances, A/R, P&L — the money rules
    uploads.js               multer config; what may be uploaded and where it goes
    routes.public.js         the intake form's endpoint
    routes.admin.js          everything else
  collections/
    settings/configs/game.json      libraries, interface, app entry point
    ui/interfaces/{html,css,data}/  the single interface shell
    scripts/libraries/js/
      DogBoardingApp.js      hash router, app entry
      DogBoardApi.js         API client
      DogBoardUI.js          DOM helpers, tables, forms, modals, money formatting
      PublicSite.js          home, rates, intake
      AdminConsole.js        login, sidebar, dashboard, settings
      AdminClients.js        clients, dogs, vets, vet records
      AdminBookings.js       stays, check-in/out, charge generation
      AdminBilling.js        invoices, payments, rate card
      AdminExpenses.js       costs and maintenance
      AdminReports.js        P&L, A/R, occupancy, vaccinations
  data/                      gitignored: the database and all uploads
```

The front end is plain DOM — no framework, no build step beyond the GUTS bundle. User data is
never passed through `innerHTML`, so a dog named `<script>` is just a dog with a strange name.
