/* ============================================
   chatbot.js
   Asistente de películas (RF12). layout.js lo
   activa en todas las páginas: un botón flotante
   abre un panel de chat que le pregunta a
   /api/chatbot. La conversación vive solo en la
   memoria de la página: no se guarda en ningún
   lado y se pierde al recargar.
   ============================================ */

import { api, urlImagen } from "./api.js";
import { crearElemento } from "./ui.js";

const MAX_MENSAJE = 300; // mismo límite que el servidor
const MAX_HISTORIAL = 6; // turnos que se mandan como contexto
const SUGERENCIAS = ["Recomendame una de terror", "¿Qué es tendencia esta semana?", "¿De qué trata Interstellar?"];
const SALUDO = "¡Hola! Soy el asistente de MediaLens. Preguntame por películas: te busco recomendaciones por género, "
  + "lo que es tendencia o de qué trata una película.";
const AVISO = "Las respuestas se generan con IA a partir de datos de TMDB y pueden contener errores. "
  + "No compartas datos personales.";

const estado = {
  historial: [], // [{ rol: "usuario" | "asistente", texto }]
  pedido: null, // AbortController de la pregunta en curso
};
let dom = null;

/* ---------- Construcción del panel ---------- */

function crearBotonFlotante() {
  // index.html ya trae el botón en el HTML; en las demás páginas se crea acá.
  let boton = document.querySelector(".chatbot-toggle");
  if (!boton) {
    boton = crearElemento("button", { clase: "chatbot-toggle", texto: "💬", atributos: { type: "button" } });
    document.body.append(boton);
  }
  boton.setAttribute("aria-label", "Abrir el asistente de películas");
  boton.setAttribute("aria-expanded", "false");
  boton.setAttribute("aria-controls", "chatbot-panel");
  boton.title = "Asistente MediaLens";
  return boton;
}

function crearPanel() {
  const mensajes = crearElemento("div", {
    clase: "chatbot_mensajes",
    // role="log": los lectores de pantalla anuncian cada mensaje nuevo.
    atributos: { role: "log", "aria-live": "polite", "aria-label": "Conversación", tabindex: "0" },
  });
  const sugerencias = crearElemento("div", { clase: "chatbot_sugerencias", atributos: { "aria-label": "Preguntas sugeridas", role: "group" } },
    SUGERENCIAS.map((texto) => crearElemento("button", { clase: "chip", texto, atributos: { type: "button" }, datos: { sugerencia: texto } })));
  const entrada = crearElemento("input", {
    atributos: {
      type: "text", id: "chatbot-entrada", maxlength: MAX_MENSAJE, autocomplete: "off",
      placeholder: "Preguntá sobre una película…", "aria-describedby": "chatbot-aviso",
    },
  });
  const enviar = crearElemento("button", { clase: "btn btn-primary btn-sm", texto: "Enviar", atributos: { type: "submit" } });
  const formulario = crearElemento("form", { clase: "chatbot_form", atributos: { novalidate: true } }, [
    crearElemento("label", { clase: "visually-hidden", texto: "Tu pregunta", atributos: { for: "chatbot-entrada" } }),
    entrada,
    enviar,
  ]);
  const limpiar = crearElemento("button", {
    clase: "btn btn-ghost btn-sm", texto: "Limpiar",
    atributos: { type: "button", "aria-label": "Limpiar la conversación" },
  });
  const cerrar = crearElemento("button", {
    clase: "chatbot_cerrar", texto: "✕", atributos: { type: "button", "aria-label": "Cerrar el asistente" },
  });

  const panel = crearElemento("section", {
    clase: "chatbot",
    atributos: { id: "chatbot-panel", role: "dialog", "aria-modal": "false", "aria-labelledby": "chatbot-titulo", hidden: true },
  }, [
    crearElemento("div", { clase: "chatbot_cabecera" }, [
      crearElemento("div", {}, [
        crearElemento("h2", { clase: "chatbot_titulo", texto: "Asistente MediaLens", atributos: { id: "chatbot-titulo" } }),
        crearElemento("p", { clase: "chatbot_subtitulo", texto: "Preguntame sobre películas" }),
      ]),
      limpiar,
      cerrar,
    ]),
    mensajes,
    sugerencias,
    formulario,
    crearElemento("p", { clase: "chatbot_aviso", texto: AVISO, atributos: { id: "chatbot-aviso" } }),
  ]);
  document.body.append(panel);
  return { panel, mensajes, sugerencias, formulario, entrada, enviar, limpiar, cerrar };
}

