const crypto = require('node:crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const [scheme, N, r, p, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  return crypto.timingSafeEqual(expected, actual);
}

/** Human-friendly temporary password, e.g. "gem-7K4Q-92XW". */
function generatePassword() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const pick = (n) => Array.from(crypto.randomBytes(n), (b) => alphabet[b % alphabet.length]).join('');
  return `gem-${pick(4)}-${pick(4)}`;
}

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 200) return 'Password is too long.';
  return null;
}

// Very small in-memory login throttle: 8 failures per key per 15 minutes.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const failures = new Map();

function throttleKey(req, id) {
  return `${req.ip}|${String(id || '').toLowerCase()}`;
}

function isThrottled(key) {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(key) {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) failures.set(key, { first: Date.now(), count: 1 });
  else entry.count += 1;
}

function clearFailures(key) {
  failures.delete(key);
}

function requireStaff(req, res, next) {
  if (res.locals.currentUser) return next();
  req.session.returnTo = req.originalUrl;
  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (!res.locals.currentUser) return requireStaff(req, res, next);
  if (res.locals.currentUser.role === 'admin') return next();
  return res.status(403).render('error', { title: 'Not allowed', message: 'Only administrators can open this page.' });
}

function requireMember(req, res, next) {
  if (res.locals.currentMember) return next();
  return res.redirect('/portal/login');
}

module.exports = {
  hashPassword, verifyPassword, generatePassword, passwordProblem,
  throttleKey, isThrottled, recordFailure, clearFailures,
  requireStaff, requireAdmin, requireMember,
};
