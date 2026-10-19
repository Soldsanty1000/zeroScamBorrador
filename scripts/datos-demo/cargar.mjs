// Carga datos de demostración por la API, igual que lo haría la app:
// personas ficticias que se registran, reportan, suben capturas, confirman y
// comentan; y la administración que revisa, valida, clasifica y canaliza.
//
// Todo es ficticio: nombres, correos (@correo-demo.test) y enlaces (.test,
// dominios reservados para pruebas que no llevan a ningún sitio real).
//
// Uso (Node 20+):
//   node scripts/datos-demo/cargar.mjs [URL de la API]
//   API por defecto: http://localhost:3000
// Variables opcionales:
//   ADMIN_EMAIL / ADMIN_PASSWORD  cuenta de moderación (por defecto admin de schema.sql)
//   DEMO_PASSWORD                 password de las cuentas de demo (por defecto Demo2026!)
//
// Al terminar escribe fechas-demo.sql: reparte la fecha de creación de los
// reportes en los últimos meses para que las estadísticas se vean naturales.
// Se corre en la base (Docker Desktop → zeroscam-db → Exec → mysql).
import { readFileSync, writeFileSync } from 'node:fs';

const API = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const ADMIN = {
  email: process.env.ADMIN_EMAIL ?? 'admin@zeroscam.mx',
  password: process.env.ADMIN_PASSWORD ?? 'ZeroScam123!',
};
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo2026!';
const DIR = new URL('.', import.meta.url).pathname;
const DAY = 24 * 60 * 60 * 1000;

const PEOPLE = [
  { key: 'mariana', name: 'Mariana', lastName: 'Treviño Salas', alias: 'mariana.ts' },
  { key: 'luis', name: 'Luis Fernando', lastName: 'Ochoa', alias: 'luisfer_ochoa' },
  { key: 'karla', name: 'Karla', lastName: 'Domínguez Ruiz', alias: 'karla.dr' },
  { key: 'jorge', name: 'Jorge', lastName: 'Villarreal', alias: 'jvillarreal' },
  { key: 'daniela', name: 'Daniela', lastName: 'Méndez Ortiz', alias: 'dani.mendez' },
  { key: 'raul', name: 'Raúl', lastName: 'Cárdenas', alias: 'raul.cardenas' },
  { key: 'sofia', name: 'Sofía', lastName: 'Guzmán Leal', alias: 'sofi.gl' },
  { key: 'hector', name: 'Héctor', lastName: 'Rangel Paz', alias: 'hrangel' },
];

