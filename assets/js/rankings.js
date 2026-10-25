/* ============================================
   rankings.js
   Página Rankings (RF05): películas ordenadas por
   puntaje o por popularidad, con filtros por
   género, año e idioma. Muestra de a 20 y permite
   cargar más hasta el puesto 100.
   Los filtros viajan en la URL (?criterio=&genero=
   &anio=&idioma=) para poder recargar o compartir.
   ============================================ */

import { api } from "./api.js";
import { iniciarFavoritas } from "./favoritas.js";
import { iniciarLayout } from "./layout.js";
import { escucharTarjetas } from "./modal.js";
import { crearFilaRanking, crearFilaRankingSkeleton } from "./render.js";
import { crearElemento, crearEstado, crearEstadoError, mostrarToast } from "./ui.js";

const CANTIDAD_SKELETON = 8;
const ANIO_INICIAL = 1920; // el servidor acepta desde 1900; acá alcanza con las películas con más votos
const ANIO_ACTUAL = new Date().getFullYear();

const CRITERIOS = { puntaje: "Mejor puntuadas", popularidad: "Más populares" };
const IDIOMAS = {
  es: "español",
  en: "inglés",
  fr: "francés",
  it: "italiano",
  de: "alemán",
  pt: "portugués",
  ja: "japonés",
  ko: "coreano",
};

const formatoNumero = new Intl.NumberFormat("es-AR");

const estado = {
  criterio: "puntaje",
  genero: null, // id de TMDB o null
  anio: null,
  idioma: null, // código ("es", "en"...) o null
  generos: [], // [{ id, nombre }]
  lista: [], // películas ya cargadas, en orden
  pagina: 0,
  totalPaginas: 0,
  total: 0,
  minimoVotos: 0,
  pedido: null, // AbortController del pedido en curso
};

const dom = {
  tabs: document.querySelectorAll("[data-criterio]"),
  panel: document.getElementById("panel-ranking"),
  titulo: document.getElementById("ranking-titulo"),
  aviso: document.getElementById("ranking-estado"),
  lista: document.getElementById("lista-ranking"),
  bloque: document.getElementById("ranking-bloque"),
  mas: document.getElementById("ranking-mas"),
  genero: document.getElementById("filtro-genero"),
  anio: document.getElementById("filtro-anio"),
  idioma: document.getElementById("filtro-idioma"),
  limpiar: document.getElementById("limpiar-filtros"),
};

const hayFiltros = () => Boolean(estado.genero || estado.anio || estado.idioma);

/* ---------- Filtros y URL ---------- */

/** Toma los filtros de la URL; lo que no sea válido se ignora. */
function leerUrl() {
  const parametros = new URLSearchParams(window.location.search);

  const criterio = parametros.get("criterio");
  if (Object.hasOwn(CRITERIOS, criterio)) estado.criterio = criterio;

  const genero = Number(parametros.get("genero"));
  if (Number.isInteger(genero) && genero > 0) estado.genero = genero;

  const anio = Number(parametros.get("anio"));
  if (Number.isInteger(anio) && anio >= ANIO_INICIAL && anio <= ANIO_ACTUAL) estado.anio = anio;

  const idioma = parametros.get("idioma");
  if (Object.hasOwn(IDIOMAS, idioma)) estado.idioma = idioma;
}

/** Refleja los filtros en la dirección, sin agregar entradas al historial. */
function escribirUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  if (estado.criterio !== "puntaje") url.searchParams.set("criterio", estado.criterio);
  if (estado.genero) url.searchParams.set("genero", estado.genero);
  if (estado.anio) url.searchParams.set("anio", estado.anio);
  if (estado.idioma) url.searchParams.set("idioma", estado.idioma);
  window.history.replaceState(null, "", url);
}

function llenarAnios() {
  const opciones = [];
  for (let anio = ANIO_ACTUAL; anio >= ANIO_INICIAL; anio--) {
    opciones.push(crearElemento("option", { texto: String(anio), atributos: { value: anio } }));
  }
  dom.anio.append(...opciones);
}

