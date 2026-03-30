const https = require('https');

const firebaseConfig = {
    databaseURL: "https://peppes-stock-default-rtdb.firebaseio.com"
};

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Metodo no permitido' }) };
    }

    const orderId = event.queryStringParameters?.id;
    const token = event.queryStringParameters?.token;

    if (!orderId) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Falta el ID del pedido' }) };
    }

    try {
        // Buscar primero en 'orders' (pedidos confirmados)
        let order = await getFirebaseData(`orders/${orderId}`);
        let source = 'orders';

        // ✅ FIX: Si no está en orders, buscar en pending_orders (webhook puede no haber llegado aún)
        if (!order) {
            order = await getFirebaseData(`pending_orders/${orderId}`);
            source = 'pending_orders';
        }

        if (!order) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Pedido no encontrado' }) };
        }

        // Validar token de seguridad si se provee
        if (token && order.auth_token && order.auth_token !== token) {
            return { statusCode: 403, body: JSON.stringify({ error: 'Token invalido' }) };
        }

        console.log(`📦 Pedido ${orderId} encontrado en ${source} con estado: ${order.estado}`);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: orderId,
                estado: order.estado,
                cliente: order.cliente,
                total: order.total,
                metodo: order.metodo,
            })
        };

    } catch (err) {
        console.error('❌ Error fetching order:', err);
        return { statusCode: 500, body: JSON.stringify({ error: 'Error interno del servidor' }) };
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
