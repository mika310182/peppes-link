const https = require('https');

const firebaseConfig = {
  databaseURL: "https://peppes-stock-default-rtdb.firebaseio.com"
};

module.exports = async (req, res) => {
  console.log("[MP-Webhook] method:", req.method);
  console.log("[MP-Webhook] headers:", JSON.stringify(req.headers));
  console.log("[MP-Webhook] query:", JSON.stringify(req.query));
  console.log("[MP-Webhook] req.body (raw):", req.body);

  if (req.method === 'GET') {
    return res.status(200).send('OK');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Metodo no permitido');
  }

  try {
    const payload = await parseBody(req);
    console.log("[MP-Webhook] payload:", JSON.stringify(payload));

    let paymentId = payload?.data?.id || payload?.id || null;

    const topic = payload?.topic || req.query?.topic;
    if (topic === 'payment' && payload?.id) paymentId = payload.id;

    if (!paymentId) {
      paymentId = req.query?.id || req.query?.["data.id"] || null;
    }

    if (!paymentId) {
      console.log("[MP-Webhook] No se encontro payment_id");
      return res.status(200).send('Ignorado (no hay payment_id)');
    }

    console.log("[MP-Webhook] payment_id:", paymentId);

    const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    if (!ACCESS_TOKEN) {
      console.error("[MP-Webhook] Falta MP_ACCESS_TOKEN");
      return res.status(500).send('Error interno');
    }

    const payment = await getFromMP(`/v1/payments/${paymentId}`, ACCESS_TOKEN);
    console.log(`[MP-Webhook] Pago ${paymentId} estado: ${payment.status}`);

    if (payment.status === 'approved') {
      const orderId = payment.external_reference;
      if (!orderId) {
        console.error("[MP-Webhook] No se encontro external_reference");
        return res.status(200).send('Error: No hay ID de pedido');
      }

      const existingOrder = await getFirebaseData(`orders/${orderId}`);
      if (existingOrder) {
        console.log(`[MP-Webhook] Pedido ${orderId} ya estaba procesado`);
        return res.status(200).send('Ya procesado');
      }

      const pendingOrder = await getFirebaseData(`pending_orders/${orderId}`);

      if (!pendingOrder) {
        console.error(`[MP-Webhook] No se encontro ${orderId} en pending_orders`);
        return res.status(200).send('Pedido no encontrado');
      }

      const operationalOrder = {
        ...pendingOrder,
        estado: "pendiente",
        paymentId: paymentId,
        paymentStatus: "approved",
        pagadoAt: Date.now()
      };

      await updateFirebaseData(`orders/${orderId}`, operationalOrder);
      await deleteFirebaseData(`pending_orders/${orderId}`);

      console.log(`[MP-Webhook] Pedido ${orderId} promovido exitosamente`);

    } else if (payment.status === 'rejected' || payment.status === 'cancelled') {
      const orderId = payment.external_reference;
      if (orderId) {
        await updateFirebaseData(`pending_orders/${orderId}`, { estado: "pago_fallido" });
        console.log(`[MP-Webhook] Pago rechazado para pedido ${orderId}`);
      }
    }

    return res.status(200).send('OK');

  } catch (err) {
    console.error('[MP-Webhook] Error:', err);
    return res.status(200).send('OK');
  }
};

async function parseBody(req) {
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    return req.body;
  }

  if (typeof req.body === 'string' && req.body.trim()) {
    try { return JSON.parse(req.body); } catch (e) { /* not JSON */ }
    try { return Object.fromEntries(new URLSearchParams(req.body)); } catch (e) { /* not form */ }
    return { raw: req.body };
  }

  try {
    const raw = await new Promise((resolve) => {
      const chunks = [];
      let settled = false;
      req.on('data', chunk => { if (!settled) chunks.push(chunk); });
      req.on('end', () => { settled = true; resolve(Buffer.concat(chunks).toString()); });
      req.on('error', () => { settled = true; resolve(''); });
      setTimeout(() => { if (!settled) { settled = true; resolve(''); } }, 5000);
    });

    if (!raw) return {};

    try { return JSON.parse(raw); } catch (e) { /* not JSON */ }
    try { return Object.fromEntries(new URLSearchParams(raw)); } catch (e) { /* not form */ }
    return { raw };
  } catch (e) {
    return {};
  }
}

function getFromMP(path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.mercadopago.com',
      path,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    };
    const req = https.request(options, res => {
      let buffer = '';
      res.on('data', chunk => buffer += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(buffer)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function buildFirebaseUrl(path) {
  const secret = process.env.FIREBASE_DATABASE_SECRET;
  const base = `${firebaseConfig.databaseURL}/${path}.json`;
  return secret ? `${base}?auth=${secret}` : base;
}

async function getFirebaseData(path) {
  return new Promise((resolve, reject) => {
    https.get(buildFirebaseUrl(path), res => {
      let buffer = '';
      res.on('data', chunk => buffer += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(buffer);
          if (data && data.error) {
            console.warn(`Firebase error en GET ${path}:`, data.error);
            resolve(null);
            return;
          }
          resolve(data);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function updateFirebaseData(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(buildFirebaseUrl(path));
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, res => {
      let buffer = '';
      res.on('data', chunk => buffer += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          console.error(`Firebase PUT ${path} devolvio ${res.statusCode}:`, buffer);
          reject(new Error(`Firebase PUT error ${res.statusCode}`));
        } else {
          resolve();
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function deleteFirebaseData(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(buildFirebaseUrl(path));
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'DELETE'
    };
    const req = https.request(options, res => {
      res.on('data', () => {});
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.end();
  });
}
