"""Servidor de MediaLens.

Cumple dos funciones:

1. Sirve el sitio (HTML, CSS y JS).
2. Hace de intermediario con TMDB: el navegador le pide datos a /api/...
   y este servidor consulta TMDB con el token del .env. Así el token
   nunca llega al navegador.

Uso (con el venv activado, desde la raíz del proyecto):

    python Back/app.py

y abrir http://localhost:5000
"""

import mimetypes
import os
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, abort, jsonify, request, send_from_directory
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from werkzeug.exceptions import HTTPException

# ============================================
# Configuración
# ============================================

RAIZ = Path(__file__).resolve().parent.parent
load_dotenv(RAIZ / ".env", override=True)

TOKEN = os.getenv("API_READ_ACCESS_TOKEN")
TMDB_URL = "https://api.themoviedb.org/3"
IDIOMA = "es-MX"  # títulos como se conocen en Latinoamérica
TIMEOUT = (3.05, 7)  # segundos: (conectar, esperar respuesta)
INTENTOS_CONEXION = 4  # reintentos ante conexiones cortadas (ver consultar_tmdb)

# Solo estas carpetas se sirven al navegador. Nunca la raíz completa:
# ahí están el .env, el venv y el código del backend.
CARPETAS_PUBLICAS = {"assets", "pages", "admin"}

# En Windows el registro a veces asocia .js con text/plain, y el
# navegador se niega a ejecutar módulos con ese tipo. Lo forzamos.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")

app = Flask(__name__, static_folder=None)
log = app.logger

# Sesión HTTP reutilizable: mantiene la conexión abierta entre consultas
# (más rápido) y reintenta una vez si TMDB responde 5xx o 429.
# Los cortes de conexión se reintentan a mano en consultar_tmdb().
sesion = requests.Session()
sesion.headers.update({"accept": "application/json", "Authorization": f"Bearer {TOKEN}"})
sesion.mount(
    "https://",
    HTTPAdapter(
        max_retries=Retry(
            total=None,
            connect=0,
            read=False,  # si TMDB no contesta a tiempo, no esperamos el doble
            status=1,
            backoff_factor=0.4,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=("GET",),
            raise_on_status=False,
        )
    ),
)


# ============================================
# Errores
# ============================================

class ErrorApi(Exception):
    """Error con un código HTTP y un mensaje apto para mostrar al usuario."""

    def __init__(self, estado, mensaje):
        super().__init__(mensaje)
        self.estado = estado
        self.mensaje = mensaje


@app.errorhandler(ErrorApi)
def responder_error_api(error):
    return jsonify(error=error.mensaje), error.estado


@app.errorhandler(404)
def no_encontrado(_error):
    if request.path.startswith("/api/"):
        return jsonify(error="Ese recurso de la API no existe."), 404
    pagina = RAIZ / "404.html"
    if pagina.is_file():
        return pagina.read_text(encoding="utf-8"), 404
    return "Página no encontrada", 404


@app.errorhandler(Exception)
def error_inesperado(error):
    if isinstance(error, HTTPException):
        return error
    log.exception("Error inesperado en %s", request.path)
    if request.path.startswith("/api/"):
        return jsonify(error="Ocurrió un error inesperado en el servidor."), 500
    return "Error interno del servidor", 500


# ============================================
# Acceso a TMDB
# ============================================

