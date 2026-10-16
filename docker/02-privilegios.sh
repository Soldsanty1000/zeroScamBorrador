#!/bin/sh
# Se ejecuta una sola vez, al crear la base (después de db/schema.sql).
# Deja al usuario de la aplicación solo con SELECT, INSERT, UPDATE y DELETE:
# la API no necesita (ni debe tener) crear/borrar tablas ni leer otras bases.
set -e
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
REVOKE ALL PRIVILEGES, GRANT OPTION FROM '${MYSQL_USER}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`${MYSQL_DATABASE}\`.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
SQL
