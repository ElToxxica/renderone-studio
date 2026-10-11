const express = require('express');
const config = require('../config');
const h = require('../helpers');
const auth = require('../auth');
const { setSetting, logActivity } = require('../db');

const router = express.Router();
router.use(auth.requireAdmin);

function render(req, res, extra = {}) {
  const { members, users } = req.app.locals.services;
  res.status(extra.status || 200).render('settings/index', {
    title: 'Settings',
    tiers: members.tiers(),
    users: users.list(),
    userErrors: {},
    userValues: { role: 'staff' },
    ...extra,
  });
}

router.get('/', (req, res) => render(req, res));

router.post('/tiers', (req, res) => {
  const { members, db } = req.app.locals.services;
  const errors = [];
  for (const t of members.tiers()) {
    const name = h.str(req.body[`name_${t.code}`], 40) || t.name;
    const admission = h.parseMoney(req.body[`admission_${t.code}`]);
    const annual = h.parseMoney(req.body[`annual_${t.code}`]);
    const color = /^#[0-9a-f]{6}$/i.test(req.body[`color_${t.code}`]) ? req.body[`color_${t.code}`] : t.color;
    if (admission === null || annual === null) {
      errors.push(`Check the fees for ${t.name}.`);
      continue;
    }
    db.prepare('UPDATE tiers SET name = ?, admission_fee = ?, annual_fee = ?, color = ? WHERE code = ?').run(name, admission, annual, color, t.code);
  }
  logActivity(db, { userId: res.locals.currentUser.id, action: 'settings.tiers_updated' });
  if (errors.length) req.flash('bad', errors.join(' '));
  else req.flash('good', 'Tier settings saved.');
  res.redirect('/settings#tiers');
});

router.post('/numbering', (req, res) => {
  const { db } = req.app.locals.services;
  const prefix = h.str(req.body.member_no_prefix, 12);
  const digits = Number(req.body.member_no_digits);
  const next = Number(req.body.next_member_no);
  const receipt = h.str(req.body.receipt_prefix, 8);
  const windowDays = Number(req.body.renewal_window_days);
  if (!/^[A-Za-z0-9-]*$/.test(prefix) || !/^[A-Za-z0-9-]*$/.test(receipt) || !(digits >= 1 && digits <= 8)
    || !(Number.isInteger(next) && next >= 1) || !(Number.isInteger(windowDays) && windowDays >= 0 && windowDays <= 365)) {
    req.flash('bad', 'Check the numbering values: prefixes may use letters, numbers and dashes; digits 1–8; renewal window 0–365 days.');
    return res.redirect('/settings#numbering');
  }
  setSetting(db, 'member_no_prefix', prefix.toUpperCase());
  setSetting(db, 'member_no_digits', digits);
  setSetting(db, 'next_member_no', next);
  setSetting(db, 'receipt_prefix', receipt.toUpperCase());
  setSetting(db, 'renewal_window_days', windowDays);
  logActivity(db, { userId: res.locals.currentUser.id, action: 'settings.numbering_updated' });
  req.flash('good', 'Numbering settings saved.');
  res.redirect('/settings#numbering');
});

router.post('/users', (req, res) => {
  const { users, db } = req.app.locals.services;
  const { data, errors } = users.validate(req.body);
  if (Object.keys(errors).length) return render(req, res, { userErrors: errors, userValues: data, status: 422 });
  users.create(data);
  logActivity(db, { userId: res.locals.currentUser.id, action: 'staff.created', details: data.username });
  req.flash('good', `Staff account “${data.username}” created.`);
  res.redirect('/settings#staff');
});

router.post('/users/:id', (req, res) => {
  const { users, db } = req.app.locals.services;
  const user = users.get(req.params.id);
  const me = res.locals.currentUser;
  if (!user) return res.redirect('/settings#staff');
  const action = req.body.action;
  const removesAdmin = user.role === 'admin' && user.active && (action === 'deactivate' || (action === 'role' && req.body.role !== 'admin'));
  if (removesAdmin && users.activeAdminCount() <= 1) {
    req.flash('bad', 'Keep at least one active administrator.');
  } else if (action === 'reset') {
    const password = auth.generatePassword();
    users.setPassword(user.id, password);
    req.flash('secret', `New temporary password for ${user.username}: ${password} (shown once).`);
  } else if (action === 'deactivate' && user.id !== me.id) {
    users.setActive(user.id, false);
    req.flash('good', `${user.username} can no longer sign in.`);
  } else if (action === 'activate') {
    users.setActive(user.id, true);
    req.flash('good', `${user.username} re-enabled.`);
  } else if (action === 'role' && config.STAFF_ROLES.some((r) => r.code === req.body.role)) {
    users.setRole(user.id, req.body.role);
    req.flash('good', `${user.username} is now ${req.body.role}.`);
  }
  logActivity(db, { userId: me.id, action: `staff.${action}`, details: user.username });
  res.redirect('/settings#staff');
});

module.exports = router;
