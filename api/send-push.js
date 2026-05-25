const { ref } = require('./firebase.js');
const webpush = require('web-push');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:pedidos@peppes.cl';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { scope, title, body, url } = req.body;
    if (!scope) return res.status(400).json({ error: 'scope required' });

    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return res.status(503).json({ error: 'VAPID keys not configured' });
    }

    const snap = await ref(`push_subs/${scope}`).once('value');
    const data = snap.val();
    if (!data) return res.status(200).json({ sent: 0, total: 0 });

    const entries = Object.values(data);
    const payload = JSON.stringify({ title, body, url: url || '/' });

    let sent = 0;
    await Promise.allSettled(entries.map(async (entry) => {
      if (!entry.subscription) return;
      try {
        await webpush.sendNotification(entry.subscription, payload);
        sent++;
      } catch (e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          const hash = require('crypto').createHash('sha256').update(JSON.stringify(entry.subscription)).digest('hex').slice(0, 16);
          await ref(`push_subs/${scope}/${hash}`).remove();
        }
      }
    }));

    return res.status(200).json({ sent, total: entries.length });
  } catch (e) {
    console.error('[send-push]', e);
    return res.status(500).json({ error: e.message });
  }
};
