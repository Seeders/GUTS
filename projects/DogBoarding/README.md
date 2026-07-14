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
node build/build.js DogBoarding   # build the client bundle
npm run server                    # the root server, which hosts every project
```

Then open <http://localhost:8080/projects/DogBoarding/index.html>. The back office is the
same page at `#/admin`.

The root server picks this project's backend up on its own. Any project can do the same by
exporting `mount(app, { base })` from `projects/<Name>/backend.js`; it gets mounted under the
prefix its client is served from (`/projects/<Name>`), so two projects can never collide over
a route like `/api`.

It also runs standalone, if you ever want to deploy the boarding app on its own. Same
`backend.js`, so the two hosts cannot drift apart:

```bash
node projects/DogBoarding/server.js   # http://localhost:3000/
```

**Requires Node 22+** — it uses the built-in `node:sqlite`, so there is no native module to
compile and no database server to install. The whole business lives in one file:
`projects/DogBoarding/secure/dogboard.db`.

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
| `DOGBOARD_DB` | `secure/dogboard.db` | Database location |
| `GUTS_SECURE_DIR` | `<project>/secure` | Where private data lives; point at a backed-up volume |

## It is data-driven — that is the point

Almost nothing this app says or offers is written in JavaScript. It is all collections, edited
in the GUTS editor.

| Collection | Category | What it controls |
|---|---|---|
| `content` | Content | Every word on the public site, and the admin console's labels |
| `forms` | Content | The fields of every form — the public intake form and all nine admin dialogs |
| `adminNav` | Content | The back-office sidebar |
| `serviceCatalog` | Data | The rate card the database is seeded from |
| `recordTypes` | Data | Vaccination types, and **which are required** |
| `expenseCategories` | Data | Expense categories, and which count as maintenance |
| `paymentMethods` | Data | How clients may pay |
| `bookingStatuses` | Data | Booking states, their colour, **and the transitions between them** |
| `serviceUnits` | Data | night / day / hour / each, and which multiply by nights stayed |
| `scenes` | Data | The routes. Each scene names its route, interface and page |
| `interfaces` | UI | The actual markup: `public`, `admin`, and a CSS-only `base` |

The libraries read these; they do not restate them. Mark Canine Influenza as required in
`recordTypes/influenza.json` and the public home page lists it, the registration form grows a
row for it, and the vaccination alerts start chasing it — with no code change.

**The server reads the same files** (`server/collections.js`). So the rate card, the required
vaccinations, the valid booking statuses and the expense categories cannot drift between the
browser and the database. Set `DOGBOARD_WATCH_COLLECTIONS=1` to re-read them on every request
while you are editing; otherwise they are cached at boot and a restart picks up changes.

A field in a form schema may say `optionsFrom: "paymentMethods"`, and its dropdown fills itself
from that collection. That is why adding a payment method is one JSON file and nothing else.

### Adding a page

1. A scene: `collections/data/scenes/faq.json` with `route`, `interface`, `page`.
2. A `<section data-page="faq">` in the interface's HTML.
3. Its words in `collections/content/faq.json`.

No routing code.

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

- They live in this project's `secure/` folder — a per-project storage category, sibling to
  `collections/`. Nothing in there is ever served as a static file; it comes back out only
  through authenticated `/api/admin/files/...` routes.
- `secure/` sits **outside `collections/` on purpose**. The build treats the folder structure
  under `collections/` as the source of truth and inlines what it finds into the client bundle,
  so a "secure" *collection* would compile straight into the browser.
- The root server denies `projects/*/secure/` at the static layer, and `projects/**/secure/` is
  **gitignored**. Do not commit it.
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
    collections.js           reads the GUTS collections off disk
  backend.js                 mount(app, { base }) - what the root server looks for
  collections/
    settings/
      configs/game.json           libraries, boot interface, app entry point
      objectTypeDefinitions/      registers each collection so the editor shows it
    content/
      content/                    every word on the site
      forms/                      the field list of every form
      adminNav/                   the back-office sidebar
    data/
      scenes/                     the routes
      serviceCatalog/             the rate card
      recordTypes/                vaccinations, and which are required
      expenseCategories/          expense categories
      paymentMethods/             how clients may pay
      bookingStatuses/            booking states and their transitions
      serviceUnits/               night / day / hour / each
    ui/interfaces/{html,css,data}/  base, public, admin
    scripts/libraries/js/
      DogBoardingApp.js      routes, read off the scenes collection
      InterfaceLoader.js     swaps the interface; mirrors SceneManager
      FormRenderer.js        builds any form from its schema
      DogBoardApi.js         API client
      DogBoardUI.js          DOM helpers, data binding, tables, modals, money
      PublicSite.js          fills the public interface from `content`
      AdminConsole.js        login, sidebar, dashboard, settings
      AdminClients.js        clients, dogs, vets, vet records
      AdminBookings.js       stays, check-in/out, charge generation
      AdminBilling.js        invoices, payments, rate card
      AdminExpenses.js       costs and maintenance
      AdminReports.js        P&L, A/R, occupancy, vaccinations
  secure/                    gitignored, never served: the database and all uploads
```

The front end is plain DOM — no framework, no build step beyond the GUTS bundle. User data is
never passed through `innerHTML`, so a dog named `<script>` is just a dog with a strange name.
