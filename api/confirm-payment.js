const https = require('https');

const firebaseConfig = {
  databaseURL: "https://peppes-stock-default-rtdb.firebaseio.com"
};

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

    console.log(`Confirm-payment llamado para orderId: ${orderId}`);

    // Verificar si existe en pending_orders
    const pending = await getFirebaseData(`pending_orders/${orderId}`);
    if (pending) {
      const estadoActual = (pending.estado || '').toLowerCase();
      // Solo promover si está en estado pagable
      if (estadoActual === 'pago_pendiente' || estadoActual === 'pagado') {
        const orderData = {
          ...pending,
          estado: "pendiente",
          paymentStatus: "confirmed",
          confirmadoAt: Date.now()
        };
        await updateFirebaseData(`orders/${orderId}`, orderData);
        await deleteFirebaseData(`pending_orders/${orderId}`);
        console.log(`Pedido ${orderId} promovido por confirm-payment`);
        return res.status(200).json({ success: true, estado: "pendiente" });
      }
      return res.status(200).json({ success: true, estado: estadoActual, note: "No se requiere promocion" });
    }

    // Verificar si ya está en orders
    const existing = await getFirebaseData(`orders/${orderId}`);
    if (existing) {
      return res.status(200).json({ success: true, estado: existing.estado, note: "Ya estaba en orders" });
    }

    return res.status(404).json({ error: 'Pedido no encontrado' });

  } catch (err) {
    console.error('Error en confirm-payment:', err);
    return res.status(500).json({ error: err.message });
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
