/* ============================================
   recomendaciones.js
   Página Recomendaciones (CU03 / RF07): filas de
   películas armadas con los géneros del usuario y
   con lo que guardó en Mis favoritas. Requiere
   sesión iniciada.
   Flujos alternativos del caso de uso:
   A1. Sin preferencias: se muestran las populares.
   A2. Pocas coincidencias: el servidor suma populares.
   A3. Base de datos caída: mensaje de "no disponible".
   ============================================ */

import { api } from "./api.js";
import { cargarFavoritas, iniciarFavoritas } from "./favoritas.js";
import { iniciarLayout } from "./layout.js";
import { escucharTarjetas } from "./modal.js";
import { crearTarjetaPelicula, crearTarjetaSkeleton } from "./render.js";
import { crearElemento, crearEstado, crearEstadoError } from "./ui.js";

const FILAS_SKELETON = 2;
const TARJETAS_SKELETON = 6;

const TITULOS_ERROR = {
  proveedor: "Las recomendaciones no están disponibles por ahora",
};

const estado = {
  pedido: null, // AbortController de la carga en curso
};

const dom = {
  perfil: document.getElementById("recs-perfil"),
  aviso: document.getElementById("recs-aviso"),
  estado: document.getElementById("recs-estado"),
  filas: document.getElementById("recs-filas"),
};

/* ---------- Estados ---------- */

function limpiarEncabezado() {
  dom.perfil.hidden = true;
  dom.perfil.replaceChildren();
  dom.aviso.hidden = true;
  dom.aviso.textContent = "";
}

function mostrarBloque(bloque) {
  limpiarEncabezado();
  dom.filas.removeAttribute("aria-busy");
  dom.filas.replaceChildren(bloque);
}

function crearAcciones(enlaces) {
  return crearElemento("div", { clase: "estado_acciones" }, enlaces.map(([texto, href, clase]) =>
    crearElemento("a", { clase: `btn ${clase}`, texto, atributos: { href } }),
  ));
}

function crearFilaSkeleton() {
  return crearElemento("div", { clase: "recs_fila", atributos: { "aria-hidden": "true" } }, [
    crearElemento("span", { clase: "skeleton skeleton-line skeleton-line--titulo recs_fila-titulo-skeleton" }),
    crearElemento("ul", { clase: "rail" }, Array.from({ length: TARJETAS_SKELETON }, () =>
      crearElemento("li", {}, [crearTarjetaSkeleton()]),
    )),
  ]);
}

function mostrarCargando() {
  limpiarEncabezado();
  dom.estado.textContent = "Armando tus recomendaciones…";
  dom.filas.setAttribute("aria-busy", "true");
  dom.filas.replaceChildren(...Array.from({ length: FILAS_SKELETON }, crearFilaSkeleton));
}

function mostrarVisitante() {
  dom.estado.textContent = "";
  const bloque = crearEstado({
    tipo: "vacio",
    titulo: "Ingresá para ver tus recomendaciones",
    mensaje: "Armamos la lista con los géneros que elegiste y con las películas que guardás en Mis favoritas.",
  });
  bloque.append(crearAcciones([
    ["Ingresar", "login.html?volver=%2Fpages%2Frecomendaciones.html", "btn-primary"],
    ["Crear cuenta", "registro.html", "btn-outline"],
  ]));
  mostrarBloque(bloque);
}

function mostrarSinRecomendaciones() {
  dom.estado.textContent = "";
  const bloque = crearEstado({
    tipo: "vacio",
    titulo: "No encontramos recomendaciones por ahora",
    mensaje: "Mientras tanto, mirá las películas mejor puntuadas y las más populares.",
  });
  bloque.append(crearAcciones([["Ver rankings", "rankings.html", "btn-primary"]]));
  mostrarBloque(bloque);
}

/* ---------- Contenido ---------- */

/** "Armadas con: Drama, Comedia y tus 3 favoritas". Solo si hay datos personales. */
function pintarPerfil({ generos, favoritas, personalizado }) {
  if (!personalizado) return;

  const partes = [crearElemento("span", { texto: "Armadas con" })];
  partes.push(...generos.map((genero) => crearElemento("span", { clase: "badge badge--soft", texto: genero })));
  if (favoritas) {
    const texto = favoritas === 1 ? "tu película favorita" : `tus ${favoritas} películas favoritas`;
    partes.push(crearElemento("span", { texto: generos.length ? `y ${texto}` : texto }));
  }
  dom.perfil.replaceChildren(...partes);
  dom.perfil.hidden = false;
}

/** Avisa cuando la lista no es 100 % personal (flujos A1 y A2). */
function pintarAviso({ perfil, ampliada }) {
  let texto = "";
  if (!perfil.personalizado) {
    texto = "Todavía no tenemos tus gustos, así que te mostramos lo más popular de la semana. Guardá películas en Mis favoritas para recibir recomendaciones a tu medida.";
  } else if (ampliada) {
    texto = "Encontramos pocas coincidencias con tus gustos, así que sumamos lo más popular de la semana.";
  }
  dom.aviso.textContent = texto;
  dom.aviso.hidden = !texto;
}

function crearFila(seccion, indice) {
  const idTitulo = `recs-fila-${indice}`;
  return crearElemento("section", { clase: "recs_fila", atributos: { "aria-labelledby": idTitulo } }, [
    crearElemento("div", { clase: "section_head" }, [
      crearElemento("h2", { texto: seccion.titulo, atributos: { id: idTitulo } }),
    ]),
    // role="list": Safari deja de anunciar como lista a las que tienen list-style: none.
    crearElemento("ul", { clase: "rail", atributos: { role: "list" } }, seccion.resultados.map((pelicula) =>
      crearElemento("li", {}, [crearTarjetaPelicula(pelicula)]),
    )),
  ]);
}

function pintar(datos) {
  if (!datos.secciones.length) {
    mostrarSinRecomendaciones();
    return;
  }

  pintarPerfil(datos.perfil);
  pintarAviso(datos);

  const total = datos.secciones.reduce((suma, seccion) => suma + seccion.resultados.length, 0);
  const filas = datos.secciones.length;
  dom.estado.textContent = `${total} películas recomendadas en ${filas} ${filas === 1 ? "lista" : "listas"}.`;

  dom.filas.removeAttribute("aria-busy");
  dom.filas.replaceChildren(...datos.secciones.map(crearFila));
}

/* ---------- Carga ---------- */

async function cargar() {
  estado.pedido?.abort();
  estado.pedido = new AbortController();
  const { signal } = estado.pedido;
  mostrarCargando();

  try {
    const datos = await api.recomendaciones({ signal });
    pintar(datos);
  } catch (error) {
    if (signal.aborted) return;
    if (error.tipo === "sesion") {
      mostrarVisitante();
      return;
    }
    console.error(error);
    dom.estado.textContent = "No se pudieron cargar las recomendaciones.";
    mostrarBloque(crearEstadoError(error, cargar, TITULOS_ERROR));
  }
}

function alCambiarSesion(usuario) {
  if (usuario) {
    // Los corazones se pintan con la lista de favoritas; si falla, quedan vacíos.
    cargarFavoritas().catch((error) => console.warn("No se pudieron cargar las favoritas:", error.message));
    cargar();
  } else {
    estado.pedido?.abort();
    mostrarVisitante();
  }
}

/* ============================================
   Inicio
   ============================================ */

mostrarCargando();
iniciarFavoritas({ alCambiarSesion });
escucharTarjetas();
iniciarLayout();
