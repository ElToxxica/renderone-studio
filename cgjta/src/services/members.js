const config = require('../config');
const h = require('../helpers');
const { tx, getSetting, setSetting, logActivity } = require('../db');

// Computed membership standing. Needs :today and :soon bound.
const STANDING_SQL = `CASE
  WHEN m.status = 'pending' THEN 'pending'
  WHEN m.status = 'rejected' THEN 'rejected'
  WHEN m.status = 'suspended' THEN 'suspended'
  WHEN m.valid_until IS NULL OR m.valid_until < :today THEN 'expired'
  WHEN m.valid_until <= :soon THEN 'due_soon'
  ELSE 'active' END`;

const EDITABLE_FIELDS = [
  'tier', 'first_name', 'last_name', 'name_on_card', 'nic_pp_no', 'gender', 'dob',
  'business_name', 'business_reg_no', 'ngja_license_no',
  'address_line1', 'address_line2', 'city', 'postal_code', 'country', 'mobile', 'email',
  'activities', 'proposed_by', 'seconded_by',
  'doc_nic', 'doc_br', 'doc_gem_license', 'doc_photo', 'exco_vote', 'terms_agreed', 'application_date',
  'cgjta_no', 'notes',
];

module.exports = function membersService(db) {
  function standingParams() {
    const today = h.today();
    const windowDays = Number(getSetting(db, 'renewal_window_days')) || 30;
    return { today, soon: h.addDays(today, windowDays) };
  }

  function decorate(row) {
    if (!row) return row;
    const m = { ...row };
    try {
      m.activities = JSON.parse(m.activities || '[]');
    } catch {
      m.activities = [];
    }
    m.full_name = h.fullName(m);
    m.initials = h.initials(m);
    return m;
  }

  const BASE_SELECT = `
    SELECT m.*, ${STANDING_SQL} AS standing, t.name AS tier_name, t.color AS tier_color, t.annual_fee AS tier_annual_fee
    FROM members m JOIN tiers t ON t.code = m.tier`;

  function list({ q = '', tier = '', standing = '', page = 1, perPage = 50 } = {}) {
    const where = [];
    const params = {};
    if (q) {
      where.push(`(m.first_name || ' ' || m.last_name LIKE :q OR m.cgjta_no LIKE :q OR m.nic_pp_no LIKE :q
        OR m.business_name LIKE :q OR m.mobile LIKE :q OR m.email LIKE :q OR m.name_on_card LIKE :q)`);
      params.q = `%${q}%`;
    }
    if (tier) {
      where.push('m.tier = :tier');
      params.tier = tier;
    }
    if (standing) {
      where.push(`${STANDING_SQL} = :standing`);
      Object.assign(params, standingParams(), { standing });
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM members m ${whereSql}`).get(params).n;
    const all = perPage === Infinity;
    const pages = all ? 1 : Math.max(1, Math.ceil(total / perPage));
    const current = Math.min(Math.max(1, Number(page) || 1), pages);
    const limitSql = all ? '' : `LIMIT ${Number(perPage)} OFFSET ${(current - 1) * Number(perPage)}`;
    const rows = db
      .prepare(`${BASE_SELECT} ${whereSql}
        ORDER BY (m.status = 'pending') DESC, t.sort_order, m.cgjta_no IS NULL, m.cgjta_no, m.last_name ${limitSql}`)
      .all({ ...standingParams(), ...params })
      .map(decorate);
    return { rows, total, page: current, pages };
  }

  function get(id) {
    return decorate(db.prepare(`${BASE_SELECT} WHERE m.id = :id`).get({ ...standingParams(), id: Number(id) }));
  }

  function getByCgjtaNo(no) {
    return decorate(db.prepare(`${BASE_SELECT} WHERE m.cgjta_no = :no`).get({ ...standingParams(), no: h.str(no, 40) }));
  }

  /** Approved EXCO members, for the proposer / seconder pickers. */
  function excoNames() {
    return db
      .prepare(`SELECT first_name, last_name, cgjta_no FROM members WHERE tier = 'EXCO' AND status = 'approved' ORDER BY last_name`)
      .all()
      .map((r) => `${h.fullName(r)}${r.cgjta_no ? ` (${r.cgjta_no})` : ''}`);
  }

  function tiers() {
    return db.prepare('SELECT * FROM tiers ORDER BY sort_order').all();
  }

  function standingCounts() {
    const rows = db.prepare(`SELECT ${STANDING_SQL} AS standing, COUNT(*) AS n FROM members m GROUP BY 1`).all(standingParams());
    const out = Object.fromEntries(Object.keys(config.STANDINGS).map((k) => [k, 0]));
    for (const r of rows) out[r.standing] = r.n;
    return out;
  }

  function tierCounts() {
    return db
      .prepare(`SELECT t.code, t.name, t.color,
          SUM(CASE WHEN ${STANDING_SQL} IN ('active', 'due_soon') THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN m.status = 'approved' THEN 1 ELSE 0 END) AS approved,
          COUNT(m.id) AS total
        FROM tiers t LEFT JOIN members m ON m.tier = t.code
        GROUP BY t.code ORDER BY t.sort_order`)
      .all(standingParams());
  }

  function renewalsDue(limit = 8) {
    return db
      .prepare(`${BASE_SELECT} WHERE ${STANDING_SQL} IN ('due_soon', 'expired')
        ORDER BY m.valid_until IS NULL, m.valid_until LIMIT ${Number(limit)}`)
      .all(standingParams())
      .map(decorate);
  }

  /**
   * Validate and normalise application form input.
   * Returns { data, errors } where errors maps field -> message.
   */
  function validate(input, { existingId = null } = {}) {
    const errors = {};
    const d = {
      tier: h.str(input.tier, 20).toUpperCase(),
      first_name: h.str(input.first_name, 80),
      last_name: h.str(input.last_name, 80),
      name_on_card: h.str(input.name_on_card, 60),
      nic_pp_no: h.str(input.nic_pp_no, 30).toUpperCase(),
      gender: ['male', 'female'].includes(input.gender) ? input.gender : null,
      dob: h.str(input.dob, 10),
      business_name: h.str(input.business_name, 150),
      business_reg_no: h.str(input.business_reg_no, 60),
      ngja_license_no: h.str(input.ngja_license_no, 60),
      address_line1: h.str(input.address_line1, 150),
      address_line2: h.str(input.address_line2, 150),
      city: h.str(input.city, 80),
      postal_code: h.str(input.postal_code, 20),
      country: h.str(input.country, 80) || 'Sri Lanka',
      mobile: h.str(input.mobile, 30),
      email: h.str(input.email, 120).toLowerCase(),
      activities: h.arr(input.activities).filter((a) => config.ACTIVITIES.some((x) => x.code === a)),
      proposed_by: h.str(input.proposed_by, 120),
      seconded_by: h.str(input.seconded_by, 120),
      doc_nic: h.bool(input.doc_nic),
      doc_br: h.bool(input.doc_br),
      doc_gem_license: h.bool(input.doc_gem_license),
      doc_photo: h.bool(input.doc_photo),
      exco_vote: h.bool(input.exco_vote),
      terms_agreed: h.bool(input.terms_agreed),
      application_date: h.str(input.application_date, 10) || h.today(),
      cgjta_no: h.str(input.cgjta_no, 40).toUpperCase() || null,
      notes: h.str(input.notes, 2000),
    };

    if (!tiers().some((t) => t.code === d.tier)) errors.tier = 'Choose a membership tier.';
    if (!d.first_name) errors.first_name = 'First name is required.';
    if (!d.last_name) errors.last_name = 'Last name is required.';
    if (!d.name_on_card) d.name_on_card = `${d.first_name} ${d.last_name}`.trim().toUpperCase();
    if (!d.nic_pp_no) errors.nic_pp_no = 'NIC or passport number is required.';
    if (!d.mobile) errors.mobile = 'Mobile number is required.';
    else if (!/^[+\d][\d\s-]{6,}$/.test(d.mobile)) errors.mobile = 'Enter a valid phone number.';
    if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) errors.email = 'Enter a valid e-mail address.';
    if (!h.isIsoDate(d.application_date)) errors.application_date = 'Enter a valid date.';
    if (!h.isIsoDate(d.dob)) errors.dob = 'Date of birth is required.';
    else if (!errors.application_date && h.yearsBetween(d.dob, d.application_date) < config.MIN_AGE) {
      errors.dob = `Applicant must be ${config.MIN_AGE} or older on the application date.`;
    }
    if (d.activities.length === 0) errors.activities = 'Select at least one primary business activity.';

    if (!errors.nic_pp_no) {
      const dup = db.prepare('SELECT id, cgjta_no FROM members WHERE nic_pp_no = ? AND id IS NOT ?').get(d.nic_pp_no, existingId);
      if (dup) errors.nic_pp_no = `This NIC/PP number is already on file${dup.cgjta_no ? ` (${dup.cgjta_no})` : ''}.`;
    }
    if (d.cgjta_no) {
      const dup = db.prepare('SELECT id FROM members WHERE cgjta_no = ? AND id IS NOT ?').get(d.cgjta_no, existingId);
      if (dup) errors.cgjta_no = 'This CGJTA number is already in use.';
    }
    return { data: d, errors };
  }

  function toRow(d) {
    const row = {};
    for (const f of EDITABLE_FIELDS) row[f] = f === 'activities' ? JSON.stringify(d.activities) : d[f];
    return row;
  }

  function create(d, userId) {
    const row = toRow(d);
    const cols = Object.keys(row);
    const id = tx(db, () => {
      const res = db
        .prepare(`INSERT INTO members (${cols.join(', ')}) VALUES (${cols.map((c) => `:${c}`).join(', ')})`)
        .run(row);
      const newId = Number(res.lastInsertRowid);
      logActivity(db, { userId, memberId: newId, action: 'application.created', details: `Tier: ${d.tier}` });
      return newId;
    });
    return id;
  }

  function update(id, d, userId) {
    const row = toRow(d);
    const sets = Object.keys(row).map((c) => `${c} = :${c}`).join(', ');
    tx(db, () => {
      db.prepare(`UPDATE members SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = :id`)
        .run({ ...row, id: Number(id) });
      logActivity(db, { userId, memberId: Number(id), action: 'member.updated' });
    });
  }

  /** Issue the next CGJTA number. Call inside a transaction. */
  function nextMemberNo() {
    const prefix = getSetting(db, 'member_no_prefix');
    const digits = Number(getSetting(db, 'member_no_digits')) || 4;
    let n = Number(getSetting(db, 'next_member_no')) || 1;
    const exists = db.prepare('SELECT 1 FROM members WHERE cgjta_no = ?');
    let candidate;
    do {
      candidate = `${prefix}${String(n).padStart(digits, '0')}`;
      n += 1;
    } while (exists.get(candidate));
    setSetting(db, 'next_member_no', n);
    return candidate;
  }

  /** Membership criteria from the form: NIC/PP + business proof, or a 2/3 EXCO vote. */
  function documentsSatisfied(m) {
    return Boolean(m.exco_vote) || (Boolean(m.doc_nic) && (Boolean(m.doc_br) || Boolean(m.doc_gem_license)));
  }

  function approve(id, input, userId) {
    const m = get(id);
    const errors = {};
    if (!m) return { errors: { _: 'Member not found.' } };
    if (m.status !== 'pending') errors._ = 'Only pending applications can be approved.';
    const segment = h.str(input.segment_approved_by, 120);
    const exco = h.str(input.exco_approved_by, 120);
    const date = h.str(input.approved_at, 10) || h.today();
    if (!segment) errors.segment_approved_by = 'Name of the Membership Segment authorised member is required.';
    if (!exco) errors.exco_approved_by = 'Name of the EXCO authorised member is required.';
    if (!h.isIsoDate(date)) errors.approved_at = 'Enter a valid date.';
    if (!m.terms_agreed) errors._ = 'The applicant has not signed the terms and conditions. Edit the application first.';
    else if (!documentsSatisfied(m)) {
      errors._ = 'Supporting documents are incomplete (NIC/PP copy plus BR or gem licence). Tick “approved by 2/3 EXCO vote” on the application if applicable.';
    }
    if (Object.keys(errors).length) return { errors };

    const cgjtaNo = tx(db, () => {
      const no = m.cgjta_no || nextMemberNo();
      db.prepare(`UPDATE members SET status = 'approved', cgjta_no = ?, segment_approved_by = ?, exco_approved_by = ?,
          approved_at = ?, status_note = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
        .run(no, segment, exco, date, m.id);
      logActivity(db, { userId, memberId: m.id, action: 'application.approved', details: `Issued ${no}` });
      return no;
    });
    return { cgjtaNo };
  }

  const TRANSITIONS = {
    reject: { from: ['pending'], to: 'rejected', action: 'application.rejected' },
    suspend: { from: ['approved'], to: 'suspended', action: 'member.suspended' },
    reinstate: { from: ['suspended'], to: 'approved', action: 'member.reinstated' },
    reopen: { from: ['rejected'], to: 'pending', action: 'application.reopened' },
  };

  function transition(id, name, note, userId) {
    const t = TRANSITIONS[name];
    const m = get(id);
    if (!t || !m) return { error: 'Unknown action.' };
    if (!t.from.includes(m.status)) return { error: `Cannot ${name} a member whose status is ${m.status}.` };
    const reason = h.str(note, 500) || null;
    tx(db, () => {
      db.prepare(`UPDATE members SET status = ?, status_note = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
        .run(t.to, reason, m.id);
      logActivity(db, { userId, memberId: m.id, action: t.action, details: reason });
    });
    return {};
  }

  /** valid_until = latest period_to across non-voided subscription payments. */
  function recomputeValidUntil(memberId) {
    const row = db
      .prepare(`SELECT MAX(period_to) AS v FROM payments WHERE member_id = ? AND type = 'subscription' AND voided_at IS NULL`)
      .get(memberId);
    db.prepare('UPDATE members SET valid_until = ? WHERE id = ?').run(row.v || null, memberId);
  }

  function setPhoto(id, file, userId) {
    db.prepare(`UPDATE members SET photo_file = ?, doc_photo = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
      .run(file, Number(id));
    logActivity(db, { userId, memberId: Number(id), action: 'member.photo_updated' });
  }

  function setPortalPassword(id, hash, userId) {
    db.prepare('UPDATE members SET portal_password_hash = ? WHERE id = ?').run(hash, Number(id));
    logActivity(db, { userId, memberId: Number(id), action: hash ? 'portal.password_set' : 'portal.disabled' });
  }

  function activity(memberId, limit = 20) {
    return db
      .prepare(`SELECT a.*, u.name AS user_name FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.member_id = ? ORDER BY a.id DESC LIMIT ${Number(limit)}`)
      .all(Number(memberId));
  }

  return {
    list, get, getByCgjtaNo, excoNames, tiers, standingCounts, tierCounts, renewalsDue,
    validate, create, update, approve, transition, documentsSatisfied,
    recomputeValidUntil, setPhoto, setPortalPassword, activity,
  };
};
