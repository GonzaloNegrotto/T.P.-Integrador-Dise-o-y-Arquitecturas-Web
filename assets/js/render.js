/* ============================================
   render.js
   Funciones que transforman datos de películas
   (lo que devuelve la API) en elementos del DOM.
   No piden datos ni escuchan eventos: solo crean
   nodos, así se pueden reutilizar en cualquier vista.
   ============================================ */

import { srcsetImagen, urlImagen } from "./api.js";
import { pintarBotonFavorita } from "./favoritas.js";
import { crearElemento } from "./ui.js";

const formatoPuntaje = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatoNumero = new Intl.NumberFormat("es-AR");
const formatoFecha = new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone: "UTC" });

const VARIANTES_POSTER = ["", "poster--gold", "poster--muted"];
const SIZES_TARJETA = "(max-width: 560px) 45vw, (max-width: 960px) 30vw, 190px";

export const urlTmdb = (id) => `https://www.themoviedb.org/movie/${id}`;

export function formatearDuracion(minutos) {
  if (!minutos) return null;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return horas ? `${horas} h ${resto} min` : `${resto} min`;
}

/* ---------- Piezas chicas ---------- */

/**
 * Póster con imagen real si existe. Si no hay imagen, o si falla la
 * descarga, queda visible el póster dibujado con CSS.
 */
export function crearPoster(pelicula, { clase = "", sizes = SIZES_TARJETA, tamanos, alt } = {}) {
  const variante = VARIANTES_POSTER[pelicula.id % VARIANTES_POSTER.length];
  const poster = crearElemento("div", { clase: ["poster", variante, clase].filter(Boolean).join(" ") });

  if (pelicula.poster) {
    const imagen = crearElemento("img", {
      atributos: {
        alt: alt ?? `Póster de ${pelicula.titulo}`,
        loading: "lazy",
        decoding: "async",
        sizes,
      },
    });
    // Los eventos se registran antes de asignar src para no perder el "load"
    // de una imagen que ya estaba en caché.
    imagen.addEventListener("load", () => imagen.classList.add("is-loaded"), { once: true });
    imagen.addEventListener("error", () => imagen.remove(), { once: true });
    imagen.srcset = srcsetImagen(pelicula.poster, tamanos);
    imagen.src = urlImagen(pelicula.poster, "w342");
    poster.append(imagen);
  }

  return poster;
}

function crearBadgePuntaje(pelicula) {
  if (!pelicula.votos) return null;
  const puntaje = formatoPuntaje.format(pelicula.puntaje);
  return crearElemento("span", {
    clase: "badge badge--rating",
    texto: puntaje,
    atributos: { "aria-label": `Puntaje ${puntaje} de 10` },
  });
}

function crearMeta(partes) {
  const visibles = partes.filter(Boolean);
  return crearElemento(
    "p",
    { clase: "card_meta" },
    (visibles.length ? visibles : ["Sin datos"]).map((parte) =>
      typeof parte === "string" ? crearElemento("span", { texto: parte }) : parte,
    ),
  );
}

/* ---------- Botón de favorita (corazón) ---------- */

/**
 * Corazón para guardar o quitar la película de Mis favoritas.
 * El clic lo maneja favoritas.js por delegación.
 */
export function crearBotonFavorita(pelicula, { conTexto = false } = {}) {
  const boton = crearElemento("button", {
    clase: conTexto ? "btn btn-outline fav fav--detalle" : "fav fav--tarjeta",
    atributos: { type: "button" },
    datos: { favoritaId: pelicula.id, titulo: pelicula.titulo },
  }, [
    crearElemento("span", { clase: "fav_icono", atributos: { "aria-hidden": "true" } }),
    conTexto && crearElemento("span", { clase: "fav_texto" }),
  ]);
  pintarBotonFavorita(boton);
  return boton;
}

/* ---------- Tarjeta de película ---------- */

