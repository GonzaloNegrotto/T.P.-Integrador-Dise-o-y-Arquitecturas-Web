/* ============================================
   estadisticas.js
   Página Estadísticas (RF06).
   - Generales: cantidad de películas por género y
     por década, y su puntaje promedio (datos de TMDB
     que calcula el servidor).
   - Tus estadísticas: números de Mis favoritas,
     solo con la sesión iniciada.
   Los gráficos son barras hechas con elementos del
   DOM y CSS, sin librerías. Las barras siempre
   arrancan en cero y miden cantidades; el puntaje
   promedio va escrito al lado, porque como barra
   (sobre 10) las diferencias entre géneros no se
   llegan a ver.
   ============================================ */

import { api } from "./api.js";
import { iniciarLayout } from "./layout.js";
import { crearElemento, crearEstado, crearEstadoError } from "./ui.js";

const formatoNumero = new Intl.NumberFormat("es-AR");
const formatoPuntaje = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const GENEROS_PROPIOS = 8; // en "Tus estadísticas" se muestran los más guardados

const puntaje = (valor) => (valor === null || valor === undefined ? "—" : formatoPuntaje.format(valor));
const estrellas = (valor) => `★ ${puntaje(valor)}`;
const peliculas = (n) => `${formatoNumero.format(n)} ${n === 1 ? "película" : "películas"}`;
const nombreDecada = (decada) => `${decada} a ${decada + 9}`;
const etiquetaDecada = (decada) => `’${String(decada).slice(2)}`; // ’90, ’00, ’10…

const estado = {
  generales: null, // última respuesta de /api/estadisticas
  pedidoGenerales: null,
  pedidoMias: null,
};

const dom = {
  estado: document.getElementById("stats-estado"),
  aviso: document.getElementById("stats-aviso"),
  generales: document.getElementById("stats-generales"),
  nota: document.getElementById("stats-nota"),
  miasEstado: document.getElementById("stats-mias-estado"),
  mias: document.getElementById("stats-mias"),
};

/* ============================================
   Piezas reutilizables
   ============================================ */

/** Fila de cifras destacadas: [{ valor, etiqueta, detalle? }]. */
function crearCifras(cifras) {
  return crearElemento("ul", { clase: "cifras", atributos: { role: "list" } }, cifras.map((cifra) =>
    crearElemento("li", { clase: "cifra" }, [
      crearElemento("span", { clase: "cifra_valor", texto: cifra.valor }),
      crearElemento("span", { clase: "cifra_etiqueta", texto: cifra.etiqueta }),
      cifra.detalle && crearElemento("span", { clase: "cifra_detalle", texto: cifra.detalle }),
    ]),
  ));
}

/** Proporción (0 a 1) de cada cantidad respecto de la mayor, para el largo de la barra. */
function proporciones(filas) {
  const maximo = Math.max(...filas.map((fila) => fila.cantidad), 1);
  return filas.map((fila) => fila.cantidad / maximo);
}

/**
 * Barras horizontales: etiqueta a la izquierda, cantidad a la derecha y,
 * si se indica, un dato secundario (el puntaje promedio).
 */
function crearBarras(filas, { etiqueta, secundario, descripcion }) {
  const largos = proporciones(filas);
  const clase = secundario ? "barras barras--con-dato" : "barras";
  return crearElemento("ol", { clase, atributos: { role: "list" } }, filas.map((fila, i) => {
    const barra = crearElemento("span", { clase: "barras_barra" });
    barra.style.setProperty("--valor", largos[i]);
    return crearElemento("li", { clase: "barras_fila", atributos: { title: descripcion(fila) } }, [
      crearElemento("span", { clase: "barras_etiqueta", texto: etiqueta(fila) }),
      crearElemento("span", { clase: "barras_pista", atributos: { "aria-hidden": "true" } }, [barra]),
      crearElemento("span", { clase: "barras_valor", texto: formatoNumero.format(fila.cantidad) }),
      secundario && crearElemento("span", { clase: "barras_dato", texto: secundario(fila) }),
    ]);
  }));
}

/** Columnas verticales, para lo que avanza en el tiempo (décadas). */
function crearColumnas(filas, { etiqueta, secundario, descripcion }) {
  const altos = proporciones(filas);
  return crearElemento("ol", { clase: "columnas", atributos: { role: "list" } }, filas.map((fila, i) => {
    const barra = crearElemento("span", { clase: "columnas_barra", atributos: { "aria-hidden": "true" } });
    barra.style.setProperty("--valor", altos[i]);
    return crearElemento("li", { clase: "columnas_item", atributos: { title: descripcion(fila) } }, [
      crearElemento("span", { clase: "columnas_area", atributos: { "aria-hidden": "true" } }, [
        crearElemento("span", { clase: "columnas_valor", texto: formatoNumero.format(fila.cantidad) }),
        barra,
      ]),
      crearElemento("span", { clase: "columnas_etiqueta", texto: etiqueta(fila), atributos: { "aria-hidden": "true" } }),
      secundario && crearElemento("span", { clase: "columnas_dato", texto: secundario(fila), atributos: { "aria-hidden": "true" } }),
      // Para lectores de pantalla, el dato completo en palabras
      crearElemento("span", { clase: "visually-hidden", texto: descripcion(fila) }),
    ]);
  }));
}

