-- ZeroScam — Migración: claves de idempotencia al crear reportes.
-- Agrega la tabla Reporte_Idempotencia SIN tocar datos. Se puede correr más
-- de una vez. Una base nueva no la necesita: schema.sql ya la trae.
--   mysql -u root -p ZeroScam < db/migracion-idempotencia.sql
USE ZeroScam;

-- Claves de idempotencia al crear reportes: cabecera opcional
-- `Idempotency-Key`. La misma clave del mismo usuario regresa el reporte ya
-- creado en vez de duplicarlo. Caducan a las 24 horas. Se borran con el reporte.
CREATE TABLE IF NOT EXISTS Reporte_Idempotencia (
  id_usuario BIGINT      NOT NULL,
  clave      VARCHAR(64)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id_reporte BIGINT      NULL,
  creada     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_usuario, clave),
  INDEX idx_idempotencia_creada (creada),
  FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario),
  FOREIGN KEY (id_reporte) REFERENCES Reporte(id_reporte) ON DELETE CASCADE
);
