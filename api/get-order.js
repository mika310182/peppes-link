const https = require('https');

const firebaseConfig = {
  databaseURL: "https://peppes-stock-default-rtdb.firebaseio.com"
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo no permitido' });

  const orderId = req.query?.id;
  const token = req.query?.token;

  if (!orderId) {
    return res.status(400).json({ error: 'Falta el ID del pedido' });
  }

  try {
    console.log(`[get-order] Buscando pedido ${orderId} en orders/`);
    let order = await getFirebaseData(`orders/${orderId}`);
    let source = 'orders';

    if (!order) {
      console.log(`[get-order] No encontrado en orders. Buscando en pending_orders/...`);
      order = await getFirebaseData(`pending_orders/${orderId}`);
      source = 'pending_orders';
    }

    if (!order) {
      console.log(`[get-order] Pedido ${orderId} NO encontrado en orders ni pending_orders`);
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    if (token && order.auth_token && order.auth_token !== token) {
      console.log(`[get-order] Token invalido para pedido ${orderId}`);
      return res.status(403).json({ error: 'Token invalido' });
    }

    console.log(`[get-order] Pedido ${orderId} encontrado en ${source} con estado: ${order.estado} paymentStatus: ${order.paymentStatus || 'N/A'}`);

    return res.status(200).json({
      id: orderId,
      estado: order.estado,
      cliente: order.cliente,
      total: order.total,
      metodo: order.metodo,
      paymentStatus: order.paymentStatus || order.estado || null,
      source: source,
    });

  } catch (err) {
    console.error('Error fetching order:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

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
          if (data && data.error) { resolve(null); return; }
          resolve(data);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}
