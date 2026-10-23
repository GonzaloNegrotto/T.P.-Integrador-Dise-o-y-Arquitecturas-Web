/* ============================================
   layout.js
   Comportamiento común a todas las páginas:
   menú responsive, link activo, cabecera al
   hacer scroll, sesión del usuario y botón del
   chatbot.
   ============================================ */

import { mostrarToast } from "./ui.js";

const normalizarRuta = (ruta) => ruta.replace(/index\.html$/, "");

function obtenerAccionesSesion() {
  return document.querySelector(".navbar_actions");
}

/**
 * Avisa a la página que cambió la sesión (inició, cerró o se consultó).
 * Las páginas que dependen de la cuenta, como Mis favoritas, escuchan este evento.
 */
function avisarCambioDeSesion(usuario) {
  document.dispatchEvent(new CustomEvent("sesion:cambio", { detail: { usuario } }));
}

/** El link "Mis favoritas" del menú solo existe con la sesión iniciada. */
function mostrarLinkFavoritas(visible) {
  const lista = document.querySelector(".navbar_links");
  if (!lista) return;
  const existente = lista.querySelector("[data-link-favoritas]");
  if (!visible) {
    existente?.remove();
    return;
  }
  if (existente) return;

  const enPagina = window.location.pathname.includes("/pages/");
  const link = document.createElement("a");
  link.href = enPagina ? "favoritas.html" : "pages/favoritas.html";
  link.textContent = "Mis favoritas";
  const item = document.createElement("li");
  item.dataset.linkFavoritas = "";
  item.append(link);
  lista.append(item);
  marcarPaginaActual(lista);
}

function mostrarUsuario(usuario) {
  mostrarLinkFavoritas(true);
  const acciones = obtenerAccionesSesion();
  if (!acciones) return;

  const saludo = document.createElement("span");
  saludo.className = "navbar_usuario";
  saludo.textContent = `Hola, ${usuario.nombre}`;

  const boton = document.createElement("button");
  boton.className = "btn btn-outline";
  boton.type = "button";
  boton.textContent = "Cerrar sesión";
  boton.addEventListener("click", cerrarSesion);

  acciones.replaceChildren(saludo, boton);
}

function mostrarVisitante() {
  mostrarLinkFavoritas(false);
  const acciones = obtenerAccionesSesion();
  if (!acciones) return;
  const enPagina = window.location.pathname.includes("/pages/");

  const ingresar = document.createElement("a");
  ingresar.className = "btn btn-outline";
  ingresar.href = enPagina ? "login.html" : "pages/login.html";
  ingresar.textContent = "Ingresar";

  const registrar = document.createElement("a");
  registrar.className = "btn btn-primary";
  registrar.href = enPagina ? "registro.html" : "pages/registro.html";
  registrar.textContent = "Registrarse";

  acciones.replaceChildren(ingresar, registrar);
}

async function cerrarSesion() {
  try {
    const respuesta = await fetch("/api/auth/logout", { method: "POST" });
    if (!respuesta.ok) throw new Error("No se pudo cerrar la sesión.");
    mostrarVisitante();
    avisarCambioDeSesion(null);
    mostrarToast("Sesión cerrada correctamente.", { tipo: "exito" });
  } catch (error) {
    mostrarToast(error.message, { tipo: "error" });
  }
}

export async function actualizarSesion() {
  try {
    const respuesta = await fetch("/api/auth/me");
    if (respuesta.status === 401) {
      mostrarVisitante();
      avisarCambioDeSesion(null);
      return null;
    }
    if (!respuesta.ok) throw new Error("No se pudo consultar la sesión.");
    const datos = await respuesta.json();
    mostrarUsuario(datos.usuario);
    avisarCambioDeSesion(datos.usuario);
    return datos.usuario;
  } catch (error) {
    // La navegación pública no se rompe si el backend está apagado.
    console.warn(error.message);
    avisarCambioDeSesion(null);
    return null;
  }
}

/** Marca el link de la página actual (clase + aria-current). */
function marcarPaginaActual(menu) {
  if (!menu) return;
  const actual = normalizarRuta(window.location.pathname);
  for (const link of menu.querySelectorAll(".navbar_links a")) {
    const esActual = normalizarRuta(new URL(link.href).pathname) === actual;
    link.classList.toggle("is-active", esActual);
    if (esActual) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

function iniciarMenu() {
  const boton = document.querySelector(".navbar_toggle");
  const menu = document.getElementById("menu-principal");
  if (!boton || !menu) return;

  marcarPaginaActual(menu);

  const estaAbierto = () => menu.classList.contains("is-open");

  function abrir() {
    menu.classList.add("is-open");
    boton.setAttribute("aria-expanded", "true");
    boton.setAttribute("aria-label", "Cerrar menú");
    boton.textContent = "✕";
  }

  function cerrar() {
    menu.classList.remove("is-open");
    boton.setAttribute("aria-expanded", "false");
    boton.setAttribute("aria-label", "Abrir menú");
    boton.textContent = "☰";
  }

  boton.addEventListener("click", () => (estaAbierto() ? cerrar() : abrir()));

  // Tocar un link del menú lo cierra (en celular, si no, tapa la página).
  menu.addEventListener("click", (evento) => {
    if (evento.target.closest("a")) cerrar();
  });

  // Escape cierra y devuelve el foco al botón.
  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && estaAbierto()) {
      cerrar();
      boton.focus();
    }
  });

  // Clic fuera del menú lo cierra.
  document.addEventListener("click", (evento) => {
    if (estaAbierto() && !menu.contains(evento.target) && !boton.contains(evento.target)) cerrar();
  });

  // Si se agranda la ventana a tamaño escritorio, el menú desplegable no tiene sentido.
  const escritorio = window.matchMedia("(min-width: 961px)"); // mismo corte que layout.css
  escritorio.addEventListener("change", (evento) => {
    if (evento.matches) cerrar();
  });
}

function iniciarCabecera() {
  const cabecera = document.querySelector(".site-header");
  if (!cabecera) return;
  const actualizar = () => cabecera.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", actualizar, { passive: true });
  actualizar();
}

function iniciarChatbot() {
  const boton = document.querySelector(".chatbot-toggle");
  boton?.addEventListener("click", () => {
    mostrarToast("El asistente de MediaLens va a estar disponible en una próxima entrega.");
  });
}

/** Devuelve una promesa con el usuario de la sesión (o null si es un visitante). */
export function iniciarLayout() {
  iniciarMenu();
  iniciarCabecera();
  iniciarChatbot();
  return actualizarSesion();
}
