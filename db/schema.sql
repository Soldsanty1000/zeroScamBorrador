-- ZeroScam (0Fraude) — Modelo físico.
-- Se recrean todas las tablas (la base se vacía).
CREATE DATABASE IF NOT EXISTS ZeroScam;
USE ZeroScam;

DROP TABLE IF EXISTS Notificacion_Alerta;
DROP TABLE IF EXISTS Historial_Estado;
DROP TABLE IF EXISTS Reporte_URL;
DROP TABLE IF EXISTS Consulta_URL;
DROP TABLE IF EXISTS SitioWeb_URL;
DROP TABLE IF EXISTS Evidencia;
DROP TABLE IF EXISTS Reporte;
DROP TABLE IF EXISTS TipoFraude;
DROP TABLE IF EXISTS Usuario;
DROP TABLE IF EXISTS Estado;
DROP TABLE IF EXISTS Rol;

CREATE TABLE Rol (
  id_rol      INT          AUTO_INCREMENT PRIMARY KEY,
  nombre_rol  VARCHAR(30)  NOT NULL UNIQUE COMMENT 'Usuario, Administrador, Policia, Owner',
  descripcion VARCHAR(150) NULL
);

CREATE TABLE Estado (
  id_estado     INT          AUTO_INCREMENT PRIMARY KEY,
  nombre_estado VARCHAR(30)  NOT NULL UNIQUE COMMENT 'RECIBIDO, EN_REVISION, VALIDADO, RECHAZADO, CANALIZADO',
  descripcion   VARCHAR(150) NULL,
  es_final      BOOLEAN      NOT NULL DEFAULT FALSE,
  orden         INT          NULL
);

CREATE TABLE Usuario (
  id_usuario         BIGINT       AUTO_INCREMENT PRIMARY KEY,
  id_rol             INT          NOT NULL,
  nombre             VARCHAR(50)  NOT NULL,
  apellido           VARCHAR(50)  NOT NULL,
  pais               VARCHAR(30)  NOT NULL,
  correo_electronico VARCHAR(150) NOT NULL UNIQUE,
  contrasena_hash    VARCHAR(255) NOT NULL,
  estado_cuenta      VARCHAR(20)  NOT NULL DEFAULT 'ACTIVO' COMMENT 'ACTIVO, SUSPENDIDO',
  fecha_registro     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_consentimiento DATETIME   NULL COMMENT 'Aceptación del aviso de privacidad (RNF07); NULL en las cuentas de arranque',
  FOREIGN KEY (id_rol) REFERENCES Rol(id_rol)
);

CREATE TABLE TipoFraude (
  id_tipo_fraude INT          AUTO_INCREMENT PRIMARY KEY,
  nombre_tipo    VARCHAR(50)  NOT NULL UNIQUE,
  descripcion    VARCHAR(255) NULL
);

CREATE TABLE Reporte (
  id_reporte            BIGINT      AUTO_INCREMENT PRIMARY KEY,
  id_usuario            BIGINT      NOT NULL,
  id_tipo_fraude        INT         NOT NULL,
  id_estado             INT         NOT NULL,
  descripcion_incidente TEXT        NOT NULL,
  fecha_incidente       DATETIME    NOT NULL,
  nivel_riesgo_asignado VARCHAR(20) NOT NULL DEFAULT 'NO_EVALUADO',
  fecha_creacion        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario),
  FOREIGN KEY (id_tipo_fraude) REFERENCES TipoFraude(id_tipo_fraude),
  FOREIGN KEY (id_estado) REFERENCES Estado(id_estado),
  INDEX idx_reporte_usuario (id_usuario),
  INDEX idx_reporte_estado (id_estado)
);

CREATE TABLE Evidencia (
  id_evidencia BIGINT       AUTO_INCREMENT PRIMARY KEY,
  id_reporte   BIGINT       NOT NULL,
  ruta_archivo VARCHAR(500) NOT NULL,
  tipo_archivo VARCHAR(50)  NOT NULL,
  fecha_carga  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_reporte) REFERENCES Reporte(id_reporte)
);

CREATE TABLE SitioWeb_URL (
  id_url                  BIGINT        AUTO_INCREMENT PRIMARY KEY,
  url_texto               VARCHAR(2048) NOT NULL,
  nivel_riesgo_global     VARCHAR(20)   NOT NULL DEFAULT 'BAJO' COMMENT 'BAJO, MEDIO, ALTO, MUY_ALTO',
  estado_certificado      VARCHAR(50)   NULL,
  fecha_ultima_evaluacion DATETIME      NULL,
  detalle_evaluacion      JSON          NULL COMMENT 'Puntaje y verificaciones del último análisis (RF07)',
  -- MySQL no deja un índice sobre 2048 caracteres utf8mb4 (máx. 3072 bytes),
  -- así que el UNIQUE es sobre los primeros 768 caracteres.
  UNIQUE KEY uq_url_texto (url_texto(768))
);

