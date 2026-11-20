/* ============================================
   main.js
   Página de inicio. Pide los datos a la API y
   arma cada sección. Cada sección maneja sus
   propios errores: si falla una, las demás se
   siguen mostrando.
   ============================================ */

import { api, srcsetImagen, urlImagen } from "./api.js";
import { iniciarFavoritas } from "./favoritas.js";
import { iniciarLayout } from "./layout.js";
import { escucharTarjetas } from "./modal.js";
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

// Filtros de la búsqueda (RF02). Los nombres coinciden con los parámetros de /api/buscar.
const ANIO_INICIAL = 1920;
const ORDEN_PREDETERMINADO = "relevancia";
const FILTROS_VACIOS = { genero: "", anio: "", idioma: "", puntaje_min: "", orden: ORDEN_PREDETERMINADO };
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
const TEXTO_ORDEN = { puntaje: "puntaje", popularidad: "popularidad", fecha: "fecha de estreno" };

const estado = {
  periodo: "week",
  tendencias: [], // última lista recibida: el filtro por género trabaja sobre esto
  filtroGenero: null, // { id, nombre } o null
  generos: [],
  mostrandoTodosLosGeneros: false,
  heroListo: false,
  pedidoTendencias: null, // AbortController del pedido en curso
  pedidoResultados: null,
  filtros: { ...FILTROS_VACIOS }, // filtros de la búsqueda (valores de los selects, como texto)
  consulta: "", // última búsqueda por título que se está mostrando
};

const dom = {
  formBusqueda: document.getElementById("form-busqueda"),
  inputBusqueda: document.getElementById("q"),
  detalleFiltros: document.getElementById("filtros-busqueda"),
  cantidadFiltros: document.getElementById("filtros-cantidad"),
  botonQuitarFiltros: document.getElementById("limpiar-filtros"),
  selectsFiltros: {
    genero: document.getElementById("filtro-genero"),
    anio: document.getElementById("filtro-anio"),
    idioma: document.getElementById("filtro-idioma"),
    puntaje_min: document.getElementById("filtro-puntaje"),
    orden: document.getElementById("filtro-orden"),
  },
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
   Filtros de la búsqueda
   El estado es la fuente de verdad: los selects lo reflejan
   y la dirección de la página lo guarda (?genero=&anio=...).
   ============================================ */

const hayFiltros = () => contarFiltros() > 0;

/** Cuántos filtros se salen de lo predeterminado (para el número junto a "Filtros"). */
function contarFiltros() {
  return Object.entries(estado.filtros).filter(([nombre, valor]) => valor !== FILTROS_VACIOS[nombre]).length;
}

/** Toma los filtros de la URL; lo que no sea válido se ignora. */
function leerFiltrosDeUrl() {
  const parametros = new URLSearchParams(window.location.search);
  const anioActual = new Date().getFullYear();
  const filtros = { ...FILTROS_VACIOS };

  const genero = Number(parametros.get("genero"));
  if (Number.isInteger(genero) && genero > 0) filtros.genero = String(genero);

  const anio = Number(parametros.get("anio"));
  if (Number.isInteger(anio) && anio >= ANIO_INICIAL && anio <= anioActual) filtros.anio = String(anio);

  const idioma = parametros.get("idioma");
  if (Object.hasOwn(IDIOMAS, idioma)) filtros.idioma = idioma;

  const puntaje = Number(parametros.get("puntaje_min"));
  if (parametros.get("puntaje_min") && Number.isFinite(puntaje) && puntaje >= 0 && puntaje <= 10) {
    filtros.puntaje_min = String(puntaje);
  }

  const orden = parametros.get("orden");
  if (orden === ORDEN_PREDETERMINADO || Object.hasOwn(TEXTO_ORDEN, orden)) filtros.orden = orden;
  return filtros;
}

function llenarAnios() {
  const anioActual = new Date().getFullYear();
  const opciones = [];
  for (let anio = anioActual; anio >= ANIO_INICIAL; anio--) {
    opciones.push(crearElemento("option", { texto: String(anio), atributos: { value: anio } }));
  }
  dom.selectsFiltros.anio.append(...opciones);
}

function llenarGenerosDelFiltro(generos) {
  dom.selectsFiltros.genero.append(
    ...generos.map((genero) => crearElemento("option", { texto: genero.nombre, atributos: { value: genero.id } })),
  );
}

/** Deja los selects, el contador y el botón "Quitar filtros" igual que el estado. */
function sincronizarFiltros() {
  for (const [nombre, select] of Object.entries(dom.selectsFiltros)) select.value = estado.filtros[nombre];

  const cantidad = contarFiltros();
  dom.cantidadFiltros.hidden = cantidad === 0;
  dom.cantidadFiltros.textContent = String(cantidad);
  dom.cantidadFiltros.setAttribute("aria-label", `${cantidad} ${cantidad === 1 ? "filtro activo" : "filtros activos"}`);
  dom.botonQuitarFiltros.hidden = cantidad === 0;
}

/** Los filtros como los espera api.buscar: el orden predeterminado no se envía. */
function filtrosParaApi() {
  const { orden, ...resto } = estado.filtros;
  return { ...resto, orden: orden === ORDEN_PREDETERMINADO ? "" : orden };
}

/** "Drama, 2019, en inglés, puntaje de 7 o más, por popularidad" (o "" si no hay filtros). */
function describirFiltros() {
  const { genero, anio, idioma, puntaje_min: puntaje, orden } = estado.filtros;
  const nombreGenero = estado.generos.find(({ id }) => String(id) === genero)?.nombre ?? (genero ? "género elegido" : "");
  return [
    nombreGenero,
    anio,
    idioma && `idioma original ${IDIOMAS[idioma]}`,
    puntaje && `puntaje de ${puntaje} o más`,
    orden !== ORDEN_PREDETERMINADO && `por ${TEXTO_ORDEN[orden]}`,
  ].filter(Boolean).join(", ");
}

/** Se llama cuando cambia cualquier filtro: si ya se estaba mostrando una búsqueda, se repite con los filtros nuevos. */
function aplicarFiltros() {
  sincronizarFiltros();
  if (estado.consulta && !dom.seccionResultados.hidden) buscarPeliculas(estado.consulta);
}

function quitarFiltros() {
  estado.filtros = { ...FILTROS_VACIOS };
  aplicarFiltros();
}

/* ============================================
   Resultados (búsqueda y géneros)
   Reemplazan temporalmente a la sección Tendencias.
   ============================================ */

async function mostrarResultados({ eyebrow, titulo, cargar, textoVacio, resumen = () => "", accionVacia = null }) {
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
        textoAccion: accionVacia?.texto ?? "Volver a tendencias",
        alAccionar: accionVacia?.alAccionar ?? limpiarResultados,
      }));
      return;
    }

    mostrarContenido(dom.grillaResultados, resultados.map(crearTarjetaPelicula));
    const formato = new Intl.NumberFormat("es-AR");
    const cantidad = total > resultados.length
      ? `Mostrando ${resultados.length} de ${formato.format(total)} resultados.`
      : `${resultados.length} ${resultados.length === 1 ? "resultado" : "resultados"}.`;
    // El resumen se arma ahora (y no antes de pedir) para que ya conozca los nombres de los géneros.
    const filtros = resumen();
    dom.estadoResultados.textContent = filtros ? `${cantidad} Filtros: ${filtros}.` : cantidad;
  } catch (error) {
    if (pedido.signal.aborted) return;
    dom.estadoResultados.textContent = "";
    mostrarError(dom.grillaResultados, error, () =>
      mostrarResultados({ eyebrow, titulo, cargar, textoVacio, resumen, accionVacia }),
    );
  }
}

