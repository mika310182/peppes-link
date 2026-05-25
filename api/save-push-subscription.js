const { ref } = require('./firebase.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { subscription, scope } = req.body;
    if (!subscription || !scope) {
      return res.status(400).json({ error: 'subscription and scope required' });
    }

    const hash = require('crypto').createHash('sha256').update(JSON.stringify(subscription)).digest('hex').slice(0, 16);

    await ref(`push_subs/${scope}/${hash}`).set({
      subscription,
      createdAt: Date.now(),
      userAgent: req.headers['user-agent'] || ''
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[save-push-subscription]', e);
    return res.status(500).json({ error: e.message });
  }
};
