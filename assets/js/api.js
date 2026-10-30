/* ============================================
   api.js
   Única puerta de entrada a los datos. Todas las
   vistas piden información con estas funciones,
   que usan fetch contra nuestro backend (Flask).
   Nunca se llama a TMDB directo: el token vive en
   el servidor.
   ============================================ */

const TIEMPO_MAXIMO_MS = 15000;
const URL_IMAGENES = "https://image.tmdb.org/t/p/";

/**
 * Error con información útil para decidir qué mostrar.
 * tipo: "red" | "tiempo" | "solicitud" | "sesion" | "no-encontrado" | "proveedor" | "servidor" | "datos"
 */
export class ErrorApi extends Error {
  constructor(mensaje, { tipo = "servidor", estado = null } = {}) {
    super(mensaje);
    this.name = "ErrorApi";
    this.tipo = tipo;
    this.estado = estado;
  }
}

const MENSAJES_POR_ESTADO = {
  400: "El pedido no es válido.",
  401: "Necesitás iniciar sesión.",
  404: "No encontramos lo que buscabas.",
  500: "El servidor tuvo un problema interno.",
  502: "El proveedor de datos respondió con un error.",
  503: "El servicio no está disponible en este momento.",
  504: "El proveedor de datos tardó demasiado en responder.",
};

function tipoSegunEstado(estado) {
  if (estado === 401) return "sesion";
  if (estado === 404) return "no-encontrado";
  if (estado >= 400 && estado < 500) return "solicitud";
  if (estado === 504) return "tiempo";
  if (estado === 502 || estado === 503) return "proveedor"; // nuestro servidor anda, TMDB no
  return "servidor";
}

/**
 * Pedido a nuestro backend con manejo de errores completo.
 * - Por defecto es GET; para guardar o borrar se indica el método y el cuerpo.
 * - Corta a los 15 s (timeout).
 * - Acepta una señal para cancelar pedidos viejos (ej: si el usuario
 *   cambia de pestaña antes de que termine el anterior).
 */
async function pedir(ruta, { signal, metodo = "GET", cuerpo } = {}) {
  const limite = AbortSignal.timeout(TIEMPO_MAXIMO_MS);
  const senal = signal ? AbortSignal.any([signal, limite]) : limite;
  const headers = { Accept: "application/json" };
  if (cuerpo !== undefined) headers["Content-Type"] = "application/json";

  let respuesta;
  try {
    respuesta = await fetch(ruta, {
      method: metodo,
      signal: senal,
      headers,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  } catch (error) {
    // Lo cancelamos nosotros a propósito: no es una falla, se propaga tal cual.
    if (error.name === "AbortError") throw error;
    if (error.name === "TimeoutError") {
      throw new ErrorApi("El servidor tardó demasiado en responder. Probá de nuevo.", { tipo: "tiempo" });
    }
    throw new ErrorApi(
      "No se pudo conectar con el servidor. Verificá que el backend esté corriendo.",
      { tipo: "red" },
    );
  }

  let datos = null;
  try {
    datos = await respuesta.json();
  } catch {
    // La respuesta no era JSON (se evalúa abajo).
  }

  if (!respuesta.ok) {
    const mensaje = datos?.error ?? MENSAJES_POR_ESTADO[respuesta.status] ?? `Error inesperado (${respuesta.status}).`;
    throw new ErrorApi(mensaje, { tipo: tipoSegunEstado(respuesta.status), estado: respuesta.status });
  }

  if (datos === null) {
    throw new ErrorApi("La respuesta del servidor no tiene un formato válido.", {
      tipo: "datos",
      estado: respuesta.status,
    });
  }

  return datos;
}

/** Arma la query string sin los valores vacíos (null, undefined o ""). */
function parametrosSinVacios(valores) {
  const parametros = new URLSearchParams();
  for (const [nombre, valor] of Object.entries(valores)) {
    if (valor !== null && valor !== undefined && valor !== "") parametros.set(nombre, valor);
  }
  return parametros;
}

export const api = {
  tendencias: (periodo, opciones) =>
    pedir(`/api/tendencias?${new URLSearchParams({ periodo })}`, opciones),
  top: (opciones) => pedir("/api/top", opciones),
  generos: (opciones) => pedir("/api/generos", opciones),
  descubrir: (idGenero, opciones) =>
    pedir(`/api/descubrir?${new URLSearchParams({ genero: idGenero })}`, opciones),
  // Búsqueda por título; filtros opcionales: genero, anio, idioma, puntaje_min y orden
  buscar: (consulta, { filtros = {}, ...opciones } = {}) =>
    pedir(`/api/buscar?${parametrosSinVacios({ q: consulta, ...filtros })}`, opciones),
  pelicula: (id, opciones) => pedir(`/api/pelicula/${encodeURIComponent(id)}`, opciones),

  // Cines cercanos (datos de OpenStreetMap a través de nuestro servidor)
  cines: (lat, lon, radio, opciones) =>
    pedir(`/api/cines?${new URLSearchParams({ lat, lon, radio })}`, opciones),
  ubicacion: (consulta, opciones) => pedir(`/api/ubicacion?${new URLSearchParams({ q: consulta })}`, opciones),
  ubicacionInversa: (lat, lon, opciones) =>
    pedir(`/api/ubicacion/inversa?${new URLSearchParams({ lat, lon })}`, opciones),

  // Rankings: los filtros vacíos (null o "") no se envían
  ranking: (filtros, opciones) => pedir(`/api/ranking?${parametrosSinVacios(filtros)}`, opciones),

  // Recomendaciones personalizadas (requieren sesión iniciada)
  recomendaciones: (opciones) => pedir("/api/recomendaciones", opciones),

  // Mis favoritas (requieren sesión iniciada)
  favoritas: (opciones) => pedir("/api/favoritos", opciones),
  agregarFavorita: (idPelicula) =>
    pedir("/api/favoritos", { metodo: "POST", cuerpo: { pelicula_id: Number(idPelicula) } }),
  quitarFavorita: (idPelicula) =>
    pedir(`/api/favoritos/${encodeURIComponent(idPelicula)}`, { metodo: "DELETE" }),
};

/* ---------- Imágenes de TMDB ---------- */

/** URL de una imagen de TMDB en el tamaño pedido (w185, w342, w500, w780, w1280...). */
export function urlImagen(ruta, tamano = "w342") {
  return ruta ? `${URL_IMAGENES}${tamano}${ruta}` : null;
}

/** srcset para que el navegador elija el tamaño justo según la pantalla. */
export function srcsetImagen(ruta, tamanos = ["w185", "w342", "w500"]) {
  return tamanos.map((t) => `${urlImagen(ruta, t)} ${t.slice(1)}w`).join(", ");
}
