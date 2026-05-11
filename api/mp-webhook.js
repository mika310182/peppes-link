const https = require('https');
const { consumeCoupon } = require('./coupon-utils');

const firebaseConfig = {
  databaseURL: "https://peppes-stock-default-rtdb.firebaseio.com"
};

const SAFETY_TIMEOUT_MS = 9000;

function safeRespond(res, statusCode, data) {
  try {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(body);
  } catch (_) {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"error","reason":"respond_failed"}');
    } catch (_) {}
  }
}

module.exports = async (req, res) => {
  let safetyTimer = setTimeout(() => {
    console.error("[MP-Webhook] SAFETY TIMEOUT - forza respuesta 200");
    safeRespond(res, 200, { status: 'timeout', reason: 'safety_timeout' });
  }, SAFETY_TIMEOUT_MS);

  try {
    console.log("[MP-Webhook] ========= WEBHOOK RECIBIDO =========");
    console.log("[MP-Webhook] method:", req.method);
    console.log("[MP-Webhook] url:", req.url);
    console.log("[MP-Webhook] query:", JSON.stringify(req.query));
    console.log("[MP-Webhook] headers:", JSON.stringify(req.headers));

    if (req.method === 'GET') {
      clearTimeout(safetyTimer);
      safetyTimer = null;
      return safeRespond(res, 200, { status: 'ok' });
    }

    if (req.method !== 'POST') {
      clearTimeout(safetyTimer);
      safetyTimer = null;
      return safeRespond(res, 200, { error: 'metodo_no_soportado' });
    }

    const rawBody = await readRawBody(req);
    const payload = parseRawBody(rawBody);
    const merged = { ...payload, ...normalizeQuery(req) };

    console.log("[MP-Webhook] rawBody:", rawBody);
    console.log("[MP-Webhook] parsed payload:", JSON.stringify(payload));
    console.log("[MP-Webhook] merged (payload + query):", JSON.stringify(merged));

    const action = merged.action || '';
    const type = merged.type || '';
    const topic = merged.topic || '';

    console.log("[MP-Webhook] action:", action, "type:", type, "topic:", topic);

    const paymentId = extractPaymentId(merged, req);
    console.log("[MP-Webhook] payment_id extraido:", paymentId);

    if (!paymentId) {
      console.log("[MP-Webhook] WARNING: no se encontro payment_id. Responde 200 para evitar reintentos.");
      clearTimeout(safetyTimer);
      safetyTimer = null;
      return safeRespond(res, 200, { status: 'ignored', reason: 'no_payment_id' });
    }

    const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    if (!ACCESS_TOKEN) {
      console.error("[MP-Webhook] ERROR: Falta MP_ACCESS_TOKEN");
      clearTimeout(safetyTimer);
      safetyTimer = null;
      return safeRespond(res, 200, { status: 'error', reason: 'missing_token' });
    }

    console.log("[MP-Webhook] Consultando pago a MP API: /v1/payments/" + paymentId);
    let payment;
    try {
      payment = await getFromMP(`/v1/payments/${paymentId}`, ACCESS_TOKEN);
      console.log("[MP-Webhook] HTTP status: 200");
    } catch (mpErr) {
      console.error("[MP-Webhook] HTTP status:", mpErr.httpStatus || 'ERROR');
      console.error("[MP-Webhook] Error consultando pago a MP:", mpErr.message);
      clearTimeout(safetyTimer);
      safetyTimer = null;
      return safeRespond(res, 200, { status: 'error', reason: 'mp_api_error', detail: mpErr.message });
    }
    console.log("[MP-Webhook] Payment status REAL:", payment && payment.status);
    console.log("[MP-Webhook] external_reference:", payment && payment.external_reference);
    console.log("[MP-Webhook] paymentId REAL:", payment && payment.id);
    console.log("[MP-Webhook] response.data completa:", JSON.stringify(payment));

    if (payment && payment.status === 'approved') {
      const orderId = payment.external_reference;
      if (!orderId) {
        console.error("[MP-Webhook] No hay external_reference en el pago");
        clearTimeout(safetyTimer);
        safetyTimer = null;
        return safeRespond(res, 200, { status: 'error', reason: 'no_external_reference' });
      }

      console.log("[MP-Webhook] Buscando pedido en orders/", orderId);
      const existingOrder = await getFirebaseData(`orders/${orderId}`);
      if (existingOrder) {
        console.log("[MP-Webhook] Pedido ya procesado anteriormente en orders:", orderId);
        clearTimeout(safetyTimer);
        safetyTimer = null;
        return safeRespond(res, 200, { status: 'already_processed', orderId });
      }

      console.log("[MP-Webhook] Buscando pedido en pending_orders/", orderId);
      const pendingOrder = await getFirebaseData(`pending_orders/${orderId}`);
      if (!pendingOrder) {
        console.error("[MP-Webhook] ERROR: No se encontro pending_order/", orderId);
        console.log("[MP-Webhook] El pedido no existe en pending_orders. Revisar Firebase.");
        clearTimeout(safetyTimer);
        safetyTimer = null;
        return safeRespond(res, 200, { status: 'error', reason: 'pending_order_not_found', orderId });
      }
      console.log("[MP-Webhook] Pending order encontrado:", JSON.stringify(pendingOrder));

      const operationalOrder = {
        ...pendingOrder,
        estado: "pendiente",
        paymentStatus: "paid",
        orderStatus: "recibido",
        paymentId: paymentId,
        pagadoAt: Date.now()
      };

      console.log("[MP-Webhook] PROMOVIENDO pedido a orders/", orderId);
      console.log("[MP-Webhook] Datos a guardar en orders:", JSON.stringify(operationalOrder));
      await updateFirebaseData(`orders/${orderId}`, operationalOrder);
      console.log("[MP-Webhook] Pedido guardado en orders. Eliminando de pending_orders...");
      await deleteFirebaseData(`pending_orders/${orderId}`);
      console.log("[MP-Webhook] Pago APROBADO. OrderId:", orderId, "PaymentId:", paymentId);

      // Consumir cupón si existe en el pedido
      if (pendingOrder.descuento && pendingOrder.descuento.code) {
        console.log("[MP-Webhook] Consumiendo cupon:", pendingOrder.descuento.code, "para order:", orderId);
        const couponResult = await consumeCoupon(
          pendingOrder.descuento.code,
          pendingOrder.telefono || '',
          orderId
        );
        console.log("[MP-Webhook] Resultado consumo cupon:", JSON.stringify(couponResult));
        if (couponResult.consumed) {
          await updateFirebaseData(`orders/${orderId}/couponConsumedAt`, Date.now());
        }
      }

      console.log("[MP-Webhook] Pedido promovido EXITOSAMENTE:", orderId);

      clearTimeout(safetyTimer);
      safetyTimer = null;
      return safeRespond(res, 200, { status: 'processed', orderId });

    } else if (payment && (payment.status === 'rejected' || payment.status === 'cancelled')) {
      const orderId = payment.external_reference;
      console.log("[MP-Webhook] Pago RECHAZADO/CANCELADO. OrderId:", orderId, "Status:", payment.status);
      if (orderId) {
        await updateFirebaseData(`pending_orders/${orderId}`, {
          estado: "pago_fallido",
          paymentStatus: "failed",
          orderStatus: "cancelado"
        });
        console.log("[MP-Webhook] pending_orders actualizado a pago_fallido para:", orderId);
      }
      clearTimeout(safetyTimer);
      safetyTimer = null;
      return safeRespond(res, 200, { status: 'payment_rejected', orderId });

    } else {
      const st = (payment && payment.status) || 'unknown';
      if (st === 'pending' || st === 'in_process') {
        console.log("[MP-Webhook] Pago EN PROCESO (pending/in_process). Se mantiene en pending_orders:", st);
      } else {
        console.log("[MP-Webhook] Estado de pago sin accion requerida:", st);
      }
      clearTimeout(safetyTimer);
      safetyTimer = null;
      return safeRespond(res, 200, { status: 'no_action_needed', paymentStatus: st });
    }

  } catch (err) {
    console.error("[MP-Webhook] EXCEPCION:", err);
    console.error("[MP-Webhook] stack:", err && err.stack);
    if (safetyTimer) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
    return safeRespond(res, 200, { status: 'error', error: err && err.message });
  }
};

