const config = require('./config');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date (YYYY-MM-DD) in the association's time zone. */
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.TZ_NAME }).format(new Date());
}

function isIsoDate(s) {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addYears(iso, years) {
  const [y, m, d] = iso.split('-').map(Number);
  // Clamp 29 Feb to 28 Feb in non-leap years instead of rolling into March.
  const target = new Date(Date.UTC(y + years, m - 1, 1));
  const lastDay = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Whole years between two ISO dates (age on a given day). */
function yearsBetween(fromIso, toIso) {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  let years = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) years -= 1;
  return years;
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: config.TZ_NAME, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

/** Format cents as "LKR 12,500.00". */
function money(cents, { symbol = true, decimals = true } = {}) {
  const n = (Number(cents) || 0) / 100;
  const d = decimals ? 2 : 0;
  const s = n.toLocaleString('en-LK', { minimumFractionDigits: d, maximumFractionDigits: d });
  return symbol ? `${config.CURRENCY} ${s}` : s;
}

/** Parse a user-entered amount ("12,500.50") into integer cents, or null. */
function parseMoney(input) {
  if (input === undefined || input === null) return null;
  const s = String(input).replace(/[,\s]/g, '').replace(/^LKR/i, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

function centsToInput(cents) {
  return ((Number(cents) || 0) / 100).toFixed(2);
}

/** Compact a rupee amount (in cents) for axis ticks: 0, 500, 25K, 1.2M. */
function compactMoney(cents) {
  const n = (Number(cents) || 0) / 100;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

/** A rounded axis maximum and step for `max`, with about `ticks` gridlines. */
function niceScale(max, ticks = 4) {
  if (!(max > 0)) return { top: ticks, step: 1 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
  return { top: step * Math.ceil(max / step), step };
}

function str(v, max = 200) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}

function bool(v) {
  return v === 'on' || v === '1' || v === 'true' || v === true ? 1 : 0;
}

/** Normalise a checkbox group value to an array. */
function arr(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

function fullName(m) {
  return [m.first_name, m.last_name].filter(Boolean).join(' ');
}

function initials(m) {
  return [m.first_name, m.last_name].filter(Boolean).map((s) => s[0].toUpperCase()).join('');
}

/** Build a query string from an object, dropping empty values. */
function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

const ACTIVITY_LABELS = {
  'application.created': 'Application received',
  'application.approved': 'Application approved',
  'application.rejected': 'Application rejected',
  'application.reopened': 'Application reopened',
  'member.updated': 'Details updated',
  'member.suspended': 'Membership suspended',
  'member.reinstated': 'Membership reinstated',
  'member.photo_updated': 'Photo updated',
  'payment.recorded': 'Payment recorded',
  'payment.voided': 'Payment voided',
  'portal.password_set': 'Portal password set',
  'portal.disabled': 'Portal access disabled',
  'settings.tiers_updated': 'Tier fees updated',
  'settings.numbering_updated': 'Numbering updated',
  'staff.created': 'Staff account created',
};

function activityLabel(action) {
  return ACTIVITY_LABELS[action] || String(action).replace(/[._]/g, ' ');
}

function csvRow(values) {
  return values
    .map((v) => {
      let s = v === null || v === undefined ? '' : String(v);
      // Neutralise spreadsheet formula injection.
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}

module.exports = {
  MONTHS,
  today, isIsoDate, addDays, addYears, yearsBetween, daysBetween,
  fmtDate, fmtDateTime, money, parseMoney, centsToInput, compactMoney, niceScale,
  str, bool, arr, fullName, initials, qs, csvRow, activityLabel,
};
