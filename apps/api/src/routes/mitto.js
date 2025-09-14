const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { sendBulkStatic, sendSingle } = require('../services/mitto.service');
const router = express.Router();
const validPhone = p => typeof p === 'string' && /^\+?[1-9]\d{6,14}$/.test(p);

router.post('/mitto/send-bulk', requireAuth, async (req, res) => {
  try {
    const { destinations, text, sender } = req.body || {};
    if (!Array.isArray(destinations) || !destinations.length) return res.status(400).json({ message: 'destinations required' });
    if (!text) return res.status(400).json({ message: 'text required' });
    const bad = destinations.filter(d => !validPhone(d));
    if (bad.length) return res.status(400).json({ message: 'invalid phone(s)', bad });

    const resp = await sendBulkStatic({ userId: req.user.id, destinations, text, sender });
    res.json(resp);
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message, payload: e.payload });
  }
});

router.post('/mitto/send', requireAuth, async (req, res) => {
  try {
    const { destination, text, sender } = req.body || {};
    if (!destination || !text) return res.status(400).json({ message: 'destination & text required' });
    if (!validPhone(destination)) return res.status(400).json({ message: 'invalid phone', destination });

    const resp = await sendSingle({ userId: req.user.id, destination, text, sender });
    res.json(resp);
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message, payload: e.payload });
  }
});

module.exports = router;
