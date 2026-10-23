/* ============================================
   ui.js
   Utilidades genéricas de DOM que usan todas las
   páginas: crear elementos, estados (error / vacío /
   éxito) y notificaciones tipo "toast".
   ============================================ */

/**
 * Crea un elemento del DOM en una sola llamada.
 *
 * Siempre usa textContent (nunca innerHTML) para el texto: si un título
 * de la API trajera algo como "<script>", se muestra como texto y no se
 * ejecuta.
 */
export function crearElemento(etiqueta, opciones = {}, hijos = []) {
  const { clase, texto, atributos = {}, datos = {} } = opciones;
  const elemento = document.createElement(etiqueta);

  if (clase) elemento.className = clase;
  if (texto !== undefined && texto !== null) elemento.textContent = texto;

  for (const [nombre, valor] of Object.entries(atributos)) {
    if (valor === false || valor === null || valor === undefined) continue;
    elemento.setAttribute(nombre, valor === true ? "" : valor);
  }

  Object.assign(elemento.dataset, datos);
  elemento.append(...hijos.filter(Boolean));
  return elemento;
}

const ICONOS_ESTADO = { error: "!", vacio: "?", exito: "✓" };

/**
 * Bloque para comunicar un estado: error, sin resultados o éxito.
 * Opcionalmente incluye un botón (ej: "Reintentar").
 */
export function crearEstado({ tipo = "error", titulo, mensaje, detalle, textoAccion, alAccionar }) {
  const estado = crearElemento("div", {
    clase: `estado estado--${tipo}`,
    atributos: { role: tipo === "error" ? "alert" : "status" },
  }, [
    crearElemento("span", { clase: "estado_icono", texto: ICONOS_ESTADO[tipo], atributos: { "aria-hidden": "true" } }),
    crearElemento("p", { clase: "estado_titulo", texto: titulo }),
    mensaje && crearElemento("p", { clase: "estado_mensaje", texto: mensaje }),
    detalle && crearElemento("p", { clase: "estado_detalle", texto: detalle }),
  ]);

  if (textoAccion && alAccionar) {
    const boton = crearElemento("button", {
      clase: "btn btn-outline",
      texto: textoAccion,
      atributos: { type: "button" },
    });
    boton.addEventListener("click", alAccionar);
    estado.append(boton);
  }

  return estado;
}

const TITULOS_ERROR = {
  red: "Sin conexión con el servidor",
  tiempo: "La respuesta está tardando demasiado",
  "no-encontrado": "No encontramos lo que buscabas",
  solicitud: "No pudimos procesar el pedido",
  sesion: "Necesitás iniciar sesión",
  proveedor: "El servicio de películas no está respondiendo",
  servidor: "Algo salió mal",
  datos: "Recibimos datos inesperados",
};

export function crearEstadoError(error, reintentar, titulosPropios = {}) {
  const esErrorApi = error?.name === "ErrorApi";
  const titulos = { ...TITULOS_ERROR, ...titulosPropios };
  return crearEstado({
    tipo: "error",
    titulo: esErrorApi ? titulos[error.tipo] ?? titulos.servidor : titulos.servidor,
    mensaje: esErrorApi ? error.message : "Ocurrió un error inesperado al mostrar la información.",
    detalle: esErrorApi && error.estado ? `Código ${error.estado}` : null,
    textoAccion: reintentar ? "Reintentar" : null,
    alAccionar: reintentar,
  });
}

/* ---------- Toasts ---------- */

function contenedorToasts() {
  let contenedor = document.querySelector(".toasts");
  if (!contenedor) {
    contenedor = crearElemento("div", { clase: "toasts", atributos: { "aria-live": "polite" } });
    document.body.append(contenedor);
  }
  return contenedor;
}

/**
 * Muestra un aviso temporal que se elimina solo (o al cerrarlo).
 * accion (opcional): { texto, href } para un enlace o { texto, alAccionar } para un botón.
 */
export function mostrarToast(mensaje, { tipo = "info", duracion = 4500, accion } = {}) {
  const cerrar = crearElemento("button", {
    clase: "toast_cerrar",
    texto: "✕",
    atributos: { type: "button", "aria-label": "Cerrar aviso" },
  });
  const boton = accion
    ? crearElemento(accion.href ? "a" : "button", {
        clase: "toast_accion",
        texto: accion.texto,
        atributos: accion.href ? { href: accion.href } : { type: "button" },
      })
    : null;
  const toast = crearElemento("div", { clase: `toast toast--${tipo}` }, [
    crearElemento("p", { texto: mensaje }),
    boton,
    cerrar,
  ]);

  let temporizador;
  const quitar = () => {
    clearTimeout(temporizador);
    toast.classList.add("is-saliendo");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  };

  cerrar.addEventListener("click", quitar);
  if (accion?.alAccionar) {
    boton.addEventListener("click", () => {
      quitar();
      accion.alAccionar();
    });
  }
  temporizador = setTimeout(quitar, duracion);
  contenedorToasts().append(toast);
}

/** Pausa asincrónica (se usa para simular demoras de red en formularios). */
export const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
