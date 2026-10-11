const express = require('express');
const config = require('../config');
const h = require('../helpers');
const { requireAdmin } = require('../auth');

const router = express.Router();

function readFilters(query) {
  return {
    from: h.str(query.from, 10),
    to: h.str(query.to, 10),
    type: h.str(query.type, 30),
    method: h.str(query.method, 30),
    q: h.str(query.q, 100),
    includeVoided: query.voided === '1',
  };
}

router.get('/', (req, res) => {
  const { payments } = req.app.locals.services;
  const filters = readFilters(req.query);
  const result = payments.list(filters, { page: Number(req.query.page) || 1 });
  res.render('payments/index', { title: 'Payments', filters, result });
});

router.get('/export.csv', (req, res) => {
  const { payments } = req.app.locals.services;
  const { rows } = payments.list(readFilters(req.query), { perPage: Infinity });
  const lines = [h.csvRow(['Receipt No', 'Date', 'CGJTA No', 'Member', 'Business', 'Type', 'Method', 'Reference',
    'Amount (LKR)', 'Period from', 'Period to', 'Recorded by', 'Void', 'Void reason', 'Notes'])];
  for (const p of rows) {
    lines.push(h.csvRow([p.receipt_no, p.paid_on, p.cgjta_no, p.member_name, p.business_name,
      (config.PAYMENT_TYPES.find((t) => t.code === p.type) || {}).label, (config.PAYMENT_METHODS.find((t) => t.code === p.method) || {}).label,
      p.reference, h.money(p.amount, { symbol: false }).replace(/,/g, ''), p.period_from, p.period_to, p.recorded_by_name,
      p.voided_at ? 'VOID' : '', p.void_reason, p.notes]));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="cgjta-payments-${h.today()}.csv"`);
  res.send(`﻿${lines.join('\r\n')}\r\n`);
});

function renderForm(req, res, { values = {}, errors = {}, member = null, status = 200 } = {}) {
  const { members, payments } = req.app.locals.services;
  const type = values.type || 'subscription';
  const fees = member
    ? { subscription: payments.suggestedAmount(member, 'subscription'), admission: payments.suggestedAmount(member, 'admission') }
    : {};
  const period = member ? payments.defaultPeriod(member, values.paid_on || h.today()) : null;
  const search = !member ? h.str(req.query.q, 100) : '';
  res.status(status).render('payments/form', {
    title: 'Record payment',
    member,
    search,
    matches: search ? members.list({ q: search, perPage: 15 }).rows : [],
    fees,
    values: {
      type,
      method: 'cash',
      paid_on: h.today(),
      amount: fees[type] !== undefined && fees[type] !== null ? h.centsToInput(fees[type]) : '',
      period_from: period ? period.from : '',
      period_to: period ? period.to : '',
      ...values,
    },
    errors,
  });
}

router.get('/new', (req, res) => {
  const { members } = req.app.locals.services;
  const member = req.query.member ? members.get(req.query.member) : null;
  const values = config.PAYMENT_TYPES.some((t) => t.code === req.query.type) ? { type: req.query.type } : {};
  renderForm(req, res, { member, values });
});

router.post('/', (req, res) => {
  const { payments } = req.app.locals.services;
  const { data, errors, member } = payments.validate(req.body);
  if (Object.keys(errors).length) {
    return renderForm(req, res, { member, values: req.body, errors, status: 422 });
  }
  const id = payments.create(data, res.locals.currentUser.id);
  req.flash('good', 'Payment recorded.');
  res.redirect(`/payments/${id}`);
});

router.get('/:id', (req, res) => {
  const { payments, members } = req.app.locals.services;
  if (!/^\d+$/.test(req.params.id)) return res.status(404).render('error', { title: 'Not found', message: 'No such payment.' });
  const payment = payments.get(req.params.id);
  if (!payment) return res.status(404).render('error', { title: 'Not found', message: 'No such payment.' });
  res.render('payments/receipt', { title: `Receipt ${payment.receipt_no}`, payment, member: members.get(payment.member_id) });
});

router.post('/:id/void', requireAdmin, (req, res) => {
  const { payments } = req.app.locals.services;
  const result = payments.voidPayment(req.params.id, req.body.reason, res.locals.currentUser.id);
  if (result.error) req.flash('bad', result.error);
  else req.flash('good', 'Payment voided. It stays on record but no longer counts toward totals or membership validity.');
  res.redirect(`/payments/${req.params.id}`);
});

module.exports = router;
