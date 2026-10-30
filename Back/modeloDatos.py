"""Modelos persistentes de la aplicación.

Cada clase que hereda de db.Model representa una tabla administrada por
Flask-Migrate. La contraseña nunca se guarda en texto plano: se persiste
únicamente su hash.
"""

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, JSON, String, UniqueConstraint, func

if __package__:
    from .conexionDB import db
else:
    # Permite ejecutar directamente `python Back/app.py`.
    from conexionDB import db


class Rol(db.Model):
    """Rol disponible para controlar el acceso a las funciones del sitio."""

    __tablename__ = "roles"

    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(String(30), unique=True, nullable=False)
    descripcion = db.Column(String(120), nullable=False)

    def __repr__(self):
        return f"<Rol {self.nombre}>"


class Usuario(db.Model):
    """Cuenta registrada y preferencias de géneros del usuario."""

    __tablename__ = "usuarios"

    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(String(40), nullable=False)
    email = db.Column(String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(String(255), nullable=False)
    fecha_nacimiento = db.Column(Date, nullable=False)
    generos = db.Column(JSON, nullable=False, default=list)
    rol_id = db.Column(
        Integer,
        ForeignKey("roles.id"),
        nullable=False,
        index=True,
    )
    rol = db.relationship("Rol", backref="usuarios")
    creado_en = db.Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    def __repr__(self):
        return f"<Usuario {self.email}>"


class Favorito(db.Model):
    """Película que un usuario guardó en "Mis favoritas".

    Además del id de TMDB se guarda una copia de los datos que muestra la
    tarjeta (título, póster, año, puntaje y géneros), así la lista se arma
    sin volver a consultar TMDB por cada película.
    """

    __tablename__ = "favoritos"
    __table_args__ = (
        # Una misma película no puede estar dos veces en la lista de un usuario.
        UniqueConstraint("usuario_id", "pelicula_id", name="uq_favoritos_usuario_pelicula"),
    )

    id = db.Column(db.Integer, primary_key=True)
    # Si se borra la cuenta, se borran también sus favoritas.
    usuario_id = db.Column(
        Integer,
        ForeignKey("usuarios.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    pelicula_id = db.Column(Integer, nullable=False)
    titulo = db.Column(String(255), nullable=False)
    poster = db.Column(String(100))
    anio = db.Column(String(4))
    puntaje = db.Column(Float, nullable=False, default=0)
    votos = db.Column(Integer, nullable=False, default=0)
    generos = db.Column(JSON, nullable=False, default=list)
    agregado_en = db.Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    def __repr__(self):
        return f"<Favorito usuario={self.usuario_id} pelicula={self.pelicula_id}>"
