const https = require('https');

// Configuración de Firebase (debe coincidir con la de index.html/admin.html)
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

        // 2. Si está aprobado, procesar el pedido
        if (payment.status === 'approved') {
            const orderId = payment.external_reference;
            if (!orderId) {
                console.error("❌ No se encontró external_reference (orderId) en el pago");
                return { statusCode: 200, body: 'Error: No hay ID de pedido' };
            }

            // 3. Obtener el pedido de 'pending_orders'
            const pendingOrder = await getFirebaseData(`pending_orders/${orderId}`);

            if (!pendingOrder) {
                // Verificar si ya existe en 'orders' (idempotencia)
                const existingOrder = await getFirebaseData(`orders/${orderId}`);
                if (existingOrder) {
                    console.log(`✅ El pedido ${orderId} ya estaba en la colección final.`);
                    return { statusCode: 200, body: 'Ya procesado' };
                }
                console.error(`❌ No se encontró el pedido ${orderId} en pending_orders`);
                return { statusCode: 200, body: 'Pedido no encontrado' };
            }

            // 4. Promocionar a 'orders' con el nuevo estado
            const operationalOrder = {
                ...pendingOrder,
                estado: "Pagado",
                paymentId: paymentId,
                paymentStatus: "approved",
                pagadoAt: Date.now()
            };

            await updateFirebaseData(`orders/${orderId}`, operationalOrder);

            // 5. Eliminar de 'pending_orders'
            await deleteFirebaseData(`pending_orders/${orderId}`);

            console.log(`🚀 Pedido ${orderId} PROMOCIONADO exitosamente.`);
        }

        return { statusCode: 200, body: 'OK' };

    } catch (err) {
        console.error('❌ Error en webhook:', err);
        return { statusCode: 500, body: 'Internal Server Error' };
    }
};

// --- Helpers de Red ---

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
                    resolve(JSON.parse(buffer));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

// --- Helpers de Firebase (REST API) ---

async function getFirebaseData(path) {
    return new Promise((resolve, reject) => {
        let url = `${firebaseConfig.databaseURL}/${path}.json`;
        const secret = process.env.FIREBASE_DATABASE_SECRET;
        if (secret) url += `?auth=${secret}`;

        https.get(url, res => {
            let buffer = '';
            res.on('data', chunk => buffer += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(buffer);
                    if (data && data.error) return resolve(null);
                    resolve(data);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function updateFirebaseData(path, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const secret = process.env.FIREBASE_DATABASE_SECRET;
        const qs = secret ? `?auth=${secret}` : '';
        const options = {
            hostname: 'peppes-stock-default-rtdb.firebaseio.com',
            path: `/${path}.json${qs}`,
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        const req = https.request(options, res => {
            res.on('data', () => { });
            res.on('end', () => resolve());
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function deleteFirebaseData(path) {
    return new Promise((resolve, reject) => {
        const secret = process.env.FIREBASE_DATABASE_SECRET;
        const qs = secret ? `?auth=${secret}` : '';
        const options = {
            hostname: 'peppes-stock-default-rtdb.firebaseio.com',
            path: `/${path}.json${qs}`,
            method: 'DELETE'
        };
        const req = https.request(options, res => {
            res.on('data', () => { });
            res.on('end', () => resolve());
        });
        req.on('error', reject);
        req.end();
    });
}
