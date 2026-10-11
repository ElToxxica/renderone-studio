const crypto = require('node:crypto');

/** Issue a per-session token and expose it to views as `csrfToken`. */
function issue(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('base64url');
  res.locals.csrfToken = req.session.csrf;
  next();
}

function tokenMatches(req) {
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const expected = req.session.csrf || '';
  if (!sent || sent.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
}

/** Reject state-changing requests without a valid token. */
function verify(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (tokenMatches(req)) return next();
  return res.status(403).render('error', {
    title: 'Form expired',
    message: 'This form has expired or was submitted from another page. Go back, refresh, and try again.',
  });
}

// Routes that accept file uploads. Their body is parsed by multer inside the
// route, so they must call `verify` themselves after the upload parser runs.
const MULTIPART_ROUTES = [/^\/members\/\d+\/photo$/];

/** Global guard for every state-changing request. */
function guard(req, res, next) {
  if (req.is('multipart/form-data') && MULTIPART_ROUTES.some((re) => re.test(req.path))) return next();
  return verify(req, res, next);
}

module.exports = { issue, verify, guard };
