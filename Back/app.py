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
import unicodedata
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from functools import partial
from itertools import zip_longest
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, abort, jsonify, request, send_from_directory, session
from flask_migrate import Migrate
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError


if __package__:
    from .conexionDB import DATABASE_URL, db
    from .modeloDatos import Favorito, Rol, Usuario
else:
    # Permite ejecutar directamente `python Back/app.py`.
    from conexionDB import DATABASE_URL, db
    from modeloDatos import Favorito, Rol, Usuario

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
# La cookie de sesión no se envía en pedidos iniciados desde otros sitios.
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
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
        "rol": usuario.rol.nombre,
    }


EDAD_MINIMA = 13


def calcular_edad(nacimiento):
    hoy = date.today()
    return hoy.year - nacimiento.year - ((hoy.month, hoy.day) < (nacimiento.month, nacimiento.day))


@app.post("/api/auth/registro")
def registrar_usuario():
    """Valida y persiste una cuenta con la contraseña hasheada."""
    datos = request.get_json(silent=True) or {}
    nombre = str(datos.get("nombre", "")).strip()
    email = str(datos.get("email", "")).strip().lower()
    password = str(datos.get("password", ""))
    nacimiento = str(datos.get("nacimiento", ""))
    generos = datos.get("generos")

    # Ley 25.326, art. 5: sin consentimiento expreso no se guardan los datos.
    if datos.get("acepta_privacidad") is not True:
        raise ErrorApi(400, "Tenés que aceptar la política de privacidad para crear la cuenta.")
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
    if calcular_edad(fecha_nacimiento) < EDAD_MINIMA:
        raise ErrorApi(400, f"Tenés que tener al menos {EDAD_MINIMA} años para registrarte.")
    if not isinstance(generos, list) or not 1 <= len(generos) <= 5:
        raise ErrorApi(400, "Elegí entre 1 y 5 géneros favoritos.")

    visitante = db.session.scalar(db.select(Rol).where(Rol.nombre == "visitante"))
    if visitante is None:
        log.error("No existe el rol visitante en la base de datos.")
        raise ErrorApi(500, "La configuración de roles no está disponible.")

    usuario = Usuario(
        nombre=nombre,
        email=email,
        password_hash=generate_password_hash(password),
        fecha_nacimiento=fecha_nacimiento,
        generos=generos,
        rol=visitante,
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


def usuario_de_la_sesion():
    """Usuario con la sesión iniciada. Si no hay ninguno, corta con 401.

    La usan todas las rutas que necesitan una cuenta.
    """
    usuario_id = session.get("usuario_id")
    if usuario_id is None:
        raise ErrorApi(401, "No hay una sesión iniciada.")
    usuario = db.session.get(Usuario, usuario_id)
    if usuario is None:
        session.clear()
        raise ErrorApi(401, "La sesión ya no es válida.")
    return usuario


@app.get("/api/auth/me")
def usuario_actual():
    """Recupera el usuario asociado a la sesión actual."""
    return jsonify(usuario=respuesta_usuario(usuario_de_la_sesion()))


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
    filtros = leer_filtros_busqueda()
    con_filtros = any(filtros[nombre] is not None for nombre in ("genero", "idioma", "puntaje_min"))

    primera = pagina_busqueda(consulta, filtros["anio"], 1)
    crudas = list(primera.get("results", []))
    ultima = min(PAGINAS_BUSQUEDA_CON_FILTROS if con_filtros else 1, primera.get("total_pages") or 1)
    for pagina in range(2, ultima + 1):
        try:
            crudas += pagina_busqueda(consulta, filtros["anio"], pagina).get("results", [])
        except ErrorApi:
            break  # con las páginas que ya llegaron alcanza para responder

    # TMDB puede repetir una película entre páginas: el dict se queda con una sola.
    elegidas = list({p["id"]: p for p in crudas if cumple_filtros(p, filtros)}.values())
    clave = ORDENES_BUSQUEDA[filtros["orden"]]
    if clave:
        elegidas.sort(key=clave, reverse=True)

    nombres = mapa_generos()
    resultados = [
        {**resumir_pelicula(p, nombres), "popularidad": round(p.get("popularity") or 0)}
        for p in elegidas
    ]
    return jsonify(
        consulta=consulta,
        filtros=filtros,
        # Sin filtros, el total que informa TMDB; con filtros, las que pasaron en las páginas revisadas.
        total=len(resultados) if con_filtros else primera.get("total_results", 0),
        resultados=resultados,
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
# Mis favoritas
# Cada usuario guarda películas en su lista. El navegador solo manda el id:
# los datos se toman de TMDB en el servidor, así no se pueden guardar
# títulos o imágenes inventados.
# ============================================

LIMITE_FAVORITAS = 200


def resumir_favorito(favorito):
    """Mismo formato que resumir_pelicula(), para reutilizar las tarjetas del front."""
    return {
        "id": favorito.pelicula_id,
        "titulo": favorito.titulo,
        "anio": favorito.anio,
        "puntaje": favorito.puntaje,
        "votos": favorito.votos,
        "poster": favorito.poster,
        "generos": favorito.generos,
        "agregada_en": favorito.agregado_en.isoformat() if favorito.agregado_en else None,
    }


def buscar_favorito(usuario, id_pelicula):
    return db.session.scalar(
        db.select(Favorito).where(
            Favorito.usuario_id == usuario.id,
            Favorito.pelicula_id == id_pelicula,
        )
    )


@app.get("/api/favoritos")
def listar_favoritos():
    """Favoritas del usuario, de la más reciente a la más antigua."""
    usuario = usuario_de_la_sesion()
    favoritos = db.session.scalars(
        db.select(Favorito)
        .where(Favorito.usuario_id == usuario.id)
        .order_by(Favorito.agregado_en.desc(), Favorito.id.desc())
    ).all()
    return jsonify(favoritas=[resumir_favorito(f) for f in favoritos])


@app.post("/api/favoritos")
def agregar_favorito():
    usuario = usuario_de_la_sesion()
    datos = request.get_json(silent=True) or {}
    id_pelicula = datos.get("pelicula_id")
    # bool es subclase de int en Python: se descarta explícitamente.
    if not isinstance(id_pelicula, int) or isinstance(id_pelicula, bool) or id_pelicula <= 0:
        raise ErrorApi(400, "Falta indicar una película válida.")

    # Si ya estaba guardada, se responde igual que si se acabara de guardar.
    existente = buscar_favorito(usuario, id_pelicula)
    if existente:
        return jsonify(favorita=resumir_favorito(existente)), 200

    cantidad = db.session.scalar(
        db.select(func.count()).select_from(Favorito).where(Favorito.usuario_id == usuario.id)
    )
    if cantidad >= LIMITE_FAVORITAS:
        raise ErrorApi(409, f"Llegaste al máximo de {LIMITE_FAVORITAS} favoritas. Quitá alguna para sumar otra.")

    # Misma clave de caché que /api/pelicula: si ya se abrió el detalle, no se vuelve a pedir.
    pelicula = con_cache(
        f"pelicula:{id_pelicula}",
        3600,
        lambda: consultar_tmdb(f"/movie/{id_pelicula}", {"append_to_response": "credits"}),
    )
    if es_contenido_adulto(pelicula):
        raise ErrorApi(404, "No encontramos lo que buscabas.")

    fecha = pelicula.get("release_date") or ""
    favorito = Favorito(
        usuario_id=usuario.id,
        pelicula_id=id_pelicula,
        titulo=(pelicula.get("title") or pelicula.get("original_title") or "Sin título")[:255],
        poster=pelicula.get("poster_path"),
        anio=fecha[:4] or None,
        puntaje=round(pelicula.get("vote_average") or 0, 1),
        votos=pelicula.get("vote_count") or 0,
        generos=[g["name"] for g in pelicula.get("genres", [])],
    )
    db.session.add(favorito)
    try:
        db.session.commit()
    except IntegrityError:
        # Dos clics casi simultáneos: el otro pedido ya la guardó.
        db.session.rollback()
        return jsonify(favorita=resumir_favorito(buscar_favorito(usuario, id_pelicula))), 200

    return jsonify(favorita=resumir_favorito(favorito)), 201


@app.delete("/api/favoritos/<int:id_pelicula>")
def quitar_favorito(id_pelicula):
    usuario = usuario_de_la_sesion()
    favorito = buscar_favorito(usuario, id_pelicula)
    # Quitar una película que ya no estaba no es un error: el resultado es el mismo.
    if favorito:
        db.session.delete(favorito)
        db.session.commit()
    return jsonify(pelicula_id=id_pelicula, eliminada=favorito is not None)


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
# Rankings
# Películas ordenadas por puntaje o por popularidad, con filtros por género,
# año e idioma (RF02 y RF05). Los datos salen de /discover/movie de TMDB.
# ============================================

CRITERIOS_RANKING = ("puntaje", "popularidad")
# Idiomas originales que ofrece el filtro (códigos ISO 639-1, como los usa TMDB).
IDIOMAS_RANKING = ("es", "en", "fr", "it", "de", "pt", "ja", "ko")
ANIO_MINIMO = 1900
PELICULAS_POR_PAGINA = 20  # tamaño de página de TMDB
PAGINAS_MAXIMAS = 5  # el ranking llega hasta el puesto 100

# Mínimo de votos para entrar al ranking por puntaje, según cuántos filtros hay
# activos. Con pocos votos un 9,5 no significa nada; al filtrar se baja el piso
# para que sigan quedando resultados.
MINIMO_VOTOS_PUNTAJE = {0: 10000, 1: 2000, 2: 500, 3: 200}
MINIMO_VOTOS_POPULARIDAD = 100


def leer_entero_opcional(nombre, minimo, maximo, mensaje):
    """Lee un entero opcional de la URL. Si el valor es inválido, corta con 400."""
    bruto = (request.args.get(nombre) or "").strip()
    if not bruto:
        return None
    try:
        valor = int(bruto)
    except ValueError:
        raise ErrorApi(400, mensaje)
    if not minimo <= valor <= maximo:
        raise ErrorApi(400, mensaje)
    return valor


def leer_genero_anio_idioma():
    """Valida ?genero=&anio=&idioma= (los usan el ranking y la búsqueda)."""
    genero = leer_entero_opcional("genero", 1, 999999, "El género no es válido.")
    if genero is not None:
        conocidos = mapa_generos()  # vacío si TMDB no responde: ahí no se puede comprobar
        if conocidos and genero not in conocidos:
            raise ErrorApi(400, "El género no es válido.")

    anio_actual = date.today().year
    anio = leer_entero_opcional(
        "anio", ANIO_MINIMO, anio_actual, f"El año tiene que estar entre {ANIO_MINIMO} y {anio_actual}."
    )

    idioma = (request.args.get("idioma") or "").strip().lower() or None
    if idioma is not None and idioma not in IDIOMAS_RANKING:
        raise ErrorApi(400, "El idioma no es válido.")
    return genero, anio, idioma


def leer_filtros_ranking():
    """Valida ?criterio=&genero=&anio=&idioma=&pagina= y los devuelve en ese orden."""
    criterio = request.args.get("criterio", "puntaje")
    if criterio not in CRITERIOS_RANKING:
        raise ErrorApi(400, "El criterio tiene que ser 'puntaje' o 'popularidad'.")

    genero, anio, idioma = leer_genero_anio_idioma()
    pagina = leer_entero_opcional(
        "pagina", 1, PAGINAS_MAXIMAS, f"La página tiene que estar entre 1 y {PAGINAS_MAXIMAS}."
    ) or 1
    return criterio, genero, anio, idioma, pagina


# ============================================
# Búsqueda con filtros
# RF01, RF02 y CU01. /search/movie de TMDB solo acepta el año, así que el
# género, el idioma y el puntaje mínimo se filtran acá sobre los resultados.
# Con filtros activos se revisan más páginas para que no queden muy pocas.
# ============================================

PAGINAS_BUSQUEDA_CON_FILTROS = 3
MINIMO_VOTOS_BUSQUEDA = 50  # con menos votos, el puntaje no es representativo


def clave_puntaje(pelicula):
    """Primero las que tienen votos suficientes; después, por puntaje y por votos."""
    votos = pelicula.get("vote_count") or 0
    return (votos >= MINIMO_VOTOS_BUSQUEDA, pelicula.get("vote_average") or 0, votos)


ORDENES_BUSQUEDA = {
    "relevancia": None,  # el orden en que responde TMDB
    "puntaje": clave_puntaje,
    "popularidad": lambda p: p.get("popularity") or 0,
    "fecha": lambda p: p.get("release_date") or "",
}


def leer_filtros_busqueda():
    """Valida ?genero=&anio=&idioma=&puntaje_min=&orden= y los devuelve en un dict."""
    genero, anio, idioma = leer_genero_anio_idioma()

    puntaje_min = None
    bruto = (request.args.get("puntaje_min") or "").strip().replace(",", ".")
    if bruto:
        try:
            puntaje_min = float(bruto)
        except ValueError:
            puntaje_min = -1  # cae en el error de abajo
        if not 0 <= puntaje_min <= 10:  # también descarta nan
            raise ErrorApi(400, "El puntaje mínimo tiene que ser un número entre 0 y 10.")

    orden = request.args.get("orden") or "relevancia"
    if orden not in ORDENES_BUSQUEDA:
        raise ErrorApi(400, "El orden tiene que ser relevancia, puntaje, popularidad o fecha.")

    return {"genero": genero, "anio": anio, "idioma": idioma, "puntaje_min": puntaje_min, "orden": orden}


def pagina_busqueda(consulta, anio, pagina):
    parametros = {"query": consulta, "include_adult": "false", "page": pagina}
    if anio:
        parametros["primary_release_year"] = anio
    return con_cache(
        f"buscar:{consulta.lower()}:{anio}:{pagina}",
        600,
        lambda: consultar_tmdb("/search/movie", parametros),
    )


def cumple_filtros(pelicula, filtros):
    genero, idioma, puntaje_min = filtros["genero"], filtros["idioma"], filtros["puntaje_min"]
    return (
        not es_contenido_adulto(pelicula)
        and (genero is None or genero in (pelicula.get("genre_ids") or []))
        and (idioma is None or pelicula.get("original_language") == idioma)
        and (
            puntaje_min is None
            or (
                (pelicula.get("vote_count") or 0) >= MINIMO_VOTOS_BUSQUEDA
                and (pelicula.get("vote_average") or 0) >= puntaje_min
            )
        )
    )


def parametros_ranking(criterio, genero, anio, idioma, pagina):
    """Parámetros de /discover/movie para el ranking. Devuelve (parametros, minimo_votos)."""
    parametros = {"include_adult": "false", "page": pagina}
    if genero:
        parametros["with_genres"] = genero
    if anio:
        parametros["primary_release_year"] = anio
    if idioma:
        parametros["with_original_language"] = idioma

    if criterio == "puntaje":
        filtros = sum(valor is not None for valor in (genero, anio, idioma))
        minimo_votos = MINIMO_VOTOS_PUNTAJE[filtros]
        if anio and anio >= date.today().year - 1:
            minimo_votos = min(minimo_votos, 300)  # los estrenos recientes juntaron pocos votos
        parametros["sort_by"] = "vote_average.desc"
    else:
        minimo_votos = MINIMO_VOTOS_POPULARIDAD
        parametros["sort_by"] = "popularity.desc"
    parametros["vote_count.gte"] = minimo_votos
    return parametros, minimo_votos


@app.get("/api/ranking")
def ranking():
    criterio, genero, anio, idioma, pagina = leer_filtros_ranking()
    parametros, minimo_votos = parametros_ranking(criterio, genero, anio, idioma, pagina)

    clave = f"ranking:{criterio}:{genero}:{anio}:{idioma}:{pagina}"
    segundos = 3600 if criterio == "puntaje" else 900  # la popularidad cambia más rápido
    datos = con_cache(clave, segundos, lambda: consultar_tmdb("/discover/movie", parametros))

    nombres = mapa_generos()
    resultados = []
    for crudo in datos.get("results", []):
        if es_contenido_adulto(crudo):
            continue
        pelicula = resumir_pelicula(crudo, nombres)
        pelicula["popularidad"] = round(crudo.get("popularity") or 0)
        resultados.append(pelicula)

    return jsonify(
        criterio=criterio,
        pagina=pagina,
        total_paginas=min(datos.get("total_pages") or 1, PAGINAS_MAXIMAS),
        total=min(datos.get("total_results") or 0, PAGINAS_MAXIMAS * PELICULAS_POR_PAGINA),
        minimo_votos=minimo_votos,
        resultados=resultados,
    )


# ============================================
# Recomendaciones
# Caso de uso CU03 (RF07). Para el usuario con sesión iniciada se arman filas
# de películas a partir de dos cosas:
#   - los géneros que eligió al registrarse y los de sus favoritas;
#   - las películas parecidas a sus últimas favoritas (/recommendations de TMDB).
# Nunca se recomienda algo que ya guardó, ni se repite una película entre filas.
# ============================================

# Géneros del formulario de registro (pages/registro.html) con su id en TMDB.
# Las claves están normalizadas (sin tildes y en minúsculas).
IDS_GENEROS_REGISTRO = {
    "accion": 28,
    "aventura": 12,
    "animacion": 16,
    "comedia": 35,
    "drama": 18,
    "terror": 27,
    "ciencia ficcion": 878,
    "romance": 10749,
}
GENEROS_POR_USUARIO = 3  # filas "Porque te gusta ..."
FAVORITAS_POR_USUARIO = 2  # filas "Porque guardaste ..."
PELICULAS_POR_FILA = 12
MINIMO_RECOMENDACIONES = 6  # con menos que esto se suman las populares (flujo A2)


def normalizar_texto(texto):
    """Minúsculas y sin tildes, para comparar nombres de géneros."""
    descompuesto = unicodedata.normalize("NFD", str(texto))
    return "".join(c for c in descompuesto if unicodedata.category(c) != "Mn").casefold().strip()


def calcular_gustos(usuario, favoritas):
    """Géneros que le gustan al usuario, del más al menos importante: [(id, nombre)].

    Cada género elegido al registrarse suma 2 puntos y cada favorita que lo
    tiene suma 1. Ante un empate se mantiene el orden de aparición.
    """
    ids_por_nombre = {normalizar_texto(nombre): id_genero for id_genero, nombre in mapa_generos().items()}
    ids_por_nombre = {**IDS_GENEROS_REGISTRO, **ids_por_nombre}
    puntos, nombres = {}, {}

    def sumar(nombre, valor):
        id_genero = ids_por_nombre.get(normalizar_texto(nombre))
        if id_genero is None:
            return
        puntos[id_genero] = puntos.get(id_genero, 0) + valor
        nombres.setdefault(id_genero, str(nombre))

    for nombre in usuario.generos or []:
        sumar(nombre, 2)
    for favorita in favoritas:
        for nombre in favorita.generos or []:
            sumar(nombre, 1)

    ordenados = sorted(puntos, key=lambda id_genero: -puntos[id_genero])
    return [(id_genero, nombres[id_genero]) for id_genero in ordenados]


def crear_fila(id_fila, titulo, datos, vistas):
    """Fila de hasta PELICULAS_POR_FILA películas nuevas, o None si no queda ninguna."""
    nombres = mapa_generos()
    elegidas = []
    for crudo in datos.get("results", []):
        if es_contenido_adulto(crudo) or not crudo.get("poster_path") or crudo["id"] in vistas:
            continue
        vistas.add(crudo["id"])
        elegidas.append(resumir_pelicula(crudo, nombres))
        if len(elegidas) == PELICULAS_POR_FILA:
            break
    return {"id": id_fila, "titulo": titulo, "resultados": elegidas} if elegidas else None


def fila_por_genero(id_genero, nombre, vistas):
    datos = con_cache(
        f"recomendar:genero:{id_genero}",
        1800,
        lambda: consultar_tmdb(
            "/discover/movie",
            {
                "with_genres": id_genero,
                "sort_by": "popularity.desc",
                "include_adult": "false",
                "vote_count.gte": 500,
                "vote_average.gte": 6.5,
            },
        ),
    )
    return crear_fila(f"genero-{id_genero}", f"Porque te gusta {nombre}", datos, vistas)


def fila_por_favorita(favorita, vistas):
    datos = con_cache(
        f"recomendar:similares:{favorita.pelicula_id}",
        3600,
        lambda: consultar_tmdb(f"/movie/{favorita.pelicula_id}/recommendations"),
    )
    return crear_fila(f"favorita-{favorita.pelicula_id}", f"Porque guardaste {favorita.titulo}", datos, vistas)


@app.get("/api/recomendaciones")
def recomendaciones():
    # Flujo A3 de CU03: si la base de datos no responde, se avisa que las
    # recomendaciones no están disponibles por ahora. El 401 (sin sesión) pasa de largo.
    try:
        usuario = usuario_de_la_sesion()
        favoritas = db.session.scalars(
            db.select(Favorito)
            .where(Favorito.usuario_id == usuario.id)
            .order_by(Favorito.agregado_en.desc(), Favorito.id.desc())
            .limit(LIMITE_FAVORITAS)
        ).all()
    except SQLAlchemyError:
        db.session.rollback()
        log.exception("No se pudo leer el perfil del usuario para las recomendaciones")
        raise ErrorApi(503, "Las recomendaciones no están disponibles temporalmente. Probá de nuevo en unos minutos.")

    gustos = calcular_gustos(usuario, favoritas)
    personalizado = bool(gustos or favoritas)
    vistas = {favorita.pelicula_id for favorita in favoritas}  # lo que ya guardó no se recomienda

    # Se intercalan las filas por género y por favorita, así arriba aparecen los dos motivos.
    por_genero = [("genero", gusto) for gusto in gustos[:GENEROS_POR_USUARIO]]
    por_favorita = [("favorita", favorita) for favorita in favoritas[:FAVORITAS_POR_USUARIO]]
    pedidos = [pedido for par in zip_longest(por_genero, por_favorita) for pedido in par if pedido]

    filas, errores = [], []
    for tipo, dato in pedidos:
        try:
            fila = fila_por_genero(*dato, vistas) if tipo == "genero" else fila_por_favorita(dato, vistas)
        except ErrorApi as error:
            # Una fila que falla no tira abajo a las demás.
            log.warning("No se pudo armar una fila de recomendaciones (%s): %s", tipo, error.mensaje)
            errores.append(error)
            continue
        if fila:
            filas.append(fila)

    # Flujos A1 (sin gustos) y A2 (pocas coincidencias): se suman las populares de la semana.
    ampliada = False
    if sum(len(fila["resultados"]) for fila in filas) < MINIMO_RECOMENDACIONES:
        try:
            populares = con_cache("tendencias:week", 600, lambda: consultar_tmdb("/trending/movie/week"))
            fila = crear_fila("populares", "Lo más popular de la semana", populares, vistas)
        except ErrorApi as error:
            errores.append(error)
        else:
            if fila:
                filas.append(fila)
                ampliada = personalizado

    if not filas and errores:
        raise errores[0]

    return jsonify(
        perfil={
            "generos": [nombre for _, nombre in gustos[:GENEROS_POR_USUARIO]],
            "favoritas": len(favoritas),
            "personalizado": personalizado,
        },
        ampliada=ampliada,
        secciones=filas,
    )


# ============================================
# Estadísticas
# RF06. El catálogo no se guarda en la base, así que las cifras generales se
# calculan con /discover/movie de TMDB: cada consulta informa cuántas películas
# cumplen el filtro (total_results) y trae las 20 más populares, con las que se
# calcula un puntaje promedio de muestra. Las personales salen de la tabla
# favoritos y no consultan a TMDB.
# ============================================

MINIMO_VOTOS_ESTADISTICAS = 100  # no se cuentan las películas casi sin votos
PRIMERA_DECADA = 1950
SEGUNDOS_CACHE_ESTADISTICAS = 24 * 3600
CONSULTAS_EN_PARALELO = 5  # pocas a la vez, para no saturar a TMDB


def promedio(valores):
    valores = list(valores)
    return round(sum(valores) / len(valores), 1) if valores else None


def resumen_discover(clave, filtros):
    """Cantidad de películas que cumplen los filtros y puntaje promedio de las 20 más populares."""
    datos = con_cache(
        f"estadisticas:{clave}",
        SEGUNDOS_CACHE_ESTADISTICAS,
        lambda: consultar_tmdb("/discover/movie", {
            "include_adult": "false",
            "sort_by": "popularity.desc",
            "vote_count.gte": MINIMO_VOTOS_ESTADISTICAS,
            **filtros,
        }),
    )
    muestra = [p for p in datos.get("results", []) if not es_contenido_adulto(p)]
    return {
        "cantidad": datos.get("total_results") or 0,
        "puntaje_promedio": promedio(p.get("vote_average") or 0 for p in muestra),
    }


def filtros_decada(decada, hoy):
    fin = min(date(decada + 9, 12, 31), hoy)  # la década actual llega hasta hoy, sin estrenos futuros
    return {"primary_release_date.gte": f"{decada}-01-01", "primary_release_date.lte": fin.isoformat()}


def intentar(tarea):
    """Ejecuta la tarea; si TMDB falla, devuelve el error en lugar de lanzarlo."""
    try:
        return tarea()
    except ErrorApi as error:
        return error


@app.get("/api/estadisticas")
def estadisticas():
    generos = obtener_generos()  # si TMDB no responde, corta acá con su error
    hoy = date.today()
    decadas = list(range(PRIMERA_DECADA, hoy.year + 1, 10))

    tareas = (
        [partial(resumen_discover, "total", {})]
        + [partial(resumen_discover, f"genero:{g['id']}", {"with_genres": g["id"]}) for g in generos]
        + [partial(resumen_discover, f"decada:{d}:{hoy.year}", filtros_decada(d, hoy)) for d in decadas]
    )
    with ThreadPoolExecutor(max_workers=CONSULTAS_EN_PARALELO) as pool:
        resultados = list(pool.map(intentar, tareas))

    errores = [r for r in resultados if isinstance(r, ErrorApi)]
    if len(errores) == len(resultados):
        raise errores[0]

    total, por_genero, por_decada = (
        resultados[0],
        resultados[1:1 + len(generos)],
        resultados[1 + len(generos):],
    )
    return jsonify(
        minimo_votos=MINIMO_VOTOS_ESTADISTICAS,
        total=None if isinstance(total, ErrorApi) else total,
        por_genero=sorted(
            ({"id": g["id"], "nombre": g["name"], **r} for g, r in zip(generos, por_genero) if not isinstance(r, ErrorApi)),
            key=lambda fila: fila["cantidad"],
            reverse=True,
        ),
        por_decada=[{"decada": d, **r} for d, r in zip(decadas, por_decada) if not isinstance(r, ErrorApi)],
        incompleto=bool(errores),  # alguna consulta falló: se muestra lo que se pudo armar
    )


@app.get("/api/estadisticas/mias")
def mis_estadisticas():
    """Estadísticas de Mis favoritas del usuario con la sesión iniciada."""
    try:
        usuario = usuario_de_la_sesion()
        favoritas = db.session.scalars(db.select(Favorito).where(Favorito.usuario_id == usuario.id)).all()
    except SQLAlchemyError:
        db.session.rollback()
        log.exception("No se pudieron leer las favoritas para las estadísticas")
        raise ErrorApi(503, "Tus estadísticas no están disponibles temporalmente. Probá de nuevo en unos minutos.")

    generos = Counter(genero for f in favoritas for genero in (f.generos or []))
    decadas = Counter(int(f.anio) // 10 * 10 for f in favoritas if f.anio and f.anio.isdigit())
    return jsonify(
        cantidad=len(favoritas),
        puntaje_promedio=promedio(f.puntaje for f in favoritas),
        por_genero=[{"nombre": nombre, "cantidad": cantidad} for nombre, cantidad in generos.most_common()],
        por_decada=[{"decada": decada, "cantidad": cantidad} for decada, cantidad in sorted(decadas.items())],
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