async function cargarGeneros() {
  try {
    const { generos } = await api.generos();
    estado.generos = generos;
    dom.genero.append(
      ...generos.map((genero) => crearElemento("option", { texto: genero.nombre, atributos: { value: genero.id } })),
    );
    // Un género inventado en la URL se descarta.
    if (!generos.some((genero) => genero.id === estado.genero)) estado.genero = null;
  } catch (error) {
    // Sin la lista de géneros el ranking sigue funcionando, solo sin ese filtro.
    console.warn("No se pudieron cargar los géneros:", error.message);
    dom.genero.disabled = true;
    dom.genero.title = "No se pudieron cargar los géneros.";
    estado.genero = null;
  }
}

function armarTitulo() {
  const genero = estado.generos.find(({ id }) => id === estado.genero)?.nombre;
  const idioma = estado.idioma && `en ${IDIOMAS[estado.idioma]}`;
  const partes = [genero, estado.anio, idioma].filter(Boolean);
  const base = CRITERIOS[estado.criterio];
  return partes.length ? `${base}: ${partes.join(", ")}` : base;
}

/** Deja los controles de la página igual que el estado (pestañas, selects, título). */
function sincronizarControles() {
  for (const tab of dom.tabs) {
    const activa = tab.dataset.criterio === estado.criterio;
    tab.setAttribute("aria-selected", String(activa));
    tab.tabIndex = activa ? 0 : -1;
  }
  dom.panel.setAttribute("aria-labelledby", `tab-${estado.criterio}`);
  dom.genero.value = estado.genero ? String(estado.genero) : "";
  dom.anio.value = estado.anio ? String(estado.anio) : "";
  dom.idioma.value = estado.idioma ?? "";
  dom.limpiar.hidden = !hayFiltros();
  dom.titulo.textContent = armarTitulo();
}

/** Se llama cada vez que cambia un filtro o el criterio: vuelve a pedir desde el puesto 1. */
function aplicarCambios() {
  sincronizarControles();
  escribirUrl();
  cargar();
}

function limpiarFiltros() {
  estado.genero = null;
  estado.anio = null;
  estado.idioma = null;
  aplicarCambios();
}

function cambiarCriterio(criterio) {
  if (criterio === estado.criterio) return;
  estado.criterio = criterio;
  aplicarCambios();
}

/* ---------- Estados de la lista ---------- */

function mostrarCargando() {
  dom.bloque.hidden = true;
  dom.mas.hidden = true;
  dom.aviso.textContent = "Cargando ranking…";
  dom.lista.hidden = false;
  dom.lista.setAttribute("aria-busy", "true");
  dom.lista.replaceChildren(
    ...Array.from({ length: CANTIDAD_SKELETON }, (_, indice) => crearFilaRankingSkeleton(indice + 1)),
  );
}

/** Reemplaza la lista por un mensaje (error o sin resultados). */
function mostrarBloque(bloque) {
  dom.lista.hidden = true;
  dom.lista.removeAttribute("aria-busy");
  dom.lista.replaceChildren();
  dom.mas.hidden = true;
  dom.bloque.hidden = false;
  dom.bloque.replaceChildren(bloque);
}

function mostrarVacio() {
  dom.aviso.textContent = "Sin resultados.";
  mostrarBloque(crearEstado({
    tipo: "vacio",
    titulo: "No hay películas para estos filtros",
    mensaje: "Probá con otro género, otro año u otro idioma. El ranking solo incluye películas con una cantidad mínima de votos.",
    textoAccion: hayFiltros() ? "Quitar filtros" : null,
    alAccionar: limpiarFiltros,
  }));
}

function describirLista() {
  const palabra = estado.total === 1 ? "película" : "películas";
  const criterio = estado.criterio === "puntaje"
    ? `Ordenadas por puntaje, solo con al menos ${formatoNumero.format(estado.minimoVotos)} votos.`
    : "Ordenadas por popularidad actual en TMDB.";
  return `Mostrando ${estado.lista.length} de ${estado.total} ${palabra}. ${criterio}`;
}

/**
 * Dibuja la lista. `desde` es el índice de la primera película nueva: al cargar
 * más solo se agregan las filas nuevas, sin volver a crear las anteriores.
 */
