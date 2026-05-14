const https = require('https');
const { get: getFirebaseData, set: updateFirebaseData, del: deleteFirebaseData } = require('./firebase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { orderId, authToken } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'Falta orderId' });
    }

    console.log(`[confirm-payment] ========= CONFIRM PAYMENT =========`);
    console.log(`[confirm-payment] orderId: ${orderId}, authToken: ${authToken ? '***' : 'sin_token'}`);

    // Validar authToken contra pending_orders
    if (!authToken) {
      return res.status(401).json({ error: 'Token de autenticación requerido' });
    }

    // Verificar si existe en pending_orders
    console.log(`[confirm-payment] Buscando en pending_orders/${orderId}`);
    const pending = await getFirebaseData(`pending_orders/${orderId}`);
    if (pending) {
      // Verificar que el token coincida con el del pedido
      if (pending.auth_token !== authToken) {
        console.log(`[confirm-payment] Token invalido para pedido ${orderId}`);
        return res.status(403).json({ error: 'Token de autenticación inválido' });
      }

      // Verificar con MP API que el pago realmente fue aprobado
      const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
      if (ACCESS_TOKEN) {
        try {
          const paymentId = pending.paymentId;
          if (paymentId) {
            const mpPayment = await getFromMP(`/v1/payments/${paymentId}`, ACCESS_TOKEN);
            if (!mpPayment || mpPayment.status !== 'approved') {
              console.log(`[confirm-payment] Pago ${paymentId} no aprobado en MP (status: ${mpPayment?.status}), rechazando promocion`);
              return res.status(403).json({ error: 'El pago no fue aprobado por Mercado Pago' });
            }
            console.log(`[confirm-payment] Pago ${paymentId} verificado como approved en MP`);
          } else {
            // No paymentId yet — webhook may not have arrived. Reject to be safe.
            console.log(`[confirm-payment] Sin paymentId — el webhook aun no ha llegado, rechazando promocion directa`);
            return res.status(403).json({ error: 'El pago aún no ha sido confirmado por Mercado Pago. Intenta de nuevo en unos segundos.' });
          }
        } catch (mpErr) {
          console.error(`[confirm-payment] Error verificando pago en MP:`, mpErr.message);
          // If MP API is unreachable, reject to be safe
          return res.status(502).json({ error: 'No se pudo verificar el pago. Intenta de nuevo.' });
        }
      }

      const estadoActual = (pending.estado || '').toLowerCase();
      console.log(`[confirm-payment] Encontrado en pending_orders. Estado: ${estadoActual}, paymentStatus: ${pending.paymentStatus || 'N/A'}`);
      // Solo promover si está en estado pagable
      if (estadoActual === 'pago_pendiente' || estadoActual === 'pagado') {
        // Idempotency: verificar si ya fue promovido
        const alreadyInOrders = await getFirebaseData(`orders/${orderId}`);
        if (alreadyInOrders) {
          console.log(`[confirm-payment] Pedido ${orderId} ya estaba en orders, skip`);
          return res.status(200).json({ success: true, estado: alreadyInOrders.estado, paymentStatus: alreadyInOrders.paymentStatus, note: "Ya estaba en orders" });
        }

        const orderData = {
          ...pending,
          estado: "pendiente",
          paymentStatus: "paid",
          orderStatus: "recibido",
          confirmadoAt: Date.now()
        };
        console.log(`[confirm-payment] Promoviendo a orders/${orderId}...`);
        await updateFirebaseData(`orders/${orderId}`, orderData);
        console.log(`[confirm-payment] Eliminando de pending_orders...`);
        await deleteFirebaseData(`pending_orders/${orderId}`);
        console.log(`[confirm-payment] Pedido ${orderId} promovido EXITOSAMENTE`);
        return res.status(200).json({ success: true, estado: "pendiente" });
      }
      console.log(`[confirm-payment] Estado ${estadoActual} no requiere promocion`);
      return res.status(200).json({ success: true, estado: estadoActual, note: "No se requiere promocion" });
    }

    // Verificar si ya está en orders
    console.log(`[confirm-payment] No encontrado en pending_orders. Buscando en orders/${orderId}`);
    const existing = await getFirebaseData(`orders/${orderId}`);
    if (existing) {
      console.log(`[confirm-payment] Pedido ya estaba en orders. Estado: ${existing.estado}`);
      return res.status(200).json({ success: true, estado: existing.estado, paymentStatus: existing.paymentStatus, note: "Ya estaba en orders" });
    }

    console.log(`[confirm-payment] Pedido ${orderId} NO encontrado ni en pending_orders ni en orders`);
    return res.status(404).json({ error: 'Pedido no encontrado' });

  } catch (err) {
    console.error('Error en confirm-payment:', err);
    return res.status(500).json({ error: err.message });
  }
};

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
        } catch (e) { reject(new Error('MP response not JSON')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}
