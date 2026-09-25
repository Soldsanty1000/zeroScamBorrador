-- Sesión 04: agregamos usuarios y cada contacto tiene dueño.
-- Se recrea contacts (la agenda se vacía; está bien para clase).
CREATE DATABASE IF NOT EXISTS agenda;
USE agenda;

DROP TABLE IF EXISTS contacts;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id            CHAR(36)     PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash CHAR(64)     NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE contacts (
  id         CHAR(36)     PRIMARY KEY,
  owner_id   CHAR(36)     NOT NULL,
  name       VARCHAR(255) NOT NULL,
  email      VARCHAR(255) NOT NULL,
  phone      VARCHAR(50)  NOT NULL,
  notes      TEXT,
  photo      VARCHAR(255),          -- sesión 06: nombre del archivo en uploads/
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);
