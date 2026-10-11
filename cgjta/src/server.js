const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

try {
  process.loadEnvFile(path.resolve(__dirname, '..', '.env'));
} catch {
  // No .env file — rely on the real environment.
}

const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const usersService = require('./services/users');
const { createApp } = require('./app');

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(config.DATA_DIR, '.session-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const database = db.open();
const users = usersService(database);

if (users.count() === 0) {
  const password = process.env.ADMIN_PASSWORD || auth.generatePassword();
  users.create({ username: 'admin', name: 'Administrator', role: 'admin', password });
  console.log('\n  First run: created administrator account');
  console.log('    username: admin');
  console.log(`    password: ${process.env.ADMIN_PASSWORD ? '(from ADMIN_PASSWORD)' : password}`);
  console.log('  Change it after signing in (top-right menu → Change password).\n');
}

const app = createApp({ db: database, sessionSecret: sessionSecret() });
app.listen(config.PORT, () => {
  console.log(`CGJTA membership app running on http://localhost:${config.PORT}`);
});
