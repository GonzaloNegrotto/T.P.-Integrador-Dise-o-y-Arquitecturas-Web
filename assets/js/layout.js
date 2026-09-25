/* ============================================
   layout.js
   Comportamiento común a todas las páginas:
   menú responsive, link activo, cabecera al
   hacer scroll y botón del chatbot.
   ============================================ */

import { mostrarToast } from "./ui.js";

const normalizarRuta = (ruta) => ruta.replace(/index\.html$/, "");

/** Marca el link de la página actual (clase + aria-current). */
function marcarPaginaActual(menu) {
  const actual = normalizarRuta(window.location.pathname);
  for (const link of menu.querySelectorAll(".navbar_links a")) {
    const esActual = normalizarRuta(new URL(link.href).pathname) === actual;
    link.classList.toggle("is-active", esActual);
    if (esActual) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

function iniciarMenu() {
  const boton = document.querySelector(".navbar_toggle");
  const menu = document.getElementById("menu-principal");
  if (!boton || !menu) return;

  marcarPaginaActual(menu);

  const estaAbierto = () => menu.classList.contains("is-open");

  function abrir() {
    menu.classList.add("is-open");
    boton.setAttribute("aria-expanded", "true");
    boton.setAttribute("aria-label", "Cerrar menú");
    boton.textContent = "✕";
  }

  function cerrar() {
    menu.classList.remove("is-open");
    boton.setAttribute("aria-expanded", "false");
    boton.setAttribute("aria-label", "Abrir menú");
    boton.textContent = "☰";
  }

  boton.addEventListener("click", () => (estaAbierto() ? cerrar() : abrir()));

  // Tocar un link del menú lo cierra (en celular, si no, tapa la página).
  menu.addEventListener("click", (evento) => {
    if (evento.target.closest("a")) cerrar();
  });

  // Escape cierra y devuelve el foco al botón.
  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && estaAbierto()) {
      cerrar();
      boton.focus();
    }
  });

  // Clic fuera del menú lo cierra.
  document.addEventListener("click", (evento) => {
    if (estaAbierto() && !menu.contains(evento.target) && !boton.contains(evento.target)) cerrar();
  });

  // Si se agranda la ventana a tamaño escritorio, el menú desplegable no tiene sentido.
  const escritorio = window.matchMedia("(min-width: 961px)"); // mismo corte que layout.css
  escritorio.addEventListener("change", (evento) => {
    if (evento.matches) cerrar();
  });
}

function iniciarCabecera() {
  const cabecera = document.querySelector(".site-header");
  if (!cabecera) return;
  const actualizar = () => cabecera.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", actualizar, { passive: true });
  actualizar();
}

function iniciarChatbot() {
  const boton = document.querySelector(".chatbot-toggle");
  boton?.addEventListener("click", () => {
    mostrarToast("El asistente de MediaLens va a estar disponible en una próxima entrega.");
  });
}

export function iniciarLayout() {
  iniciarMenu();
  iniciarCabecera();
  iniciarChatbot();
}
