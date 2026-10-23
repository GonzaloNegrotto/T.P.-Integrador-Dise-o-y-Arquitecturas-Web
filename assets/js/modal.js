/* ============================================
   modal.js
   Ventana de detalle de una película. Se crea al
   abrirla y se elimina del DOM al cerrarla.
   Usa <dialog>, que ya resuelve el foco, la tecla
   Escape y el fondo oscuro.
   ============================================ */

import { api } from "./api.js";
import { crearDetallePelicula, crearDetalleSkeleton } from "./render.js";
import { crearElemento, crearEstadoError } from "./ui.js";

export function abrirDetallePelicula(id, { titulo, disparador } = {}) {
  const botonCerrar = crearElemento("button", {
    clase: "modal_cerrar",
    texto: "✕",
    atributos: { type: "button", "aria-label": "Cerrar detalle" },
  });
  const contenido = crearElemento("div", { clase: "modal_contenido" });
  const dialogo = crearElemento("dialog", {
    clase: "modal",
    atributos: { "aria-label": titulo ? `Detalle de ${titulo}` : "Detalle de la película" },
  }, [botonCerrar, crearElemento("div", { clase: "modal_scroll" }, [contenido])]);

  const controlador = new AbortController();

  async function cargar() {
    contenido.replaceChildren(crearDetalleSkeleton());
    dialogo.setAttribute("aria-busy", "true");
    try {
      const detalle = await api.pelicula(id, { signal: controlador.signal });
      contenido.replaceChildren(crearDetallePelicula(detalle));
      dialogo.removeAttribute("aria-label");
      dialogo.setAttribute("aria-labelledby", "modal-titulo");
    } catch (error) {
      if (controlador.signal.aborted) return; // se cerró el modal antes de que llegara la respuesta
      console.error(error);
      contenido.replaceChildren(crearEstadoError(error, cargar));
    } finally {
      dialogo.removeAttribute("aria-busy");
    }
  }

  // Todas las formas de cerrar pasan por acá. La limpieza se hace en el
  // momento (no se espera al evento "close", que el navegador dispara
  // más tarde) y es segura aunque se llame dos veces.
  let cerrado = false;
  function cerrar() {
    if (cerrado) return;
    cerrado = true;
    controlador.abort(); // si el detalle todavía estaba cargando, se cancela
    if (dialogo.open) dialogo.close();
    dialogo.remove();
    document.documentElement.classList.remove("modal-abierto");
    disparador?.focus();
  }

  botonCerrar.addEventListener("click", cerrar);

  // Clic en el fondo oscuro (fuera de la caja).
  dialogo.addEventListener("click", (evento) => {
    if (evento.target === dialogo) cerrar();
  });

  // Tecla Escape: el <dialog> dispara "cancel" antes de cerrarse.
  dialogo.addEventListener("cancel", (evento) => {
    evento.preventDefault();
    cerrar();
  });

  // Respaldo, por si el diálogo se cierra por otra vía.
  dialogo.addEventListener("close", cerrar);

  document.body.append(dialogo);
  document.documentElement.classList.add("modal-abierto");
  dialogo.showModal();
  cargar();
}

/**
 * Delegación: cualquier tarjeta de película de la página (con data-pelicula-id)
 * abre el detalle, aunque se haya creado después.
 */
export function escucharTarjetas() {
  document.addEventListener("click", (evento) => {
    const enlace = evento.target.closest("[data-pelicula-id]");
    if (!enlace) return;
    // Ctrl/⌘ + clic o clic del medio: dejamos que abra TMDB en otra pestaña.
    if (evento.ctrlKey || evento.metaKey || evento.shiftKey || evento.button !== 0) return;
    evento.preventDefault();
    abrirDetallePelicula(enlace.dataset.peliculaId, { titulo: enlace.dataset.titulo, disparador: enlace });
  });
}
