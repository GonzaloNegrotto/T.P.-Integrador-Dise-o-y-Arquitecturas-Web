/* ============================================
   cines.js
   Página "Cines cercanos" (RF08, RF10, CU04).
   Obtiene una ubicación (GPS del navegador o una
   dirección escrita), pide los cines al servidor y
   los muestra en una lista y en un mapa (Leaflet).
   ============================================ */

import { api } from "./api.js";
import { iniciarLayout } from "./layout.js";
import { crearElemento, crearEstado, crearEstadoError } from "./ui.js";
import { crearValidador, reglas } from "./validacion.js";

const CENTRO_INICIAL = [-34.6037, -58.3816]; // Obelisco, Ciudad de Buenos Aires
const RADIOS_KM = [2, 5, 10];
const TITULOS_MAPA = { proveedor: "El servicio de mapas no está respondiendo" };
const formatoKm = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

const estado = {
  origen: null, // { lat, lon, nombre }: punto desde donde se busca
  radio: 5,
  cines: [],
  limiteAlcanzado: false,
  pedido: null, // AbortController de la búsqueda en curso
};

const dom = {
  botonUbicacion: document.getElementById("usar-ubicacion"),
  form: document.getElementById("form-ubicacion"),
  input: document.getElementById("direccion"),
  chipsRadio: document.querySelectorAll("[data-radio]"),
  estadoTexto: document.getElementById("cines-estado"),
  lista: document.getElementById("lista-cines"),
  contenedorMapa: document.getElementById("mapa"),
};

/* ============================================
   1. Mapa (Leaflet)
   ============================================ */

// Leaflet se carga desde un CDN. Si no está disponible, la página sigue
// funcionando solo con la lista.
const hayMapa = typeof window.L !== "undefined";
let mapa = null;
let capaCines = null;
let marcadorOrigen = null;
let circuloRadio = null;
const marcadores = new Map(); // id del cine → marcador del mapa

function iniciarMapa() {
  if (!hayMapa) {
    dom.contenedorMapa.classList.add("is-sin-mapa");
    dom.contenedorMapa.replaceChildren(crearEstado({
      tipo: "error",
      titulo: "No se pudo cargar el mapa",
      mensaje: "Podés seguir usando la lista de cines.",
    }));
    return;
  }

  mapa = L.map(dom.contenedorMapa, { scrollWheelZoom: false }).setView(CENTRO_INICIAL, 12);
  // Mapas de OpenStreetMap: gratuitos, sin clave, con la mención de la fuente.
  // Se oscurecen con un filtro CSS (ver .leaflet-tile-pane en components.css).
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; colaboradores de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa);
  capaCines = L.layerGroup().addTo(mapa);

  // La rueda del mouse hace zoom recién después de hacer clic en el mapa:
  // así el mapa no "atrapa" el scroll de la página.
  mapa.on("click", () => mapa.scrollWheelZoom.enable());
  mapa.on("mouseout", () => mapa.scrollWheelZoom.disable());
}

function mostrarOrigenEnMapa() {
  if (!hayMapa) return;
  const { lat, lon } = estado.origen;
  marcadorOrigen?.remove();
  circuloRadio?.remove();

  marcadorOrigen = L.marker([lat, lon], {
    icon: L.divIcon({ className: "marcador-origen", iconSize: [18, 18] }),
    title: "Punto de búsqueda",
    keyboard: false,
    zIndexOffset: 1000,
  }).addTo(mapa);
  circuloRadio = L.circle([lat, lon], {
    radius: estado.radio * 1000,
    color: "#C49A5A",
    weight: 1.5,
    fillColor: "#C49A5A",
    fillOpacity: 0.06,
    interactive: false,
  }).addTo(mapa);
  mapa.fitBounds(circuloRadio.getBounds(), { padding: [16, 16] });
}

function crearPopup(cine) {
  // El contenido se arma con el DOM (no con HTML en texto): los nombres vienen
  // de OpenStreetMap y así se evita que se ejecute código ajeno.
  return crearElemento("div", { clase: "popup-cine" }, [
    crearElemento("strong", { texto: cine.nombre }),
    crearElemento("span", { texto: `${formatearDistancia(cine.distancia_km)} · ${describirUbicacion(cine)}` }),
    cine.web && crearElemento("a", {
      texto: "Cartelera y reservas ↗",
      atributos: { href: cine.web, target: "_blank", rel: "noopener noreferrer" },
    }),
  ]);
}

