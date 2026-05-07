const https = require('https');

const firebaseConfig = {
  databaseURL: "https://peppes-stock-default-rtdb.firebaseio.com"
};

module.exports = async (req, res) => {
  console.log("Webhook recibido:", req.body);

  if (req.method !== 'POST') {
    return res.status(405).send('Metodo no permitido');
  }

  try {
    const payload = req.body;

    if (payload.type !== 'payment' || !payload.data || !payload.data.id) {
      return res.status(200).send('Ignorado (no es un pago)');
    }

    const paymentId = payload.data.id;
    const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

    if (!ACCESS_TOKEN) {
      console.error("Falta MP_ACCESS_TOKEN");
      return res.status(500).send('Error interno');
    }

    const payment = await getFromMP(`/v1/payments/${paymentId}`, ACCESS_TOKEN);
    console.log(`Pago ${paymentId} estado: ${payment.status}`);

    if (payment.status === 'approved') {
      const orderId = payment.external_reference;
      if (!orderId) {
        console.error("No se encontro external_reference (orderId) en el pago");
        return res.status(200).send('Error: No hay ID de pedido');
      }

      const existingOrder = await getFirebaseData(`orders/${orderId}`);
      if (existingOrder) {
        console.log(`El pedido ${orderId} ya estaba procesado.`);
        return res.status(200).send('Ya procesado');
      }

      const pendingOrder = await getFirebaseData(`pending_orders/${orderId}`);

      if (!pendingOrder) {
        console.error(`No se encontro el pedido ${orderId} en pending_orders`);
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

      console.log(`Pedido ${orderId} PROMOCIONADO exitosamente con estado "pendiente".`);

    } else if (payment.status === 'rejected' || payment.status === 'cancelled') {
      const orderId = payment.external_reference;
      if (orderId) {
        await updateFirebaseData(`pending_orders/${orderId}`, { estado: "pago_fallido" });
        console.log(`Pago rechazado para pedido ${orderId}`);
      }
    }

    return res.status(200).send('OK');

  } catch (err) {
    console.error('Error en webhook:', err);
    return res.status(500).send('Internal Server Error');
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