export function crearTarjetaPelicula(pelicula) {
  const media = crearPoster(pelicula, { clase: "card_media" });
  const badge = crearBadgePuntaje(pelicula);
  if (badge) media.append(badge);
  media.append(
    crearElemento("span", { clase: "card_overlay", atributos: { "aria-hidden": "true" } }, [
      crearElemento("span", { clase: "btn btn-ghost btn-sm", texto: "Ver detalle" }),
    ]),
  );

  // Es un enlace real a TMDB: si JS no intercepta el clic (o se abre en
  // otra pestaña), igual lleva a la ficha de la película.
  const enlace = crearElemento("a", {
    clase: "card_link",
    atributos: { href: urlTmdb(pelicula.id) },
    datos: { peliculaId: pelicula.id, titulo: pelicula.titulo },
  }, [
    media,
    crearElemento("div", { clase: "card_body" }, [
      crearElemento("h3", { clase: "card_title", texto: pelicula.titulo }),
      crearMeta([pelicula.generos[0], pelicula.anio]),
    ]),
  ]);

  // El corazón va fuera del enlace: un botón no puede estar dentro de un <a>.
  return crearElemento("article", { clase: "card" }, [enlace, crearBotonFavorita(pelicula)]);
}

export function crearTarjetaSkeleton() {
  return crearElemento("article", { clase: "card card--skeleton", atributos: { "aria-hidden": "true" } }, [
    crearElemento("div", { clase: "card_media skeleton" }),
    crearElemento("div", { clase: "card_body" }, [
      crearElemento("span", { clase: "skeleton skeleton-line" }),
      crearElemento("span", { clase: "skeleton skeleton-line skeleton-line--corta" }),
    ]),
  ]);
}

/* ---------- Ranking ---------- */

export function crearTarjetaRanking(pelicula, posicion) {
  return crearElemento("li", { clase: "rank-card" }, [
    crearElemento("span", { clase: "rank-card_number", texto: posicion, atributos: { "aria-hidden": "true" } }),
    crearElemento("a", {
      clase: "rank-card_link",
      atributos: { href: urlTmdb(pelicula.id) },
      datos: { peliculaId: pelicula.id, titulo: pelicula.titulo },
    }, [
      crearPoster(pelicula, { clase: "rank-card_poster", sizes: "(max-width: 720px) 60vw, 220px" }),
      crearElemento("div", { clase: "rank-card_body" }, [
        crearElemento("h3", { clase: "rank-card_title", texto: pelicula.titulo }),
        crearMeta([pelicula.anio, crearBadgePuntaje(pelicula)]),
      ]),
    ]),
  ]);
}

export function crearTarjetaRankingSkeleton(posicion) {
  return crearElemento("li", { clase: "rank-card rank-card--skeleton", atributos: { "aria-hidden": "true" } }, [
    crearElemento("span", { clase: "rank-card_number", texto: posicion }),
    crearElemento("div", { clase: "rank-card_poster poster skeleton" }),
    crearElemento("div", { clase: "rank-card_body" }, [
      crearElemento("span", { clase: "skeleton skeleton-line" }),
      crearElemento("span", { clase: "skeleton skeleton-line skeleton-line--corta" }),
    ]),
  ]);
}

/* ---------- Géneros ---------- */

export function crearTileGenero(genero) {
  return crearElemento("button", {
    clase: "tile",
    atributos: { type: "button" },
    datos: { generoId: genero.id, generoNombre: genero.nombre },
  }, [
    crearElemento("span", { clase: "tile_name", texto: genero.nombre }),
    crearElemento("span", { clase: "tile_count", texto: "Explorar →" }),
  ]);
}

export function crearTileSkeleton() {
  return crearElemento("div", { clase: "tile skeleton", atributos: { "aria-hidden": "true" } });
}

/* ---------- Destacada del hero ---------- */

export function crearDestacada(pelicula, etiqueta) {
  const miniatura = crearPoster(pelicula, {
    clase: "hero_featured_thumb",
    sizes: "40px",
    tamanos: ["w92", "w185"],
    alt: "",
  });

  return crearElemento("a", {
    clase: "hero_featured_link",
    atributos: { href: urlTmdb(pelicula.id) },
    datos: { peliculaId: pelicula.id, titulo: pelicula.titulo },
  }, [
    miniatura,
    crearElemento("span", { clase: "hero_featured_text" }, [
      crearElemento("span", { clase: "hero_featured_label", texto: etiqueta }),
      crearElemento("span", { clase: "hero_featured_title", texto: pelicula.titulo }),
    ]),
    crearBadgePuntaje(pelicula),
  ]);
}

/* ---------- Detalle (contenido del modal) ---------- */

function crearDato(termino, valor) {
  if (!valor) return null;
  return crearElemento("div", { clase: "detalle_dato" }, [
    crearElemento("dt", { texto: termino }),
    crearElemento("dd", { texto: valor }),
  ]);
}

