const config = require('../config');
const h = require('../helpers');
const { tx, getSetting, setSetting, logActivity } = require('../db');

module.exports = function paymentsService(db, members) {
  const SELECT = `
    SELECT p.*, m.first_name, m.last_name, m.cgjta_no, m.tier, m.business_name,
           u.name AS recorded_by_name, v.name AS voided_by_name
    FROM payments p
    JOIN members m ON m.id = p.member_id
    LEFT JOIN users u ON u.id = p.recorded_by
    LEFT JOIN users v ON v.id = p.voided_by`;

  function decorate(p) {
    if (!p) return p;
    return { ...p, member_name: h.fullName(p) };
  }

  function buildWhere({ from, to, type, method, q, memberId, includeVoided }) {
    const where = [];
    const params = {};
    if (!includeVoided) where.push('p.voided_at IS NULL');
    if (h.isIsoDate(from)) {
      where.push('p.paid_on >= :from');
      params.from = from;
    }
    if (h.isIsoDate(to)) {
      where.push('p.paid_on <= :to');
      params.to = to;
    }
    if (type) {
      where.push('p.type = :type');
      params.type = type;
    }
    if (method) {
      where.push('p.method = :method');
      params.method = method;
    }
    if (memberId) {
      where.push('p.member_id = :memberId');
      params.memberId = Number(memberId);
    }
    if (q) {
      where.push(`(p.receipt_no LIKE :q OR p.reference LIKE :q OR m.cgjta_no LIKE :q
        OR m.first_name || ' ' || m.last_name LIKE :q OR m.business_name LIKE :q)`);
      params.q = `%${q}%`;
    }
    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }

  function list(filters = {}, { page = 1, perPage = 50 } = {}) {
    const { sql, params } = buildWhere(filters);
    const agg = db
      .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN p.voided_at IS NULL THEN p.amount ELSE 0 END), 0) AS sum
        FROM payments p JOIN members m ON m.id = p.member_id ${sql}`)
      .get(params);
    const all = perPage === Infinity;
    const pages = all ? 1 : Math.max(1, Math.ceil(agg.n / perPage));
    const current = Math.min(Math.max(1, Number(page) || 1), pages);
    const limitSql = all ? '' : `LIMIT ${Number(perPage)} OFFSET ${(current - 1) * Number(perPage)}`;
    const rows = db.prepare(`${SELECT} ${sql} ORDER BY p.paid_on DESC, p.id DESC ${limitSql}`).all(params).map(decorate);
    return { rows, total: agg.n, sum: agg.sum, page: current, pages };
  }

  function get(id) {
    return decorate(db.prepare(`${SELECT} WHERE p.id = ?`).get(Number(id)));
  }

  function forMember(memberId) {
    return db.prepare(`${SELECT} WHERE p.member_id = ? ORDER BY p.paid_on DESC, p.id DESC`).all(Number(memberId)).map(decorate);
  }

  function recent(limit = 6) {
    return db.prepare(`${SELECT} WHERE p.voided_at IS NULL ORDER BY p.created_at DESC LIMIT ${Number(limit)}`).all().map(decorate);
  }

  /** Next receipt number for the year of `paidOn`, e.g. R2026-00042. Call inside a transaction. */
  function nextReceiptNo(paidOn) {
    const year = paidOn.slice(0, 4);
    const prefix = getSetting(db, 'receipt_prefix');
    const key = `receipt_seq_${year}`;
    let n = Number(getSetting(db, key)) || 1;
    const exists = db.prepare('SELECT 1 FROM payments WHERE receipt_no = ?');
    let candidate;
    do {
      candidate = `${prefix}${year}-${String(n).padStart(5, '0')}`;
      n += 1;
    } while (exists.get(candidate));
    setSetting(db, key, n);
    return candidate;
  }

  /** Subscription covers 12 months from the day after the current expiry (or from the payment date). */
  function defaultPeriod(member, paidOn) {
    const start = member && member.valid_until && member.valid_until >= paidOn ? h.addDays(member.valid_until, 1) : paidOn;
    return { from: start, to: h.addDays(h.addYears(start, 1), -1) };
  }

  /** Suggested amount for a payment type, based on the member's tier. */
  function suggestedAmount(member, type) {
    if (!member) return null;
    const tier = db.prepare('SELECT admission_fee, annual_fee FROM tiers WHERE code = ?').get(member.tier);
    if (!tier) return null;
    if (type === 'subscription') return tier.annual_fee;
    if (type === 'admission') return tier.admission_fee;
    return null;
  }

  function validate(input) {
    const errors = {};
    const d = {
      member_id: Number(input.member_id) || null,
      receipt_no: h.str(input.receipt_no, 40).toUpperCase() || null,
      type: h.str(input.type, 30),
      amount: h.parseMoney(input.amount),
      method: h.str(input.method, 30),
      reference: h.str(input.reference, 120),
      paid_on: h.str(input.paid_on, 10) || h.today(),
      period_from: h.str(input.period_from, 10) || null,
      period_to: h.str(input.period_to, 10) || null,
      notes: h.str(input.notes, 1000),
    };
    const member = d.member_id ? members.get(d.member_id) : null;
    if (!member) errors.member_id = 'Choose a member.';
    if (!config.PAYMENT_TYPES.some((t) => t.code === d.type)) errors.type = 'Choose a payment type.';
    if (!config.PAYMENT_METHODS.some((t) => t.code === d.method)) errors.method = 'Choose a payment method.';
    if (d.amount === null) errors.amount = 'Enter an amount, e.g. 5000 or 5,000.00.';
    if (!h.isIsoDate(d.paid_on)) errors.paid_on = 'Enter a valid date.';
    else if (d.paid_on > h.today()) errors.paid_on = 'Payment date cannot be in the future.';
    if (d.method === 'cheque' && !d.reference) errors.reference = 'Enter the cheque number.';

    if (d.type === 'subscription' && !errors.paid_on) {
      if (!d.period_from && !d.period_to) {
        const p = defaultPeriod(member, d.paid_on);
        d.period_from = p.from;
        d.period_to = p.to;
      } else if (d.period_from && !d.period_to && h.isIsoDate(d.period_from)) {
        d.period_to = h.addDays(h.addYears(d.period_from, 1), -1);
      }
      if (!h.isIsoDate(d.period_from)) errors.period_from = 'Enter a valid start date.';
      if (!h.isIsoDate(d.period_to)) errors.period_to = 'Enter a valid end date.';
      else if (d.period_from && d.period_to < d.period_from) errors.period_to = 'End date must be after the start date.';
    } else if (d.type !== 'subscription') {
      d.period_from = null;
      d.period_to = null;
    }

    if (d.receipt_no && db.prepare('SELECT 1 FROM payments WHERE receipt_no = ?').get(d.receipt_no)) {
      errors.receipt_no = 'This receipt number has already been used.';
    }
    return { data: d, errors, member };
  }

  function create(d, userId) {
    return tx(db, () => {
      const receiptNo = d.receipt_no || nextReceiptNo(d.paid_on);
      const res = db
        .prepare(`INSERT INTO payments (receipt_no, member_id, type, amount, method, reference, paid_on, period_from, period_to, notes, recorded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(receiptNo, d.member_id, d.type, d.amount, d.method, d.reference, d.paid_on, d.period_from, d.period_to, d.notes, userId);
      if (d.type === 'subscription') members.recomputeValidUntil(d.member_id);
      const label = config.PAYMENT_TYPES.find((t) => t.code === d.type).label;
      logActivity(db, { userId, memberId: d.member_id, action: 'payment.recorded', details: `${receiptNo} · ${label} · ${h.money(d.amount)}` });
      return Number(res.lastInsertRowid);
    });
  }

  function voidPayment(id, reason, userId) {
    const p = get(id);
    if (!p) return { error: 'Payment not found.' };
    if (p.voided_at) return { error: 'This payment is already void.' };
    const why = h.str(reason, 300);
    if (!why) return { error: 'Give a reason for voiding this payment.' };
    tx(db, () => {
      db.prepare(`UPDATE payments SET voided_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), voided_by = ?, void_reason = ? WHERE id = ?`)
        .run(userId, why, p.id);
      if (p.type === 'subscription') members.recomputeValidUntil(p.member_id);
      logActivity(db, { userId, memberId: p.member_id, action: 'payment.voided', details: `${p.receipt_no} — ${why}` });
    });
    return {};
  }

  function totals() {
    const today = h.today();
    const sum = (from, to) =>
      db.prepare('SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS n FROM payments WHERE voided_at IS NULL AND paid_on BETWEEN ? AND ?')
        .get(from, to);
    return {
      month: sum(`${today.slice(0, 7)}-01`, today),
      year: sum(`${today.slice(0, 4)}-01-01`, today),
    };
  }

  /** Collections per month for a given year: [{ month: '2026-01', total, count }, ...] */
  function monthly(year) {
    const rows = db
      .prepare(`SELECT substr(paid_on, 1, 7) AS month, SUM(amount) AS total, COUNT(*) AS count
        FROM payments WHERE voided_at IS NULL AND paid_on LIKE ? GROUP BY 1`)
      .all(`${year}-%`);
    const byMonth = Object.fromEntries(rows.map((r) => [r.month, r]));
    return Array.from({ length: 12 }, (_, i) => {
      const month = `${year}-${String(i + 1).padStart(2, '0')}`;
      return byMonth[month] || { month, total: 0, count: 0 };
    });
  }

  return { list, get, forMember, recent, defaultPeriod, suggestedAmount, validate, create, voidPayment, totals, monthly };
};
