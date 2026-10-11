const session = require('express-session');

/** express-session store backed by the app's SQLite database. */
class SqliteStore extends session.Store {
  constructor(db, { ttlMs = 12 * 60 * 60 * 1000 } = {}) {
    super();
    this.db = db;
    this.ttlMs = ttlMs;
    this.stmts = {
      get: db.prepare('SELECT data, expires FROM sessions WHERE sid = ?'),
      set: db.prepare(
        'INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires'
      ),
      touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
      destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      prune: db.prepare('DELETE FROM sessions WHERE expires < ?'),
    };
    this.pruneTimer = setInterval(() => this.stmts.prune.run(Date.now()), 60 * 60 * 1000);
    this.pruneTimer.unref();
  }

  expiry(sess) {
    const e = sess && sess.cookie && sess.cookie.expires;
    return e ? new Date(e).getTime() : Date.now() + this.ttlMs;
  }

  get(sid, cb) {
    try {
      const row = this.stmts.get.get(sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      return cb(null, JSON.parse(row.data));
    } catch (err) {
      return cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      this.stmts.set.run(sid, JSON.stringify(sess), this.expiry(sess));
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      this.stmts.touch.run(this.expiry(sess), sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.stmts.destroy.run(sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }
}

module.exports = SqliteStore;
