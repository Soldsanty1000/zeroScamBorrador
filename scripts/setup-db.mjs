// Crea la base desde db/schema.sql y un usuario de MySQL SOLO con los permisos
// que la API necesita (SELECT, INSERT, UPDATE, DELETE), para que la API no use
// root (CWE-250).
//
//   DATABASE_ADMIN_URL=mysql://root:...@localhost:3306/ZeroScam \
//     node scripts/setup-db.mjs --write-env
//
// Sin DATABASE_ADMIN_URL usa DATABASE_URL del .env. Con --write-env deja en
// .env la DATABASE_URL del usuario limitado (la contraseña de administrador
// NO se guarda en ningún archivo). OJO: schema.sql borra y recrea las tablas.
import { randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'mysql2/promise';

if (existsSync('.env')) process.loadEnvFile();
const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!adminUrl) throw new Error('Falta DATABASE_ADMIN_URL o DATABASE_URL');

const url = new URL(adminUrl);
const database = decodeURIComponent(url.pathname.slice(1));
const schema = readFileSync('db/schema.sql', 'utf8');
const schemaDatabase = /^USE\s+(\w+)\s*;/m.exec(schema)?.[1];

if (!database || database !== schemaDatabase) {
  throw new Error(
    `La base de la URL (${database || 'ninguna'}) no coincide con la de db/schema.sql (${schemaDatabase}). Se cancela para no borrar otra base.`,
  );
}
if (process.env.CONFIRMAR_BORRADO !== 'si') {
  throw new Error(
    `schema.sql BORRA y recrea las tablas de la base "${database}". Si es lo que quieres, repite el comando con CONFIRMAR_BORRADO=si.`,
  );
}

const APP_USER = 'zeroscam_app';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
let password = '';
for (let i = 0; i < 28; i++) password += ALPHABET[randomInt(ALPHABET.length)];

const connection = await createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  multipleStatements: true,
});
await connection.query(schema);
const hosts = [...new Set(['localhost', '127.0.0.1', url.hostname, '%'].filter((h) => h === 'localhost' || h === '127.0.0.1' || h === url.hostname))];
for (const host of hosts) {
  await connection.query('CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?', [APP_USER, host, password]);
  await connection.query('ALTER USER ?@? IDENTIFIED BY ?', [APP_USER, host, password]);
  await connection.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO ?@?`, [APP_USER, host]);
}
await connection.end();

const appUrl = `mysql://${APP_USER}:${password}@${url.hostname}:${url.port || 3306}/${database}`;
if (process.argv.includes('--write-env')) {
  const env = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
  const line = `DATABASE_URL=${appUrl}`;
  writeFileSync('.env', /^DATABASE_URL=.*$/m.test(env) ? env.replace(/^DATABASE_URL=.*$/m, line) : `${env}\n${line}\n`, { mode: 0o600 });
  console.log(`Base ${database} creada. DATABASE_URL del usuario ${APP_USER} (sin root) guardada en .env`);
} else {
  console.log(`Base ${database} creada y usuario ${APP_USER} listo. Pon su DATABASE_URL en .env (corre con --write-env para hacerlo automático).`);
}
