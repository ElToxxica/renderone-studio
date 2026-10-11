# CGJTA Membership

Membership and payments system for the Ceylon Gem and Jewellery Traders
Association. It follows the paper *Membership Application Form*:

- **Applications.** Every field on the form, including business activities,
  proposer and seconder, the document checklist and the terms declaration. The
  age (18+) and document rules are checked. If documents are missing, a 2/3
  EXCO vote can be recorded instead.
- **Approval.** Staff record the Membership Segment and EXCO approvers. Approval
  issues the member's **CGJTA No**, which is also their **user ID**.
- **Three tiers:** EXCO, Premier and Member. Each has its own admission fee,
  annual fee and colour, all editable in Settings.
- **Payments.** Admission fees, annual subscriptions and other payments, with
  automatic receipt numbers (`R2026-00001`) or numbers from a paper receipt
  book. Receipts can be printed. A payment can be voided, which keeps it on
  record. Results can be filtered and exported to CSV.
- **Membership standing** is worked out from subscription payments: *Active*,
  *Renewal due* (within 30 days), *Expired*, *Pending*, *Suspended* or
  *Rejected*.
- **Dashboard.** Shows collections this year and month, members by tier, a
  monthly chart, pending applications, renewals and recent activity.
- **Membership cards** with tier artwork, a photo and a print layout (ID-1 size).
- **Member portal** (`/portal`). Members sign in with their CGJTA No to see
  their status, card and payment history.
- **Staff accounts** with two roles. *Admin* can do everything. *Staff* can do
  everything except Settings and voiding payments.
- **Audit trail.** Each member's profile has a history of changes.

## Run it

Requires **Node.js 22.13 or newer** (uses the built-in SQLite, so there's nothing native to compile).

```bash
cd cgjta
npm install
npm start            # http://localhost:3000
```

On first start it creates an `admin` account and prints the password in the
terminal. Set `ADMIN_PASSWORD` beforehand to choose the password yourself.

To try it with sample data, run this on an empty database:

```bash
npm run seed:demo    # 10 sample members, payments; admin / change-me-now
```

Other commands:

```bash
npm run dev                                            # restart on file changes
npm test                                               # automated tests
npm run user:create -- jdoe "Jane Doe" staff           # add a staff account from the shell
```

## Configuration

Copy `.env.example` to `.env`, or set these variables on your host:

| Variable         | Default          | Purpose |
|------------------|------------------|---------|
| `PORT`           | `3000`           | HTTP port |
| `DATA_DIR`       | `./data`         | SQLite database and uploaded photos. **Back up this folder.** |
| `SESSION_SECRET` | auto-generated   | Signs login cookies. If unset, it is generated once and saved in `data/` |
| `TZ_NAME`        | `Asia/Colombo`   | Sets what "today" means for due dates and receipts |
| `COOKIE_SECURE`  | `0`              | Set to `1` when served over HTTPS |
| `TRUST_PROXY`    | unset            | Set to `1` behind a reverse proxy or load balancer |
| `ADMIN_PASSWORD` | random           | Password for the first `admin` account |

## Hosting

This is a Node server with a database, so it **cannot run on GitHub Pages**.
Any host with Node 22+ and a **persistent disk** works, for example a small VPS,
Render or Railway with a mounted volume (point `DATA_DIR` at it), or an office
PC. Put it behind HTTPS and set `COOKIE_SECURE=1`.

## Artwork

The logo and card backgrounds are placeholders in `public/artwork/`. To use
the final designs, drop in files with the same names: `logo`,
`card-exco`, `card-premier`, `card-member` and optionally `card-back`. PNG,
JPG, WebP and SVG all work. No code changes are needed. See
`public/artwork/README.md` for sizes.

## Project layout

```
src/
  server.js           start-up, first admin account
  app.js              Express setup, sessions, security headers
  config.js           tiers, activities, documents, payment types, standings
  db.js               SQLite schema and settings
  services/           members, payments, users (business rules live here)
  routes/             dashboard, members, payments, settings, portal, auth
views/                EJS templates (server-rendered, work without JavaScript)
public/               CSS, small progressive-enhancement script, artwork
scripts/              demo seed, create-user
test/                 end-to-end tests (node:test)
```

Money is stored as integer cents (LKR). Dates are stored as `YYYY-MM-DD`.
