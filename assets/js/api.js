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
 * tipo: "red" | "tiempo" | "solicitud" | "no-encontrado" | "proveedor" | "servidor" | "datos"
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
  404: "No encontramos lo que buscabas.",
  500: "El servidor tuvo un problema interno.",
  502: "El proveedor de datos respondió con un error.",
  503: "El servicio no está disponible en este momento.",
  504: "El proveedor de datos tardó demasiado en responder.",
};

function tipoSegunEstado(estado) {
  if (estado === 404) return "no-encontrado";
  if (estado >= 400 && estado < 500) return "solicitud";
  if (estado === 504) return "tiempo";
  if (estado === 502 || estado === 503) return "proveedor"; // nuestro servidor anda, TMDB no
  return "servidor";
}

/**
 * GET a nuestro backend con manejo de errores completo.
 * - Corta a los 15 s (timeout).
 * - Acepta una señal para cancelar pedidos viejos (ej: si el usuario
 *   cambia de pestaña antes de que termine el anterior).
 */
async function pedir(ruta, { signal } = {}) {
  const limite = AbortSignal.timeout(TIEMPO_MAXIMO_MS);
  const senal = signal ? AbortSignal.any([signal, limite]) : limite;

  let respuesta;
  try {
    respuesta = await fetch(ruta, { signal: senal, headers: { Accept: "application/json" } });
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

export const api = {
  tendencias: (periodo, opciones) =>
    pedir(`/api/tendencias?${new URLSearchParams({ periodo })}`, opciones),
  top: (opciones) => pedir("/api/top", opciones),
  generos: (opciones) => pedir("/api/generos", opciones),
  descubrir: (idGenero, opciones) =>
    pedir(`/api/descubrir?${new URLSearchParams({ genero: idGenero })}`, opciones),
  buscar: (consulta, opciones) => pedir(`/api/buscar?${new URLSearchParams({ q: consulta })}`, opciones),
  pelicula: (id, opciones) => pedir(`/api/pelicula/${encodeURIComponent(id)}`, opciones),
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