export function crearDetallePelicula(detalle) {
  const fondo = crearElemento("div", { clase: "detalle_fondo", atributos: { "aria-hidden": "true" } });
  if (detalle.fondo) {
    fondo.style.backgroundImage = `url("${urlImagen(detalle.fondo, "w1280")}")`;
  }

  const puntaje = detalle.votos
    ? `★ ${formatoPuntaje.format(detalle.puntaje)} · ${formatoNumero.format(detalle.votos)} votos`
    : "Sin votos todavía";

  const cabecera = crearElemento("div", { clase: "detalle_cabecera" }, [
    crearElemento("p", {
      clase: "eyebrow",
      texto: [detalle.anio, formatearDuracion(detalle.duracion)].filter(Boolean).join(" · ") || "Película",
    }),
    crearElemento("h2", { clase: "detalle_titulo", texto: detalle.titulo, atributos: { id: "modal-titulo" } }),
    detalle.titulo_original && detalle.titulo_original !== detalle.titulo
      ? crearElemento("p", { clase: "detalle_original", texto: detalle.titulo_original })
      : null,
    crearElemento("div", { clase: "detalle_etiquetas" }, [
      crearElemento("span", { clase: "badge badge--rating-lg", texto: puntaje }),
      ...detalle.generos.map((genero) => crearElemento("span", { clase: "badge badge--soft", texto: genero })),
    ]),
  ]);

  const reparto = detalle.reparto.length
    ? crearElemento("div", { clase: "detalle_seccion" }, [
        crearElemento("h3", { texto: "Reparto principal" }),
        crearElemento("ul", { clase: "detalle_reparto" }, detalle.reparto.map((actor) =>
          crearElemento("li", {}, [
            crearElemento("span", { clase: "detalle_actor", texto: actor.nombre }),
            actor.personaje && crearElemento("span", { clase: "detalle_personaje", texto: actor.personaje }),
          ]),
        )),
      ])
    : null;

  const texto = crearElemento("div", { clase: "detalle_texto" }, [
    detalle.eslogan && crearElemento("p", { clase: "detalle_eslogan", texto: `“${detalle.eslogan}”` }),
    crearElemento("p", {
      clase: "detalle_sinopsis",
      texto: detalle.sinopsis || "Esta película todavía no tiene sinopsis en español.",
    }),
    crearElemento("dl", { clase: "detalle_datos" }, [
      crearDato(detalle.direccion.length > 1 ? "Dirección" : "Director/a", detalle.direccion.join(", ")),
      crearDato("Estreno", detalle.fecha && formatoFecha.format(new Date(detalle.fecha))),
      crearDato("Duración", formatearDuracion(detalle.duracion)),
    ]),
    reparto,
    crearElemento("div", { clase: "detalle_acciones" }, [
      crearBotonFavorita(detalle, { conTexto: true }),
      crearElemento("a", {
        clase: "btn btn-outline",
        texto: "Ver ficha en TMDB ↗",
        atributos: { href: urlTmdb(detalle.id), target: "_blank", rel: "noopener noreferrer" },
      }),
    ]),
  ]);

  const cuerpo = crearElemento("div", { clase: "detalle" }, [
    crearPoster(detalle, { clase: "detalle_poster", sizes: "(max-width: 720px) 110px, 220px", tamanos: ["w185", "w342", "w500"] }),
    cabecera,
    texto,
  ]);

  const fragmento = document.createDocumentFragment();
  fragmento.append(fondo, cuerpo);
  return fragmento;
}

export function crearDetalleSkeleton() {
  const fragmento = document.createDocumentFragment();
  fragmento.append(
    crearElemento("div", { clase: "detalle_fondo skeleton", atributos: { "aria-hidden": "true" } }),
    crearElemento("div", { clase: "detalle", atributos: { "aria-hidden": "true" } }, [
      crearElemento("div", { clase: "detalle_poster poster skeleton" }),
      crearElemento("div", { clase: "detalle_cabecera" }, [
        crearElemento("span", { clase: "skeleton skeleton-line skeleton-line--corta" }),
        crearElemento("span", { clase: "skeleton skeleton-line skeleton-line--titulo" }),
        crearElemento("span", { clase: "skeleton skeleton-line" }),
      ]),
      crearElemento("div", { clase: "detalle_texto" }, [
        crearElemento("span", { clase: "skeleton skeleton-line" }),
        crearElemento("span", { clase: "skeleton skeleton-line" }),
        crearElemento("span", { clase: "skeleton skeleton-line skeleton-line--corta" }),
      ]),
    ]),
  );
  return fragmento;
}
