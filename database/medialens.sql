-- ============================================================
-- MediaLens: script SQL de la base de datos (PostgreSQL)
-- ============================================================
-- Crea las 4 tablas del modelo (roles, usuarios, favoritos y auditoria),
-- sus claves, restricciones e índices, y carga los 3 roles.
--
-- Es equivalente a aplicar todas las migraciones de migrations/ con
--     flask --app Back/app.py db upgrade
-- y deja registrada la versión de migración, para que después se pueda
-- seguir usando Flask-Migrate sobre la misma base.
--
-- Uso, sobre una base vacía:
--     psql "postgresql://usuario:contraseña@host/base" -f database/medialens.sql
--
-- El catálogo de películas no se guarda en la base: se consulta a TMDB en el
-- momento (ver la sección 4.1 del documento técnico).
-- ============================================================

BEGIN;

-- Tabla roles
CREATE TABLE roles (
	id SERIAL NOT NULL, 
	nombre VARCHAR(30) NOT NULL, 
	descripcion VARCHAR(120) NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (nombre)
);

-- Tabla usuarios
CREATE TABLE usuarios (
	id SERIAL NOT NULL, 
	nombre VARCHAR(40) NOT NULL, 
	email VARCHAR(255) NOT NULL, 
	password_hash VARCHAR(255) NOT NULL, 
	estado VARCHAR(10) DEFAULT 'activo' NOT NULL, 
	fecha_nacimiento DATE NOT NULL, 
	generos JSON NOT NULL, 
	rol_id INTEGER NOT NULL, 
	creado_en TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(rol_id) REFERENCES roles (id)
);
CREATE UNIQUE INDEX ix_usuarios_email ON usuarios (email);
CREATE INDEX ix_usuarios_rol_id ON usuarios (rol_id);

-- Tabla auditoria
CREATE TABLE auditoria (
	id SERIAL NOT NULL, 
	usuario_id INTEGER, 
	accion VARCHAR(40) NOT NULL, 
	entidad VARCHAR(30) NOT NULL, 
	entidad_id INTEGER, 
	detalle JSON NOT NULL, 
	fecha TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
);
CREATE INDEX ix_auditoria_usuario_id ON auditoria (usuario_id);

-- Tabla favoritos
CREATE TABLE favoritos (
	id SERIAL NOT NULL, 
	usuario_id INTEGER NOT NULL, 
	pelicula_id INTEGER NOT NULL, 
	titulo VARCHAR(255) NOT NULL, 
	poster VARCHAR(100), 
	anio VARCHAR(4), 
	puntaje FLOAT NOT NULL, 
	votos INTEGER NOT NULL, 
	generos JSON NOT NULL, 
	agregado_en TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_favoritos_usuario_pelicula UNIQUE (usuario_id, pelicula_id), 
	FOREIGN KEY(usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
);
CREATE INDEX ix_favoritos_usuario_id ON favoritos (usuario_id);

-- Roles del sistema (sección 18.1 del documento técnico).
-- «usuario» es el que se asigna al registrarse.
INSERT INTO roles (nombre, descripcion) VALUES
    ('superadministrador', 'Acceso total a la aplicación.'),
    ('administrador', 'Administra las cuentas de usuarios.'),
    ('usuario', 'Acceso básico de una cuenta registrada.');

-- Versión de migración: Flask-Migrate reconoce la base como actualizada.
CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL,
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);
INSERT INTO alembic_version (version_num) VALUES ('d8e2f3a4b5c6');

COMMIT;