CREATE TABLE Reporte_URL (
  id_reporte       BIGINT   NOT NULL,
  id_url           BIGINT   NOT NULL,
  fecha_asociacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_reporte, id_url),
  FOREIGN KEY (id_reporte) REFERENCES Reporte(id_reporte),
  FOREIGN KEY (id_url) REFERENCES SitioWeb_URL(id_url)
);

-- Quién analizó qué URL y cuándo fue la última vez: a esos usuarios se les
-- avisa si el riesgo de la URL sube (RF08).
CREATE TABLE Consulta_URL (
  id_usuario     BIGINT   NOT NULL,
  id_url         BIGINT   NOT NULL,
  fecha_consulta DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_usuario, id_url),
  FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario),
  FOREIGN KEY (id_url) REFERENCES SitioWeb_URL(id_url)
);

CREATE TABLE Historial_Estado (
  id_historial         BIGINT   AUTO_INCREMENT PRIMARY KEY,
  id_reporte           BIGINT   NOT NULL,
  id_admin_responsable BIGINT   NOT NULL,
  id_estado_anterior   INT      NULL COMMENT 'NULL en el registro inicial',
  id_estado_nuevo      INT      NOT NULL,
  observaciones        TEXT     NULL,
  fecha_cambio         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_reporte) REFERENCES Reporte(id_reporte),
  FOREIGN KEY (id_admin_responsable) REFERENCES Usuario(id_usuario),
  FOREIGN KEY (id_estado_anterior) REFERENCES Estado(id_estado),
  FOREIGN KEY (id_estado_nuevo) REFERENCES Estado(id_estado)
);

CREATE TABLE Notificacion_Alerta (
  id_notificacion BIGINT   AUTO_INCREMENT PRIMARY KEY,
  id_usuario      BIGINT   NOT NULL,
  id_reporte      BIGINT   NULL,
  id_url          BIGINT   NULL COMMENT 'URL de la alerta de riesgo (RF08); NULL si el aviso es de un reporte',
  mensaje         TEXT     NOT NULL,
  leido_estatus   BOOLEAN  NOT NULL DEFAULT FALSE,
  fecha_envio     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario),
  FOREIGN KEY (id_reporte) REFERENCES Reporte(id_reporte),
  FOREIGN KEY (id_url) REFERENCES SitioWeb_URL(id_url)
);

INSERT INTO Rol (nombre_rol, descripcion) VALUES
('Usuario', 'Usuario estándar de la plataforma que realiza reportes.'),
('Administrador', 'Personal encargado de revisar y validar los reportes.'),
('Policia', 'Autoridad legal a la que se canalizan los reportes graves.'),
('Owner', 'Propietario y administrador supremo del sistema.');

INSERT INTO Estado (nombre_estado, descripcion, es_final, orden) VALUES
('RECIBIDO', 'El reporte ha sido ingresado al sistema y espera asignación.', 0, 1),
('EN_REVISION', 'Un administrador está analizando los datos y evidencias.', 0, 2),
('VALIDADO', 'El reporte es verídico pero aún no se toma una acción definitiva.', 0, 3),
('RECHAZADO', 'El reporte no procede, es falso o carece de evidencia suficiente.', 1, 4),
('CANALIZADO', 'El reporte ha sido enviado a las autoridades correspondientes.', 1, 5);

INSERT INTO TipoFraude (nombre_tipo, descripcion) VALUES
('Phishing', 'Suplantación de identidad mediante correos o enlaces falsos para robar credenciales.'),
('Estafa en Comercio Electrónico', 'Compra o venta fraudulenta donde el producto no llega o el pago es falso.'),
('Robo de Identidad', 'Uso no autorizado de los datos personales de un usuario.'),
('Fraude de Inversión / Cripto', 'Esquemas Ponzi o falsas promesas de altos rendimientos financieros.'),
('Ransomware / Extorsión', 'Secuestro de datos o amenazas cibernéticas a cambio de dinero.'),
('Fraude Telefónico (Vishing)', 'Llamadas fraudulentas simulando ser bancos o instituciones oficiales.');

-- Cuentas de arranque para probar cada rol. Password de las tres: ZeroScam123!
-- (hash SHA-256 en hex, igual que AuthService). Cámbienlas fuera de desarrollo.
INSERT INTO Usuario (id_rol, nombre, apellido, pais, correo_electronico, contrasena_hash) VALUES
((SELECT id_rol FROM Rol WHERE nombre_rol = 'Owner'), 'Owner', 'ZeroScam', 'México', 'owner@zeroscam.mx', 'de25822427b7186ec9855ad1e7bf319974a5fe426c7e57eb85293f2ad539ff21'),
((SELECT id_rol FROM Rol WHERE nombre_rol = 'Administrador'), 'Admin', 'ZeroScam', 'México', 'admin@zeroscam.mx', 'de25822427b7186ec9855ad1e7bf319974a5fe426c7e57eb85293f2ad539ff21'),
((SELECT id_rol FROM Rol WHERE nombre_rol = 'Policia'), 'Policía', 'Cibernética', 'México', 'policia@zeroscam.mx', 'de25822427b7186ec9855ad1e7bf319974a5fe426c7e57eb85293f2ad539ff21');
