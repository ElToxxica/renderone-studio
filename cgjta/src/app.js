const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const config = require('./config');
const h = require('./helpers');
const csrf = require('./csrf');
const SqliteStore = require('./session-store');
const { allSettings } = require('./db');
const { requireStaff } = require('./auth');

const membersService = require('./services/members');
const paymentsService = require('./services/payments');
const usersService = require('./services/users');

const ARTWORK_DIR = path.join(config.ROOT, 'public', 'artwork');
const ARTWORK_EXTS = ['png', 'jpg', 'webp', 'svg'];

/** URL of an artwork file by base name (see public/artwork/README.md), or null. */
function artwork(name) {
  for (const ext of ARTWORK_EXTS) {
    if (fs.existsSync(path.join(ARTWORK_DIR, `${name}.${ext}`))) return `/static/artwork/${name}.${ext}`;
  }
  return null;
}

function createApp({ db, sessionSecret }) {
  const app = express();
  const members = membersService(db);
  const services = { db, members, payments: paymentsService(db, members), users: usersService(db) };
  app.locals.services = services;

  app.set('views', path.join(config.ROOT, 'views'));
  app.set('view engine', 'ejs');
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:'],
          // Only force HTTPS sub-resources when the site itself is served over HTTPS.
          'upgrade-insecure-requests': config.COOKIE_SECURE ? [] : null,
        },
      },
    })
  );
  app.use('/static', express.static(path.join(config.ROOT, 'public'), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));

  app.use(
    session({
      name: 'cgjta.sid',
      secret: sessionSecret,
      store: new SqliteStore(db),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: { httpOnly: true, sameSite: 'lax', secure: config.COOKIE_SECURE, maxAge: 12 * 60 * 60 * 1000 },
    })
  );
  // Shared view locals.
  app.use((req, res, next) => {
    req.flash = (type, message) => {
      req.session.flash = [...(req.session.flash || []), { type, message }];
    };
    res.locals.flash = req.session.flash || [];
    delete req.session.flash;

    res.locals.h = h;
    res.locals.artwork = artwork;
    res.locals.config = config;
    res.locals.settings = allSettings(db);
    res.locals.path = req.path;
    res.locals.currentUser = null;
    res.locals.currentMember = null;

    if (req.session.userId) {
      const user = services.users.get(req.session.userId);
      if (user && user.active) {
        res.locals.currentUser = user;
        res.locals.pendingCount = db.prepare(`SELECT COUNT(*) AS n FROM members WHERE status = 'pending'`).get().n;
      } else delete req.session.userId;
    }
    if (req.session.memberId) {
      const member = services.members.get(req.session.memberId);
      if (member && member.status !== 'rejected' && member.portal_password_hash) res.locals.currentMember = member;
      else delete req.session.memberId;
    }
    next();
  });
  app.use(csrf.issue);
  app.use(csrf.guard);

  app.use(require('./routes/auth'));
  app.use('/portal', require('./routes/portal'));

  // Everything below needs a staff login.
  app.use(requireStaff);
  app.use(require('./routes/dashboard'));
  app.use('/members', require('./routes/members'));
  app.use('/payments', require('./routes/payments'));
  app.use('/settings', require('./routes/settings'));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    const status = err.status || err.statusCode || 500;
    const message = status < 500 && err.expose ? err.message : 'Something went wrong. The error has been logged.';
    Object.assign(res.locals, {
      h, config, artwork, flash: [], path: req.path,
      settings: res.locals.settings || allSettings(db),
      currentUser: res.locals.currentUser || null,
      currentMember: res.locals.currentMember || null,
    });
    res.status(status).render('error', { title: 'Error', message });
  });

  return app;
}

module.exports = { createApp };
