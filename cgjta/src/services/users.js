const config = require('../config');
const h = require('../helpers');
const auth = require('../auth');

module.exports = function usersService(db) {
  const PUBLIC_COLS = 'id, username, name, role, active, last_login_at, created_at';

  function list() {
    return db.prepare(`SELECT ${PUBLIC_COLS} FROM users ORDER BY active DESC, name`).all();
  }

  function get(id) {
    return db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE id = ?`).get(Number(id));
  }

  function count() {
    return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  }

  /** Returns the user row on success, or null. */
  function authenticate(username, password) {
    const row = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(h.str(username, 60));
    if (!row || !auth.verifyPassword(password, row.password_hash)) return null;
    db.prepare(`UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(row.id);
    return get(row.id);
  }

  function validate(input, { requirePassword = true } = {}) {
    const errors = {};
    const d = {
      username: h.str(input.username, 60).toLowerCase(),
      name: h.str(input.name, 100),
      role: config.STAFF_ROLES.some((r) => r.code === input.role) ? input.role : 'staff',
      password: typeof input.password === 'string' ? input.password : '',
    };
    if (!/^[a-z0-9._-]{3,60}$/.test(d.username)) errors.username = 'Use 3+ letters, numbers, dots, dashes or underscores.';
    else if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(d.username)) errors.username = 'That username is taken.';
    if (!d.name) errors.name = 'Name is required.';
    if (requirePassword) {
      const problem = auth.passwordProblem(d.password);
      if (problem) errors.password = problem;
    }
    return { data: d, errors };
  }

  function create({ username, name, role, password }) {
    const res = db
      .prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)')
      .run(username, name, role, auth.hashPassword(password));
    return Number(res.lastInsertRowid);
  }

  function setPassword(id, password) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(password), Number(id));
  }

  function checkPassword(id, password) {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(Number(id));
    return Boolean(row) && auth.verifyPassword(password, row.password_hash);
  }

  function setActive(id, active) {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, Number(id));
  }

  function setRole(id, role) {
    if (!config.STAFF_ROLES.some((r) => r.code === role)) return;
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, Number(id));
  }

  function activeAdminCount() {
    return db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1`).get().n;
  }

  return { list, get, count, authenticate, validate, create, setPassword, checkPassword, setActive, setRole, activeAdminCount };
};