/* ---------- Mensajes ---------- */

function bajarAlFinal() {
  dom.mensajes.scrollTop = dom.mensajes.scrollHeight;
}

function crearTarjeta(pelicula) {
  const poster = pelicula.poster
    ? crearElemento("img", { atributos: { src: urlImagen(pelicula.poster, "w92"), alt: "", loading: "lazy", width: 46, height: 69 } })
    : crearElemento("span", { clase: "chatbot_poster-vacio", atributos: { "aria-hidden": "true" } });
  return crearElemento("li", {}, [
    crearElemento("button", {
      clase: "chatbot_pelicula",
      atributos: { type: "button", "aria-label": `Ver detalle de ${pelicula.titulo}${pelicula.anio ? ` (${pelicula.anio})` : ""}` },
      datos: { chatbotPelicula: pelicula.id, titulo: pelicula.titulo },
    }, [
      poster,
      crearElemento("span", { clase: "chatbot_pelicula-texto" }, [
        crearElemento("span", { clase: "chatbot_pelicula-titulo", texto: pelicula.titulo }),
        pelicula.anio && crearElemento("span", { clase: "chatbot_pelicula-anio", texto: pelicula.anio }),
      ]),
    ]),
  ]);
}

function agregarMensaje(rol, texto, { peliculas = [], modo, acciones } = {}) {
  const autor = rol === "usuario" ? "Vos" : "MediaLens";
  const mensaje = crearElemento("div", { clase: `chatbot_mensaje chatbot_mensaje--${rol}` }, [
    crearElemento("p", {}, [
      crearElemento("span", { clase: "visually-hidden", texto: `${autor}: ` }),
      texto,
    ]),
    peliculas.length ? crearElemento("ul", { clase: "chatbot_peliculas", atributos: { "aria-label": "Películas mencionadas" } }, peliculas.map(crearTarjeta)) : null,
    modo === "reglas" ? crearElemento("p", { clase: "chatbot_modo", texto: "Respuesta automática, sin IA." }) : null,
    acciones,
  ]);
  dom.mensajes.append(mensaje);
  bajarAlFinal();
  return mensaje;
}

function mostrarEscribiendo() {
  const indicador = crearElemento("div", { clase: "chatbot_mensaje chatbot_mensaje--asistente chatbot_escribiendo" }, [
    crearElemento("span", { clase: "visually-hidden", texto: "MediaLens está escribiendo…" }),
    ...[1, 2, 3].map(() => crearElemento("span", { clase: "chatbot_punto", atributos: { "aria-hidden": "true" } })),
  ]);
  dom.mensajes.append(indicador);
  bajarAlFinal();
  return indicador;
}

function textoDeError(error) {
  if (error.tipo === "red") return "No hay conexión con el servidor. Revisá tu conexión y probá de nuevo.";
  if (error.tipo === "tiempo") return "La respuesta está tardando demasiado. Probá de nuevo en unos segundos.";
  if (error.estado === 429) return error.message;
  if (error.estado >= 500) return `${error.message} Probá de nuevo en unos segundos.`;
  return error.message || "No se pudo responder la pregunta.";
}

function agregarError(error, pregunta) {
  // Ante un error de validación (400) reintentar no sirve: no se ofrece el botón.
  const reintentar = error.estado === 400 ? null : crearElemento("button", {
    clase: "btn btn-outline btn-sm", texto: "Reintentar", atributos: { type: "button" },
  });
  const mensaje = agregarMensaje("error", textoDeError(error), { acciones: reintentar });
  reintentar?.addEventListener("click", () => {
    mensaje.remove();
    preguntar(pregunta);
  });
}

