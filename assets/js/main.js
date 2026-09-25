/* ============================================
   main.js
   Página de inicio. Pide los datos a la API y
   arma cada sección. Cada sección maneja sus
   propios errores: si falla una, las demás se
   siguen mostrando.
   ============================================ */

import { api, srcsetImagen, urlImagen } from "./api.js";
import { iniciarLayout } from "./layout.js";
import { abrirDetallePelicula } from "./modal.js";
import {
  crearDestacada,
  crearTarjetaPelicula,
  crearTarjetaRanking,
  crearTarjetaRankingSkeleton,
  crearTarjetaSkeleton,
  crearTileGenero,
  crearTileSkeleton,
} from "./render.js";
import { crearElemento, crearEstado, crearEstadoError } from "./ui.js";
import { crearValidador, reglas } from "./validacion.js";

const CANTIDAD_TENDENCIAS = 12;
const CANTIDAD_TOP = 5;
const GENEROS_INICIALES = 10;
const TEXTO_PERIODO = { day: "de hoy", week: "de la semana" };

const estado = {
  periodo: "week",
  tendencias: [], // última lista recibida: el filtro por género trabaja sobre esto
  filtroGenero: null, // { id, nombre } o null
  generos: [],
  mostrandoTodosLosGeneros: false,
  heroListo: false,
  pedidoTendencias: null, // AbortController del pedido en curso
  pedidoResultados: null,
};

const dom = {
  formBusqueda: document.getElementById("form-busqueda"),
  inputBusqueda: document.getElementById("q"),
  chips: document.querySelectorAll("[data-filtro-genero]"),
  destacada: document.getElementById("hero-destacada"),
  postersHero: document.querySelectorAll(".hero_showcase .poster"),

  seccionTendencias: document.getElementById("tendencias"),
  tituloTendencias: document.getElementById("tendencias-titulo"),
  tabs: document.querySelectorAll("[data-periodo]"),
  filtroActivo: document.getElementById("filtro-activo"),
  grillaTendencias: document.getElementById("grilla-tendencias"),
  avisoTendencias: document.getElementById("tendencias-aviso"),

  seccionResultados: document.getElementById("resultados"),
  eyebrowResultados: document.getElementById("resultados-eyebrow"),
  tituloResultados: document.getElementById("resultados-titulo"),
  estadoResultados: document.getElementById("resultados-estado"),
  grillaResultados: document.getElementById("grilla-resultados"),
  botonLimpiar: document.getElementById("limpiar-resultados"),

  listaTop: document.getElementById("lista-top"),
  grillaGeneros: document.getElementById("grilla-generos"),
  botonMasGeneros: document.getElementById("ver-mas-generos"),
};

/* ============================================
   Utilidades de la página
   ============================================ */

function mostrarCargando(contenedor, cantidad, crearSkeleton) {
  contenedor.classList.remove("is-estado");
  contenedor.setAttribute("aria-busy", "true");
  contenedor.replaceChildren(...Array.from({ length: cantidad }, (_, i) => crearSkeleton(i + 1)));
}

function mostrarContenido(contenedor, elementos) {
  contenedor.classList.remove("is-estado");
  contenedor.removeAttribute("aria-busy");
  contenedor.replaceChildren(...elementos);
}

/** Reemplaza el contenido por un bloque de estado (error o vacío). */
function mostrarBloqueEstado(contenedor, bloque) {
  contenedor.classList.add("is-estado");
  contenedor.removeAttribute("aria-busy");
  // Dentro de una lista (<ol>/<ul>) solo puede haber <li>.
  const envoltorio = ["OL", "UL"].includes(contenedor.tagName) ? crearElemento("li", {}, [bloque]) : bloque;
  contenedor.replaceChildren(envoltorio);
}

function mostrarError(contenedor, error, reintentar) {
  console.error(error);
  mostrarBloqueEstado(contenedor, crearEstadoError(error, reintentar));
}

/** Cancela el pedido anterior (si lo hay) y devuelve un controlador nuevo. */
function nuevoPedido(clave) {
  estado[clave]?.abort();
  estado[clave] = new AbortController();
  return estado[clave];
}

const irA = (seccion) => seccion.scrollIntoView({ behavior: "smooth", block: "start" });

/* ============================================
   Hero
   ============================================ */

