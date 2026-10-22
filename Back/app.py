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

import math
import mimetypes
import os
import threading
import time
from datetime import date
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, abort, jsonify, request, send_from_directory, session
from flask_migrate import Migrate
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash
from sqlalchemy.exc import IntegrityError


if __package__:
    from .conexionDB import DATABASE_URL, db
    from .modeloDatos import Usuario  # noqa: F401
else:
    # Permite ejecutar directamente `python Back/app.py`.
    from conexionDB import DATABASE_URL, db
    from modeloDatos import Usuario  # noqa: F401

# Importar los modelos registra sus tablas en el metadata de SQLAlchemy antes
# de que Flask-Migrate compare el esquema de la base de datos.
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

# La conexión se toma exclusivamente del .env y se reutiliza mediante el pool
# de SQLAlchemy. Flask-Migrate usa esta misma instancia para las migraciones.
app.config["SQLALCHEMY_DATABASE_URI"] = DATABASE_URL
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
# Se recomienda definir SECRET_KEY en .env; la URL privada es un respaldo
# estable para no invalidar sesiones existentes si falta esa variable.
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY") or DATABASE_URL
db.init_app(app)

# Habilita los comandos `flask db ...` (migrate, upgrade, current) usando la
# carpeta migrations/ de la raíz, sin importar desde dónde se ejecuten.
migrate = Migrate(app, db, directory=str(RAIZ / "migrations"))

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

def respuesta_usuario(usuario):
    """Devuelve datos públicos del usuario, sin exponer su contraseña."""
    return {
        "id": usuario.id,
        "nombre": usuario.nombre,
        "email": usuario.email,
        "fecha_nacimiento": usuario.fecha_nacimiento.isoformat(),
        "generos": usuario.generos,
    }


@app.post("/api/auth/registro")
def registrar_usuario():
    """Valida y persiste una cuenta con la contraseña hasheada."""
    datos = request.get_json(silent=True) or {}
    nombre = str(datos.get("nombre", "")).strip()
    email = str(datos.get("email", "")).strip().lower()
    password = str(datos.get("password", ""))
    nacimiento = str(datos.get("nacimiento", ""))
    generos = datos.get("generos")

    if not nombre or len(nombre) > 40:
        raise ErrorApi(400, "El nombre es obligatorio y debe tener hasta 40 caracteres.")
    if "@" not in email or len(email) > 255:
        raise ErrorApi(400, "Ingresá un email válido.")
    if len(password) < 8:
        raise ErrorApi(400, "La contraseña debe tener al menos 8 caracteres.")
    try:
        fecha_nacimiento = date.fromisoformat(nacimiento)
    except ValueError:
        raise ErrorApi(400, "La fecha de nacimiento no es válida.")
    if fecha_nacimiento >= date.today():
        raise ErrorApi(400, "La fecha de nacimiento debe ser anterior a hoy.")
    if not isinstance(generos, list) or not 1 <= len(generos) <= 5:
        raise ErrorApi(400, "Elegí entre 1 y 5 géneros favoritos.")

    usuario = Usuario(
        nombre=nombre,
        email=email,
        password_hash=generate_password_hash(password),
        fecha_nacimiento=fecha_nacimiento,
        generos=generos,
    )
    db.session.add(usuario)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        raise ErrorApi(409, "Ya existe una cuenta registrada con ese email.")

    return jsonify(usuario=respuesta_usuario(usuario)), 201


@app.post("/api/auth/login")
def iniciar_sesion():
    """Comprueba credenciales y crea una sesión firmada en el servidor."""
    datos = request.get_json(silent=True) or {}
    email = str(datos.get("email", "")).strip().lower()
    password = str(datos.get("password", ""))
    usuario = db.session.scalar(db.select(Usuario).where(Usuario.email == email))
    if usuario is None or not check_password_hash(usuario.password_hash, password):
        raise ErrorApi(401, "El email o la contraseña no son correctos.")

    session.clear()
    session["usuario_id"] = usuario.id
    return jsonify(usuario=respuesta_usuario(usuario))


