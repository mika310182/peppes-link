const https = require('https');

const firebaseConfig = {
    databaseURL: "https://peppes-stock-default-rtdb.firebaseio.com"
};

exports.handler = async (event) => {
    console.log("🔔 Webhook recibido:", event.body);

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Metodo no permitido' };
    }

    try {
        const payload = JSON.parse(event.body);

        // Solo procesar notificaciones de tipo 'payment'
        if (payload.type !== 'payment' || !payload.data || !payload.data.id) {
            return { statusCode: 200, body: 'Ignorado (no es un pago)' };
        }

        const paymentId = payload.data.id;
        const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

        if (!ACCESS_TOKEN) {
            console.error("❌ Falta MP_ACCESS_TOKEN");
            return { statusCode: 500, body: 'Error interno' };
        }

        // 1. Consultar estado del pago en Mercado Pago
        const payment = await getFromMP(`/v1/payments/${paymentId}`, ACCESS_TOKEN);
        console.log(`💰 Pago ${paymentId} estado: ${payment.status}`);

        if (payment.status === 'approved') {
            const orderId = payment.external_reference;
            if (!orderId) {
                console.error("❌ No se encontró external_reference (orderId) en el pago");
                return { statusCode: 200, body: 'Error: No hay ID de pedido' };
            }

            // 2. Verificar idempotencia: si ya existe en 'orders', no hacer nada
            const existingOrder = await getFirebaseData(`orders/${orderId}`);
            if (existingOrder) {
                console.log(`✅ El pedido ${orderId} ya estaba procesado.`);
                return { statusCode: 200, body: 'Ya procesado' };
            }

            // 3. Obtener el pedido de 'pending_orders'
            const pendingOrder = await getFirebaseData(`pending_orders/${orderId}`);

            if (!pendingOrder) {
                console.error(`❌ No se encontró el pedido ${orderId} en pending_orders`);
                return { statusCode: 200, body: 'Pedido no encontrado' };
            }

            // 4. Promocionar a 'orders' con estado "pendiente" (minúsculas, como espera el dashboard)
            const operationalOrder = {
                ...pendingOrder,
                estado: "pendiente",   // ✅ FIX: minúsculas para coincidir con el dashboard y admin
                paymentId: paymentId,
                paymentStatus: "approved",
                pagadoAt: Date.now()
            };

            await updateFirebaseData(`orders/${orderId}`, operationalOrder);

            // 5. Eliminar de 'pending_orders'
            await deleteFirebaseData(`pending_orders/${orderId}`);

            console.log(`🚀 Pedido ${orderId} PROMOCIONADO exitosamente con estado "pendiente".`);

        } else if (payment.status === 'rejected' || payment.status === 'cancelled') {
            // Marcar como fallido en pending_orders para que el cliente lo vea
            const orderId = payment.external_reference;
            if (orderId) {
                await updateFirebaseData(`pending_orders/${orderId}`, { estado: "pago_fallido" });
                console.log(`❌ Pago rechazado para pedido ${orderId}`);
            }
        }

        return { statusCode: 200, body: 'OK' };

    } catch (err) {
        console.error('❌ Error en webhook:', err);
        return { statusCode: 500, body: 'Internal Server Error' };
    }
};

// --- Helper Mercado Pago ---
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

// --- Helpers Firebase REST (con autenticación via Database Secret) ---
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
                    // Firebase devuelve null si no existe, o {error:...} si hay problema de permisos
                    if (data && data.error) {
                        console.warn(`⚠️ Firebase error en GET ${path}:`, data.error);
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
                    console.error(`❌ Firebase PUT ${path} devolvió ${res.statusCode}:`, buffer);
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
