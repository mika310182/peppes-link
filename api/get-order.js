const { get: getFirebaseData } = require('./firebase');

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

  if (!token) {
    return res.status(401).json({ error: 'Token de autenticación requerido' });
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

    // Validar token contra el auth_token del pedido
    if (!order.auth_token || order.auth_token !== token) {
      console.log(`[get-order] Token invalido para pedido ${orderId}`);
      return res.status(403).json({ error: 'Token invalido' });
    }

    console.log(`[get-order] Pedido ${orderId} encontrado en ${source} con estado: ${order.estado} paymentStatus: ${order.paymentStatus || 'N/A'}`);

    const paymentStatus = order.paymentStatus || null;
    const orderStatus = order.orderStatus || (
      order.estado === 'pago_pendiente' ? 'recibido' :
      order.estado === 'pendiente' ? 'recibido' :
      order.estado === 'cocinando' ? 'en_horno' :
      order.estado === 'listo' ? 'listo' :
      order.estado === 'en camino' ? 'en_camino' :
      order.estado === 'entregado' ? 'entregado' :
      order.estado === 'cancelado' || order.estado === 'pago_fallido' ? 'cancelado' :
      order.estado || 'recibido'
    );

    return res.status(200).json({
      id: orderId,
      estado: order.estado,
      orderStatus,
      paymentStatus,
      cliente: order.cliente,
      total: order.total,
      metodo: order.metodo,
      source: source,
    });

  } catch (err) {
    console.error('Error fetching order:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};


