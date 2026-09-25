/* ============================================
   auth-decoracion.js
   Rellena los pósters decorativos de las páginas
   de registro y login con películas reales en
   tendencia. Es solo decoración: si la API falla,
   quedan los pósters dibujados con CSS y no se
   muestra ningún error.
   ============================================ */

import { api, srcsetImagen, urlImagen } from "./api.js";
import { crearElemento } from "./ui.js";

export async function decorarConPosters(selector = ".auth_aside .poster") {
  const posters = document.querySelectorAll(selector);
  if (!posters.length) return;

  try {
    const { resultados } = await api.tendencias("week");
    const conPoster = resultados.filter((p) => p.poster);

    posters.forEach((poster, i) => {
      const pelicula = conPoster[i];
      if (!pelicula) return;
      const imagen = crearElemento("img", { atributos: { alt: "", sizes: "180px", decoding: "async" } });
      imagen.addEventListener("load", () => imagen.classList.add("is-loaded"), { once: true });
      imagen.addEventListener("error", () => imagen.remove(), { once: true });
      imagen.srcset = srcsetImagen(pelicula.poster, ["w185", "w342"]);
      imagen.src = urlImagen(pelicula.poster, "w185");
      poster.replaceChildren(imagen);
    });
  } catch (error) {
    console.warn("No se pudieron cargar los pósters decorativos:", error.message);
  }
}
