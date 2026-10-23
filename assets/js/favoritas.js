/* ============================================
   favoritas.js
   Estado compartido de "Mis favoritas": qué
   películas guardó el usuario y qué pasa al tocar
   el corazón de una tarjeta o del detalle.
   Lo usan el inicio y la página Mis favoritas.
   ============================================ */

import { api } from "./api.js";
import { mostrarToast } from "./ui.js";

const estado = {
  usuario: null, // null = visitante
  ids: new Set(), // ids de TMDB de las películas guardadas
  enCurso: new Set(), // ids con un pedido pendiente (evita el doble clic)
};

const enPagina = window.location.pathname.includes("/pages/");
const enMisFavoritas = window.location.pathname.endsWith("/favoritas.html");

export const esFavorita = (id) => estado.ids.has(Number(id));

/* ---------- Botones ---------- */

/** Actualiza un botón de corazón según la película esté guardada o no. */
export function pintarBotonFavorita(boton) {
  const guardada = esFavorita(boton.dataset.favoritaId);
  const accion = guardada ? "Quitar de Mis favoritas" : "Guardar en Mis favoritas";
  boton.setAttribute("aria-pressed", String(guardada));
  // Mientras el servidor responde, el botón se ve "ocupado" y no acepta otro clic.
  boton.setAttribute("aria-busy", String(estado.enCurso.has(Number(boton.dataset.favoritaId))));
  boton.title = accion;
  const texto = boton.querySelector(".fav_texto");
  if (texto) {
    // Botón con texto visible: el lector de pantalla lee ese texto.
    texto.textContent = guardada ? "En tus favoritas" : "Guardar en favoritas";
  } else {
    // Solo el ícono: el nombre accesible dice qué película es.
    boton.setAttribute("aria-label", `${accion}: ${boton.dataset.titulo}`);
  }
}

/** Puede haber más de un botón por película (la tarjeta y el detalle abierto). */
function pintarBotones(id) {
  const selector = id === undefined ? "[data-favorita-id]" : `[data-favorita-id="${Number(id)}"]`;
  document.querySelectorAll(selector).forEach(pintarBotonFavorita);
}

/* ---------- Avisos ---------- */

/** Avisa a la página que se guardó o quitó una favorita (Mis favoritas lo escucha). */
function avisarCambio(detalle) {
  document.dispatchEvent(new CustomEvent("favoritas:cambio", { detail: detalle }));
}

function pedirInicioDeSesion() {
  const volver = encodeURIComponent(window.location.pathname);
  mostrarToast("Ingresá a tu cuenta para guardar tus películas favoritas.", {
    accion: { texto: "Ingresar", href: `${enPagina ? "" : "pages/"}login.html?volver=${volver}` },
  });
}

/* ---------- Guardar y quitar ---------- */

/**
 * Guarda o quita una película. El corazón cambia al instante y, si el
 * servidor responde con un error, vuelve a como estaba.
 */
export async function cambiarFavorita(id, titulo, guardar) {
  id = Number(id);
  if (!estado.usuario) {
    pedirInicioDeSesion();
    return;
  }
  if (estado.enCurso.has(id) || esFavorita(id) === guardar) return;

  estado.enCurso.add(id);
  if (guardar) estado.ids.add(id);
  else estado.ids.delete(id);
  pintarBotones(id);

  try {
    if (guardar) {
      const { favorita } = await api.agregarFavorita(id);
      avisarCambio({ id, guardada: true, favorita });
      mostrarToast(`Guardaste “${titulo}” en tus favoritas.`, {
        tipo: "exito",
        accion: enMisFavoritas ? null : { texto: "Ver lista", href: `${enPagina ? "" : "pages/"}favoritas.html` },
      });
    } else {
      await api.quitarFavorita(id);
      avisarCambio({ id, guardada: false });
      mostrarToast(`Quitaste “${titulo}” de tus favoritas.`, {
        accion: { texto: "Deshacer", alAccionar: () => cambiarFavorita(id, titulo, true) },
      });
    }
  } catch (error) {
    // Se deshace el cambio visual: la base de datos quedó como antes.
    if (guardar) estado.ids.delete(id);
    else estado.ids.add(id);
    pintarBotones(id);

    if (error.tipo === "sesion") {
      estado.usuario = null;
      pedirInicioDeSesion();
    } else {
      mostrarToast(error.message, { tipo: "error" });
    }
  } finally {
    estado.enCurso.delete(id);
    pintarBotones(id);
  }
}

/* ---------- Carga ---------- */

/**
 * Pide la lista al servidor y actualiza los corazones de la página.
 * Devuelve las favoritas; los errores los decide quien la llama.
 */
export async function cargarFavoritas(opciones) {
  try {
    const { favoritas } = await api.favoritas(opciones);
    estado.ids = new Set(favoritas.map((f) => f.id));
    return favoritas;
  } catch (error) {
    if (error.tipo === "sesion") estado.usuario = null;
    estado.ids.clear();
    throw error;
  } finally {
    pintarBotones();
  }
}

/** Si no hay sesión, todos los corazones quedan vacíos. */
async function cargarSiHaySesion() {
  if (!estado.usuario) {
    estado.ids.clear();
    pintarBotones();
    return;
  }
  try {
    await cargarFavoritas();
  } catch (error) {
    // En el inicio no se interrumpe nada: los corazones quedan vacíos.
    console.warn("No se pudieron cargar las favoritas:", error.message);
  }
}

/**
 * Activa los corazones de la página.
 * alCambiarSesion: qué hacer cuando se conoce (o cambia) la sesión. Por
 * defecto solo se cargan las favoritas para pintar los corazones.
 */
export function iniciarFavoritas({ alCambiarSesion = cargarSiHaySesion } = {}) {
  // Delegación: un solo listener sirve para todas las tarjetas, aunque se creen después.
  document.addEventListener("click", (evento) => {
    const boton = evento.target.closest("[data-favorita-id]");
    if (!boton) return;
    evento.preventDefault();
    cambiarFavorita(boton.dataset.favoritaId, boton.dataset.titulo, !esFavorita(boton.dataset.favoritaId));
  });

  document.addEventListener("sesion:cambio", (evento) => {
    estado.usuario = evento.detail.usuario;
    alCambiarSesion(estado.usuario);
  });
}
