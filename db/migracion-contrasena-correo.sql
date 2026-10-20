-- ZeroScam — Migración: contraseña por correo.
-- Agrega la tabla Codigo_Correo (códigos para recuperar o cambiar la
-- contraseña) y la columna Usuario.contrasena_cambiada (las sesiones emitidas
-- antes ya no se renuevan). No toca datos y se puede correr más de una vez.
-- Una base nueva no la necesita: schema.sql ya lo trae.
--   mysql -u root -p ZeroScam < db/migracion-contrasena-correo.sql
USE ZeroScam;

-- MySQL 8 no tiene ADD COLUMN IF NOT EXISTS: se revisa information_schema.
SET @falta := (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Usuario'
                 AND COLUMN_NAME = 'contrasena_cambiada');
SET @sql := IF(@falta,
  'ALTER TABLE Usuario ADD COLUMN contrasena_cambiada DATETIME(3) NULL COMMENT ''Último cambio de contraseña; los refresh tokens anteriores ya no sirven''',
  'SELECT 1');
PREPARE paso FROM @sql;
EXECUTE paso;
DEALLOCATE PREPARE paso;
-- Con milisegundos: se compara con la hora de emisión del token, y por
-- segundo uno emitido en el mismo segundo del cambio pasaría como posterior.
-- Arregla también una base donde ya se corrió la versión sin milisegundos.
ALTER TABLE Usuario MODIFY COLUMN contrasena_cambiada DATETIME(3) NULL
  COMMENT 'Último cambio de contraseña; los refresh tokens anteriores ya no sirven';

-- Código de un solo uso enviado por correo para recuperar (RECUPERAR) o
-- cambiar (CAMBIAR) la contraseña. Se guarda su hash; a los 3 intentos
-- fallidos la fila se borra.
CREATE TABLE IF NOT EXISTS Codigo_Correo (
  id_codigo   CHAR(64)     PRIMARY KEY,
  id_usuario  BIGINT       NOT NULL,
  proposito   VARCHAR(10)  NOT NULL COMMENT 'RECUPERAR o CAMBIAR',
  codigo_hash CHAR(64)     NOT NULL,
  expira      DATETIME     NOT NULL,
  intentos    INT          NOT NULL DEFAULT 0,
  INDEX idx_codigo_usuario (id_usuario, proposito),
  FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario)
);