function mostrarCinesEnMapa() {
  if (!hayMapa) return;
  capaCines.clearLayers();
  marcadores.clear();
  estado.cines.forEach((cine, i) => {
    const marcador = L.marker([cine.lat, cine.lon], {
      icon: L.divIcon({
        className: "marcador-cine",
        html: `<span>${i + 1}</span>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -14],
      }),
      title: cine.nombre,
      riseOnHover: true,
    });
    marcador.bindPopup(crearPopup(cine));
    marcador.on("click", () => resaltarEnLista(cine.id));
    marcador.addTo(capaCines);
    marcadores.set(cine.id, marcador);
  });
}

/** Borra la búsqueda anterior (lista, marcadores y círculo) para no mostrar datos viejos. */
function limpiarBusquedaAnterior() {
  estado.pedido?.abort();
  estado.origen = null;
  estado.cines = [];
  capaCines?.clearLayers();
  marcadores.clear();
  marcadorOrigen?.remove();
  circuloRadio?.remove();
}

function verEnMapa(id) {
  const marcador = marcadores.get(id);
  if (!marcador) return;
  mapa.flyTo(marcador.getLatLng(), Math.max(mapa.getZoom(), 15), { duration: 0.6 });
  marcador.openPopup();
  resaltarEnLista(id);
  // En celular el mapa está arriba de la lista: se lleva la vista hasta él.
  if (window.matchMedia("(max-width: 960px)").matches) {
    dom.contenedorMapa.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

/* ============================================
   2. Lista de cines
   ============================================ */

function formatearDistancia(km) {
  return km < 1 ? `${Math.round(km * 100) * 10} m` : `${formatoKm.format(km)} km`;
}

function describirUbicacion(cine) {
  return [cine.direccion, cine.zona].filter(Boolean).join(" · ") || "Dirección no disponible";
}

function urlComoLlegar(cine) {
  const parametros = new URLSearchParams({ api: "1", destination: `${cine.lat},${cine.lon}` });
  if (estado.origen) parametros.set("origin", `${estado.origen.lat},${estado.origen.lon}`);
  return `https://www.google.com/maps/dir/?${parametros}`;
}

function crearTarjetaCine(cine, posicion) {
  const acciones = [
    hayMapa && crearElemento("button", {
      clase: "btn btn-ghost btn-sm",
      texto: "Ver en el mapa",
      atributos: { type: "button" },
      datos: { accion: "mapa" },
    }),
    crearElemento("a", {
      clase: "btn btn-outline btn-sm",
      texto: "Cómo llegar ↗",
      atributos: { href: urlComoLlegar(cine), target: "_blank", rel: "noopener noreferrer" },
    }),
    // RF10: el botón lleva al sitio del cine; la reserva no se hace en MediaLens.
    // CU04-A4: si el cine no tiene sitio web, se muestran solo sus datos.
    cine.web
      ? crearElemento("a", {
          clase: "btn btn-primary btn-sm",
          texto: "Cartelera y reservas ↗",
          atributos: { href: cine.web, target: "_blank", rel: "noopener noreferrer" },
        })
      : crearElemento("span", { clase: "cine_sin-web", texto: "Sin sitio web de reservas" }),
  ];

  return crearElemento("li", { clase: "cine", datos: { cineId: cine.id } }, [
    crearElemento("span", { clase: "cine_numero", texto: posicion, atributos: { "aria-hidden": "true" } }),
    crearElemento("div", { clase: "cine_cuerpo" }, [
      crearElemento("h2", { clase: "cine_nombre", texto: cine.nombre }),
      crearElemento("p", { clase: "cine_meta" }, [
        crearElemento("span", { clase: "cine_distancia", texto: formatearDistancia(cine.distancia_km) }),
        crearElemento("span", { texto: describirUbicacion(cine) }),
      ]),
      cine.telefono && crearElemento("p", { clase: "cine_telefono" }, [
        crearElemento("a", {
          texto: `Tel. ${cine.telefono}`,
          atributos: { href: `tel:${cine.telefono.replace(/[^\d+]/g, "")}` },
        }),
      ]),
      crearElemento("div", { clase: "cine_acciones" }, acciones),
    ]),
  ]);
}

function crearTarjetaSkeleton() {
  return crearElemento("li", { clase: "cine cine--skeleton", atributos: { "aria-hidden": "true" } }, [
    crearElemento("span", { clase: "cine_numero skeleton" }),
    crearElemento("div", { clase: "cine_cuerpo" }, [
      crearElemento("span", { clase: "skeleton skeleton-line skeleton-line--corta" }),
      crearElemento("span", { clase: "skeleton skeleton-line" }),
      crearElemento("span", { clase: "skeleton skeleton-line skeleton-line--corta" }),
    ]),
  ]);
}

/** Muestra un bloque de estado (vacío o error) en lugar de la lista. */
function mostrarEnLista(bloque) {
  dom.lista.removeAttribute("aria-busy");
  dom.lista.replaceChildren(crearElemento("li", { clase: "cines_lista-estado" }, [bloque]));
}

function resaltarEnLista(id) {
  for (const item of dom.lista.querySelectorAll(".cine")) {
    item.classList.toggle("is-activo", item.dataset.cineId === id);
  }
  dom.lista.querySelector(`[data-cine-id="${CSS.escape(id)}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/** Texto de la línea de estado (se lee en voz alta en lectores de pantalla). */
function avisar(texto) {
  dom.estadoTexto.textContent = texto;
}

function avisarResultados() {
  const cantidad = estado.cines.length === 1 ? "1 cine" : `${estado.cines.length} cines`;
  let texto = `${cantidad} a menos de ${estado.radio} km de ${estado.origen.nombre}.`;
  if (estado.limiteAlcanzado) texto += " Hay muchos resultados: elegí una distancia menor para verlos todos.";
  avisar(texto);
}

/* ============================================
   3. Búsqueda de cines
   ============================================ */

async function cargarCines() {
  if (!estado.origen) return;
  estado.pedido?.abort(); // si había una búsqueda anterior en curso, se cancela
  const pedido = new AbortController();
  estado.pedido = pedido;
  const { lat, lon } = estado.origen;

  avisar(`Buscando cines cerca de ${estado.origen.nombre}…`);
  dom.lista.setAttribute("aria-busy", "true");
  dom.lista.replaceChildren(...Array.from({ length: 4 }, crearTarjetaSkeleton));
  capaCines?.clearLayers();
  mostrarOrigenEnMapa();

  try {
    const respuesta = await api.cines(lat, lon, estado.radio, { signal: pedido.signal });
    estado.cines = respuesta.cines;
    estado.limiteAlcanzado = respuesta.limite_alcanzado;

    if (!estado.cines.length) {
      mostrarSinResultados();
      return;
    }
    dom.lista.removeAttribute("aria-busy");
    dom.lista.replaceChildren(...estado.cines.map((cine, i) => crearTarjetaCine(cine, i + 1)));
    mostrarCinesEnMapa();
    avisarResultados();
  } catch (error) {
    if (pedido.signal.aborted) return; // la reemplazó una búsqueda más nueva
    console.error(error);
    estado.cines = [];
    avisar("No se pudieron cargar los cines.");
    mostrarEnLista(crearEstadoError(error, cargarCines, TITULOS_MAPA)); // CU04-A3
  }
}

function mostrarSinResultados() {
  // CU04-A2: no hay cines; se ofrece ampliar la distancia si se puede.
  const siguiente = RADIOS_KM.find((radio) => radio > estado.radio);
  avisar(`No hay cines a menos de ${estado.radio} km de ${estado.origen.nombre}.`);
  mostrarEnLista(crearEstado({
    tipo: "vacio",
    titulo: "No encontramos cines cerca",
    mensaje: siguiente ? `Probá ampliando la búsqueda a ${siguiente} km.` : "Probá con otra dirección o barrio.",
    textoAccion: siguiente ? `Buscar hasta ${siguiente} km` : null,
    alAccionar: siguiente ? () => cambiarRadio(siguiente) : null,
  }));
}

function cambiarRadio(radio) {
  estado.radio = radio;
  for (const chip of dom.chipsRadio) {
    chip.setAttribute("aria-pressed", String(Number(chip.dataset.radio) === radio));
  }
  if (estado.origen) cargarCines();
}

/* ============================================
   4. Ubicación: GPS del navegador o dirección escrita
   ============================================ */

const MENSAJES_GPS = {
  1: "No diste permiso para usar tu ubicación. Podés escribir una dirección o un barrio.",
  2: "No pudimos determinar tu ubicación. Probá escribiendo una dirección o un barrio.",
  3: "Se agotó el tiempo para obtener tu ubicación. Probá de nuevo o escribí una dirección.",
};

function botonCargando(boton, cargando) {
  boton.disabled = cargando;
  boton.classList.toggle("is-loading", cargando);
}

function usarMiUbicacion() {
  if (!("geolocation" in navigator)) {
    avisar("Tu navegador no permite obtener la ubicación. Escribí una dirección o un barrio.");
    dom.input.focus();
    return;
  }

  botonCargando(dom.botonUbicacion, true);
  avisar("Obteniendo tu ubicación… Si el navegador lo pregunta, aceptá compartirla.");

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      botonCargando(dom.botonUbicacion, false);
      const { latitude: lat, longitude: lon } = coords;
      estado.origen = { lat, lon, nombre: "tu ubicación" };
      dom.input.value = "";
      cargarCines();

      // Se busca el nombre del barrio para mostrar "cerca de Palermo" en lugar
      // de "cerca de tu ubicación". Si falla, no pasa nada.
      api.ubicacionInversa(lat, lon)
        .then(({ nombre }) => {
          if (estado.origen?.lat !== lat || estado.origen?.lon !== lon) return;
          estado.origen.nombre = nombre;
          if (estado.cines.length && !dom.lista.hasAttribute("aria-busy")) avisarResultados();
        })
        .catch(() => {});
    },
    (error) => {
      // CU04-A1: sin permiso (u otro problema), se ofrece escribir la dirección.
      botonCargando(dom.botonUbicacion, false);
      avisar(MENSAJES_GPS[error.code] ?? MENSAJES_GPS[2]);
      dom.input.focus();
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
  );
}

const validador = crearValidador(dom.form, {
  direccion: [
    reglas.requerido("Escribí una dirección o un barrio."),
    reglas.minLargo(3, "Escribí al menos 3 caracteres."),
    reglas.maxLargo(120, "La dirección es demasiado larga (máximo 120 caracteres)."),
  ],
}, { validarAlSalir: false });

async function buscarDireccion(evento) {
  evento.preventDefault();
  if (!validador.validarTodo()) return;

  const consulta = dom.input.value.trim();
  const boton = dom.form.querySelector("[type='submit']");
  dom.input.blur(); // en celular, cierra el teclado
  botonCargando(boton, true);
  avisar(`Buscando “${consulta}”…`);

  try {
    const { lugares } = await api.ubicacion(consulta);
    if (!lugares.length) {
      limpiarBusquedaAnterior();
      avisar(`No encontramos “${consulta}”.`);
      mostrarEnLista(crearEstado({
        tipo: "vacio",
        titulo: "No encontramos esa dirección",
        mensaje: "Revisá cómo está escrita o agregá la ciudad (por ejemplo: Corrientes 1500, CABA).",
      }));
      return;
    }
    const [lugar] = lugares;
    estado.origen = { lat: lugar.lat, lon: lugar.lon, nombre: `“${consulta}”` };
    cargarCines();
  } catch (error) {
    console.error(error);
    limpiarBusquedaAnterior();
    avisar("No se pudo buscar la dirección.");
    mostrarEnLista(crearEstadoError(error, () => dom.form.requestSubmit(), TITULOS_MAPA));
  } finally {
    botonCargando(boton, false);
  }
}

/* ============================================
   5. Eventos e inicio
   ============================================ */

dom.botonUbicacion.addEventListener("click", usarMiUbicacion);
dom.form.addEventListener("submit", buscarDireccion);

for (const chip of dom.chipsRadio) {
  chip.addEventListener("click", () => cambiarRadio(Number(chip.dataset.radio)));
}

// Delegación: un solo listener para los botones "Ver en el mapa" de todas las tarjetas.
dom.lista.addEventListener("click", (evento) => {
  const boton = evento.target.closest("[data-accion='mapa']");
  if (boton) verEnMapa(boton.closest("[data-cine-id]").dataset.cineId);
});

iniciarLayout();
iniciarMapa();
mostrarEnLista(crearEstado({
  tipo: "vacio",
  titulo: "¿Desde dónde buscamos?",
  mensaje: "Usá tu ubicación o escribí una dirección o un barrio para ver los cines cercanos.",
}));
