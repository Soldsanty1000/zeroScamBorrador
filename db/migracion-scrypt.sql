-- ZeroScam: migración de contraseñas a scrypt.
--
-- La API ya no acepta los hashes SHA-256 sin sal de antes (64 caracteres
-- hexadecimales): esas cuentas no pueden iniciar sesión hasta tener un hash
-- scrypt. Esto actualiza las cuentas de arranque de schema.sql solo si
-- siguen con su password original (ZeroScam123!): una cuenta a la que ya le
-- cambiaron el password no se toca, para no regresarla a uno conocido. Al
-- final lista las que sigan con el hash viejo.
--
-- Uso, en la PC de la base:
--   docker exec -i zeroscam-db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" ZeroScam' < db/migracion-scrypt.sql

UPDATE Usuario SET contrasena_hash = 'scrypt:207981bdb0fc5b19b926fbea03173ecc:9c8f2ecc6047458fc4a3f87106167a9dd0446f28d87897144f81085e0cbe546392cb8e004ff9a49c88bc1b621c5f15a61f66257c81fdff1788fa926de1108311'
 WHERE correo_electronico = 'owner@zeroscam.mx' AND contrasena_hash = 'de25822427b7186ec9855ad1e7bf319974a5fe426c7e57eb85293f2ad539ff21';
UPDATE Usuario SET contrasena_hash = 'scrypt:ae7fd6b7b46ae847c8a9ccc121c76943:bc05f0e2d730b1f0ec25a44e2283aec57947b7bcae50cf78eecf3d0222d8be28de3e957aec6015f7ab99015f9f9dd5279152b334dca185d7dbb22c83245a3159'
 WHERE correo_electronico = 'admin@zeroscam.mx' AND contrasena_hash = 'de25822427b7186ec9855ad1e7bf319974a5fe426c7e57eb85293f2ad539ff21';
UPDATE Usuario SET contrasena_hash = 'scrypt:f288a91b25790e6eca09b9a4034e9d24:c82043c6eacad07215ad62ad3c3b48f9672222b60e0243a9e35785790118a9c5c5df00bdaaf1a01556e872d49a58967bf68bf29a5bf6aa3889d0094c896ca3f7'
 WHERE correo_electronico = 'policia@zeroscam.mx' AND contrasena_hash = 'de25822427b7186ec9855ad1e7bf319974a5fe426c7e57eb85293f2ad539ff21';

-- Cuentas que siguen con el hash viejo: no hay forma de convertirlas sin el
-- password. Pueden registrarse de nuevo con otro correo, o la administración
-- las elimina desde la app.
SELECT id_usuario, correo_electronico AS 'cuentas con hash viejo'
  FROM Usuario WHERE contrasena_hash REGEXP '^[0-9a-f]{64}$';
