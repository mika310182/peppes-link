const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { items, orderId, metodo, authToken, deliveryFee, addressDetails, discountData } = req.body;
    const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

    if (!ACCESS_TOKEN) {
      return res.status(500).json({ error: 'Missing MP_ACCESS_TOKEN env variable' });
    }

    let normalizedAddress = null;
    if (addressDetails) {
      if (Array.isArray(addressDetails)) {
        const road = addressDetails.find(c => c.types?.includes('route'));
        const house_number = addressDetails.find(c => c.types?.includes('street_number'));
        normalizedAddress = {
          road: road?.long_name || null,
          house_number: house_number?.long_name || null
        };
      } else {
        normalizedAddress = {
          road: addressDetails.road || null,
          house_number: addressDetails.house_number || null
        };
      }
    }

    if (metodo === 'Delivery') {
      if (!deliveryFee || deliveryFee <= 0) {
        return res.status(400).json({ error: 'Falta costo de envio para Delivery' });
      }
      if (!normalizedAddress || !normalizedAddress.road || !normalizedAddress.house_number) {
        return res.status(400).json({ error: 'Falta calle o numero para Delivery' });
      }
    }

    const isSandbox = ACCESS_TOKEN.startsWith('TEST-');
    console.log(`[create-preference] Modo: ${isSandbox ? 'SANDBOX (TEST-)' : 'PRODUCCION'}, token prefix: ${ACCESS_TOKEN.substring(0, 8)}...`);

    const rawUrl = process.env.FRONTEND_URL || 'https://www.peppes.cl';
    const baseUrl = rawUrl.replace(/\/+$/, '');
    console.log(`[create-preference] baseUrl calculado: ${baseUrl} (rawUrl=${rawUrl}, FRONTEND_URL=${process.env.FRONTEND_URL || 'unset'})`);

    const mpItems = items.map(item => ({
      id: item.id || 'producto',
      title: item.name || 'Producto',
      quantity: item.qty || 1,
      unit_price: Math.round(item.price / (item.qty || 1)),
      currency_id: 'CLP'
    }));

    if (metodo === 'Delivery') {
      mpItems.push({
        id: 'delivery',
        title: 'Despacho a domicilio',
        quantity: 1,
        unit_price: Math.round(deliveryFee),
        currency_id: 'CLP'
      });
    }

    if (discountData && discountData.amount > 0) {
      mpItems.push({
        id: 'discount',
        title: `Descuento: ${discountData.code}`,
        quantity: 1,
        unit_price: -Math.round(discountData.amount),
        currency_id: 'CLP'
      });
    }

    const preference = {
      items: mpItems,
      external_reference: orderId,
      notification_url: `${baseUrl}/api/mp-webhook`,
      back_urls: {
        success: `${baseUrl}/?payment=success&order=${encodeURIComponent(orderId)}&auth=${encodeURIComponent(authToken)}`,
        pending: `${baseUrl}/?payment=pending&order=${encodeURIComponent(orderId)}&auth=${encodeURIComponent(authToken)}`,
        failure: `${baseUrl}/?payment=failure&order=${encodeURIComponent(orderId)}&auth=${encodeURIComponent(authToken)}`
      },
      auto_return: 'approved',
      statement_descriptor: 'PEPPES PIZZAS',
      binary_mode: true
    };

    console.log("[create-preference] notification_url:", preference.notification_url);
    console.log("[create-preference] back_urls:", JSON.stringify(preference.back_urls));
    console.log("[create-preference] Enviando a MP, orderId:", orderId);
    const mpResponse = await postToMP('/checkout/preferences', ACCESS_TOKEN, preference);
    console.log("[create-preference] init_point:", mpResponse.init_point);
    console.log("[create-preference] sandbox_init_point:", mpResponse.sandbox_init_point);
    console.log("[create-preference] preference_id:", mpResponse.id);

    const finalInitPoint = mpResponse.init_point || mpResponse.sandbox_init_point;
    console.log("[create-preference] finalInitPoint usado:", finalInitPoint);
    console.log("[create-preference] Es HTTPS:", finalInitPoint ? finalInitPoint.startsWith('https://') : 'NO (undefined!)');

    if (!finalInitPoint) {
      console.error("[create-preference] CRITICO: init_point es undefined - posiblemente token TEST sin sandbox_init_point");
      return res.status(500).json({ error: 'Mercado Pago no devolvió URL de checkout' });
    }

    return res.status(200).json({
      init_point: finalInitPoint,
      preference_id: mpResponse.id
    });

  } catch (err) {
    console.error('Error creating MP preference:', err);
    return res.status(500).json({ error: err.message });
  }
};

function postToMP(path, token, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname: 'api.mercadopago.com',
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode >= 400) {
            reject(new Error(`MP API error ${res.statusCode}: ${JSON.stringify(parsed)}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error('Invalid JSON from MP API'));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