function mostrarInicio() {
  dom.mensajes.replaceChildren();
  agregarMensaje("asistente", SALUDO);
  dom.sugerencias.hidden = false;
}

/* ---------- Preguntar ---------- */

async function preguntar(texto) {
  const pregunta = texto.replace(/\s+/g, " ").trim();
  if (!pregunta || estado.pedido) return;

  dom.entrada.value = "";
  dom.sugerencias.hidden = true;
  agregarMensaje("usuario", pregunta);

  const indicador = mostrarEscribiendo();
  const pedido = new AbortController();
  estado.pedido = pedido;
  dom.enviar.disabled = true;
  try {
    const datos = await api.chatbot(pregunta, estado.historial.slice(-MAX_HISTORIAL), { signal: pedido.signal });
    estado.historial.push({ rol: "usuario", texto: pregunta }, { rol: "asistente", texto: datos.respuesta });
    estado.historial = estado.historial.slice(-MAX_HISTORIAL);
    agregarMensaje("asistente", datos.respuesta, { peliculas: datos.peliculas, modo: datos.modo });
  } catch (error) {
    if (pedido.signal.aborted) return; // se limpió la conversación mientras esperaba
    console.error(error);
    agregarError(error, pregunta);
  } finally {
    indicador.remove();
    if (estado.pedido === pedido) estado.pedido = null;
    dom.enviar.disabled = false;
    if (!dom.panel.hidden) dom.entrada.focus();
  }
}

function limpiarConversacion() {
  estado.pedido?.abort();
  estado.pedido = null;
  estado.historial = [];
  dom.entrada.value = "";
  mostrarInicio();
  dom.entrada.focus();
}

/* ---------- Detalle de una película ---------- */

async function abrirDetalle(boton) {
  // Se cargan solo cuando hacen falta: la mayoría de las visitas no abre el chat.
  const [{ abrirDetallePelicula }, favoritas, layout] = await Promise.all([
    import("./modal.js"),
    import("./favoritas.js"),
    import("./layout.js"),
  ]);
  // Si la página no tiene películas propias, sus corazones no estaban activos.
  if (!favoritas.favoritasIniciadas()) {
    favoritas.iniciarFavoritas();
    layout.actualizarSesion(); // vuelve a avisar la sesión para pintar los corazones
  }
  abrirDetallePelicula(boton.dataset.chatbotPelicula, { titulo: boton.dataset.titulo, disparador: boton });
}

/* ---------- Abrir y cerrar ---------- */

function abrir() {
  dom.panel.hidden = false;
  dom.boton.setAttribute("aria-expanded", "true");
  dom.boton.setAttribute("aria-label", "Cerrar el asistente de películas");
  dom.entrada.focus();
  bajarAlFinal();
}

function cerrar() {
  dom.panel.hidden = true;
  dom.boton.setAttribute("aria-expanded", "false");
  dom.boton.setAttribute("aria-label", "Abrir el asistente de películas");
  dom.boton.focus();
}

export function iniciarChatbot() {
  if (dom) return;
  dom = { boton: crearBotonFlotante(), ...crearPanel() };
  mostrarInicio();

  dom.boton.addEventListener("click", () => (dom.panel.hidden ? abrir() : cerrar()));
  dom.cerrar.addEventListener("click", cerrar);
  dom.limpiar.addEventListener("click", limpiarConversacion);
  dom.panel.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") {
      evento.stopPropagation(); // que no cierre también el menú del encabezado
      cerrar();
    }
  });
  dom.formulario.addEventListener("submit", (evento) => {
    evento.preventDefault();
    preguntar(dom.entrada.value);
  });
  dom.sugerencias.addEventListener("click", (evento) => {
    const sugerencia = evento.target.closest("[data-sugerencia]");
    if (sugerencia) preguntar(sugerencia.dataset.sugerencia);
  });
  dom.mensajes.addEventListener("click", (evento) => {
    const pelicula = evento.target.closest("[data-chatbot-pelicula]");
    if (pelicula) abrirDetalle(pelicula);
  });
}
