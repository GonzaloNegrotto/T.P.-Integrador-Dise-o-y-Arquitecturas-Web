"""Respaldo y restauración de la base de datos.

Se usa desde la terminal, con el venv activado y desde la raíz del proyecto:

    flask --app Back.app respaldo crear
    flask --app Back.app respaldo listar
    flask --app Back.app respaldo restaurar respaldos/<archivo>.json.gz

Cada respaldo es un archivo JSON comprimido con gzip que contiene todas las
tablas del modelo (las que define modeloDatos.py, así que una tabla nueva entra
sola) y la versión de migración de la base. Se lee y se escribe con SQLAlchemy,
por lo que no hace falta instalar pg_dump ni que su versión coincida con la de
Neon.

Los archivos contienen datos personales (emails, fechas de nacimiento y hashes
de contraseñas): la carpeta está excluida del repositorio y no debe compartirse.
"""

import gzip
import json
import os
import re
from datetime import date, datetime
from pathlib import Path

import click
from flask.cli import AppGroup
from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import SQLAlchemyError

if __package__:
    from .conexionDB import RAIZ, db
else:
    from conexionDB import RAIZ, db

FORMATO = "medialens-respaldo"
VERSION_FORMATO = 1
CARPETA = Path(os.getenv("RESPALDO_DIR") or RAIZ / "respaldos")
A_CONSERVAR = int(os.getenv("RESPALDOS_A_CONSERVAR") or 10)
PATRON_NOMBRE = re.compile(r"^medialens-(\d{8}-\d{6})(?:-(\d+))?\.json\.gz$")


class ErrorRespaldo(Exception):
    """Problema con un respaldo, con un mensaje apto para mostrar en la terminal."""


# ============================================
# Utilidades
# ============================================

def tablas():
    """Tablas del modelo, ordenadas para que cada una aparezca después de las que referencia."""
    return db.metadata.sorted_tables


def a_json(valor):
    if isinstance(valor, (datetime, date)):
        return valor.isoformat()
    raise TypeError(f"No se puede guardar un valor de tipo {type(valor).__name__}")


def tipo_python(columna):
    try:
        return columna.type.python_type
    except NotImplementedError:
        return None


def desde_json(fila, tabla):
    """Convierte las fechas guardadas como texto al tipo de cada columna."""
    convertida = dict(fila)
    for columna in tabla.columns:
        valor = convertida.get(columna.name)
        if not isinstance(valor, str):
            continue
        tipo = tipo_python(columna)
        if tipo is datetime:
            convertida[columna.name] = datetime.fromisoformat(valor)
        elif tipo is date:
            convertida[columna.name] = date.fromisoformat(valor)
    return convertida


def version_migracion(conexion):
    """Versión de Alembic aplicada a la base, o None si la base no tiene migraciones."""
    if not inspect(conexion).has_table("alembic_version"):
        return None
    return conexion.execute(text("SELECT version_num FROM alembic_version")).scalar()


def nombre_nuevo():
    base = f"medialens-{datetime.now():%Y%m%d-%H%M%S}"
    nombre, n = f"{base}.json.gz", 1
    while (CARPETA / nombre).exists():  # dos respaldos en el mismo segundo
        n += 1
        nombre = f"{base}-{n}.json.gz"
    return CARPETA / nombre


def respaldos_existentes():
    """Respaldos de la carpeta, del más reciente al más antiguo."""
    if not CARPETA.is_dir():
        return []
    encontrados = []
    for archivo in CARPETA.iterdir():
        coincidencia = PATRON_NOMBRE.match(archivo.name)
        if archivo.is_file() and coincidencia:
            fecha, numero = coincidencia.groups()
            encontrados.append(((fecha, int(numero or 1)), archivo))
    return [archivo for _, archivo in sorted(encontrados, reverse=True)]


def aplicar_retencion():
    """Borra los respaldos más antiguos y conserva los A_CONSERVAR más recientes."""
    borrados = []
    for archivo in respaldos_existentes()[A_CONSERVAR:]:
        archivo.unlink()
        borrados.append(archivo.name)
    return borrados