function buscarPeliculas(consulta) {
  estado.consulta = consulta;

  // La búsqueda y sus filtros quedan en la dirección: se puede recargar o compartir.
  const url = new URL(window.location.href);
  url.searchParams.set("q", consulta);
  for (const [nombre, valor] of Object.entries(estado.filtros)) {
    if (valor !== FILTROS_VACIOS[nombre]) url.searchParams.set(nombre, valor);
    else url.searchParams.delete(nombre);
  }
  history.replaceState(null, "", url);

  const conFiltros = hayFiltros();
  mostrarResultados({
    eyebrow: "Búsqueda",
    titulo: `Resultados para “${consulta}”`,
    cargar: (signal) => api.buscar(consulta, { filtros: filtrosParaApi(), signal }),
    textoVacio: conFiltros
      ? `No encontramos películas para “${consulta}” con esos filtros. Probá quitarlos o cambiarlos.`
      : `No encontramos películas para “${consulta}”. Revisá la ortografía o probá con otro título.`,
    resumen: describirFiltros,
    accionVacia: conFiltros ? { texto: "Quitar filtros", alAccionar: quitarFiltros } : null,
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
  estado.consulta = "";
  estado.filtros = { ...FILTROS_VACIOS };
  sincronizarFiltros();

  const url = new URL(window.location.href);
  for (const nombre of ["q", ...Object.keys(FILTROS_VACIOS)]) url.searchParams.delete(nombre);
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
    llenarGenerosDelFiltro(generos);
    sincronizarFiltros(); // por si la URL traía un género ya elegido
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

  // Filtros: cada cambio actualiza el estado y, si hay resultados a la vista, repite la búsqueda.
  for (const [nombre, select] of Object.entries(dom.selectsFiltros)) {
    select.addEventListener("change", () => {
      estado.filtros[nombre] = select.value;
      aplicarFiltros();
    });
  }
  dom.botonQuitarFiltros.addEventListener("click", quitarFiltros);

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

  // Cualquier tarjeta de película (de cualquier sección) abre el detalle.
  escucharTarjetas();
}

/* ============================================
   Inicio
   ============================================ */

llenarAnios();
estado.filtros = leerFiltrosDeUrl();
sincronizarFiltros();
if (hayFiltros()) dom.detalleFiltros.open = true; // si la URL trae filtros, se ven desplegados
iniciarFavoritas();
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
