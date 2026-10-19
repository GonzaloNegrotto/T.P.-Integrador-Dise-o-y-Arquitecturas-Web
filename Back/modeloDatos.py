"""Modelos persistentes de la aplicación.

Cada clase que hereda de db.Model representa una tabla administrada por
Flask-Migrate. La contraseña nunca se guarda en texto plano: se persiste
únicamente su hash.
"""

from sqlalchemy import Date, DateTime, JSON, String, func

if __package__:
    from .conexionDB import db
else:
    # Permite ejecutar directamente `python Back/app.py`.
    from conexionDB import db


class Usuario(db.Model):
    """Cuenta registrada y preferencias de géneros del usuario."""

    __tablename__ = "usuarios"

    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(String(40), nullable=False)
    email = db.Column(String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(String(255), nullable=False)
    fecha_nacimiento = db.Column(Date, nullable=False)
    generos = db.Column(JSON, nullable=False, default=list)
    creado_en = db.Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    def __repr__(self):
        return f"<Usuario {self.email}>"