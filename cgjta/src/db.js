const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tiers (
  code          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  admission_fee INTEGER NOT NULL DEFAULT 0,  -- cents
  annual_fee    INTEGER NOT NULL DEFAULT 0,  -- cents
  color         TEXT NOT NULL DEFAULT '#4b5563',
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  active        INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS members (
  id                  INTEGER PRIMARY KEY,
  cgjta_no            TEXT UNIQUE COLLATE NOCASE,  -- the member's user ID; assigned on approval
  tier                TEXT NOT NULL REFERENCES tiers(code),
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),

  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  name_on_card        TEXT NOT NULL,
  nic_pp_no           TEXT NOT NULL,
  gender              TEXT CHECK (gender IN ('male', 'female')),
  dob                 TEXT NOT NULL,

  business_name       TEXT,
  business_reg_no     TEXT,
  ngja_license_no     TEXT,

  address_line1       TEXT,
  address_line2       TEXT,
  city                TEXT,
  postal_code         TEXT,
  country             TEXT,
  mobile              TEXT NOT NULL,
  email               TEXT,

  activities          TEXT NOT NULL DEFAULT '[]',   -- JSON array of activity codes
  proposed_by         TEXT,
  seconded_by         TEXT,

  doc_nic             INTEGER NOT NULL DEFAULT 0,
  doc_br              INTEGER NOT NULL DEFAULT 0,
  doc_gem_license     INTEGER NOT NULL DEFAULT 0,
  doc_photo           INTEGER NOT NULL DEFAULT 0,
  exco_vote           INTEGER NOT NULL DEFAULT 0,   -- docs unavailable, accepted by 2/3 EXCO vote
  terms_agreed        INTEGER NOT NULL DEFAULT 0,
  application_date    TEXT NOT NULL,

  segment_approved_by TEXT,
  exco_approved_by    TEXT,
  approved_at         TEXT,
  status_note         TEXT,

  valid_until         TEXT,   -- derived from subscription payments
  photo_file          TEXT,
  portal_password_hash TEXT,
  notes               TEXT,

  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS members_tier ON members(tier);
CREATE INDEX IF NOT EXISTS members_status ON members(status);
CREATE INDEX IF NOT EXISTS members_nic ON members(nic_pp_no);

CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY,
  receipt_no   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  member_id    INTEGER NOT NULL REFERENCES members(id),
  type         TEXT NOT NULL,
  amount       INTEGER NOT NULL CHECK (amount >= 0),  -- cents
  method       TEXT NOT NULL,
  reference    TEXT,
  paid_on      TEXT NOT NULL,
  period_from  TEXT,
  period_to    TEXT,
  notes        TEXT,
  recorded_by  INTEGER REFERENCES users(id),
  voided_at    TEXT,
  voided_by    INTEGER REFERENCES users(id),
  void_reason  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS payments_member ON payments(member_id);
CREATE INDEX IF NOT EXISTS payments_paid_on ON payments(paid_on);

CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  member_id  INTEGER REFERENCES members(id),
  action     TEXT NOT NULL,
  details    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS activity_member ON activity_log(member_id);

CREATE TABLE IF NOT EXISTS sessions (
  sid     TEXT PRIMARY KEY,
  data    TEXT NOT NULL,
  expires INTEGER NOT NULL
);
`;

const DEFAULT_SETTINGS = {
  org_name: 'Ceylon Gem and Jewellery Traders Association',
  org_short: 'CGJTA',
  member_no_prefix: 'CGJTA-',
  member_no_digits: '4',
  next_member_no: '1',
  receipt_prefix: 'R',
  renewal_window_days: '30',
};

function open(file = config.DB_PATH) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

  const tierCount = db.prepare('SELECT COUNT(*) AS n FROM tiers').get().n;
  if (tierCount === 0) {
    const insertTier = db.prepare(
      'INSERT INTO tiers (code, name, admission_fee, annual_fee, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const t of config.DEFAULT_TIERS) {
      insertTier.run(t.code, t.name, t.admission_fee, t.annual_fee, t.color, t.sort_order);
    }
  }
  return db;
}

/** Run fn inside a transaction; rolls back if it throws. */
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULT_SETTINGS[key];
}

function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

function allSettings(db) {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

function logActivity(db, { userId = null, memberId = null, action, details = null }) {
  db.prepare('INSERT INTO activity_log (user_id, member_id, action, details) VALUES (?, ?, ?, ?)')
    .run(userId, memberId, action, details);
}

module.exports = { open, tx, getSetting, setSetting, allSettings, logActivity };