def consultar_tmdb(ruta, parametros=None):
    """Hace un GET a TMDB y devuelve el JSON, o lanza ErrorApi."""
    if not TOKEN:
        log.error("Falta API_READ_ACCESS_TOKEN en el archivo .env")
        raise ErrorApi(500, "El servidor no tiene configurada la conexión con TMDB.")

    parametros = {"language": IDIOMA, **(parametros or {})}

    # Las conexiones cortadas ("Connection reset") se reintentan: fallan
    # rápido y un GET se puede repetir sin riesgo. Pasa, por ejemplo, cuando
    # TMDB cierra una conexión que quedó inactiva, o con redes inestables.
    # Los timeouts NO se reintentan, para no hacer esperar el doble.
    for intento in range(1, INTENTOS_CONEXION + 1):
        try:
            respuesta = sesion.get(f"{TMDB_URL}{ruta}", params=parametros, timeout=TIMEOUT)
            break
        except requests.exceptions.Timeout:
            log.warning("TMDB no respondió a tiempo: %s", ruta)
            raise ErrorApi(504, "TMDB tardó demasiado en responder. Probá de nuevo en unos segundos.")
        except requests.exceptions.ConnectionError as error:
            if intento < INTENTOS_CONEXION:
                log.info("Conexión con TMDB interrumpida (%s), intento %s…", ruta, intento + 1)
                time.sleep(0.15 * intento)
                continue
            log.warning("No se pudo conectar con TMDB tras %s intentos (%s): %s", intento, ruta, error)
            raise ErrorApi(503, "No se pudo conectar con TMDB. Revisá la conexión a internet del servidor.")
        except requests.exceptions.RequestException as error:
            log.warning("Error al consultar TMDB (%s): %s", ruta, error)
            raise ErrorApi(502, "No se pudo completar la consulta a TMDB.")

    if respuesta.status_code == 404:
        raise ErrorApi(404, "No encontramos lo que buscabas.")
    if respuesta.status_code == 401:
        log.error("TMDB rechazó el token (401). Revisá el archivo .env.")
        raise ErrorApi(502, "El servidor no pudo autenticarse con TMDB.")
    if respuesta.status_code == 429:
        raise ErrorApi(503, "Hay demasiadas consultas en este momento. Esperá unos segundos.")
    if not respuesta.ok:
        log.warning("TMDB devolvió %s en %s", respuesta.status_code, ruta)
        raise ErrorApi(502, "TMDB devolvió un error inesperado.")

    try:
        return respuesta.json()
    except ValueError:
        raise ErrorApi(502, "TMDB devolvió una respuesta con formato inválido.")


# Caché en memoria: evita repetir consultas y sirve de respaldo.
_cache = {}
MAX_ENTRADAS_CACHE = 300


def con_cache(clave, segundos, obtener):
    """Devuelve el dato guardado si es reciente; si no, lo pide de nuevo.

    Si TMDB falla y hay una copia vieja, se devuelve esa: es preferible
    mostrar datos de hace un rato que un error.
    """
    ahora = time.monotonic()
    guardado = _cache.get(clave)
    if guardado and ahora - guardado[0] < segundos:
        return guardado[1]

    try:
        datos = obtener()
    except ErrorApi as error:
        if guardado and error.estado >= 500:
            log.warning("TMDB falló (%s); se usa la copia guardada de '%s'", error.mensaje, clave)
            return guardado[1]
        raise

    if len(_cache) >= MAX_ENTRADAS_CACHE:
        _cache.clear()  # simple: evita que el caché crezca sin límite
    _cache[clave] = (ahora, datos)
    return datos


def obtener_generos():
    datos = con_cache("generos", 24 * 3600, lambda: consultar_tmdb("/genre/movie/list"))
    return datos.get("genres", [])


def mapa_generos():
    """{id: nombre}. Si TMDB falla, devuelve {} para no romper el listado."""
    try:
        return {g["id"]: g["name"] for g in obtener_generos()}
    except ErrorApi:
        return {}


# ============================================
# Formato de las respuestas
# Devolvemos solo lo que usa el front, con nombres en español.
# ============================================

def resumir_pelicula(pelicula, nombres_generos):
    fecha = pelicula.get("release_date") or ""
    ids_generos = pelicula.get("genre_ids") or []
    return {
        "id": pelicula["id"],
        "titulo": pelicula.get("title") or pelicula.get("original_title") or "Sin título",
        "anio": fecha[:4] or None,
        "puntaje": round(pelicula.get("vote_average") or 0, 1),
        "votos": pelicula.get("vote_count") or 0,
        "poster": pelicula.get("poster_path"),
        "fondo": pelicula.get("backdrop_path"),
        "sinopsis": pelicula.get("overview") or "",
        "genero_ids": ids_generos,
        "generos": [nombres_generos[i] for i in ids_generos if i in nombres_generos],
    }


def es_contenido_adulto(pelicula):
    # TMDB marca el contenido explícito con "adult" y el erótico con "softcore".
    return bool(pelicula.get("adult") or pelicula.get("softcore"))


def listar_peliculas(datos):
    nombres = mapa_generos()
    return [
        resumir_pelicula(p, nombres)
        for p in datos.get("results", [])
        if not es_contenido_adulto(p)
    ]


# ============================================
# API
# ============================================

