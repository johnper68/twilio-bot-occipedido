require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { MessagingResponse } = require('twilio').twiml;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const APPSHEET_API_KEY = process.env.APPSHEET_API_KEY;
const BASE_URL = process.env.APPSHEET_BASE_URL;
const PRODUCTOS_URL = `${BASE_URL}/tables/productos/Action`;
const PEDIDOS_URL = `${BASE_URL}/tables/pedido/Action`;
const ENCABEZADO_URL = `${BASE_URL}/tables/enc_pedido/Action`;

const sesiones = {};

const generarRespuesta = (mensaje) => {
  const twiml = new MessagingResponse();
  twiml.message(mensaje);
  return twiml.toString();
};

app.post('/webhook', async (req, res) => {
  const mensaje = req.body.Body?.trim().toLowerCase();
  const numero = req.body.From?.split(':').pop();
  const session = sesiones[numero] || { paso: 'inicio', pedido: [], datos: {} };

  const send = (msg) => res.type('text/xml').send(generarRespuesta(msg));
  sesiones[numero] = session;

  if (mensaje === 'pedido') {
    session.paso = 'cliente';
    return send('👤 Escribe tu *nombre completo*:');
  }

  if (mensaje === 'fin') {
    if (session.pedido.length === 0) return send('❌ No hay productos registrados.');
    const total = session.pedido.reduce((sum, item) => sum + item.valor, 0);
    const resumen = session.pedido.map((p, i) =>
      `${i + 1}. *${p.nombreProducto}* x${p.cantidadProducto} = $${p.valor.toLocaleString('es-CO')}`
    ).join('\n');
    const encabezado = {
      pedidoId: Math.random().toString(36).substring(2, 10),
      cliente: session.datos.cliente,
      direccion: session.datos.direccion,
      celular: session.datos.celular,
      fecha: new Date().toISOString().split('T')[0],
      enc_total: total
    };
    try {
      await axios.post(ENCABEZADO_URL, {
        Action: 'Add',
        Properties: { Locale: 'es-ES' },
        Rows: [encabezado]
      }, { headers: {
        'ApplicationAccessKey': APPSHEET_API_KEY,
        'Content-Type': 'application/json'
      }});
      for (const item of session.pedido) {
        await axios.post(PEDIDOS_URL, {
          Action: 'Add',
          Properties: { Locale: 'es-ES' },
          Rows: [{
            pedidoId: encabezado.pedidoId,
            fecha: encabezado.fecha,
            nombreProducto: item.nombreProducto,
            cantidadProducto: item.cantidadProducto,
            valor_unit: item.valor_unit,
            valor: item.valor,
            status: 'Pendiente'
          }]
        }, { headers: {
          'ApplicationAccessKey': APPSHEET_API_KEY,
          'Content-Type': 'application/json'
        }});
      }
      sesiones[numero] = { paso: 'inicio', pedido: [], datos: {} };
      return send(`✅ Pedido enviado correctamente 🧾\n${resumen}\n💰 Total: $${total.toLocaleString('es-CO')}`);
    } catch (error) {
      console.error('❌ Error al guardar pedido:', error.message);
      return send('❌ Error al guardar el pedido. Intenta más tarde.');
    }
  }

  switch (session.paso) {
    case 'cliente':
      session.datos.cliente = req.body.Body.trim();
      session.paso = 'direccion';
      return send('🏠 Escribe tu *dirección*');
    case 'direccion':
      session.datos.direccion = req.body.Body.trim();
      session.paso = 'celular';
      return send('📱 Escribe tu *celular* (10 dígitos):');
    case 'celular':
      const celular = req.body.Body.trim();
      if (!/^\d{10}$/.test(celular)) return send('❌ Número inválido.');
      session.datos.celular = celular;
      session.paso = 'producto';
      return send('🛒 Escribe una palabra del producto que deseas buscar:');
    case 'producto':
      try {
        const busqueda = req.body.Body.trim().toLowerCase();
        const resp = await axios.post(PRODUCTOS_URL, {
          Action: 'Find',
          Properties: { Locale: 'es-ES' },
          Rows: []
        }, { headers: {
          'ApplicationAccessKey': APPSHEET_API_KEY,
          'Content-Type': 'application/json'
        }});
        const productos = resp.data?.value || [];
        const encontrados = productos.filter(p => p.nombreProducto?.toLowerCase().includes(busqueda)).slice(0, 5);
        if (encontrados.length === 0) return send('❌ No se encontraron productos.');
        session.resultados = encontrados;
        session.paso = 'seleccion';
        return send('🔍 Selecciona el número del producto:\n' +
          encontrados.map((p, i) =>
            `${i + 1}. ${p.nombreProducto} - $${parseFloat(p.valor).toLocaleString('es-CO')}`
          ).join('\n'));
      } catch (e) {
        console.error('Error al buscar productos:', e.message);
        return send('❌ Error al buscar productos.');
      }
    case 'seleccion':
      const seleccion = parseInt(req.body.Body.trim());
      const resultados = session.resultados || [];
      if (isNaN(seleccion) || seleccion < 1 || seleccion > resultados.length) {
        return send('❌ Selección inválida.');
      }
      session.productoSeleccionado = resultados[seleccion - 1];
      session.paso = 'cantidad';
      return send(`🧮 ¿Cuántas unidades de *${session.productoSeleccionado.nombreProducto}* deseas?`);
    case 'cantidad':
      const cantidad = parseFloat(req.body.Body.trim());
      const producto = session.productoSeleccionado;
      if (isNaN(cantidad) || cantidad <= 0) return send('❌ Cantidad inválida.');
      const valorUnitario = parseFloat(producto.valor);
      const subtotal = cantidad * valorUnitario;
      session.pedido.push({
        nombreProducto: producto.nombreProducto,
        cantidadProducto: cantidad,
        valor_unit: valorUnitario,
        valor: subtotal
      });
      session.paso = 'producto';
      return send(`✅ Producto agregado: ${producto.nombreProducto} x${cantidad} = $${subtotal.toLocaleString('es-CO')}\n🛒 Escribe otro producto o *FIN* para terminar.`);
  }

  return send('👋 Bienvenido a *Occiquímicos*.\nEscribe *PEDIDO* para comenzar o *FIN* para cerrar.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Bot de WhatsApp activo en puerto ${PORT}`);
});
