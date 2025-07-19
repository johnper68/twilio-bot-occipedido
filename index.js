const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

let pedido = [];
let enProceso = false;

// Ruta principal webhook
app.post('/webhook', async (req, res) => {
    const incomingMsg = req.body.Body?.trim().toLowerCase();
    const from = req.body.From;

    console.log(`Mensaje de ${from}: ${incomingMsg}`);

    let reply = '';

    if (!incomingMsg) {
        reply = 'Mensaje vacío. Intenta nuevamente.';
    } else if (!enProceso && incomingMsg === 'hola') {
        enProceso = true;
        reply = await listarProductos();
    } else if (enProceso && /^[1-9]\d*$/.test(incomingMsg)) {
        const index = parseInt(incomingMsg) - 1;
        const producto = await obtenerProducto(index);
        if (producto) {
            pedido.push(producto);
            reply = `✅ Producto agregado: ${producto.Nombre}\n\nPuedes escribir otro número o escribe *fin* para terminar.`;
        } else {
            reply = '❌ Número inválido. Intenta nuevamente.';
        }
    } else if (enProceso && incomingMsg === 'fin') {
        reply = generarResumenPedido();
        enProceso = false;
        pedido = [];
    } else {
        reply = '❓ Escribe "hola" para comenzar tu pedido.';
    }

    res.set('Content-Type', 'text/xml');
    res.send(`
        <Response>
            <Message>${reply}</Message>
        </Response>
    `);
});

// Función para listar productos
async function listarProductos() {
    try {
        const response = await axios.get(`${process.env.APPSHEET_BASE_URL}/tables/productos/records`, {
            headers: {
                'ApplicationAccessKey': process.env.APPSHEET_API_KEY
            }
        });

        const productos = response.data?.value || [];

        if (productos.length === 0) {
            return '⚠️ No hay productos disponibles.';
        }

        let lista = '📦 *Productos disponibles:*\n\n';
        productos.slice(0, 10).forEach((p, i) => {
            lista += `${i + 1}. ${p.Nombre} - $${p.Precio}\n`;
        });
        lista += '\n✏️ Escribe el número del producto para agregarlo.\nEscribe *fin* para terminar.';

        return lista;
    } catch (error) {
        console.error('Error al obtener productos:', error.message);
        return '❌ Error al consultar productos. Intenta más tarde.';
    }
}

// Función para obtener producto por índice
async function obtenerProducto(index) {
    try {
        const response = await axios.get(`${process.env.APPSHEET_BASE_URL}/tables/productos/records`, {
            headers: {
                'ApplicationAccessKey': process.env.APPSHEET_API_KEY
            }
        });

        const productos = response.data?.value || [];

        return productos[index] || null;
    } catch (error) {
        console.error('Error al obtener producto:', error.message);
        return null;
    }
}

// Función para generar resumen del pedido
function generarResumenPedido() {
    if (pedido.length === 0) {
        return '🛒 No agregaste ningún producto.';
    }

    let resumen = '🧾 *Resumen de tu pedido:*\n\n';
    let total = 0;

    pedido.forEach((item, i) => {
        resumen += `${i + 1}. ${item.Nombre} - $${item.Precio}\n`;
        total += Number(item.Precio);
    });

    resumen += `\n💰 Total: $${total.toFixed(2)}\n📦 Gracias por tu pedido.`;
    return resumen;
}

app.listen(PORT, () => {
    console.log(`✅ Servidor escuchando en puerto ${PORT}`);
});