function extractPaymentId(merged, req) {
  return merged && merged.data && merged.data.id
    || merged && merged.id
    || merged && merged["data.id"]
    || req.query && req.query.id
    || req.query && req.query["data.id"]
    || null;
}

function normalizeQuery(req) {
  if (!req.query || typeof req.query !== 'object') return {};
  const out = {};
  for (const key of Object.keys(req.query)) {
    out[key] = req.query[key];
  }
  return out;
}

async function readRawBody(req) {
  if (typeof req.body === 'string' && req.body.trim()) {
    return req.body.trim();
  }

  if (Buffer.isBuffer(req.body) && req.body.length > 0) {
    return req.body.toString('utf8');
  }

  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    try { return JSON.stringify(req.body); } catch (e) { return ''; }
  }

  return new Promise((resolve) => {
    if (req.readableEnded || req.destroyed) return resolve('');
    const chunks = [];
    let done = false;

    const onData = (chunk) => { if (!done && chunk) chunks.push(chunk); };
    const onEnd = () => {
      if (done) return;
      done = true;
      cleanup();
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve(raw);
    };
    const onError = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve('');
    };

    let timer = setTimeout(() => {
      if (!done) {
        done = true;
        cleanup();
        resolve('');
      }
    }, 5000);

    const cleanup = () => {
      clearTimeout(timer);
      timer = null;
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
        try {
          const data = JSON.parse(buffer);
          if (res.statusCode !== 200) {
            const err = new Error(`MP HTTP ${res.statusCode}: ${data.message || data.error || 'unknown'}`);
            err.httpStatus = res.statusCode;
            reject(err);
          } else {
            resolve(data);
          }
        }
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
