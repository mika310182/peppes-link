const https = require('https');

const FIREBASE_URL = "https://peppes-stock-default-rtdb.firebaseio.com";

function buildFirebaseUrl(path) {
  const secret = process.env.FIREBASE_DATABASE_SECRET;
  const base = `${FIREBASE_URL}/${path}.json`;
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

function normalizePhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('56') && digits.length >= 11) return digits;
  if (digits.startsWith('9') && digits.length === 9) return '56' + digits;
  return digits;
}

function normalizeCode(code) {
  if (!code) return '';
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

function validateCoupon(coupon, subtotal, phone) {
  if (!coupon) return { valid: false, message: 'Cupón inválido' };
  if (coupon.active === false) return { valid: false, message: 'Cupón desactivado' };
  const now = new Date();
  if (coupon.expiresAt) {
    const exp = new Date(coupon.expiresAt);
    if (!isNaN(exp.getTime()) && now > exp) {
      return { valid: false, message: 'Cupón expirado' };
    }
  }
  if (coupon.maxUses !== undefined && coupon.maxUses !== null) {
    const used = coupon.usedCount || 0;
    if (used >= coupon.maxUses) {
      return { valid: false, message: 'Cupón agotado (sin usos disponibles)' };
    }
  }
  if (coupon.oneUsePerPhone === true) {
    const phoneNorm = normalizePhone(phone);
    if (phoneNorm && coupon.usedByPhones && coupon.usedByPhones[phoneNorm]) {
      return { valid: false, message: 'Este teléfono ya usó este cupón' };
    }
  }
  if (coupon.minSubtotal && coupon.minSubtotal > 0) {
    if (subtotal < coupon.minSubtotal) {
      return { valid: false, message: `Monto mínimo no alcanzado (mín: $${Math.round(coupon.minSubtotal).toLocaleString('es-CL')})` };
    }
  }
  return { valid: true };
}

function calculateDiscount(coupon, subtotal) {
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

async function consumeCoupon(code, phone, orderId) {
  if (!code) return { consumed: false, reason: 'no_code' };
  const normCode = normalizeCode(code);
  if (!normCode) return { consumed: false, reason: 'invalid_code' };

  console.log(`[coupon-utils] consumeCoupon: code=${normCode} phone=${phone} orderId=${orderId}`);

  const coupon = await getFirebaseData(`store_settings/coupons/${normCode}`);
  if (!coupon) {
    console.log(`[coupon-utils] Cupon ${normCode} no existe en Firebase`);
    return { consumed: false, reason: 'not_found' };
  }

  if (coupon.consumedByOrders && coupon.consumedByOrders[orderId]) {
    console.log(`[coupon-utils] Cupon ${normCode} ya fue consumido por order ${orderId}, skip`);
    return { consumed: true, reason: 'already_consumed' };
  }

  const validation = validateCoupon(coupon, 0, phone);
  if (!validation.valid) {
    console.log(`[coupon-utils] Cupon ${normCode} no valido al consumir:`, validation.message);
    return { consumed: false, reason: validation.message };
  }

  const phoneNorm = normalizePhone(phone);
  const usedByPhones = coupon.usedByPhones || {};
  if (phoneNorm) usedByPhones[phoneNorm] = true;
  const consumedByOrders = coupon.consumedByOrders || {};
  consumedByOrders[orderId] = true;

  const updateData = {
    usedCount: (coupon.usedCount || 0) + 1,
    usedByPhones,
    consumedByOrders,
    lastConsumedAt: Date.now(),
    lastConsumedByOrder: orderId
  };

  try {
    await updateFirebaseData(`store_settings/coupons/${normCode}`, { ...coupon, ...updateData });
    console.log(`[coupon-utils] Cupon ${normCode} consumido exitosamente para order ${orderId}`);
    return { consumed: true, discountAmount: calculateDiscount(coupon, 0) };
  } catch (err) {
    console.error(`[coupon-utils] Error al consumir cupon ${normCode}:`, err.message);
    return { consumed: false, reason: 'firebase_error' };
  }
}

module.exports = {
  normalizePhone,
  normalizeCode,
  validateCoupon,
  calculateDiscount,
  consumeCoupon,
  getFirebaseData,
  updateFirebaseData,
  buildFirebaseUrl
};
