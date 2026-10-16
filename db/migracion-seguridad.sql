-- ZeroScam — Migración de seguridad (sesiones revocables).
-- Para una base creada con una versión anterior de schema.sql. Una base nueva
-- no la necesita: schema.sql ya trae la tabla.
--   mysql -u root -p ZeroScam < db/migracion-seguridad.sql
USE ZeroScam;

CREATE TABLE IF NOT EXISTS Sesion (
  id_sesion  CHAR(32)   PRIMARY KEY,
  id_usuario BIGINT     NOT NULL,
  creada     DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira     DATETIME   NOT NULL,
  revocada   BOOLEAN    NOT NULL DEFAULT FALSE,
  INDEX idx_sesion_usuario (id_usuario),
  INDEX idx_sesion_expira (expira),
  FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario) ON DELETE CASCADE
);

-- Bitácora de seguridad (sin contraseñas, tokens ni textos libres).
CREATE TABLE IF NOT EXISTS Auditoria (
  id_auditoria BIGINT       AUTO_INCREMENT PRIMARY KEY,
  fecha        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  id_usuario   BIGINT       NULL,
  accion       VARCHAR(40)  NOT NULL,
  detalle      VARCHAR(500) NULL,
  ip           VARCHAR(45)  NULL,
  INDEX idx_auditoria_fecha (fecha),
  INDEX idx_auditoria_usuario (id_usuario)
);

-- Las contraseñas SHA-256 anteriores se siguen aceptando una vez y se
-- reemplazan por scrypt en el primer login (AuthService.login).