// fate: qué hace la administración. daysAgo: hace cuánto pasó.
const REPORTS = [
  { by: 'mariana', type: 'Tienda Clonada', city: 'Monterrey', daysAgo: 150, title: 'Página de tenis con 70% de descuento que nunca envió', description: 'Vi un anuncio en redes de una tienda de tenis con todo al 70%. Pagué con tarjeta unos tenis de $1,450 y me llegó un correo de confirmación, pero el número de guía no existe y la página ya no abre. En el estado de cuenta el cargo aparece con otro nombre de comercio.', url: 'https://tenis-outlet-oferta.test/producto/88', fate: 'canalizado', risk: 'ALTO', evidence: [] },
  { by: 'luis', type: 'Llamada', city: 'Ciudad de México', daysAgo: 132, title: 'Supuesto ejecutivo del banco pidió el código del SMS', description: 'Me marcaron diciendo que eran del área de seguridad de mi banco y que había un cargo no reconocido de $8,000. Sabían mi nombre completo y los últimos dígitos de la tarjeta. Me pidieron el código que me llegó por mensaje para "cancelar" el cargo y se los di. Al rato me hicieron dos transferencias.', suspiciousText: 'Llamada del +52 55 0000 0000 haciéndose pasar por el banco', fate: 'canalizado', risk: 'MUY_ALTO', evidence: ['llamada-banco.jpg'] },
  { by: 'karla', type: 'Marketplace', city: 'Guadalajara', daysAgo: 120, title: 'Vendedor de consola pidió anticipo y me bloqueó', description: 'Encontré una consola nueva en un grupo de compraventa a muy buen precio. El vendedor me pidió el 50% para apartarla y que me la mandaba al otro día. Le deposité $1,950 y después de eso dejó de contestar y me bloqueó. El perfil tenía pocos días de creado.', fate: 'validado', risk: 'MEDIO', evidence: ['chat-vendedor.jpg'] },
  { by: 'jorge', type: 'Phishing', city: 'Puebla', daysAgo: 104, title: 'SMS de bloqueo de tarjeta con liga para verificar datos', description: 'Me llegó un SMS diciendo que mi tarjeta había sido bloqueada por un acceso inusual y que tenía que verificar mis datos en una liga. La página se ve igual a la del banco y pide número de tarjeta, fecha de vencimiento y CVV. No metí nada, pero mi mamá recibió el mismo mensaje.', url: 'https://bancoficticio-verifica.test', fate: 'canalizado', risk: 'ALTO', evidence: ['sms-banco.jpg'] },
  { by: 'daniela', type: 'Sorteo Falso', city: 'Querétaro', daysAgo: 96, title: 'Me dijeron que gané un celular y pidieron pagar el envío', description: 'Me escribieron por mensaje que había ganado un celular en un sorteo de aniversario de una tienda. Para mandarlo solo tenía que pagar $199 de envío con tarjeta en una página. Yo nunca participé en ningún sorteo. Lo reporto porque a varias personas de mi trabajo les llegó lo mismo.', url: 'https://sorteo-aniversario.test/ganador', fate: 'validado', risk: 'ALTO', evidence: ['chat-sorteo.jpg'] },
  { by: 'raul', type: 'Fraude de Inversión / Cripto', city: 'Mérida', daysAgo: 88, title: 'Plataforma de cripto que no deja retirar el dinero', description: 'Un asesor me contactó prometiendo ganancias de 30% semanal con criptomonedas. Invertí $2,000 y en la plataforma se veía que crecía, pero cuando quise retirar me pidieron pagar una comisión de liberación de $1,500. Pagué y ahora piden otra más. Ya no recupero nada.', url: 'https://cripto-ganancias.test', fate: 'canalizado', risk: 'MUY_ALTO', evidence: ['chat-inversion.jpg'] },
  { by: 'sofia', type: 'Phishing', city: 'León', daysAgo: 75, title: 'Mensaje de paquetería con cobro de arancel', description: 'Me llegó un mensaje de una supuesta paquetería diciendo que mi paquete estaba retenido y que pagara $48 de arancel en una liga. No estaba esperando nada. La página pide los datos de la tarjeta completos.', url: 'https://envios-rapidos-pago.test/guia/7781', fate: 'validado', risk: 'ALTO', evidence: ['chat-paqueteria.jpg'] },
  { by: 'hector', type: 'Oferta Falsa', city: 'Tijuana', daysAgo: 64, title: 'Pantallas a mitad de precio en una página de liquidación', description: 'Anuncian pantallas de 55 pulgadas a $3,999 por "cierre de sucursal". Solo aceptan transferencia y te dan 15 minutos para pagar. Busqué la empresa y no tiene dirección ni teléfono. No compré, pero quiero que otros lo sepan.', url: 'https://liquidacion-pantallas.test', fate: 'revision' },
  { by: 'mariana', type: 'Robo de Identidad', city: 'Monterrey', daysAgo: 52, title: 'Abrieron un crédito a mi nombre en una app', description: 'Me llegó una notificación de cobro de una app de préstamos que nunca usé. Alguien abrió una cuenta con mi nombre y mi CURP y pidió un préstamo de $5,000. Ya levanté la queja en la app pero siguen llamándome para cobrar.', fate: 'validado', risk: 'MEDIO', evidence: [] },
  { by: 'luis', type: 'Marketplace', city: 'Toluca', daysAgo: 41, title: 'Renta de departamento que pedía depósito sin mostrarlo', description: 'Publicaron un departamento muy barato cerca de la universidad. La supuesta dueña decía que estaba fuera del país y que para mandarme las llaves por paquetería tenía que depositar dos meses de renta. Las fotos eran de otro anuncio.', fate: 'rechazado', observations: 'Sin evidencia de pago ni de la publicación; no se puede validar con lo enviado.' },
  { by: 'karla', type: 'Fraude Telefónico (Vishing)', city: 'Guadalajara', daysAgo: 33, title: 'Llamada de supuesto familiar detenido pidiendo dinero', description: 'Llamaron a mi abuela diciendo que mi primo estaba detenido y que necesitaban $10,000 para que lo soltaran. Sonaba alterado y no dejaban colgar. Por suerte nos llamó antes de depositar y mi primo estaba bien.', suspiciousText: 'Llamada de número desconocido pidiendo depósito urgente por un familiar detenido', fate: 'validado', risk: 'ALTO', evidence: [] },
  { by: 'jorge', type: 'Tienda Clonada', city: 'Puebla', daysAgo: 24, title: 'Tienda de electrónicos con logo copiado y precios muy bajos', description: 'Encontré una tienda en línea que usa el mismo diseño que una cadena conocida pero con otro dominio. Los precios son demasiado bajos y solo aceptan pago por transferencia a una cuenta personal.', url: 'https://electronica-descuentos.test', fate: 'revision' },
  { by: 'daniela', type: 'Oferta Falsa', city: 'Querétaro', daysAgo: 15, title: 'Boletos de concierto a precio de preventa por redes', description: 'Una cuenta vendía boletos para un concierto que ya estaba agotado, a precio de preventa. Pedían pago por transferencia y prometían mandarlos por correo. Una amiga pagó y nunca le llegaron.', fate: 'recibido' },
  { by: 'raul', type: 'Phishing', city: 'Mérida', daysAgo: 9, title: 'Correo de premio de aerolínea pidiendo datos de tarjeta', description: 'Recibí un correo diciendo que gané dos boletos de avión por ser cliente frecuente. Para reclamarlos pedían llenar un formulario con la tarjeta "para validar la identidad". El remitente no coincide con la aerolínea.', url: 'https://premios-viajero.test/reclamar', fate: 'recibido' },
  { by: 'sofia', type: 'Sorteo Falso', city: 'León', daysAgo: 5, title: 'Página de encuesta que regala tarjetas de regalo', description: 'Me mandaron por mensaje una encuesta de "aniversario" que al final regala una tarjeta de regalo de $2,000 si compartes con 10 contactos y pagas $25 de activación.', url: 'https://encuesta-regalo.test', fate: 'recibido' },
  { by: 'hector', type: 'Llamada', city: 'Tijuana', daysAgo: 2, title: 'Llamada de supuesta compañía telefónica para "actualizar" la línea', description: 'Me llamaron diciendo que mi línea se iba a suspender si no actualizaba mis datos, y me pidieron el código que me llegó por SMS. No se los di y colgué.', suspiciousText: 'Llamada pidiendo el código de verificación para "actualizar la línea"', fate: 'recibido' },
];

