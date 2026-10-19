// Genera las capturas de evidencia de los datos de demostración (JPEG).
// Todo es ficticio: empresas, personas y dominios (.test, reservados para
// pruebas). Cada imagen lleva la marca de agua "EJEMPLO · DATOS DE PRUEBA".
//
// Uso (necesita un Chrome o chrome-headless-shell):
//   npm i -D puppeteer-core   (o en una carpeta aparte)
//   CHROME=/ruta/a/chrome node scripts/datos-demo/capturas.mjs
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const OUT = new URL('./capturas/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const css = `
  * { box-sizing: border-box; margin: 0; }
  body { width: 390px; height: 760px; font: 15px/1.35 -apple-system, 'Segoe UI', Roboto, sans-serif; background: #ece5dd; position: relative; overflow: hidden; }
  .bar { height: 64px; display: flex; align-items: center; gap: 10px; padding: 0 14px; color: #fff; background: #3b6e63; }
  .avatar { width: 38px; height: 38px; border-radius: 50%; background: #9db8b1; display: grid; place-items: center; font-weight: 700; color: #fff; }
  .who b { display: block; } .who small { opacity: .8; }
  .chat { padding: 14px 10px; display: grid; gap: 8px; }
  .msg { max-width: 82%; padding: 8px 10px 16px; border-radius: 8px; background: #fff; position: relative; box-shadow: 0 1px 1px rgb(0 0 0 / .12); }
  .msg.me { justify-self: end; background: #d7f3c8; }
  .msg time { position: absolute; right: 8px; bottom: 3px; font-size: 11px; color: #7a7a7a; }
  .link { color: #1a6fd1; text-decoration: underline; word-break: break-all; }
  .day { justify-self: center; font-size: 12px; background: #d9e6ef; padding: 3px 10px; border-radius: 6px; color: #50606b; }
  .mark { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
  .mark span { transform: rotate(-30deg); font: 800 21px/1 sans-serif; letter-spacing: 1px; color: rgb(200 30 30 / .2); border: 4px solid rgb(200 30 30 / .2); padding: 8px 14px; white-space: nowrap; }
  .foot { position: absolute; bottom: 0; left: 0; right: 0; padding: 6px; text-align: center; font-size: 11px; color: #fff; background: rgb(150 20 20 / .75); }
`;
const page = (body) => `<html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}
  <div class="mark"><span>EJEMPLO · DATOS DE PRUEBA</span></div>
  <div class="foot">Captura simulada para la demostración de ZeroScam. Nombres y sitios ficticios.</div></body></html>`;
const chat = (name, initials, sub, msgs) =>
  page(`<div class="bar"><div class="avatar">${initials}</div><div class="who"><b>${name}</b><small>${sub}</small></div></div>
  <div class="chat">${msgs.map(([who, text, time]) => (who === 'day' ? `<div class="day">${text}</div>` : `<div class="msg ${who === 'yo' ? 'me' : ''}">${text}<time>${time}</time></div>`)).join('')}</div>`);

const CAPTURAS = {
  'chat-paqueteria.jpg': chat('Envíos Rápidos MX (ficticio)', 'ER', 'en línea', [
    ['day', 'HOY'],
    ['ellos', 'Hola, su paquete con guía 7781-204 está retenido en el centro de distribución por falta de pago de arancel.', '10:14'],
    ['ellos', 'Para liberarlo pague $48.00 antes de las 18:00 en: <span class="link">https://envios-rapidos-pago.test/guia/7781</span>', '10:14'],
    ['yo', '¿Qué paquete? No estoy esperando nada', '10:31'],
    ['ellos', 'Si no realiza el pago el envío será devuelto al remitente.', '10:32'],
  ]),
  'sms-banco.jpg': chat('BancoFicticio Alertas', 'BF', 'SMS', [
    ['day', 'Martes'],
    ['ellos', 'BancoFicticio: detectamos un acceso inusual. Su tarjeta terminación 4821 fue BLOQUEADA. Verifique sus datos en <span class="link">https://bancoficticio-verifica.test</span>', '08:02'],
    ['ellos', 'Si no verifica en 24 h su cuenta se cancelará.', '08:02'],
  ]),
  'chat-vendedor.jpg': chat('Ventas Consola Pro', 'VC', 'últ. vez hoy a las 19:40', [
    ['day', 'Ayer'],
    ['yo', 'Hola, ¿sigue disponible la consola?', '18:05'],
    ['ellos', 'Sí amigo, está nueva en caja. Te la dejo en $3,900 porque me urge vender.', '18:07'],
    ['ellos', 'Para apartarla necesito un depósito del 50% y te la envío mañana.', '18:08'],
    ['yo', 'Listo, ya deposité. ¿A qué hora la mandas?', '19:12'],
    ['day', 'Hoy'],
    ['yo', '¿Hola? Ya no contestas', '12:30'],
  ]),
  'chat-sorteo.jpg': chat('Promociones Celulares (ficticio)', 'PC', 'cuenta de empresa', [
    ['day', 'HOY'],
    ['ellos', '🎉 ¡Felicidades! Fuiste seleccionado como ganador de un smartphone en nuestro sorteo de aniversario.', '13:40'],
    ['ellos', 'Para el envío solo cubre $199 de gastos de envío con tarjeta aquí: <span class="link">https://sorteo-aniversario.test/ganador</span>', '13:41'],
    ['yo', 'Nunca participé en ningún sorteo', '13:55'],
  ]),
  'chat-inversion.jpg': chat('Asesor Inversiones Seguras', 'AI', 'en línea', [
    ['day', 'Lunes'],
    ['ellos', 'Con nuestra plataforma de criptomonedas tu dinero crece 30% cada semana, garantizado ✅', '21:03'],
    ['ellos', 'Empieza con $2,000 y en un mes recuperas el triple. Regístrate: <span class="link">https://cripto-ganancias.test</span>', '21:04'],
    ['yo', 'Ya invertí pero no me deja retirar', '11:20'],
    ['ellos', 'Para retirar debes pagar una comisión de liberación de $1,500', '11:26'],
  ]),
  'llamada-banco.jpg': chat('+52 55 0000 0000', '☎', 'Llamada perdida · Desconocido', [
    ['day', 'Hoy'],
    ['ellos', 'Llamada entrante · 6 min 32 s', '09:15'],
    ['ellos', 'Le hablamos del área de seguridad de su banco. Para cancelar un cargo no reconocido necesitamos el código que le llegó por SMS.', '09:21'],
    ['yo', 'Me pidieron el código y el NIP por teléfono', '09:40'],
  ]),
};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME,
  defaultViewport: { width: 390, height: 760, deviceScaleFactor: 2 },
});
const tab = await browser.newPage();
for (const [file, html] of Object.entries(CAPTURAS)) {
  await tab.setContent(html);
  await tab.screenshot({ path: OUT + file, type: 'jpeg', quality: 72 });
  console.log('ok', file);
}
await browser.close();
