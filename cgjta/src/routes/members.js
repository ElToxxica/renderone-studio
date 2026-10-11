const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');

const config = require('../config');
const h = require('../helpers');
const auth = require('../auth');
const csrf = require('../csrf');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } });

const IMAGE_TYPES = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
];

function formLocals(req, extra) {
  const { members } = req.app.locals.services;
  return { tiers: members.tiers(), excoNames: members.excoNames(), errors: {}, ...extra };
}

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return next('route');
  const member = req.app.locals.services.members.get(id);
  if (!member) return res.status(404).render('error', { title: 'Not found', message: 'No member with that ID.' });
  req.member = member;
  next();
});

router.get('/', (req, res) => {
  const { members } = req.app.locals.services;
  const filters = { q: h.str(req.query.q, 100), tier: h.str(req.query.tier, 20), standing: h.str(req.query.standing, 20) };
  const result = members.list({ ...filters, page: Number(req.query.page) || 1 });
  res.render('members/index', { title: 'Members', filters, result, tiers: members.tiers() });
});

router.get('/export.csv', (req, res) => {
  const { members } = req.app.locals.services;
  const filters = { q: h.str(req.query.q, 100), tier: h.str(req.query.tier, 20), standing: h.str(req.query.standing, 20) };
  const { rows } = members.list({ ...filters, perPage: Infinity });
  const header = ['CGJTA No', 'Tier', 'Standing', 'First name', 'Last name', 'Name on card', 'NIC/PP', 'Gender', 'DOB',
    'Business', 'BR No', 'NGJA licence', 'Address 1', 'Address 2', 'City', 'Postal code', 'Country', 'Mobile', 'E-mail',
    'Activities', 'Proposed by', 'Seconded by', 'Application date', 'Approved on', 'Valid until'];
  const lines = [h.csvRow(header)];
  for (const m of rows) {
    lines.push(h.csvRow([m.cgjta_no, m.tier_name, config.STANDINGS[m.standing].label, m.first_name, m.last_name, m.name_on_card,
      m.nic_pp_no, m.gender, m.dob, m.business_name, m.business_reg_no, m.ngja_license_no, m.address_line1, m.address_line2,
      m.city, m.postal_code, m.country, m.mobile, m.email,
      m.activities.map((a) => (config.ACTIVITIES.find((x) => x.code === a) || {}).label).join('; '),
      m.proposed_by, m.seconded_by, m.application_date, m.approved_at, m.valid_until]));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="cgjta-members-${h.today()}.csv"`);
  res.send(`﻿${lines.join('\r\n')}\r\n`);
});

router.get('/new', (req, res) => {
  res.render('members/form', formLocals(req, {
    title: 'New application',
    member: { country: 'Sri Lanka', application_date: h.today(), tier: req.query.tier || 'MEMBER', activities: [] },
    action: '/members',
  }));
});

router.post('/', (req, res) => {
  const { members } = req.app.locals.services;
  const { data, errors } = members.validate(req.body);
  if (Object.keys(errors).length) {
    return res.status(422).render('members/form', formLocals(req, { title: 'New application', member: data, errors, action: '/members' }));
  }
  const id = members.create(data, res.locals.currentUser.id);
  req.flash('good', `Application saved for ${h.fullName(data)}. Approve it below once it has been checked.`);
  res.redirect(`/members/${id}`);
});

router.get('/:id', (req, res) => {
  const { members, payments } = req.app.locals.services;
  res.render('members/show', {
    title: req.member.full_name,
    member: req.member,
    payments: payments.forMember(req.member.id),
    activity: members.activity(req.member.id),
    docsOk: members.documentsSatisfied(req.member),
    approveErrors: {},
  });
});

router.get('/:id/edit', (req, res) => {
  res.render('members/form', formLocals(req, { title: `Edit ${req.member.full_name}`, member: req.member, action: `/members/${req.member.id}` }));
});

router.post('/:id', (req, res) => {
  const { members } = req.app.locals.services;
  const { data, errors } = members.validate(req.body, { existingId: req.member.id });
  // Once issued, the CGJTA number can be changed but not cleared.
  if (!data.cgjta_no && req.member.cgjta_no) data.cgjta_no = req.member.cgjta_no;
  if (Object.keys(errors).length) {
    return res.status(422).render('members/form', formLocals(req, {
      title: `Edit ${req.member.full_name}`, member: { ...data, id: req.member.id, status: req.member.status }, errors, action: `/members/${req.member.id}`,
    }));
  }
  members.update(req.member.id, data, res.locals.currentUser.id);
  req.flash('good', 'Member details updated.');
  res.redirect(`/members/${req.member.id}`);
});

router.post('/:id/approve', (req, res) => {
  const { members, payments } = req.app.locals.services;
  const result = members.approve(req.member.id, req.body, res.locals.currentUser.id);
  if (result.errors) {
    return res.status(422).render('members/show', {
      title: req.member.full_name,
      member: req.member,
      payments: payments.forMember(req.member.id),
      activity: members.activity(req.member.id),
      docsOk: members.documentsSatisfied(req.member),
      approveErrors: result.errors,
      approveValues: req.body,
    });
  }
  req.flash('good', `Approved. Membership number ${result.cgjtaNo} issued.`);
  res.redirect(`/members/${req.member.id}`);
});

router.post('/:id/status', (req, res) => {
  const { members } = req.app.locals.services;
  const result = members.transition(req.member.id, String(req.body.action || ''), req.body.note, res.locals.currentUser.id);
  if (result.error) req.flash('bad', result.error);
  else req.flash('good', 'Status updated.');
  res.redirect(`/members/${req.member.id}`);
});

function photoUpload(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (!err) return next();
    req.flash('bad', err.code === 'LIMIT_FILE_SIZE' ? 'That photo is larger than 3 MB.' : 'The photo could not be uploaded.');
    res.redirect(`/members/${req.member.id}`);
  });
}

router.post('/:id/photo', photoUpload, csrf.verify, (req, res) => {
  const { members } = req.app.locals.services;
  const file = req.file;
  const type = file && IMAGE_TYPES.find((t) => t.test(file.buffer));
  if (!type) {
    req.flash('bad', 'Upload a JPG, PNG or WebP image (max 3 MB).');
    return res.redirect(`/members/${req.member.id}`);
  }
  fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
  const name = `member-${req.member.id}-${crypto.randomBytes(6).toString('hex')}.${type.ext}`;
  fs.writeFileSync(path.join(config.UPLOAD_DIR, name), file.buffer);
  if (req.member.photo_file) fs.rm(path.join(config.UPLOAD_DIR, path.basename(req.member.photo_file)), { force: true }, () => {});
  members.setPhoto(req.member.id, name, res.locals.currentUser.id);
  req.flash('good', 'Photo updated.');
  res.redirect(`/members/${req.member.id}`);
});

router.get('/:id/photo', (req, res) => sendPhoto(req.member, res));

router.get('/:id/card', (req, res) => {
  res.render('members/card', { title: `Card — ${req.member.full_name}`, member: req.member, photoUrl: `/members/${req.member.id}/photo` });
});

router.post('/:id/portal', (req, res) => {
  const { members } = req.app.locals.services;
  if (req.body.action === 'disable') {
    members.setPortalPassword(req.member.id, null, res.locals.currentUser.id);
    req.flash('good', 'Member portal access disabled.');
  } else {
    if (!req.member.cgjta_no) {
      req.flash('bad', 'Approve the application first — the CGJTA number is the member’s user ID.');
      return res.redirect(`/members/${req.member.id}`);
    }
    const password = auth.generatePassword();
    members.setPortalPassword(req.member.id, auth.hashPassword(password), res.locals.currentUser.id);
    req.flash('secret', `Portal login for ${req.member.full_name} — User ID: ${req.member.cgjta_no} · Temporary password: ${password} (shown once; share it with the member securely).`);
  }
  res.redirect(`/members/${req.member.id}`);
});

function sendPhoto(member, res) {
  if (!member.photo_file) return res.status(404).end();
  const file = path.join(config.UPLOAD_DIR, path.basename(member.photo_file));
  if (!fs.existsSync(file)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=300');
  res.sendFile(file);
}

module.exports = router;
module.exports.sendPhoto = sendPhoto;