// Quién confirma ("yo también"), comenta y guarda cada reporte validado.
const COMMENTS = [
  'A mí me llegó exactamente el mismo mensaje la semana pasada.',
  'Gracias por reportarlo, mi papá casi cae.',
  'Ojo: también lo están moviendo por grupos de vecinos.',
  'Confirmo, el número de la liga es el mismo que me mandaron a mí.',
  'Ya lo reporté también en el banco.',
];

async function call(method, path, token, body) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(API + path, { method, headers, body: payload });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message = Array.isArray(data?.message) ? data.message.join('; ') : data?.message;
    throw new Error(`${method} ${path} → ${res.status} ${message ?? ''}`);
  }
  return data;
}

async function login(email, password) {
  const res = await call('POST', '/auth/login', undefined, { email, password });
  if (!res.accessToken) throw new Error(`${email} tiene verificación en dos pasos; usa otra cuenta`);
  return res.accessToken;
}

const step = (text) => console.log(`\n== ${text}`);

/**
 * Comenta; si la API pide esperar (429), espera un minuto y reintenta hasta
 * 3 veces. Si sigue bloqueado (p. ej. relojes desfasados entre la PC de la
 * API y la de la base) se salta ese comentario en vez de detener todo.
 */
async function comment(id, token, text) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await call('POST', `/community/reports/${id}/comments`, token, { text });
      return true;
    } catch (e) {
      if (!String(e.message).includes('429')) throw e;
      console.log(`  (la API pide esperar entre comentarios; intento ${attempt} de 3…)`);
      await new Promise((r) => setTimeout(r, 61_000));
    }
  }
  console.log(`  ! se omitió un comentario del reporte #${id}: la API siguió pidiendo esperar`);
  return false;
}

await call('GET', '/health');
step(`API ${API}`);
const admin = await login(ADMIN.email, ADMIN.password);
console.log(`moderación: ${ADMIN.email}`);

step('Cuentas');
const tokens = {};
for (const p of PEOPLE) {
  const email = `${p.alias.replace(/[^a-z0-9.]/g, '.')}@correo-demo.test`;
  try {
    await call('POST', '/account/register', undefined, {
      name: p.name, lastName: p.lastName, country: 'México', email, password: PASSWORD,
      acceptsPrivacy: true, alias: p.alias, privacyVersion: '2026-10',
    });
    console.log(`  + ${email}`);
  } catch (e) {
    if (!String(e.message).includes('409')) throw e;
    console.log(`  = ${email} (ya existía)`);
  }
  tokens[p.key] = await login(email, PASSWORD);
}

// Los tipos se toman del catálogo de la base, sin importar acentos ni
// mayúsculas; uno que no exista se manda como "Otro" con su nombre.
const plain = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const catalog = (await call('GET', '/catalogs')).fraudTypes.map((t) => t.name);
const fraudType = (wanted) => {
  const found = catalog.find((name) => plain(name) === plain(wanted));
  return found ? { fraudType: found } : { fraudType: 'Otro', otherType: wanted.slice(0, 50) };
};