@app.get("/api/auth/me")
def usuario_actual():
    """Recupera el usuario asociado a la sesión actual."""
    usuario_id = session.get("usuario_id")
    if usuario_id is None:
        raise ErrorApi(401, "No hay una sesión iniciada.")
    usuario = db.session.get(Usuario, usuario_id)
    if usuario is None:
        session.clear()
        raise ErrorApi(401, "La sesión ya no es válida.")
    return jsonify(usuario=respuesta_usuario(usuario))


@app.post("/api/auth/logout")
def cerrar_sesion():
    """Elimina la sesión actual."""
    session.clear()
    return jsonify(mensaje="Sesión cerrada.")


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

NOMINATIM_URL = "https://nominatim.openstreetmap.org"
RADIOS_KM = (2, 5, 10)
LIMITE_NOMINATIM = 40  # máximo de resultados que devuelve Nominatim por consulta

# Política de uso de Nominatim: identificar la aplicación y no superar una
# consulta por segundo. 
sesion_osm = requests.Session()
sesion_osm.headers.update({
    "User-Agent": "MediaLens/1.0 (Trabajo Practico Integrador UAI)",
    "Accept-Language": "es",
})
_candado_osm = threading.Lock()
_ultima_consulta_osm = 0.0


def consultar_nominatim(ruta, parametros):
    """GET a Nominatim respetando su política de uso. Devuelve el JSON o lanza ErrorApi."""
    global _ultima_consulta_osm
    with _candado_osm:
        espera = 1.0 - (time.monotonic() - _ultima_consulta_osm)
        if espera > 0:
            time.sleep(espera)
        try:
            respuesta = sesion_osm.get(
                f"{NOMINATIM_URL}{ruta}",
                params={"format": "jsonv2", **parametros},
                timeout=(3.05, 10),
            )
        except requests.exceptions.Timeout:
            log.warning("Nominatim no respondió a tiempo: %s", ruta)
            raise ErrorApi(504, "El servicio de mapas tardó demasiado en responder. Probá de nuevo.")
        except requests.exceptions.RequestException as error:
            log.warning("No se pudo conectar con Nominatim (%s): %s", ruta, error)
            raise ErrorApi(503, "No se pudo conectar con el servicio de mapas.")
        finally:
            _ultima_consulta_osm = time.monotonic()

    if respuesta.status_code == 429:
        raise ErrorApi(503, "El servicio de mapas recibió demasiadas consultas. Esperá unos segundos.")
    if not respuesta.ok:
        log.warning("Nominatim devolvió %s en %s", respuesta.status_code, ruta)
        raise ErrorApi(502, "El servicio de mapas devolvió un error inesperado.")
    try:
        return respuesta.json()
    except ValueError:
        raise ErrorApi(502, "El servicio de mapas devolvió una respuesta inválida.")


def leer_coordenadas():
    """Lee y valida ?lat=...&lon=... de la URL."""
    try:
        lat = float(request.args["lat"])
        lon = float(request.args["lon"])
    except (KeyError, ValueError):
        raise ErrorApi(400, "Faltan coordenadas válidas (lat y lon).")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ErrorApi(400, "Las coordenadas están fuera de rango.")
    return lat, lon


def distancia_km(lat1, lon1, lat2, lon2):
    """Distancia en línea recta sobre la superficie terrestre"""
    radio_tierra = 6371
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * radio_tierra * math.asin(math.sqrt(a))


def caja_alrededor(lat, lon, km):
    """Rectángulo (viewbox) que contiene el círculo de `km` alrededor del punto."""
    dlat = km / 111.32
    dlon = km / (111.32 * math.cos(math.radians(lat)))
    return f"{lon - dlon},{lat + dlat},{lon + dlon},{lat - dlat}"  # izquierda, arriba, derecha, abajo


