/* ============================================
   mis-favoritas.js
   Página Mis favoritas: lista las películas que
   guardó el usuario, con filtro por género y
   orden. Si quita una, la tarjeta desaparece.
   ============================================ */

import { cargarFavoritas, iniciarFavoritas } from "./favoritas.js";
import { actualizarSesion, iniciarLayout } from "./layout.js";
import { escucharTarjetas } from "./modal.js";
import { crearTarjetaPelicula, crearTarjetaSkeleton } from "./render.js";
import { crearElemento, crearEstado, crearEstadoError } from "./ui.js";

const CANTIDAD_SKELETON = 6;

const estado = {
  favoritas: [], // tal como las devuelve el servidor
  filtroGenero: null, // nombre del género o null (todas)
  orden: "recientes",
  pedido: null, // AbortController de la carga en curso
};

const dom = {
  herramientas: document.getElementById("favoritas-herramientas"),
  generos: document.getElementById("filtro-generos"),
  orden: document.getElementById("orden-favoritas"),
  aviso: document.getElementById("favoritas-estado"),
  grilla: document.getElementById("grilla-favoritas"),
};

const comparar = new Intl.Collator("es", { sensitivity: "base" }).compare;

const ORDENES = {
  recientes: (a, b) => (b.agregada_en ?? "").localeCompare(a.agregada_en ?? ""),
  puntaje: (a, b) => b.puntaje - a.puntaje,
  titulo: (a, b) => comparar(a.titulo, b.titulo),
  anio: (a, b) => (Number(b.anio) || 0) - (Number(a.anio) || 0),
};

/* ---------- Estados de la grilla ---------- */

function mostrarBloque(bloque) {
  dom.herramientas.hidden = true;
  dom.grilla.classList.add("is-estado");
  dom.grilla.removeAttribute("aria-busy");
  dom.grilla.replaceChildren(bloque);
}

function crearAcciones(enlaces) {
  return crearElemento("div", { clase: "estado_acciones" }, enlaces.map(([texto, href, clase]) =>
    crearElemento("a", { clase: `btn ${clase}`, texto, atributos: { href } }),
  ));
}

function mostrarCargando() {
  dom.aviso.textContent = "Cargando tus favoritas…";
  dom.grilla.classList.remove("is-estado");
  dom.grilla.setAttribute("aria-busy", "true");
  dom.grilla.replaceChildren(...Array.from({ length: CANTIDAD_SKELETON }, crearTarjetaSkeleton));
}

function mostrarVisitante() {
  dom.aviso.textContent = "";
  const bloque = crearEstado({
    tipo: "vacio",
    titulo: "Ingresá para ver tus favoritas",
    mensaje: "Con tu cuenta podés guardar las películas que querés ver y encontrarlas acá cuando vuelvas.",
  });
  bloque.append(crearAcciones([
    ["Ingresar", "login.html?volver=%2Fpages%2Ffavoritas.html", "btn-primary"],
    ["Crear cuenta", "registro.html", "btn-outline"],
  ]));
  mostrarBloque(bloque);
}

function mostrarListaVacia() {
  dom.aviso.textContent = "Todavía no guardaste películas.";
  const bloque = crearEstado({
    tipo: "vacio",
    titulo: "Todavía no guardaste películas",
    mensaje: "Tocá el ♥ de cualquier película para sumarla a tu lista.",
  });
  bloque.append(crearAcciones([["Explorar tendencias", "../index.html#tendencias", "btn-primary"]]));
  mostrarBloque(bloque);
}

/* ---------- Filtro por género ---------- */

/** Géneros presentes en la lista, del más repetido al menos repetido. */
function contarGeneros() {
  const cuenta = new Map();
  for (const favorita of estado.favoritas) {
    for (const genero of favorita.generos) cuenta.set(genero, (cuenta.get(genero) ?? 0) + 1);
  }
  return [...cuenta].sort((a, b) => b[1] - a[1] || comparar(a[0], b[0]));
}

function crearChip(texto, valor) {
  return crearElemento("button", {
    clase: "chip",
    texto,
    atributos: { type: "button", "aria-pressed": String(estado.filtroGenero === valor) },
    datos: { genero: valor ?? "" },
  });
}

function renderizarGeneros() {
  const generos = contarGeneros();
  // Si se quitó la última película del género elegido, el filtro se limpia solo.
  if (estado.filtroGenero && !generos.some(([nombre]) => nombre === estado.filtroGenero)) {
    estado.filtroGenero = null;
  }
  dom.generos.replaceChildren(
    crearChip("Todas", null),
    ...generos.map(([nombre, cantidad]) => crearChip(`${nombre} (${cantidad})`, nombre)),
  );
}

/* ---------- Lista ---------- */

function renderizar() {
  if (!estado.favoritas.length) {
    mostrarListaVacia();
    return;
  }

  renderizarGeneros();
  dom.herramientas.hidden = false;

  const visibles = estado.favoritas
    .filter((f) => !estado.filtroGenero || f.generos.includes(estado.filtroGenero))
    .sort(ORDENES[estado.orden]);

  const total = estado.favoritas.length;
  const palabra = total === 1 ? "película guardada" : "películas guardadas";
  dom.aviso.textContent = estado.filtroGenero
    ? `${visibles.length} de ${total} ${palabra} son de ${estado.filtroGenero}.`
    : `${total} ${palabra}.`;

  dom.grilla.classList.remove("is-estado");
  dom.grilla.removeAttribute("aria-busy");
  dom.grilla.replaceChildren(...visibles.map(crearTarjetaPelicula));
}

async function cargar() {
  estado.pedido?.abort();
  estado.pedido = new AbortController();
  const { signal } = estado.pedido;
  mostrarCargando();

  try {
    estado.favoritas = await cargarFavoritas({ signal });
    renderizar();
  } catch (error) {
    if (signal.aborted) return;
    if (error.tipo === "sesion") {
      mostrarVisitante();
      return;
    }
    console.error(error);
    dom.aviso.textContent = "No se pudieron cargar tus favoritas.";
    // Reintentar vuelve a consultar la sesión: si responde, se carga la lista.
    mostrarBloque(crearEstadoError(error, () => {
      mostrarCargando();
      actualizarSesion();
    }));
  }
}

function alCambiarSesion(usuario) {
  if (usuario) cargar();
  else {
    estado.pedido?.abort();
    estado.favoritas = [];
    mostrarVisitante();
  }
}

/* ---------- Eventos ---------- */

// Se guardó o quitó una favorita (desde una tarjeta, el detalle o "Deshacer").
document.addEventListener("favoritas:cambio", ({ detail }) => {
  const sinEsta = estado.favoritas.filter((f) => f.id !== detail.id);
  estado.favoritas = detail.guardada && detail.favorita ? [...sinEsta, detail.favorita] : sinEsta;
  renderizar();
});

dom.generos.addEventListener("click", (evento) => {
  const chip = evento.target.closest("[data-genero]");
  if (!chip) return;
  estado.filtroGenero = chip.dataset.genero || null;
  renderizar();
});

dom.orden.addEventListener("change", () => {
  estado.orden = dom.orden.value;
  renderizar();
});

/* ---------- Inicio ---------- */

mostrarCargando();
iniciarFavoritas({ alCambiarSesion });
escucharTarjetas();
iniciarLayout();