function actualizarHero(peliculas) {
  if (estado.heroListo || !peliculas.length) return;
  estado.heroListo = true;

  // Collage: los 3 pósters pasan a ser las 3 películas más en tendencia.
  const conPoster = peliculas.filter((p) => p.poster);
  dom.postersHero.forEach((poster, i) => {
    const pelicula = conPoster[i];
    if (!pelicula) return;
    const imagen = crearElemento("img", {
      atributos: { alt: "", sizes: "(max-width: 960px) 40vw, 200px", decoding: "async" },
    });
    imagen.addEventListener("load", () => imagen.classList.add("is-loaded"), { once: true });
    imagen.addEventListener("error", () => imagen.remove(), { once: true });
    imagen.srcset = srcsetImagen(pelicula.poster, ["w342", "w500"]);
    imagen.src = urlImagen(pelicula.poster, "w342");
    poster.replaceChildren(imagen);
  });

  dom.destacada.replaceChildren(crearDestacada(peliculas[0], "N.º 1 en tendencia esta semana"));
  dom.destacada.hidden = false;
}

/* ============================================
   Tendencias (pestañas Hoy / Esta semana + filtro)
   ============================================ */

async function cargarTendencias() {
  const pedido = nuevoPedido("pedidoTendencias");
  mostrarCargando(dom.grillaTendencias, CANTIDAD_TENDENCIAS, crearTarjetaSkeleton);
  dom.avisoTendencias.textContent = "Cargando tendencias…";

  try {
    const { resultados } = await api.tendencias(estado.periodo, { signal: pedido.signal });
    estado.tendencias = resultados;
    renderizarTendencias();
    if (estado.periodo === "week") actualizarHero(resultados);
  } catch (error) {
    if (pedido.signal.aborted) return; // lo reemplazó un pedido más nuevo
    estado.tendencias = [];
    dom.avisoTendencias.textContent = "No se pudieron cargar las tendencias.";
    mostrarError(dom.grillaTendencias, error, cargarTendencias);
    // Si falló la primera carga, el hero no puede mostrar la destacada.
    if (!estado.heroListo) dom.destacada.hidden = true;
  }
}

function renderizarTendencias() {
  const { filtroGenero } = estado;
  const visibles = filtroGenero
    ? estado.tendencias.filter((p) => p.genero_ids.includes(filtroGenero.id))
    : estado.tendencias;

  if (!visibles.length) {
    const periodo = TEXTO_PERIODO[estado.periodo];
    dom.avisoTendencias.textContent = `No hay tendencias ${periodo} de ${filtroGenero.nombre}.`;
    mostrarBloqueEstado(dom.grillaTendencias, crearEstado({
      tipo: "vacio",
      titulo: `Ninguna tendencia ${periodo} es de ${filtroGenero.nombre}`,
      mensaje: "Probá con otro género o explorá las películas más populares de este.",
      textoAccion: `Explorar ${filtroGenero.nombre}`,
      alAccionar: () => mostrarGenero(filtroGenero.id, filtroGenero.nombre),
    }));
    return;
  }

  const tarjetas = visibles.slice(0, CANTIDAD_TENDENCIAS).map(crearTarjetaPelicula);
  mostrarContenido(dom.grillaTendencias, tarjetas);
  dom.avisoTendencias.textContent = `Se muestran ${tarjetas.length} películas en tendencia ${TEXTO_PERIODO[estado.periodo]}.`;
}

function cambiarPeriodo(periodo) {
  if (periodo === estado.periodo) return;
  estado.periodo = periodo;

  for (const tab of dom.tabs) {
    const activa = tab.dataset.periodo === periodo;
    tab.setAttribute("aria-selected", String(activa));
    tab.tabIndex = activa ? 0 : -1;
  }
  dom.tituloTendencias.textContent = `Tendencias ${TEXTO_PERIODO[periodo]}`;
  cargarTendencias();
}

function aplicarFiltroGenero(filtro) {
  estado.filtroGenero = filtro;

  for (const chip of dom.chips) {
    const id = Number(chip.dataset.filtroGenero) || null;
    chip.setAttribute("aria-pressed", String(id === (filtro?.id ?? null)));
  }

  // Pastilla "Filtro: Drama ✕" junto al título de la sección.
  if (filtro) {
    const pastilla = crearElemento("button", {
      clase: "filter-pill",
      atributos: { type: "button", "aria-label": `Quitar filtro ${filtro.nombre}` },
    }, [
      crearElemento("span", { texto: `Filtro: ${filtro.nombre}` }),
      crearElemento("span", { clase: "filter-pill_x", texto: "✕", atributos: { "aria-hidden": "true" } }),
    ]);
    pastilla.addEventListener("click", () => aplicarFiltroGenero(null));
    dom.filtroActivo.replaceChildren(pastilla);
  } else {
    dom.filtroActivo.replaceChildren();
  }

  if (estado.tendencias.length) renderizarTendencias();
}

