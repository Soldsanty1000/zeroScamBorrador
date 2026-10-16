// Pone una contraseña ALEATORIA a las 3 cuentas de staff (Owner, Administrador,
// Policía) que crea db/schema.sql con la contraseña desactivada ('!').
//
//   npm run build && npm run seed:staff
//
// Las contraseñas se escriben en db/CREDENCIALES-STAFF.local.txt (solo lectura
// para ti, fuera de git) y NO se imprimen. Con STAFF_CREDENTIALS_FILE=/tmp/x.txt
// cambias el archivo (en Docker: docker compose exec -e STAFF_CREDENTIALS_FILE=/tmp/staff.txt
// api node scripts/seed-staff.mjs  y luego  docker compose exec api cat /tmp/staff.txt).
// Corre el script de nuevo para regenerarlas. Se cambian también al primer inicio de sesión recomendado.
import { randomInt } from 'node:crypto';
import { existsSync, writeFileSync, chmodSync } from 'node:fs';
import { createConnection } from 'mysql2/promise';
import { hashPassword } from '../dist/auth/password.js';

if (existsSync('.env')) process.loadEnvFile();
if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en .env');

const ACCOUNTS = ['owner@zeroscam.mx', 'admin@zeroscam.mx', 'policia@zeroscam.mx'];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!#$%&*+-=?@';

function randomPassword(length = 20) {
  let text = '';
  for (let i = 0; i < length; i++) text += ALPHABET[randomInt(ALPHABET.length)];
  return text;
}

const connection = await createConnection({ uri: process.env.DATABASE_URL });
const lines = ['# Credenciales de staff generadas por scripts/seed-staff.mjs', '# NO subir a git. Cámbialas tras el primer acceso.', ''];
for (const email of ACCOUNTS) {
  const password = randomPassword();
  const [result] = await connection.query(
    'UPDATE Usuario SET contrasena_hash = ? WHERE correo_electronico = ?',
    [await hashPassword(password), email],
  );
  if (result.affectedRows === 1) lines.push(`${email}  ${password}`);
  else lines.push(`${email}  (no existe en la base)`);
}
await connection.end();

const file = process.env.STAFF_CREDENTIALS_FILE ?? 'db/CREDENCIALES-STAFF.local.txt';
writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
chmodSync(file, 0o600);
console.log(`Listo. Contraseñas nuevas en ${file}`);
