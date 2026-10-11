const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');

module.exports = {
  ROOT,
  DATA_DIR,
  DB_PATH: process.env.DB_PATH || path.join(DATA_DIR, 'cgjta.db'),
  UPLOAD_DIR: path.join(DATA_DIR, 'uploads'),
  PORT: Number(process.env.PORT) || 3000,
  TZ_NAME: process.env.TZ_NAME || 'Asia/Colombo',
  COOKIE_SECURE: process.env.COOKIE_SECURE === '1',
  CURRENCY: 'LKR',

  // Default tiers. Fees and colours are editable in Settings; these are only
  // the first-run values.
  DEFAULT_TIERS: [
    { code: 'EXCO', name: 'EXCO', admission_fee: 0, annual_fee: 25000_00, color: '#9a7b2f', sort_order: 1 },
    { code: 'PREMIER', name: 'Premier', admission_fee: 10000_00, annual_fee: 15000_00, color: '#1f3f8f', sort_order: 2 },
    { code: 'MEMBER', name: 'Member', admission_fee: 5000_00, annual_fee: 5000_00, color: '#4b5563', sort_order: 3 },
  ],

  // "Primary Business Activity" on the paper application form.
  ACTIVITIES: [
    { code: 'export_trading', label: 'Export Trading', hint: 'Primarily involved in exporting goods purchased locally' },
    { code: 'import_trading', label: 'Import Trading', hint: 'Primarily involved in importing goods from Africa / other countries for local trading' },
    { code: 'local_trading', label: 'Local Trading', hint: 'Primarily involved in buying & selling locally' },
    { code: 'manufacturing', label: 'Manufacturing', hint: 'Lapidary, mining, workshop (e.g. heating / goldsmith)' },
    { code: 'broker', label: 'Broker', hint: 'Primarily involved in trading goods of others, buyer handling agent' },
    { code: 'support_industry', label: 'Support Industry', hint: 'Gemological service, tools & equipment, shipping / handling agent, landlord' },
    { code: 'buyer', label: 'Buyer', hint: 'International frequent visitor' },
  ],

  // Supporting documents checklist on page 2 of the form.
  DOCUMENTS: [
    { field: 'doc_nic', label: 'NIC / Passport / Driving licence copy' },
    { field: 'doc_br', label: 'Business registration (BR) copy' },
    { field: 'doc_gem_license', label: 'Gem licence copy' },
    { field: 'doc_photo', label: 'Digital photo' },
  ],

  PAYMENT_TYPES: [
    { code: 'subscription', label: 'Annual subscription' },
    { code: 'admission', label: 'Admission / registration fee' },
    { code: 'card', label: 'Card replacement' },
    { code: 'other', label: 'Other' },
  ],

  PAYMENT_METHODS: [
    { code: 'cash', label: 'Cash' },
    { code: 'cheque', label: 'Cheque' },
    { code: 'bank_transfer', label: 'Bank transfer' },
    { code: 'card', label: 'Card' },
    { code: 'online', label: 'Online' },
  ],

  // Application / admin state stored on the member row.
  STATUSES: ['pending', 'approved', 'rejected', 'suspended'],

  // Computed standing shown everywhere (see services/members.js#standingSql).
  STANDINGS: {
    pending: { label: 'Pending approval', tone: 'info' },
    active: { label: 'Active', tone: 'good' },
    due_soon: { label: 'Renewal due', tone: 'warn' },
    expired: { label: 'Expired', tone: 'bad' },
    suspended: { label: 'Suspended', tone: 'bad' },
    rejected: { label: 'Rejected', tone: 'muted' },
  },

  STAFF_ROLES: [
    { code: 'admin', label: 'Administrator', hint: 'Everything, including settings and staff accounts' },
    { code: 'staff', label: 'Staff', hint: 'Members, applications and payments' },
  ],

  MIN_AGE: 18,
};