/* ============================================
   Resultados (búsqueda y géneros)
   Reemplazan temporalmente a la sección Tendencias.
   ============================================ */

async function mostrarResultados({ eyebrow, titulo, cargar, textoVacio }) {
  const pedido = nuevoPedido("pedidoResultados");

  dom.eyebrowResultados.textContent = eyebrow;
  dom.tituloResultados.textContent = titulo;
  dom.estadoResultados.textContent = "Buscando…";
  dom.seccionTendencias.hidden = true;
  dom.seccionResultados.hidden = false;
  mostrarCargando(dom.grillaResultados, CANTIDAD_TENDENCIAS, crearTarjetaSkeleton);
  irA(dom.seccionResultados);

  try {
    const { resultados, total } = await cargar(pedido.signal);

    if (!resultados.length) {
      dom.estadoResultados.textContent = "Sin resultados.";
      mostrarBloqueEstado(dom.grillaResultados, crearEstado({
        tipo: "vacio",
        titulo: "Sin resultados",
        mensaje: textoVacio,
        textoAccion: "Volver a tendencias",
        alAccionar: limpiarResultados,
      }));
      return;
    }

    mostrarContenido(dom.grillaResultados, resultados.map(crearTarjetaPelicula));
    const formato = new Intl.NumberFormat("es-AR");
    dom.estadoResultados.textContent = total > resultados.length
      ? `Mostrando ${resultados.length} de ${formato.format(total)} resultados.`
      : `${resultados.length} ${resultados.length === 1 ? "resultado" : "resultados"}.`;
  } catch (error) {
    if (pedido.signal.aborted) return;
    dom.estadoResultados.textContent = "";
    mostrarError(dom.grillaResultados, error, () => mostrarResultados({ eyebrow, titulo, cargar, textoVacio }));
  }
}

function buscarPeliculas(consulta) {
  const url = new URL(window.location.href);
  url.searchParams.set("q", consulta);
  history.replaceState(null, "", url);

  mostrarResultados({
    eyebrow: "Búsqueda",
    titulo: `Resultados para “${consulta}”`,
    cargar: (signal) => api.buscar(consulta, { signal }),
    textoVacio: `No encontramos películas para “${consulta}”. Revisá la ortografía o probá con otro título.`,
  });
}

function mostrarGenero(id, nombre) {
  mostrarResultados({
    eyebrow: "Género",
    titulo: nombre,
    cargar: (signal) => api.descubrir(id, { signal }),
    textoVacio: `No encontramos películas de ${nombre}.`,
  });
}

function limpiarResultados() {
  estado.pedidoResultados?.abort();
  dom.grillaResultados.replaceChildren();
  dom.seccionResultados.hidden = true;
  dom.seccionTendencias.hidden = false;
  dom.inputBusqueda.value = "";
  validadorBusqueda.reiniciar();

  const url = new URL(window.location.href);
  url.searchParams.delete("q");
  history.replaceState(null, "", url);
  irA(dom.seccionTendencias);
}

/* ============================================
   Top 5
   ============================================ */

async function cargarTop() {
  mostrarCargando(dom.listaTop, CANTIDAD_TOP, crearTarjetaRankingSkeleton);
  try {
    const { resultados } = await api.top();
    const tarjetas = resultados.slice(0, CANTIDAD_TOP).map((p, i) => crearTarjetaRanking(p, i + 1));
    mostrarContenido(dom.listaTop, tarjetas);
  } catch (error) {
    mostrarError(dom.listaTop, error, cargarTop);
  }
}

/* ============================================
   Géneros
   ============================================ */

function renderizarGeneros() {
  const visibles = estado.mostrandoTodosLosGeneros
    ? estado.generos
    : estado.generos.slice(0, GENEROS_INICIALES);
  mostrarContenido(dom.grillaGeneros, visibles.map(crearTileGenero));

  const hayMas = estado.generos.length > GENEROS_INICIALES;
  dom.botonMasGeneros.hidden = !hayMas;
  dom.botonMasGeneros.textContent = estado.mostrandoTodosLosGeneros
    ? "Ver menos géneros"
    : `Ver los ${estado.generos.length} géneros`;
  dom.botonMasGeneros.setAttribute("aria-expanded", String(estado.mostrandoTodosLosGeneros));
}

