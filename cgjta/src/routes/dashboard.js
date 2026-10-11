const express = require('express');
const h = require('../helpers');

const router = express.Router();

router.get('/', (req, res) => {
  const { members, payments, db } = req.app.locals.services;
  const year = h.today().slice(0, 4);
  res.render('dashboard', {
    title: 'Dashboard',
    standing: members.standingCounts(),
    tiers: members.tierCounts(),
    totals: payments.totals(),
    monthly: payments.monthly(year),
    year,
    recentPayments: payments.recent(6),
    renewals: members.renewalsDue(8),
    pending: members.list({ standing: 'pending', perPage: 5 }).rows,
    activity: db
      .prepare(`SELECT a.*, u.name AS user_name, m.first_name, m.last_name, m.id AS mid
        FROM activity_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN members m ON m.id = a.member_id
        ORDER BY a.id DESC LIMIT 8`)
      .all(),
  });
});

module.exports = router;