/** Sección con título, una aclaración y el gráfico. */
function crearSeccion({ id, titulo, subtitulo, grafico }) {
  const idTitulo = `${id}-titulo`;
  return crearElemento("section", { clase: "stats_seccion", atributos: { "aria-labelledby": idTitulo } }, [
    crearElemento("div", { clase: "section_head" }, [
      crearElemento("div", { clase: "section_title-group" }, [
        crearElemento("h2", { texto: titulo, atributos: { id: idTitulo } }),
        crearElemento("p", { clase: "section_status text-muted", texto: subtitulo }),
      ]),
    ]),
    grafico,
  ]);
}

function crearAcciones(enlaces) {
  return crearElemento("div", { clase: "estado_acciones" }, enlaces.map(([texto, href, clase]) =>
    crearElemento("a", { clase: `btn ${clase}`, texto, atributos: { href } }),
  ));
}

function crearSkeleton() {
  const linea = () => crearElemento("span", { clase: "skeleton skeleton-line" });
  return crearElemento("div", { clase: "stats_skeleton", atributos: { "aria-hidden": "true" } }, [
    crearElemento("div", { clase: "cifras" }, Array.from({ length: 3 }, () =>
      crearElemento("div", { clase: "cifra skeleton" }),
    )),
    crearElemento("div", { clase: "stats_skeleton-lineas" }, Array.from({ length: 6 }, linea)),
  ]);
}

/* ============================================
   Estadísticas generales
   ============================================ */

function cifrasGenerales({ total, por_genero: generos, por_decada: decadas, minimo_votos: minimo }) {
  const cifras = [];
  if (total) {
    cifras.push({ valor: formatoNumero.format(total.cantidad), etiqueta: "películas en el catálogo de TMDB", detalle: `con ${minimo} votos o más` });
    cifras.push({ valor: puntaje(total.puntaje_promedio), etiqueta: "puntaje promedio", detalle: "de las 20 más populares" });
  }
  if (generos.length) {
    cifras.push({ valor: generos[0].nombre, etiqueta: "es el género con más películas", detalle: peliculas(generos[0].cantidad) });
  }
  if (decadas.length) {
    const mayor = decadas.reduce((max, fila) => (fila.cantidad > max.cantidad ? fila : max));
    cifras.push({ valor: `Años ${mayor.decada}`, etiqueta: "es la década con más estrenos", detalle: peliculas(mayor.cantidad) });
  }
  return cifras;
}

function pintarGenerales(datos) {
  estado.generales = datos;
  const { por_genero: generos, por_decada: decadas } = datos;

  const secciones = [crearCifras(cifrasGenerales(datos))];
  if (generos.length) {
    secciones.push(crearSeccion({
      id: "generos",
      titulo: "Películas por género",
      subtitulo: "Cantidad de películas y puntaje promedio (★). Una película puede contar en más de un género.",
      grafico: crearBarras(generos, {
        etiqueta: (fila) => fila.nombre,
        secundario: (fila) => estrellas(fila.puntaje_promedio),
        descripcion: (fila) => `${fila.nombre}: ${peliculas(fila.cantidad)}, puntaje promedio ${puntaje(fila.puntaje_promedio)}`,
      }),
    }));
  }
  if (decadas.length) {
    secciones.push(crearSeccion({
      id: "decadas",
      titulo: "Estrenos por década",
      subtitulo: "Cantidad de películas y puntaje promedio (★). La década actual cuenta hasta hoy.",
      grafico: crearColumnas(decadas, {
        etiqueta: (fila) => etiquetaDecada(fila.decada),
        secundario: (fila) => estrellas(fila.puntaje_promedio),
        descripcion: (fila) => `${nombreDecada(fila.decada)}: ${peliculas(fila.cantidad)}, puntaje promedio ${puntaje(fila.puntaje_promedio)}`,
      }),
    }));
  }

  dom.estado.textContent = "";
  dom.aviso.textContent = datos.incompleto
    ? "TMDB no respondió algunas consultas, así que puede faltar algún género o década. Recargá la página en unos minutos para completarlo."
    : "";
  dom.aviso.hidden = !datos.incompleto;
  dom.nota.textContent = `Se cuentan las películas con al menos ${datos.minimo_votos} votos en TMDB, para dejar afuera las que casi nadie vio. `
    + "El puntaje promedio se calcula con las 20 películas más populares de cada grupo. Los datos se actualizan una vez por día.";
  dom.nota.hidden = false;
  dom.generales.removeAttribute("aria-busy");
  dom.generales.replaceChildren(...secciones);
}

