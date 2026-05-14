const https = require('https');
const { get: getFirebaseData, set: updateFirebaseData } = require('./firebase');

const CUTLERY_PRICE = 500;

function calcDiscountAmount(coupon, subtotal) {
  if (!coupon) return 0;
  let amount = 0;
  if (coupon.type === 'percent' || coupon.type === 'percentage') {
    amount = Math.round(subtotal * (coupon.value / 100));
  } else {
    amount = Math.round(coupon.value);
  }
  if (amount > subtotal) amount = subtotal;
  if (amount < 0) amount = 0;
  return amount;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { items, orderId, metodo, authToken, deliveryFee, addressDetails, discountData, cliente, telefono, nota, direccion, glink, coords, distanceKm, incluyeCubiertos } = req.body;
    const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

    if (!ACCESS_TOKEN) {
      return res.status(500).json({ error: 'Missing MP_ACCESS_TOKEN env variable' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Carrito vacío' });
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

    // ── Server-side price recalculation ──
    const [inventory, extras] = await Promise.all([
      getFirebaseData('inventory_clean'),
      getFirebaseData('extras')
    ]);

    const mpItems = [];
    const orderItems = [];
    let recalculatedSubtotal = 0;

    for (const item of items) {
      const qty = Math.max(1, Math.min(99, parseInt(item.qty) || 1));
      let unitPrice = 0;
      let found = false;

      // Look up real price from Firebase catalog
      if (item.productId && item.categoryId && inventory) {
        const catData = inventory[item.categoryId];
        if (catData) {
          const realProduct = catData[item.productId];
          if (realProduct && realProduct.prices) {
            found = true;
            const size = (item.size || 'U').toUpperCase();
            unitPrice = realProduct.prices[size] || realProduct.prices['U'] || 0;
            if (typeof unitPrice !== 'number') unitPrice = 0;

            // Add extras prices from Firebase
            if (item.selectedExtrasIds && Array.isArray(item.selectedExtrasIds) && extras) {
              for (const extraId of item.selectedExtrasIds) {
                const realExtra = extras[extraId];
                if (realExtra) {
                  const extraPrice = (size === 'G')
                    ? (realExtra.g || realExtra.price || 0)
                    : (realExtra.pm || realExtra.price || 0);
                  unitPrice += (typeof extraPrice === 'number') ? extraPrice : 0;
                }
              }
            }
          }
        }
      }

      if (!found) {
        if (inventory) {
          // Catalog available but product not found — reject
          return res.status(400).json({
            error: !item.productId || !item.categoryId
              ? 'Carrito desactualizado. Recarga la página y vuelve a agregar los productos.'
              : `Producto "${item.name || item.productId}" no encontrado en catálogo.`
          });
        }
        // Firebase unavailable — trust client price as best-effort
        unitPrice = Math.max(0, Math.round((item.price || 0) / qty));
      }

      unitPrice = Math.max(0, Math.round(unitPrice));
      recalculatedSubtotal += unitPrice * qty;

      mpItems.push({
        id: item.productId || item.id || 'producto',
        title: item.name || 'Producto',
        quantity: qty,
        unit_price: unitPrice,
        currency_id: 'CLP'
      });

      orderItems.push({
        id: item.id || item.productId || null,
        name: item.name || 'Producto',
        size: item.size || '',
        img: item.img || '',
        qty: qty,
        productId: item.productId || null,
        categoryId: item.categoryId || null,
        selectedExtrasIds: item.selectedExtrasIds || [],
        price: unitPrice * qty,
        unit_price: unitPrice,
        isPromo: item.isPromo || false,
        promoType: item.promoType || null,
        basePizzas: item.basePizzas || null
      });
    }

    let validDeliveryFee = 0;
    if (metodo === 'Delivery') {
      validDeliveryFee = Math.max(0, Math.min(50000, Math.round(parseFloat(deliveryFee) || 0)));
      mpItems.push({
        id: 'delivery',
        title: 'Despacho a domicilio',
        quantity: 1,
        unit_price: validDeliveryFee,
        currency_id: 'CLP'
      });
    }

    // Recalculate discount from Firebase coupon data
    let recalculatedDiscount = 0;
    if (discountData && discountData.code) {
      const normCode = discountData.code.trim().toUpperCase().replace(/\s+/g, '');
      const coupon = await getFirebaseData(`store_settings/coupons/${normCode}`);
      if (coupon) {
        recalculatedDiscount = calcDiscountAmount(coupon, recalculatedSubtotal);
      }
    }

    if (recalculatedDiscount > 0) {
      mpItems.push({
        id: 'discount',
        title: `Descuento: ${discountData.code}`,
        quantity: 1,
        unit_price: -Math.round(recalculatedDiscount),
        currency_id: 'CLP'
      });
    }

    // ── Create pending_order with server-recalculated values ──
    const cutleryFee = incluyeCubiertos ? CUTLERY_PRICE : 0;
    const recalculatedTotal = recalculatedSubtotal + validDeliveryFee + cutleryFee - recalculatedDiscount;

    const pendingOrderData = {
      id: orderId,
      cliente: cliente || '',
      telefono: telefono || '',
      metodo,
      direccion: direccion || (metodo === 'Retiro' ? 'Retiro en local' : ''),
      glink: glink || null,
      coords: coords || null,
      distanceKm: distanceKm || null,
      nota: nota || '',
      items: orderItems,
      subtotal: recalculatedSubtotal,
      deliveryCost: validDeliveryFee,
      cutleryFee: cutleryFee,
      discountAmount: recalculatedDiscount,
      total: recalculatedTotal,
      descuento: discountData?.code ? { code: discountData.code, amount: recalculatedDiscount } : null,
      incluyeCubiertos: !!incluyeCubiertos,
      auth_token: authToken,
      estado: "pago_pendiente",
      paymentStatus: "pending",
      orderStatus: "recibido",
      timestamp: Date.now(),
      fecha: new Date().toLocaleString('es-CL')
    };

    console.log(`[create-preference] Creando pending_order ${orderId}...`);
    await updateFirebaseData(`pending_orders/${orderId}`, pendingOrderData);
    console.log(`[create-preference] pending_order ${orderId} creado exitosamente`);

    const isSandbox = ACCESS_TOKEN.startsWith('TEST-');
    console.log(`[create-preference] Modo: ${isSandbox ? 'SANDBOX' : 'PRODUCCION'}`);

    const rawUrl = process.env.FRONTEND_URL || 'https://www.peppes.cl';
    const baseUrl = rawUrl.replace(/\/+$/, '');
    console.log(`[create-preference] baseUrl calculado: ${baseUrl}`);

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
    console.log("[create-preference] Enviando a MP, orderId:", orderId);
    const mpResponse = await postToMP('/checkout/preferences', ACCESS_TOKEN, preference);
    console.log("[create-preference] init_point:", mpResponse.init_point);
    console.log("[create-preference] sandbox_init_point:", mpResponse.sandbox_init_point);
    console.log("[create-preference] preference_id:", mpResponse.id);

    const finalInitPoint = mpResponse.init_point || mpResponse.sandbox_init_point;

    if (!finalInitPoint) {
      console.error("[create-preference] CRITICO: init_point es undefined");
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
