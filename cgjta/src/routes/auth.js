const express = require('express');
const auth = require('../auth');

const router = express.Router();

function regenerate(req) {
  return new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
}

router.get('/login', (req, res) => {
  if (res.locals.currentUser) return res.redirect('/');
  res.render('login', { title: 'Staff sign in', username: '', error: null });
});

router.post('/login', async (req, res) => {
  const { users } = req.app.locals.services;
  const username = String(req.body.username || '').trim();
  const key = auth.throttleKey(req, username);
  if (auth.isThrottled(key)) {
    return res.status(429).render('login', { title: 'Staff sign in', username, error: 'Too many attempts. Try again in 15 minutes.' });
  }
  const user = users.authenticate(username, String(req.body.password || ''));
  if (!user) {
    auth.recordFailure(key);
    return res.status(401).render('login', { title: 'Staff sign in', username, error: 'Incorrect username or password.' });
  }
  auth.clearFailures(key);
  const returnTo = req.session.returnTo;
  await regenerate(req);
  req.session.userId = user.id;
  // Only same-site paths: "//host" and "/\host" would leave the site.
  res.redirect(typeof returnTo === 'string' && /^\/(?![/\\])/.test(returnTo) ? returnTo : '/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.get('/account/password', auth.requireStaff, (req, res) => {
  res.render('account-password', { title: 'Change password', errors: {} });
});

router.post('/account/password', auth.requireStaff, (req, res) => {
  const { users } = req.app.locals.services;
  const me = res.locals.currentUser;
  const errors = {};
  if (!users.checkPassword(me.id, String(req.body.current || ''))) errors.current = 'Current password is incorrect.';
  const problem = auth.passwordProblem(req.body.password);
  if (problem) errors.password = problem;
  else if (req.body.password !== req.body.confirm) errors.confirm = 'Passwords do not match.';
  if (Object.keys(errors).length) return res.status(422).render('account-password', { title: 'Change password', errors });
  users.setPassword(me.id, req.body.password);
  req.flash('good', 'Your password has been changed.');
  res.redirect('/');
});

module.exports = router;
