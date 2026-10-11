// Fills an empty database with sample members and payments so the screens
// have something to show. Refuses to run if any members already exist.
const db = require('../src/db');
const h = require('../src/helpers');
const auth = require('../src/auth');
const membersService = require('../src/services/members');
const paymentsService = require('../src/services/payments');
const usersService = require('../src/services/users');

const conn = db.open();
const members = membersService(conn);
const payments = paymentsService(conn, members);
const users = usersService(conn);

if (conn.prepare('SELECT COUNT(*) AS n FROM members').get().n > 0) {
  console.error('Members already exist — demo data not added.');
  process.exit(1);
}
if (users.count() === 0) {
  users.create({ username: 'admin', name: 'Administrator', role: 'admin', password: process.env.ADMIN_PASSWORD || 'change-me-now' });
  console.log('Created admin / change-me-now');
}
const adminId = conn.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`).get().id;
const today = h.today();
const ago = (days) => h.addDays(today, -days);

const people = [
  ['Ruwan', 'Perera', 'EXCO', 'Perera Gems (Pvt) Ltd', ['export_trading', 'local_trading'], 'Colombo 03', 900, 'approved'],
  ['Fathima', 'Rizwan', 'EXCO', 'Rizwan Jewellers', ['manufacturing'], 'Beruwala', 820, 'approved'],
  ['Nimal', 'Jayasuriya', 'PREMIER', 'Ratnapura Sapphire House', ['export_trading', 'import_trading'], 'Ratnapura', 700, 'approved'],
  ['Mohamed', 'Hafeel', 'PREMIER', 'Hafeel Gem Lapidary', ['manufacturing', 'local_trading'], 'Kandy', 400, 'approved'],
  ['Sanduni', 'Wickramasinghe', 'MEMBER', 'Blue Lotus Gems', ['broker'], 'Galle', 380, 'approved'],
  ['Kasun', 'Bandara', 'MEMBER', 'Bandara Gem Traders', ['local_trading'], 'Elahera', 340, 'approved'],
  ['Ishara', 'Fernando', 'MEMBER', 'Fernando Gemological Lab', ['support_industry'], 'Negombo', 200, 'approved'],
  ['Arjun', 'Selvaraj', 'MEMBER', '', ['buyer'], 'Colombo 06', 60, 'approved'],
  ['Dilani', 'Gunawardena', 'MEMBER', 'Gunawardena Heat Treatment', ['manufacturing'], 'Ratnapura', 6, 'pending'],
  ['Tharindu', 'Silva', 'PREMIER', 'Silva Gem Exports', ['export_trading'], 'Colombo 04', 3, 'pending'],
];

people.forEach(([first, last, tier, business, activities, city, daysAgo, status], i) => {
  const appDate = ago(daysAgo);
  const id = members.create({
    tier, first_name: first, last_name: last, name_on_card: `${first} ${last}`.toUpperCase(),
    nic_pp_no: `19${70 + i}${String(1234567 + i * 7919).slice(0, 7)}V`, gender: i % 3 === 1 ? 'female' : 'male',
    dob: `19${70 + i}-0${(i % 9) + 1}-1${i % 9}`, business_name: business, business_reg_no: business ? `PV ${10000 + i * 37}` : '',
    ngja_license_no: business ? `NGJA/${2000 + i * 13}` : '', address_line1: `${12 + i} Gem Street`, address_line2: '',
    city, postal_code: '', country: 'Sri Lanka', mobile: `+94 77 ${String(1000000 + i * 104729).slice(0, 7)}`,
    email: `${first.toLowerCase()}@example.com`, activities, proposed_by: i > 1 ? 'Ruwan Perera' : '', seconded_by: i > 1 ? 'Fathima Rizwan' : '',
    doc_nic: 1, doc_br: business ? 1 : 0, doc_gem_license: 1, doc_photo: 0, exco_vote: 0, terms_agreed: 1,
    application_date: appDate, cgjta_no: null, notes: '',
  }, adminId);

  if (status !== 'approved') return;
  members.approve(id, { segment_approved_by: 'A. B. Senanayake', exco_approved_by: 'R. Perera', approved_at: h.addDays(appDate, 5) }, adminId);
  const m = members.get(id);
  const fee = (type) => payments.suggestedAmount(m, type);
  const methods = ['cash', 'bank_transfer', 'cheque', 'online'];
  const pay = (type, paidOn, extra = {}) => {
    const { data, errors } = payments.validate({
      member_id: id, type, amount: h.centsToInput(fee(type) || 250000), method: methods[i % 4],
      reference: methods[i % 4] === 'cheque' ? `CHQ ${300100 + i}` : '', paid_on: paidOn, ...extra,
    });
    if (Object.keys(errors).length) throw new Error(JSON.stringify(errors));
    payments.create(data, adminId);
  };
  if (fee('admission')) pay('admission', h.addDays(appDate, 5));
  pay('subscription', h.addDays(appDate, 5));
  // Renew each year, paying shortly before expiry. One member has lapsed.
  const lapsed = i === 2;
  for (;;) {
    const until = members.get(id).valid_until;
    const due = h.addDays(until, -10);
    if (lapsed || until >= today || due > today) break;
    pay('subscription', due);
  }
});

console.log(`Added ${people.length} demo members with payments.`);
