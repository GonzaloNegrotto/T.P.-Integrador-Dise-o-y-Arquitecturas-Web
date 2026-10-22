"""Configuración compartida de la conexión con PostgreSQL.

La URL se mantiene fuera del código, en el archivo .env de la raíz del
proyecto. Este módulo solo crea la instancia de SQLAlchemy; la aplicación
Flask la inicializa cuando arranca.
"""

import os

from pathlib import Path

from dotenv import load_dotenv
from flask_sqlalchemy import SQLAlchemy

RAIZ = Path(__file__).resolve().parent.parent
load_dotenv(RAIZ / ".env", override=True)

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError(
        "Falta DATABASE_URL en el archivo .env. "
        "No se puede iniciar la conexión con PostgreSQL."
    )

# SQLAlchemy administra el pool y las sesiones de la base de datos.
db = SQLAlchemy()