def leer_respaldo(ruta):
    ruta = Path(ruta)
    if not ruta.is_file():
        raise ErrorRespaldo(f"No existe el archivo {ruta}.")
    try:
        with gzip.open(ruta, "rt", encoding="utf-8") as archivo:
            datos = json.load(archivo)
    except (OSError, EOFError, ValueError):
        raise ErrorRespaldo(f"{ruta.name} no es un respaldo válido: el archivo está dañado o incompleto.")
    if not isinstance(datos, dict) or datos.get("formato") != FORMATO or not isinstance(datos.get("tablas"), dict):
        raise ErrorRespaldo(f"{ruta.name} no es un respaldo de MediaLens.")
    if datos.get("version_formato") != VERSION_FORMATO:
        raise ErrorRespaldo(f"{ruta.name} usa una versión de formato que este programa no conoce.")
    return datos


# ============================================
# Crear y restaurar
# ============================================

def crear_respaldo():
    """Guarda todas las tablas en un archivo nuevo. Devuelve (ruta, cantidades por tabla)."""
    contenido = {
        "formato": FORMATO,
        "version_formato": VERSION_FORMATO,
        "creado_en": datetime.now().astimezone().isoformat(timespec="seconds"),
        "tablas": {},
    }
    # REPEATABLE READ: todas las tablas se leen en el mismo instante, aunque
    # alguien guarde una favorita mientras se arma el respaldo.
    with db.engine.connect().execution_options(isolation_level="REPEATABLE READ") as conexion:
        contenido["version_migracion"] = version_migracion(conexion)
        for tabla in tablas():
            orden = list(tabla.primary_key.columns) or list(tabla.columns)
            filas = conexion.execute(select(tabla).order_by(*orden)).mappings()
            contenido["tablas"][tabla.name] = [dict(fila) for fila in filas]

    CARPETA.mkdir(parents=True, exist_ok=True)
    ruta = nombre_nuevo()
    temporal = ruta.with_name(ruta.name + ".tmp")
    # Se escribe en un archivo temporal y después se renombra: si el proceso se
    # corta a mitad de camino, no queda un respaldo incompleto con nombre válido.
    with gzip.open(temporal, "wt", encoding="utf-8") as archivo:
        json.dump(contenido, archivo, ensure_ascii=False, default=a_json)
    os.replace(temporal, ruta)
    try:
        os.chmod(ruta, 0o600)  # solo el dueño puede leerlo (en Windows no tiene efecto)
    except OSError:
        pass

    cantidades = {nombre: len(filas) for nombre, filas in contenido["tablas"].items()}
    return ruta, cantidades


def comprobar_compatibilidad(datos, conexion):
    """Corta con un error si el respaldo no coincide con la estructura actual de la base."""
    actual = version_migracion(conexion)
    if datos.get("version_migracion") != actual:
        raise ErrorRespaldo(
            f"El respaldo es de la versión de migración {datos.get('version_migracion')} "
            f"y la base está en {actual}. Llevá la base a la misma versión con "
            "`flask --app Back.app db upgrade` (o `db downgrade`) antes de restaurar."
        )
    modelo = {tabla.name: tabla for tabla in tablas()}
    for nombre, filas in datos["tablas"].items():
        if nombre not in modelo:
            raise ErrorRespaldo(f"El respaldo tiene la tabla {nombre}, que no existe en el modelo actual.")
        columnas = {columna.name for columna in modelo[nombre].columns}
        for fila in filas:
            sobrantes = set(fila) - columnas
            if sobrantes:
                raise ErrorRespaldo(f"La tabla {nombre} del respaldo tiene columnas que ya no existen: {', '.join(sorted(sobrantes))}.")


def reiniciar_secuencias(conexion):
    """Deja cada contador de ids en el máximo restaurado, para que los próximos registros no choquen."""
    if conexion.dialect.name != "postgresql":
        return
    for tabla in tablas():
        clave = list(tabla.primary_key.columns)
        if len(clave) != 1 or tipo_python(clave[0]) is not int:
            continue
        columna = clave[0]
        secuencia = conexion.execute(
            select(func.pg_get_serial_sequence(tabla.name, columna.name))
        ).scalar()
        if secuencia:
            maximo = conexion.execute(select(func.max(columna))).scalar()
            # Con la tabla vacía, el próximo id vuelve a ser 1.
            conexion.execute(select(func.setval(secuencia, maximo or 1, maximo is not None)))