function renderizar(desde = 0) {
  if (!estado.lista.length) {
    mostrarVacio();
    return;
  }

  dom.bloque.hidden = true;
  dom.lista.hidden = false;
  dom.lista.removeAttribute("aria-busy");

  const filas = estado.lista
    .slice(desde)
    .map((pelicula, indice) => crearFilaRanking(pelicula, desde + indice + 1, estado.criterio));
  if (desde === 0) dom.lista.replaceChildren(...filas);
  else dom.lista.append(...filas);

  dom.aviso.textContent = describirLista();
  dom.mas.hidden = estado.pagina >= estado.totalPaginas;
  dom.mas.disabled = false;
  dom.mas.removeAttribute("aria-busy");
}

/* ---------- Carga ---------- */

async function cargar({ siguiente = false } = {}) {
  // Si el usuario cambia un filtro antes de que llegue la respuesta anterior, esa se cancela.
  estado.pedido?.abort();
  estado.pedido = new AbortController();
  const { signal } = estado.pedido;

  const pagina = siguiente ? estado.pagina + 1 : 1;
  if (siguiente) {
    dom.mas.disabled = true;
    dom.mas.setAttribute("aria-busy", "true");
  } else {
    estado.lista = [];
    mostrarCargando();
  }

  try {
    const datos = await api.ranking(
      { criterio: estado.criterio, genero: estado.genero, anio: estado.anio, idioma: estado.idioma, pagina },
      { signal },
    );

    // Entre página y página el orden puede moverse un poco: no se repiten películas.
    const conocidas = new Set(estado.lista.map((pelicula) => pelicula.id));
    const nuevas = datos.resultados.filter((pelicula) => !conocidas.has(pelicula.id));
    const desde = estado.lista.length;

    estado.lista = [...estado.lista, ...nuevas];
    estado.pagina = datos.pagina;
    estado.totalPaginas = datos.total_paginas;
    estado.total = datos.total;
    estado.minimoVotos = datos.minimo_votos;
    renderizar(desde);
  } catch (error) {
    if (signal.aborted) return;
    console.error(error);

    if (siguiente) {
      // La lista que ya se ve no se toca: solo se avisa y se puede reintentar.
      dom.mas.disabled = false;
      dom.mas.removeAttribute("aria-busy");
      mostrarToast(error.message, { tipo: "error" });
      return;
    }
    dom.aviso.textContent = "No se pudo cargar el ranking.";
    mostrarBloque(crearEstadoError(error, () => cargar()));
  }
}

/* ---------- Eventos ---------- */

function registrarEventos() {
  // Pestañas: clic y flechas del teclado (mismo patrón que las tendencias del inicio).
  for (const tab of dom.tabs) {
    tab.addEventListener("click", () => cambiarCriterio(tab.dataset.criterio));
    tab.addEventListener("keydown", (evento) => {
      if (!["ArrowLeft", "ArrowRight"].includes(evento.key)) return;
      const tabs = [...dom.tabs];
      const paso = evento.key === "ArrowRight" ? 1 : -1;
      const siguiente = tabs[(tabs.indexOf(tab) + paso + tabs.length) % tabs.length];
      siguiente.focus();
      cambiarCriterio(siguiente.dataset.criterio);
    });
  }

  dom.genero.addEventListener("change", () => {
    estado.genero = Number(dom.genero.value) || null;
    aplicarCambios();
  });
  dom.anio.addEventListener("change", () => {
    estado.anio = Number(dom.anio.value) || null;
    aplicarCambios();
  });
  dom.idioma.addEventListener("change", () => {
    estado.idioma = dom.idioma.value || null;
    aplicarCambios();
  });
  dom.limpiar.addEventListener("click", limpiarFiltros);
  dom.mas.addEventListener("click", () => cargar({ siguiente: true }));
}

/* ============================================
   Inicio
   ============================================ */

function iniciar() {
  sincronizarControles();
  cargar();
}

llenarAnios();
leerUrl();
mostrarCargando();
iniciarFavoritas();
escucharTarjetas();
iniciarLayout();
registrarEventos();

// Si la URL trae un género, primero hay que conocer la lista para validarlo.
const generosListos = cargarGeneros();
if (estado.genero) generosListos.then(iniciar);
else iniciar();
