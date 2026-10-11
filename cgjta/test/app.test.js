const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cgjta-test-'));
process.env.DATA_DIR = tmp;

const db = require('../src/db');
const h = require('../src/helpers');
const usersService = require('../src/services/users');
const { createApp } = require('../src/app');

let server;
let base;
let conn;

/** Minimal cookie-keeping client. */
function client() {
  let cookie = '';
  async function request(method, url, form) {
    const res = await fetch(base + url, {
      method,
      redirect: 'manual',
      headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  }
  async function token(url) {
    const page = await request('GET', url);
    const m = page.text.match(/name="_csrf" value="([^"]+)"/);
    assert.ok(m, `no CSRF token on ${url}`);
    return m[1];
  }
  return {
    get: (url) => request('GET', url),
    post: async (url, form, from = url) => request('POST', url, { _csrf: await token(from), ...form }),
    rawPost: (url, form) => request('POST', url, form),
    async login(username, password) {
      return this.post('/login', { username, password });
    },
  };
}

const applicant = (over = {}) => ({
  tier: 'MEMBER', first_name: 'Kamal', last_name: 'Silva', nic_pp_no: '198512345678', dob: '1985-04-02',
  mobile: '+94 77 555 1234', email: 'kamal@example.com', activities: 'local_trading', application_date: h.today(),
  doc_nic: '1', doc_br: '1', terms_agreed: '1', ...over,
});

before(async () => {
  conn = db.open(path.join(tmp, 'test.db'));
  const users = usersService(conn);
  users.create({ username: 'admin', name: 'Admin', role: 'admin', password: 'admin-pass-1' });
  users.create({ username: 'clerk', name: 'Clerk', role: 'staff', password: 'clerk-pass-1' });
  const app = createApp({ db: conn, sessionSecret: 'test-secret' });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('staff pages require sign-in', async () => {
  const res = await client().get('/members');
  assert.equal(res.status, 302);
  assert.equal(res.location, '/login');
});

test('login rejects a wrong password and accepts the right one', async () => {
  const c = client();
  assert.equal((await c.login('admin', 'nope')).status, 401);
  const ok = await c.login('admin', 'admin-pass-1');
  assert.equal(ok.status, 302);
  assert.equal((await c.get('/')).status, 200);
});

test('state-changing requests need a CSRF token', async () => {
  const c = client();
  await c.login('admin', 'admin-pass-1');
  const res = await c.rawPost('/members', applicant());
  assert.equal(res.status, 403);
});

test('application → approval → subscription → standing', async () => {
  const c = client();
  await c.login('admin', 'admin-pass-1');

  const young = await c.post('/members', applicant({ dob: h.addYears(h.today(), -17) }), '/members/new');
  assert.equal(young.status, 422);
  assert.match(young.text, /18 or older/);

  const created = await c.post('/members', applicant(), '/members/new');
  assert.equal(created.status, 302);
  const id = created.location.split('/').pop();
  assert.equal(conn.prepare('SELECT status FROM members WHERE id = ?').get(id).status, 'pending');

  const dup = await c.post('/members', applicant({ first_name: 'Other' }), '/members/new');
  assert.equal(dup.status, 422);
  assert.match(dup.text, /already on file/);

  const missing = await c.post(`/members/${id}/approve`, { segment_approved_by: '', exco_approved_by: 'R. Perera' }, `/members/${id}`);
  assert.equal(missing.status, 422);

  const approved = await c.post(`/members/${id}/approve`, { segment_approved_by: 'A. B. Senanayake', exco_approved_by: 'R. Perera' }, `/members/${id}`);
  assert.equal(approved.status, 302);
  const m = conn.prepare('SELECT cgjta_no, status, valid_until FROM members WHERE id = ?').get(id);
  assert.equal(m.cgjta_no, 'CGJTA-0001');
  assert.equal(m.status, 'approved');
  assert.equal(m.valid_until, null);

  const paidOn = h.today();
  const pay1 = await c.post('/payments', { member_id: id, type: 'subscription', amount: '5,000', method: 'cash', paid_on: paidOn }, `/payments/new?member=${id}`);
  assert.equal(pay1.status, 302);
  const expected1 = h.addDays(h.addYears(paidOn, 1), -1);
  assert.equal(conn.prepare('SELECT valid_until FROM members WHERE id = ?').get(id).valid_until, expected1);

  // A second subscription continues from the current expiry.
  const pay2 = await c.post('/payments', { member_id: id, type: 'subscription', amount: '5000', method: 'bank_transfer', paid_on: paidOn }, `/payments/new?member=${id}`);
  const expected2 = h.addDays(h.addYears(h.addDays(expected1, 1), 1), -1);
  assert.equal(conn.prepare('SELECT valid_until FROM members WHERE id = ?').get(id).valid_until, expected2);

  const page = await c.get(`/members/${id}`);
  assert.match(page.text, />Active</);

  // Voiding the later payment rolls validity back.
  const payId = pay2.location.split('/').pop();
  const voided = await c.post(`/payments/${payId}/void`, { reason: 'Entered twice' }, `/payments/${payId}`);
  assert.equal(voided.status, 302);
  assert.equal(conn.prepare('SELECT valid_until FROM members WHERE id = ?').get(id).valid_until, expected1);
  const receipts = conn.prepare('SELECT receipt_no FROM payments ORDER BY id').all().map((r) => r.receipt_no);
  assert.deepEqual(receipts, [`R${paidOn.slice(0, 4)}-00001`, `R${paidOn.slice(0, 4)}-00002`]);
});

test('approval is blocked without supporting documents unless EXCO voted', async () => {
  const c = client();
  await c.login('admin', 'admin-pass-1');
  const created = await c.post('/members', applicant({ nic_pp_no: 'N1234567', doc_nic: '', doc_br: '' }), '/members/new');
  const id = created.location.split('/').pop();
  const blocked = await c.post(`/members/${id}/approve`, { segment_approved_by: 'A', exco_approved_by: 'B' }, `/members/${id}`);
  assert.equal(blocked.status, 422);
  assert.match(blocked.text, /documents are incomplete/);
});

test('staff role cannot open settings or void payments', async () => {
  const c = client();
  await c.login('clerk', 'clerk-pass-1');
  assert.equal((await c.get('/settings')).status, 403);
  const payId = conn.prepare('SELECT id FROM payments WHERE voided_at IS NULL LIMIT 1').get().id;
  const res = await c.post(`/payments/${payId}/void`, { reason: 'x' }, `/payments/${payId}`);
  assert.equal(res.status, 403);
});

test('members can sign in to the portal with their CGJTA number', async () => {
  const admin = client();
  await admin.login('admin', 'admin-pass-1');
  const id = conn.prepare(`SELECT id FROM members WHERE cgjta_no = 'CGJTA-0001'`).get().id;
  await admin.post(`/members/${id}/portal`, { action: 'generate' }, `/members/${id}`);
  const page = await admin.get(`/members/${id}`);
  const password = page.text.match(/Temporary password: (gem-[A-Z0-9]{4}-[A-Z0-9]{4})/)[1];

  const member = client();
  const bad = await member.post('/portal/login', { cgjta_no: 'cgjta-0001', password: 'wrong' }, '/portal/login');
  assert.equal(bad.status, 401);
  const ok = await member.post('/portal/login', { cgjta_no: 'cgjta-0001', password }, '/portal/login');
  assert.equal(ok.status, 302);
  const home = await member.get('/portal');
  assert.equal(home.status, 200);
  assert.match(home.text, /Welcome, Kamal/);
  // A member session is not a staff session.
  assert.equal((await member.get('/members')).status, 302);
});

test('CSV export neutralises spreadsheet formulas', () => {
  assert.equal(h.csvRow(['=HYPERLINK("x")', 'plain', 'a,b']), `"'=HYPERLINK(""x"")",plain,"a,b"`);
});

test('date helpers handle leap years', () => {
  assert.equal(h.addYears('2028-02-29', 1), '2029-02-28');
  assert.equal(h.yearsBetween('2008-10-12', '2026-10-11'), 17);
  assert.equal(h.yearsBetween('2008-10-11', '2026-10-11'), 18);
});
