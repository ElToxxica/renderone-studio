// Usage: npm run user:create -- <username> "<Full name>" [admin|staff]
// Prompts are avoided on purpose so this works over SSH / in CI: the password
// is generated and printed once.
const db = require('../src/db');
const auth = require('../src/auth');
const usersService = require('../src/services/users');

const [username, name, role = 'staff'] = process.argv.slice(2);
if (!username || !name) {
  console.error('Usage: npm run user:create -- <username> "<Full name>" [admin|staff]');
  process.exit(1);
}
const users = usersService(db.open());
const password = auth.generatePassword();
const { data, errors } = users.validate({ username, name, role, password });
if (Object.keys(errors).length) {
  console.error(Object.values(errors).join('\n'));
  process.exit(1);
}
users.create(data);
console.log(`Created ${data.role} "${data.username}". Temporary password: ${password}`);