async function cargarGenerales() {
  estado.pedidoGenerales?.abort();
  estado.pedidoGenerales = new AbortController();
  const { signal } = estado.pedidoGenerales;

  dom.estado.textContent = "Calculando estadísticas…";
  dom.aviso.hidden = true;
  dom.generales.setAttribute("aria-busy", "true");
  dom.generales.replaceChildren(crearSkeleton());

  try {
    pintarGenerales(await api.estadisticas({ signal }));
  } catch (error) {
    if (signal.aborted) return;
    console.error(error);
    dom.estado.textContent = "No se pudieron cargar las estadísticas.";
    dom.generales.removeAttribute("aria-busy");
    dom.generales.replaceChildren(crearEstadoError(error, cargarGenerales));
  }
}

/* ============================================
   Tus estadísticas (Mis favoritas)
   ============================================ */

function mostrarMias(...hijos) {
  dom.mias.removeAttribute("aria-busy");
  dom.mias.replaceChildren(...hijos);
}

function mostrarVisitante() {
  dom.miasEstado.textContent = "";
  const bloque = crearEstado({
    tipo: "vacio",
    titulo: "Ingresá para ver tus estadísticas",
    mensaje: "Con tu cuenta, calculamos qué géneros y qué décadas guardás más en Mis favoritas.",
  });
  bloque.append(crearAcciones([
    ["Ingresar", "login.html?volver=%2Fpages%2Festadisticas.html", "btn-primary"],
    ["Crear cuenta", "registro.html", "btn-outline"],
  ]));
  mostrarMias(bloque);
}

function pintarMias(datos) {
  if (!datos.cantidad) {
    dom.miasEstado.textContent = "";
    const bloque = crearEstado({
      tipo: "vacio",
      titulo: "Todavía no guardaste películas",
      mensaje: "Tocá el corazón de cualquier película para sumarla a Mis favoritas y acá vas a ver tus números.",
    });
    bloque.append(crearAcciones([["Ver tendencias", "../index.html#tendencias", "btn-primary"]]));
    mostrarMias(bloque);
    return;
  }

  const generos = datos.por_genero.slice(0, GENEROS_PROPIOS);
  const cifras = [
    { valor: formatoNumero.format(datos.cantidad), etiqueta: datos.cantidad === 1 ? "película guardada" : "películas guardadas" },
    { valor: puntaje(datos.puntaje_promedio), etiqueta: "puntaje promedio de tus favoritas" },
  ];
  if (generos.length) {
    cifras.push({ valor: generos[0].nombre, etiqueta: "es tu género más guardado", detalle: peliculas(generos[0].cantidad) });
  }

  const contenido = [crearCifras(cifras)];
  if (generos.length) {
    contenido.push(crearSeccion({
      id: "mis-generos",
      titulo: "Tus géneros",
      subtitulo: datos.por_genero.length > GENEROS_PROPIOS ? `Los ${GENEROS_PROPIOS} que más guardaste.` : "Los que más guardaste.",
      grafico: crearBarras(generos, {
        etiqueta: (fila) => fila.nombre,
        descripcion: (fila) => `${fila.nombre}: ${peliculas(fila.cantidad)}`,
      }),
    }));
  }
  if (datos.por_decada.length) {
    contenido.push(crearSeccion({
      id: "mis-decadas",
      titulo: "Tus décadas",
      subtitulo: "Según el año de estreno de cada película.",
      grafico: crearColumnas(datos.por_decada, {
        etiqueta: (fila) => etiquetaDecada(fila.decada),
        descripcion: (fila) => `${nombreDecada(fila.decada)}: ${peliculas(fila.cantidad)}`,
      }),
    }));
  }

  dom.miasEstado.textContent = "Calculadas con las películas que guardaste en Mis favoritas.";
  mostrarMias(...contenido);
}

async function cargarMias() {
  estado.pedidoMias?.abort();
  estado.pedidoMias = new AbortController();
  const { signal } = estado.pedidoMias;

  dom.miasEstado.textContent = "Calculando tus estadísticas…";
  dom.mias.setAttribute("aria-busy", "true");
  dom.mias.replaceChildren(crearSkeleton());

  try {
    pintarMias(await api.misEstadisticas({ signal }));
  } catch (error) {
    if (signal.aborted) return;
    if (error.tipo === "sesion") {
      mostrarVisitante();
      return;
    }
    console.error(error);
    dom.miasEstado.textContent = "No se pudieron cargar tus estadísticas.";
    mostrarMias(crearEstadoError(error, cargarMias, {
      proveedor: "Tus estadísticas no están disponibles por ahora",
    }));
  }
}

function alCambiarSesion(usuario) {
  if (usuario) {
    cargarMias();
  } else {
    estado.pedidoMias?.abort();
    mostrarVisitante();
  }
}

/* ============================================
   Inicio
   ============================================ */

dom.mias.replaceChildren(crearSkeleton());
document.addEventListener("sesion:cambio", (evento) => alCambiarSesion(evento.detail.usuario));
iniciarLayout();
cargarGenerales();