async function cargarGeneros() {
  dom.botonMasGeneros.hidden = true;
  mostrarCargando(dom.grillaGeneros, GENEROS_INICIALES, crearTileSkeleton);
  try {
    const { generos } = await api.generos();
    estado.generos = generos;
    renderizarGeneros();
  } catch (error) {
    mostrarError(dom.grillaGeneros, error, cargarGeneros);
  }
}

/* ============================================
   Búsqueda (formulario del hero)
   ============================================ */

const validadorBusqueda = crearValidador(dom.formBusqueda, {
  q: [
    reglas.requerido("Escribí el nombre de una película."),
    reglas.minLargo(2, "Escribí al menos 2 caracteres."),
    reglas.maxLargo(100, "La búsqueda es demasiado larga (máximo 100 caracteres)."),
  ],
}, { validarAlSalir: false }); // no molestar con errores si solo pasa por el campo

/* ============================================
   Eventos
   ============================================ */

function registrarEventos() {
  dom.formBusqueda.addEventListener("submit", (evento) => {
    evento.preventDefault();
    if (!validadorBusqueda.validarTodo()) return;
    dom.inputBusqueda.blur(); // en celular, cierra el teclado
    buscarPeliculas(dom.inputBusqueda.value.trim());
  });

  dom.botonLimpiar.addEventListener("click", limpiarResultados);

  // Pestañas: clic y flechas del teclado (patrón accesible de "tabs").
  for (const tab of dom.tabs) {
    tab.addEventListener("click", () => cambiarPeriodo(tab.dataset.periodo));
    tab.addEventListener("keydown", (evento) => {
      if (!["ArrowLeft", "ArrowRight"].includes(evento.key)) return;
      const lista = [...dom.tabs];
      const siguiente = lista[(lista.indexOf(tab) + (evento.key === "ArrowRight" ? 1 : -1) + lista.length) % lista.length];
      siguiente.focus();
      cambiarPeriodo(siguiente.dataset.periodo);
    });
  }

  // Chips de género del hero: filtran la grilla de tendencias.
  for (const chip of dom.chips) {
    chip.addEventListener("click", () => {
      const id = Number(chip.dataset.filtroGenero) || null;
      const yaActivo = estado.filtroGenero?.id === id;
      aplicarFiltroGenero(id && !yaActivo ? { id, nombre: chip.dataset.nombre } : null);
      if (!dom.seccionResultados.hidden) limpiarResultados();
      else irA(dom.seccionTendencias);
    });
  }

  // Delegación: un solo listener para todos los tiles, aunque se creen después.
  dom.grillaGeneros.addEventListener("click", (evento) => {
    const tile = evento.target.closest("[data-genero-id]");
    if (tile) mostrarGenero(Number(tile.dataset.generoId), tile.dataset.generoNombre);
  });

  dom.botonMasGeneros.addEventListener("click", () => {
    estado.mostrandoTodosLosGeneros = !estado.mostrandoTodosLosGeneros;
    renderizarGeneros();
  });

  // Delegación: cualquier tarjeta de película (de cualquier sección) abre el detalle.
  document.addEventListener("click", (evento) => {
    const enlace = evento.target.closest("[data-pelicula-id]");
    if (!enlace) return;
    // Ctrl/⌘ + clic o clic del medio: dejamos que abra TMDB en otra pestaña.
    if (evento.ctrlKey || evento.metaKey || evento.shiftKey || evento.button !== 0) return;
    evento.preventDefault();
    abrirDetallePelicula(enlace.dataset.peliculaId, { titulo: enlace.dataset.titulo, disparador: enlace });
  });
}

/* ============================================
   Inicio
   ============================================ */

iniciarLayout();
registrarEventos();
cargarTendencias();
cargarTop();
cargarGeneros();

// Si la URL trae ?q=... (ej: al recargar después de buscar), se repite la búsqueda.
const consultaInicial = new URLSearchParams(window.location.search).get("q")?.trim();
if (consultaInicial) {
  dom.inputBusqueda.value = consultaInicial;
  if (validadorBusqueda.validarTodo()) buscarPeliculas(consultaInicial);
}