def nombre_de_zona(direccion):
    """Barrio o localidad a partir del detalle de dirección de Nominatim."""
    return (
        direccion.get("suburb")
        or direccion.get("city_district")
        or direccion.get("neighbourhood")
        or direccion.get("town")
        or direccion.get("city")
    )


def resumir_cine(lugar, lat, lon):
    extra = lugar.get("extratags") or {}
    direccion = lugar.get("address") or {}
    calle = " ".join(filter(None, [direccion.get("road"), direccion.get("house_number")]))
    web = extra.get("website") or extra.get("contact:website") or extra.get("url")
    # Solo enlaces web (http/https): los datos de OpenStreetMap los carga la comunidad.
    if web and not web.startswith(("http://", "https://")):
        web = f"https://{web}"
    lat_cine, lon_cine = float(lugar["lat"]), float(lugar["lon"])
    return {
        "id": f"{lugar.get('osm_type', '')[:1]}{lugar.get('osm_id')}",
        "nombre": lugar.get("name") or "Cine sin nombre",
        "direccion": calle or None,
        "zona": nombre_de_zona(direccion),
        "lat": lat_cine,
        "lon": lon_cine,
        "distancia_km": round(distancia_km(lat, lon, lat_cine, lon_cine), 2),
        "web": web,
        "telefono": extra.get("phone") or extra.get("contact:phone"),
    }


@app.get("/api/cines")
def cines_cercanos():
    lat, lon = leer_coordenadas()
    radio = request.args.get("radio", 5, type=int)
    if radio not in RADIOS_KM:
        raise ErrorApi(400, "El radio tiene que ser de 2, 5 o 10 km.")

    # La caché usa coordenadas redondeadas (~100 m) para reutilizar búsquedas cercanas.
    datos = con_cache(
        f"cines:{lat:.3f}:{lon:.3f}:{radio}",
        6 * 3600,
        lambda: consultar_nominatim("/search", {
            "amenity": "cinema",
            "viewbox": caja_alrededor(lat, lon, radio),
            "bounded": 1,
            "limit": LIMITE_NOMINATIM,
            "extratags": 1,
            "addressdetails": 1,
        }),
    )
    cines = [
        resumir_cine(lugar, lat, lon)
        for lugar in datos
        if lugar.get("category") == "amenity" and lugar.get("type") == "cinema"
    ]
    # La búsqueda es por rectángulo: se descartan las esquinas que quedan fuera del radio.
    cines = sorted((c for c in cines if c["distancia_km"] <= radio), key=lambda c: c["distancia_km"])
    return jsonify(radio=radio, cines=cines, limite_alcanzado=len(datos) >= LIMITE_NOMINATIM)


@app.get("/api/ubicacion")
def buscar_ubicacion():
    consulta = (request.args.get("q") or "").strip()
    if not 3 <= len(consulta) <= 120:
        raise ErrorApi(400, "Escribí una dirección o barrio de entre 3 y 120 caracteres.")
    datos = con_cache(
        f"ubicacion:{consulta.lower()}",
        24 * 3600,
        lambda: consultar_nominatim("/search", {"q": consulta, "limit": 5, "countrycodes": "ar"}),
    )
    return jsonify(lugares=[
        {"nombre": d.get("display_name"), "lat": float(d["lat"]), "lon": float(d["lon"])}
        for d in datos
    ])


@app.get("/api/ubicacion/inversa")
def ubicacion_inversa():
    lat, lon = leer_coordenadas()
    datos = con_cache(
        f"inversa:{lat:.3f}:{lon:.3f}",
        24 * 3600,
        lambda: consultar_nominatim("/reverse", {"lat": lat, "lon": lon, "zoom": 14, "addressdetails": 1}),
    )
    direccion = datos.get("address") or {}
    partes = [nombre_de_zona(direccion), direccion.get("city") or direccion.get("state")]
    nombre = ", ".join(dict.fromkeys(filter(None, partes)))  # sin repetir (ej: "Rosario, Rosario")
    return jsonify(nombre=nombre or "tu ubicación")


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
