/* ============================================
   privacidad.js
   Política de privacidad: marca en el índice la
   sección que se está leyendo.
   ============================================ */

import { iniciarLayout } from "./layout.js";

const linksIndice = new Map(
  [...document.querySelectorAll(".legal_indice a")].map((link) => [link.hash.slice(1), link]),
);

function marcarSeccion(id) {
  for (const [idLink, link] of linksIndice) {
    const actual = idLink === id;
    link.classList.toggle("is-activo", actual);
    if (actual) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}

// Una sección cuenta como "en lectura" cuando cruza la franja superior de la pantalla.
const observador = new IntersectionObserver((entradas) => {
  for (const entrada of entradas) {
    if (entrada.isIntersecting) marcarSeccion(entrada.target.id);
  }
}, { rootMargin: "-90px 0px -65% 0px" });

for (const id of linksIndice.keys()) {
  const seccion = document.getElementById(id);
  if (seccion) observador.observe(seccion);
}

iniciarLayout();
