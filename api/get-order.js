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
    return res.status(401).json({ error: 'Token de autenticacion requerido' });
  }

  try {
    let order = await getFirebaseData(`orders/${orderId}`);
    let source = 'orders';

    if (!order) {
      order = await getFirebaseData(`pending_orders/${orderId}`);
      source = 'pending_orders';
    }

    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    if (!order.auth_token || order.auth_token !== token) {
      return res.status(403).json({ error: 'Token invalido' });
    }

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
      cliente: order.cliente,
      telefono: order.telefono,
      metodo: order.metodo,
      direccion: order.direccion,
      items: order.items || [],
      subtotal: order.subtotal || 0,
      deliveryCost: order.deliveryCost || 0,
      discountAmount: order.discountAmount || 0,
      total: order.total || 0,
      paymentMethod: order.paymentMethod || null,
      paymentStatus,
      paymentLink: order.paymentLink || null,
      orderStatus,
      estado: order.estado,
      incluyeCubiertos: order.incluyeCubiertos || false,
      nota: order.nota || null,
      timestamp: order.timestamp || null,
      driverName: order.driverName || null,
      driverPhone: order.driverPhone || null,
      source
    });

  } catch (err) {
    console.error('Error fetching order:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};
