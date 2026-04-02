const https = require('https');

exports.handler = async (event) => {
    // CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { items, orderId, metodo, authToken, deliveryFee, addressDetails, discountData } = JSON.parse(event.body);
        const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

        if (!ACCESS_TOKEN) {
            return { statusCode: 500, body: JSON.stringify({ error: 'Missing MP_ACCESS_TOKEN env variable' }) };
        }

        // Normalizar addressDetails (puede venir como array de Google Places o como objeto de Nominatim)
        let normalizedAddress = null;
        if (addressDetails) {
            if (Array.isArray(addressDetails)) {
                // Es array de Google Places - parsear para extraer road y house_number
                const road = addressDetails.find(c => c.types.includes('route'));
                const house_number = addressDetails.find(c => c.types.includes('street_number'));
                normalizedAddress = {
                    road: road?.long_name || null,
                    house_number: house_number?.long_name || null
                };
            } else {
                // Es objeto de Nominatim/OSM
                normalizedAddress = {
                    road: addressDetails.road || null,
                    house_number: addressDetails.house_number || null
                };
            }
        }

        if (metodo === 'Delivery') {
            if (!deliveryFee || deliveryFee <= 0) {
                return { statusCode: 400, body: JSON.stringify({ error: 'Falta costo de envío para Delivery' }) };
            }
            if (!normalizedAddress || !normalizedAddress.road || !normalizedAddress.house_number) {
                return { statusCode: 400, body: JSON.stringify({ error: 'Falta calle o número para Delivery' }) };
            }
        }

        // Construir items para MP (precio en CLP, sin decimales)
        const mpItems = items.map(item => ({
            id: item.id || 'producto',
            title: item.name || 'Producto',
            quantity: item.qty || 1,
            unit_price: Math.round(item.price / (item.qty || 1)),  // Precio unitario
            currency_id: 'CLP'
        }));

        // Agregar despacho si es delivery
        if (metodo === 'Delivery') {
            mpItems.push({
                id: 'delivery',
                title: 'Despacho a domicilio',
                quantity: 1,
                unit_price: Math.round(deliveryFee),
                currency_id: 'CLP'
            });
        }

        // Agregar descuento si existe
        if (discountData && discountData.amount > 0) {
            mpItems.push({
                id: 'discount',
                title: `Descuento: ${discountData.code}`,
                quantity: 1,
                unit_price: -Math.round(discountData.amount),
                currency_id: 'CLP'
            });
        }

        const preference = {
            items: mpItems,
            external_reference: orderId,
            notification_url: "https://peppes.cl/.netlify/functions/mp-webhook", // Endpoint para el webhook
            back_urls: {
                success: `https://peppes.cl/?payment=success&order=${orderId}&auth=${authToken}`,
                pending: `https://peppes.cl/?payment=pending&order=${orderId}&auth=${authToken}`,
                failure: `https://peppes.cl/?payment=failure&order=${orderId}&auth=${authToken}`
            },
            auto_return: 'approved',
            statement_descriptor: 'PEPPES PIZZAS',
            payment_methods: {
                excluded_payment_types: [],
                installments: 1  // Sin cuotas para CLP
            }
        };

        const mpResponse = await postToMP('/checkout/preferences', ACCESS_TOKEN, preference);

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                init_point: mpResponse.init_point,
                preference_id: mpResponse.id
            })
        };

    } catch (err) {
        console.error('Error creating MP preference:', err);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: err.message })
        };
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