def restaurar_respaldo(ruta):
    """Reemplaza el contenido de las tablas por el del respaldo, todo o nada."""
    datos = leer_respaldo(ruta)
    with db.engine.begin() as conexion:  # una sola transacción: si algo falla, no cambia nada
        comprobar_compatibilidad(datos, conexion)
        for tabla in reversed(tablas()):  # primero las que referencian a otras
            conexion.execute(tabla.delete())
        for tabla in tablas():
            filas = [desde_json(fila, tabla) for fila in datos["tablas"].get(tabla.name, [])]
            if filas:
                conexion.execute(tabla.insert(), filas)
        reiniciar_secuencias(conexion)
    return {nombre: len(filas) for nombre, filas in datos["tablas"].items()}


# ============================================
# Comandos de la terminal
# ============================================

respaldo_cli = AppGroup("respaldo", help="Crear, listar y restaurar respaldos de la base de datos.")


def resumen(cantidades):
    return ", ".join(f"{nombre}: {cantidad}" for nombre, cantidad in cantidades.items())


@respaldo_cli.command("crear")
def comando_crear():
    """Guarda una copia de todas las tablas en la carpeta de respaldos."""
    ruta, cantidades = crear_respaldo()
    click.echo(f"Respaldo creado: {ruta}")
    click.echo(f"Registros: {resumen(cantidades)}")
    for nombre in aplicar_retencion():
        click.echo(f"Se borró el respaldo antiguo {nombre} (se conservan los {A_CONSERVAR} más recientes).")


@respaldo_cli.command("listar")
def comando_listar():
    """Muestra los respaldos guardados, del más reciente al más antiguo."""
    archivos = respaldos_existentes()
    if not archivos:
        click.echo(f"No hay respaldos en {CARPETA}.")
        return
    for archivo in archivos:
        try:
            datos = leer_respaldo(archivo)
            detalle = resumen({n: len(f) for n, f in datos["tablas"].items()})
        except ErrorRespaldo:
            detalle = "archivo dañado"
        click.echo(f"{archivo.name}  ({archivo.stat().st_size / 1024:.1f} KB)  {detalle}")


@respaldo_cli.command("restaurar")
@click.argument("archivo", type=click.Path(dir_okay=False, path_type=Path))
@click.option("--si", is_flag=True, help="No pedir confirmación.")
def comando_restaurar(archivo, si):
    """Reemplaza los datos de la base por los del ARCHIVO indicado."""
    try:
        datos = leer_respaldo(archivo)
    except ErrorRespaldo as error:
        raise click.ClickException(str(error))

    try:
        with db.engine.connect() as conexion:
            comprobar_compatibilidad(datos, conexion)
    except ErrorRespaldo as error:
        raise click.ClickException(f"{error} La base no se modificó.")

    click.echo(f"Respaldo del {datos.get('creado_en')} con {resumen({n: len(f) for n, f in datos['tablas'].items()})}.")
    if not si:
        click.confirm("Se van a reemplazar TODOS los datos actuales de la base. ¿Continuar?", abort=True)

    # Antes de pisar nada se respalda el estado actual, por si hay que volver atrás.
    previo, _ = crear_respaldo()
    click.echo(f"Copia del estado actual guardada en {previo}")
    try:
        cantidades = restaurar_respaldo(archivo)
    except ErrorRespaldo as error:
        raise click.ClickException(f"{error} La base no se modificó.")
    except SQLAlchemyError as error:
        # Por ejemplo, un registro que no cumple una restricción: la transacción se deshace entera.
        raise click.ClickException(f"No se pudo restaurar ({error.__class__.__name__}): {str(error.orig or error).strip().rstrip('.')}. La base no se modificó.")
    click.echo(f"Base restaurada. Registros: {resumen(cantidades)}")
