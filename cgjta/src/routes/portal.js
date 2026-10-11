const express = require('express');
const auth = require('../auth');
const { sendPhoto } = require('./members');

const router = express.Router();

function regenerate(req) {
  return new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
}

router.get('/login', (req, res) => {
  if (res.locals.currentMember) return res.redirect('/portal');
  res.render('portal/login', { title: 'Member sign in', cgjtaNo: '', error: null });
});

router.post('/login', async (req, res) => {
  const { members } = req.app.locals.services;
  const cgjtaNo = String(req.body.cgjta_no || '').trim().toUpperCase();
  const key = auth.throttleKey(req, `member:${cgjtaNo}`);
  const fail = (status, error) => res.status(status).render('portal/login', { title: 'Member sign in', cgjtaNo, error });
  if (auth.isThrottled(key)) return fail(429, 'Too many attempts. Try again in 15 minutes.');
  const member = cgjtaNo ? members.getByCgjtaNo(cgjtaNo) : null;
  const ok = member && member.portal_password_hash && member.status !== 'rejected'
    && auth.verifyPassword(String(req.body.password || ''), member.portal_password_hash);
  if (!ok) {
    auth.recordFailure(key);
    return fail(401, 'Incorrect membership number or password.');
  }
  auth.clearFailures(key);
  await regenerate(req);
  req.session.memberId = member.id;
  res.redirect('/portal');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/portal/login'));
});

router.get('/', auth.requireMember, (req, res) => {
  const { payments } = req.app.locals.services;
  const member = res.locals.currentMember;
  res.render('portal/home', {
    title: 'My membership',
    member,
    payments: payments.forMember(member.id).filter((p) => !p.voided_at),
  });
});

router.get('/card', auth.requireMember, (req, res) => {
  res.render('members/card', { title: 'My membership card', member: res.locals.currentMember, photoUrl: '/portal/photo', portal: true });
});

router.get('/photo', auth.requireMember, (req, res) => sendPhoto(res.locals.currentMember, res));

router.get('/password', auth.requireMember, (req, res) => {
  res.render('portal/password', { title: 'Change password', errors: {} });
});

router.post('/password', auth.requireMember, (req, res) => {
  const { members } = req.app.locals.services;
  const member = res.locals.currentMember;
  const errors = {};
  if (!auth.verifyPassword(String(req.body.current || ''), member.portal_password_hash)) errors.current = 'Current password is incorrect.';
  const problem = auth.passwordProblem(req.body.password);
  if (problem) errors.password = problem;
  else if (req.body.password !== req.body.confirm) errors.confirm = 'Passwords do not match.';
  if (Object.keys(errors).length) return res.status(422).render('portal/password', { title: 'Change password', errors });
  members.setPortalPassword(member.id, auth.hashPassword(req.body.password), null);
  req.flash('good', 'Your password has been changed.');
  res.redirect('/portal');
});

module.exports = router;