@app.get("/api/tendencias")
def tendencias():
    periodo = request.args.get("periodo", "week")
    if periodo not in ("day", "week"):
        raise ErrorApi(400, "El período tiene que ser 'day' o 'week'.")
    datos = con_cache(f"tendencias:{periodo}", 600, lambda: consultar_tmdb(f"/trending/movie/{periodo}"))
    return jsonify(resultados=listar_peliculas(datos))


@app.get("/api/top")
def top():
    # /movie/top_rated a veces pone arriba estrenos con pocos votos.
    # Pedimos un mínimo de votos para que el ranking sea representativo.
    datos = con_cache(
        "top",
        3600,
        lambda: consultar_tmdb(
            "/discover/movie",
            {
                "sort_by": "vote_average.desc",
                "vote_count.gte": 10000,
                "include_adult": "false",
            },
        ),
    )
    return jsonify(resultados=listar_peliculas(datos))


@app.get("/api/generos")
def generos():
    lista = [
        {"id": g["id"], "nombre": g["name"]}
        for g in obtener_generos()
        if g["id"] != 10770  # "Película de TV": no aporta en la landing
    ]
    return jsonify(generos=lista)


@app.get("/api/descubrir")
def descubrir():
    genero = request.args.get("genero", type=int)
    if not genero:
        raise ErrorApi(400, "Falta indicar un género válido.")
    datos = con_cache(
        f"descubrir:{genero}",
        1800,
        lambda: consultar_tmdb(
            "/discover/movie",
            {
                "with_genres": genero,
                "sort_by": "popularity.desc",
                "include_adult": "false",
                "vote_count.gte": 50,
            },
        ),
    )
    return jsonify(total=datos.get("total_results", 0), resultados=listar_peliculas(datos))


@app.get("/api/buscar")
def buscar():
    consulta = (request.args.get("q") or "").strip()
    if len(consulta) < 2:
        raise ErrorApi(400, "Escribí al menos 2 caracteres para buscar.")
    if len(consulta) > 100:
        raise ErrorApi(400, "La búsqueda es demasiado larga (máximo 100 caracteres).")
    datos = con_cache(
        f"buscar:{consulta.lower()}",
        600,
        lambda: consultar_tmdb("/search/movie", {"query": consulta, "include_adult": "false"}),
    )
    return jsonify(
        consulta=consulta,
        total=datos.get("total_results", 0),
        resultados=listar_peliculas(datos),
    )


@app.get("/api/pelicula/<int:id_pelicula>")
def pelicula(id_pelicula):
    datos = con_cache(
        f"pelicula:{id_pelicula}",
        3600,
        lambda: consultar_tmdb(f"/movie/{id_pelicula}", {"append_to_response": "credits"}),
    )
    if es_contenido_adulto(datos):
        raise ErrorApi(404, "No encontramos lo que buscabas.")

    creditos = datos.get("credits") or {}
    fecha = datos.get("release_date") or ""
    return jsonify(
        id=datos["id"],
        titulo=datos.get("title") or datos.get("original_title") or "Sin título",
        titulo_original=datos.get("original_title"),
        anio=fecha[:4] or None,
        fecha=fecha or None,
        duracion=datos.get("runtime") or None,
        puntaje=round(datos.get("vote_average") or 0, 1),
        votos=datos.get("vote_count") or 0,
        poster=datos.get("poster_path"),
        fondo=datos.get("backdrop_path"),
        eslogan=datos.get("tagline") or "",
        sinopsis=datos.get("overview") or "",
        generos=[g["name"] for g in datos.get("genres", [])],
        direccion=[c["name"] for c in creditos.get("crew", []) if c.get("job") == "Director"],
        reparto=[
            {"nombre": c["name"], "personaje": c.get("character") or ""}
            for c in creditos.get("cast", [])[:6]
        ],
    )


# ============================================
# Sitio estático
# ============================================

@app.get("/")
@app.get("/index.html")
def inicio():
    return send_from_directory(RAIZ, "index.html")


@app.get("/<carpeta>/<path:archivo>")
def archivos_publicos(carpeta, archivo):
    if carpeta not in CARPETAS_PUBLICAS:
        abort(404)
    return send_from_directory(RAIZ / carpeta, archivo)


if __name__ == "__main__":
    if not TOKEN:
        print("ATENCIÓN: falta API_READ_ACCESS_TOKEN en el .env; la API va a responder con error.")
    print("MediaLens corriendo en http://localhost:5000  (Ctrl+C para detener)")
    app.run(host="127.0.0.1", port=5000, debug=True)
