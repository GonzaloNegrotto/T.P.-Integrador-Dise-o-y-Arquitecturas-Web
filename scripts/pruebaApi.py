"""Prueba de conexión con la API de TMDB.

Las credenciales se leen del archivo .env de la raíz del proyecto,
así no quedan escritas en el código ni terminan en el repositorio.
"""

import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

# Raíz del proyecto = carpeta que contiene a Back/
RAIZ = Path(__file__).resolve().parent.parent

# override=True: el .env manda por sobre variables de entorno viejas del sistema
load_dotenv(RAIZ / ".env", override=True)

TOKEN = os.getenv("API_READ_ACCESS_TOKEN")

if not TOKEN:
    sys.exit(
        "Falta API_READ_ACCESS_TOKEN.\n"
        f"Revisá que exista el archivo {RAIZ / '.env'} con la línea:\n"
        "  API_READ_ACCESS_TOKEN=tu_token_de_tmdb"
    )

URL = "https://api.themoviedb.org/3/authentication"

headers = {
    "accept": "application/json",
    "Authorization": f"Bearer {TOKEN}",
}

try:
    response = requests.get(URL, headers=headers, timeout=10)
    response.raise_for_status()
except requests.exceptions.RequestException as error:
    sys.exit(f"Error al conectarse con TMDB: {error}")

print(f"Estado HTTP: {response.status_code}")
print(response.text)
