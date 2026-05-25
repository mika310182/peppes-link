const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { orderId, items, deliveryCost, authToken } = req.body;
    const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

    if (!ACCESS_TOKEN) return res.status(500).json({ error: 'Missing MP_ACCESS_TOKEN' });
    if (!orderId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invalid order data' });
    }

    const mpItems = [];
    for (const item of items) {
      const qty = Math.max(1, Math.min(99, parseInt(item.qty) || 1));
      const unitPrice = Math.max(0, Math.round(item.unit_price || (item.price / qty) || 0));
      mpItems.push({ title: item.name || 'Producto', quantity: qty, unit_price: unitPrice, currency_id: 'CLP' });
    }

    const validDelivery = Math.max(0, Math.min(50000, Math.round(parseFloat(deliveryCost) || 0)));
    if (validDelivery > 0) {
      mpItems.push({ title: 'Despacho a domicilio', quantity: 1, unit_price: validDelivery, currency_id: 'CLP' });
    }

    const rawUrl = process.env.FRONTEND_URL || 'https://www.peppes.cl';
    const baseUrl = rawUrl.replace(/\/+$/, '');
    const encodedAuth = authToken ? `&auth=${encodeURIComponent(authToken)}` : '';

    const preference = {
      items: mpItems,
      external_reference: orderId,
      notification_url: `${baseUrl}/api/mp-webhook`,
      back_urls: {
        success: `${baseUrl}/?payment=success&order=${encodeURIComponent(orderId)}${encodedAuth}`,
        pending: `${baseUrl}/?payment=pending&order=${encodeURIComponent(orderId)}`,
        failure: `${baseUrl}/?payment=failure&order=${encodeURIComponent(orderId)}`
      },
      auto_return: 'approved',
      statement_descriptor: 'PEPPES PIZZAS',
      binary_mode: true
    };

    const mpResponse = await postToMP('/checkout/preferences', ACCESS_TOKEN, preference);
    const initPoint = mpResponse.init_point || mpResponse.sandbox_init_point;

    if (!initPoint) return res.status(500).json({ error: 'MP did not return checkout URL' });

    return res.status(200).json({ init_point: initPoint, preference_id: mpResponse.id });

  } catch (err) {
    console.error('[generate-payment-link] Error:', err);
    return res.status(500).json({ error: err.message });
  }
};

function postToMP(path, token, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname: 'api.mercadopago.com', path, method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode >= 400) reject(new Error(`MP API error ${res.statusCode}: ${JSON.stringify(parsed)}`));
          else resolve(parsed);
        } catch (e) { reject(new Error('Invalid JSON from MP API')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
