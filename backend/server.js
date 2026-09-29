const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();

// Habilita CORS y parsing de JSON en las peticiones
app.use(cors());
app.use(express.json());

const PORT = 5000;


const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'eventixoc@gmail.com',
    pass: 'epjq frlv xuuc oksj' 
  }
});

// Endpoint principal
app.post('/api/reservar', async (req, res) => {
  try {
    const { emailCliente = '', eventoTitulo = '', cantidad = '1', total = '$0' } = req.body;

    const mailOptions = {
      from: '"Eventix" <eventixoc@gmail.com>',
      to: emailCliente.trim(),
      subject: `Confirmacion de Reserva - ${eventoTitulo.trim()}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head><meta charset="utf-8"></head>
          <body style="font-family: Arial, sans-serif; background-color: #0f172a; color: #ffffff; padding: 20px;">
            <h2 style="color: #6366f1;">¡Reserva Confirmada en Eventix!</h2>
            <p>Hola, aquí tienes el resumen de tu reserva:</p>
            <ul>
              <li><strong>Evento:</strong> ${eventoTitulo}</li>
              <li><strong>Cantidad de entradas:</strong> ${cantidad}</li>
              <li><strong>Total pagado:</strong> ${total}</li>
            </ul>
            <p>Presenta este mensaje el día del evento.</p>
          </body>
        </html>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('-> Correo enviado con éxito desde Node.js');

    return res.status(200).json({ status: 'ok', mensaje: 'Correo enviado con exito' });

  } catch (error) {
    console.error('Error detallado:', error);
    return res.status(500).json({ status: 'error', mensaje: error.message });
  }
});


app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor de Eventix corriendo en http://localhost:${PORT}`);
});