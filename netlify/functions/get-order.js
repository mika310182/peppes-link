const https = require('https');

const firebaseConfig = {
    databaseURL: "https://peppes-stock-default-rtdb.firebaseio.com"
};

exports.handler = async (event) => {
    // Solo permitir GET
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Metodo no permitido' }) };
    }

    const orderId = event.queryStringParameters.id;
    const token = event.queryStringParameters.token; // Optional auth token for security

    if (!orderId) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Falta el ID del pedido' }) };
    }

    try {
        let order;
        try {
            order = await getFirebaseData(`orders/${orderId}`);
        } catch (e) {
            console.warn("No pude acceder directamente a", orderId);
        }

        if (!order || order.error) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Pedido no encontrado o restringido' }) };
        }

        // Return limited safe dataset
        return {
            statusCode: 200,
            body: JSON.stringify({
                id: orderId,
                estado: order.estado,
                cliente: order.cliente,
                total: order.total,
                metodo: order.metodo,
            })
        };

    } catch (err) {
        console.error('❌ Error fetching order status:', err);
        return { statusCode: 500, body: JSON.stringify({ error: 'Error interno del servidor REST' }) };
    }
};

// --- Helper REST API ---
async function getFirebaseData(path) {
    return new Promise((resolve, reject) => {

        let url = `${firebaseConfig.databaseURL}/${path}.json`;

        // This is crucial. If the user creates a Database Secret in Firebase, Netlify can bypass rules.
        const secret = process.env.FIREBASE_DATABASE_SECRET;
        if (secret) {
            url += `?auth=${secret}`;
        }

        https.get(url, res => {
            let buffer = '';
            res.on('data', chunk => buffer += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(buffer);
                    if (data && data.error) {
                        resolve(null); // Treat errors like permission denied as missing to hide rule errors safely
                        return;
                    }
                    resolve(data);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}
