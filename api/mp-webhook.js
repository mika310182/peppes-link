const https = require('https');

const firebaseConfig = {
  databaseURL: "https://peppes-stock-default-rtdb.firebaseio.com"
};

module.exports = async (req, res) => {
  console.log("[MP-Webhook] method:", req.method);
  console.log("[MP-Webhook] headers:", JSON.stringify(req.headers));
  console.log("[MP-Webhook] query:", JSON.stringify(req.query));

  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ error: 'metodo_no_soportado' });
  }

  try {
    const rawBody = await readRawBody(req);
    const payload = parseRawBody(rawBody);
    const merged = { ...payload, ...req.query };

    console.log("[MP-Webhook] rawBody:", rawBody);
    console.log("[MP-Webhook] parsed payload:", JSON.stringify(payload));

    const action = merged.action || '';
    const type = merged.type || '';
    const topic = merged.topic || '';

    console.log("[MP-Webhook] action:", action, "type:", type, "topic:", topic);

    const paymentId = merged?.data?.id
      || merged?.id
      || merged?.["data.id"]
      || req.query?.id
      || req.query?.["data.id"]
      || null;

    if (!paymentId) {
      console.log("[MP-Webhook] WARNING: no se encontro payment_id. Respondiendo 200 para evitar reintentos.");
      return res.status(200).json({ status: 'ignored', reason: 'no_payment_id' });
    }

    console.log("[MP-Webhook] payment_id extraido:", paymentId);

    const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    if (!ACCESS_TOKEN) {
      console.error("[MP-Webhook] ERROR: Falta MP_ACCESS_TOKEN");
      return res.status(200).json({ status: 'error', reason: 'missing_token' });
    }

    const payment = await getFromMP(`/v1/payments/${paymentId}`, ACCESS_TOKEN);
    console.log("[MP-Webhook] payment status:", payment.status);
    console.log("[MP-Webhook] external_reference:", payment.external_reference);

    if (payment.status === 'approved') {
      const orderId = payment.external_reference;
      if (!orderId) {
        console.error("[MP-Webhook] No hay external_reference en el pago");
        return res.status(200).json({ status: 'error', reason: 'no_external_reference' });
      }

      const existingOrder = await getFirebaseData(`orders/${orderId}`);
      if (existingOrder) {
        console.log("[MP-Webhook] Pedido ya procesado:", orderId);
        return res.status(200).json({ status: 'already_processed', orderId });
      }

      const pendingOrder = await getFirebaseData(`pending_orders/${orderId}`);
      if (!pendingOrder) {
        console.error("[MP-Webhook] No se encontro pending_order:", orderId);
        return res.status(200).json({ status: 'error', reason: 'pending_order_not_found', orderId });
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

      console.log("[MP-Webhook] Pedido promovido exitosamente:", orderId);
      return res.status(200).json({ status: 'processed', orderId });

    } else if (payment.status === 'rejected' || payment.status === 'cancelled') {
      const orderId = payment.external_reference;
      if (orderId) {
        await updateFirebaseData(`pending_orders/${orderId}`, { estado: "pago_fallido" });
        console.log("[MP-Webhook] Pago rechazado para pedido:", orderId);
      }
      return res.status(200).json({ status: 'payment_rejected', orderId });

    } else {
      console.log("[MP-Webhook] Estado de pago no necesita accion:", payment.status);
      return res.status(200).json({ status: 'no_action_needed', paymentStatus: payment.status });
    }

  } catch (err) {
    console.error("[MP-Webhook] EXCEPCION:", err);
    console.error("[MP-Webhook] stack:", err.stack);
    return res.status(200).json({ status: 'error', error: err.message });
  }
};

async function readRawBody(req) {
  if (typeof req.body === 'string' && req.body.trim()) {
    return req.body.trim();
  }
  if (req.body && typeof req.body === 'object') {
    try { return JSON.stringify(req.body); } catch (e) { return ''; }
  }
  return new Promise((resolve) => {
    if (req.readableEnded || req.destroyed) return resolve('');
    const chunks = [];
    let done = false;
    const onData = (chunk) => { if (!done) chunks.push(chunk); };
    const onEnd = () => { done = true; cleanup(); resolve(Buffer.concat(chunks).toString()); };
    const onError = () => { done = true; cleanup(); resolve(''); };
    const timer = setTimeout(() => { if (!done) { done = true; cleanup(); resolve(''); } }, 1000);
    const cleanup = () => {
      clearTimeout(timer);
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

function parseRawBody(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { /* not JSON */ }
  try { return Object.fromEntries(new URLSearchParams(raw)); } catch (e) { /* not form */ }
  return { raw };
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
        catch (e) { reject(new Error('MP response not JSON: ' + buffer.slice(0, 200))); }
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
            console.warn(`[MP-Webhook] Firebase error GET ${path}:`, data.error);
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
          console.error(`[MP-Webhook] Firebase PUT ${path} devolvio ${res.statusCode}:`, buffer);
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