step('Reportes');
const created = [];
// Lo que cada persona ya reportó (por título): correr el script otra vez
// no duplica, solo completa lo que faltó.
const mine = {};
for (const p of PEOPLE) {
  const list = await call('GET', '/community/reports?scope=mine', tokens[p.key]);
  mine[p.key] = new Map(list.map((x) => [x.title, x]));
}
for (const r of REPORTS) {
  const existing = mine[r.by].get(r.title);
  if (existing) {
    // Si quedó sin moderar (una corrida anterior se cortó), se termina ahora.
    created.push({ ...r, id: existing.id, existing: existing.status !== 'RECIBIDO' });
    console.log(`  = #${existing.id} ${r.title.slice(0, 60)} (ya existía)`);
    continue;
  }
  const incident = new Date(Date.now() - (r.daysAgo + 1) * DAY);
  const report = await call('POST', '/community/reports', tokens[r.by], {
    ...fraudType(r.type), title: r.title, description: r.description,
    incidentDate: incident.toISOString(), anonymous: r.daysAgo % 3 === 0, affected: 'YO',
    city: r.city, ...(r.url ? { url: r.url } : {}), ...(r.suspiciousText ? { suspiciousText: r.suspiciousText } : {}),
  });
  for (const file of r.evidence ?? []) {
    const form = new FormData();
    form.append('file', new Blob([readFileSync(`${DIR}capturas/${file}`)], { type: 'image/jpeg' }), file);
    await call('POST', `/community/reports/${report.id}/evidence`, tokens[r.by], form);
  }
  created.push({ ...r, id: report.id });
  console.log(`  #${report.id} ${r.title.slice(0, 60)}`);
}

step('Moderación');
const status = (id, s, observations) => call('PATCH', `/reports/${id}/status`, admin, { status: s, ...(observations ? { observations } : {}) });
for (const r of created) {
  if (r.fate === 'recibido' || r.existing) continue;
  await status(r.id, 'EN_REVISION');
  if (r.fate === 'revision') continue;
  if (r.fate === 'rechazado') {
    await status(r.id, 'RECHAZADO', r.observations);
  } else {
    await call('PATCH', `/reports/${r.id}/risk`, admin, { riskLevel: r.risk });
    await status(r.id, 'VALIDADO', 'Evidencia revisada; coincide con otros casos reportados.');
    if (r.fate === 'canalizado') {
      await status(r.id, 'CANALIZADO', 'Turnado a la Policía Cibernética.');
    }
  }
  console.log(`  #${r.id} → ${r.fate}`);
}

step('Comunidad');
const others = (by) => PEOPLE.map((p) => p.key).filter((k) => k !== by);
let n = 0;
for (const r of created.filter((x) => x.fate === 'validado' || x.fate === 'canalizado')) {
  const people = others(r.by);
  // Confirmar y guardar dos veces no duplica (la API lo ignora).
  for (const k of people.slice(0, 2 + (r.id % 4))) {
    await call('POST', `/community/reports/${r.id}/confirmations`, tokens[k]).catch(() => {});
  }
  // Comentan dos personas distintas cada vez; la API permite pocos
  // comentarios por minuto a cada una. Si ya tiene, solo se completan.
  const have = (await call('GET', `/community/reports/${r.id}/comments`, tokens[r.by])).length;
  for (let i = have; i < 2; i++) {
    const k = people[(n + i) % people.length];
    await comment(r.id, tokens[k], COMMENTS[n % COMMENTS.length]);
    n++;
  }
  await call('PUT', `/community/reports/${r.id}/saved`, tokens[people[5]]).catch(() => {});
}
console.log('  confirmaciones, comentarios y guardados listos');

// Fechas de creación repartidas: un día después del incidente, a media mañana.
const sql = created
  .map((r) => {
    const at = new Date(Date.now() - r.daysAgo * DAY);
    const stamp = at.toISOString().slice(0, 10) + ' 10:30:00';
    return `UPDATE Reporte SET fecha_creacion = '${stamp}' WHERE id_reporte = ${Number(r.id)};`;
  })
  .join('\n');
writeFileSync(`${DIR}fechas-demo.sql`, `-- Reparte las fechas de los reportes de demo (generado por cargar.mjs).\n${sql}\n`);

step('Listo');
console.log(`  ${PEOPLE.length} cuentas (password: ${PASSWORD}), ${created.length} reportes.`);
console.log(`  Para repartir las fechas, corre ${DIR}fechas-demo.sql en la base.`);
