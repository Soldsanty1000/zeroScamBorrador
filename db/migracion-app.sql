-- ZeroScam (0Fraude) — Migración para la app de iOS.
-- Agrega lo que la app necesita SIN borrar datos: columnas nuevas en Usuario
-- y Reporte, y las tablas de comentarios, guardados, confirmaciones, persona
-- afectada, verificación en dos pasos y analíticas.
--
-- Se corre una sola vez sobre una base creada con una versión anterior de
-- schema.sql:   mysql -u root -p ZeroScam < db/migracion-app.sql
-- Una base nueva no la necesita: schema.sql ya trae todo esto.
USE ZeroScam;

ALTER TABLE Usuario
  ADD COLUMN alias                VARCHAR(20)  NULL UNIQUE COMMENT 'Nombre público; NULL = usuario<id>',
  ADD COLUMN biografia            VARCHAR(300) NOT NULL DEFAULT '',
  ADD COLUMN avatar_archivo       VARCHAR(100) NULL COMMENT 'Archivo dentro de storage/avatars/',
  ADD COLUMN pref_notificaciones  BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN pref_modo_oscuro     BOOLEAN      NOT NULL DEFAULT TRUE,
  ADD COLUMN pref_dos_pasos       BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN pref_perfil_publico  BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN pref_analiticas      BOOLEAN      NOT NULL DEFAULT TRUE,
  ADD COLUMN version_aviso        VARCHAR(10)  NULL COMMENT 'Versión del aviso de privacidad aceptada';

ALTER TABLE Reporte
  ADD COLUMN titulo           VARCHAR(120) NULL,
  ADD COLUMN ciudad           VARCHAR(60)  NULL,
  ADD COLUMN es_anonimo       BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN afectado         VARCHAR(20)  NOT NULL DEFAULT 'YO' COMMENT 'YO, OTRA_PERSONA',
  ADD COLUMN tipo_otro        VARCHAR(50)  NULL COMMENT 'Lo que escribió cuando el tipo es Otro',
  ADD COLUMN texto_sospechoso TEXT         NULL COMMENT 'Mensaje o texto del fraude cuando no hay URL';

CREATE TABLE Persona_Afectada (
  id_reporte BIGINT       PRIMARY KEY,
  nombre     VARCHAR(100) NOT NULL,
  contacto   VARCHAR(150) NOT NULL,
  autorizo   BOOLEAN      NOT NULL DEFAULT FALSE,
  FOREIGN KEY (id_reporte) REFERENCES Reporte(id_reporte) ON DELETE CASCADE
);

CREATE TABLE Reporte_Guardado (
  id_usuario BIGINT   NOT NULL,
  id_reporte BIGINT   NOT NULL,
  fecha      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_usuario, id_reporte),
  FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario),
  FOREIGN KEY (id_reporte) REFERENCES Reporte(id_reporte) ON DELETE CASCADE
);

-- "Yo también": una confirmación por usuario y reporte.
CREATE TABLE Reporte_Confirmacion (
  id_usuario BIGINT   NOT NULL,
  id_reporte BIGINT   NOT NULL,
  fecha      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_usuario, id_reporte),
  FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario),
  FOREIGN KEY (id_reporte) REFERENCES Reporte(id_reporte) ON DELETE CASCADE
);

CREATE TABLE Comentario (
  id_comentario BIGINT       AUTO_INCREMENT PRIMARY KEY,
  id_reporte    BIGINT       NOT NULL,
  id_usuario    BIGINT       NOT NULL,
  texto         VARCHAR(500) NOT NULL,
  fecha         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_reporte) REFERENCES Reporte(id_reporte) ON DELETE CASCADE,
  FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario),
  INDEX idx_comentario_reporte (id_reporte)
);

-- Código pendiente de la verificación en dos pasos. Se guarda su hash, no el
-- código; a los 3 intentos fallidos la fila se borra.
CREATE TABLE Desafio_DosPasos (
  id_desafio  CHAR(64)  PRIMARY KEY,
  id_usuario  BIGINT    NOT NULL,
  codigo_hash CHAR(64)  NOT NULL,
  expira      DATETIME  NOT NULL,
  intentos    INT       NOT NULL DEFAULT 0,
  FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario)
);

-- Contadores anónimos de uso: un total por evento, sin id de usuario.
CREATE TABLE Analitica_Evento (
  nombre VARCHAR(50) PRIMARY KEY,
  total  BIGINT      NOT NULL DEFAULT 0
);

-- Tipos de fraude que usa la app (los anteriores se conservan).
INSERT IGNORE INTO TipoFraude (nombre_tipo, descripcion) VALUES
('Oferta Falsa', 'Descuentos irreales y liquidaciones que nunca llegan.'),
('Sorteo Falso', 'Concursos y premios falsos que piden datos o dinero.'),
('Tienda Clonada', 'Sitios que imitan marcas conocidas para robar el pago.'),
('Marketplace', 'Vendedores falsos en redes que cobran y no entregan.'),
('Llamada', 'Llamadas y mensajes que se hacen pasar por bancos o autoridades.'),
('Otro', 'Otro tipo de engaño; el detalle va en Reporte.tipo_otro.');
