/* ============================================
   layout.js
   Comportamiento común a todas las páginas:
   menú responsive, link activo, cabecera al
   hacer scroll, sesión del usuario y botón del
   chatbot.
   ============================================ */

import { iniciarChatbot } from "./chatbot.js";
import { mostrarToast } from "./ui.js";

const normalizarRuta = (ruta) => ruta.replace(/index\.html$/, "");

const ROLES_ADMINISTRATIVOS = ["administrador", "superadministrador"];

/**
 * Ruta relativa a un archivo del sitio, escrita desde la raíz
 * ("pages/login.html", "admin/dashboard.html"). Funciona igual desde
 * index.html, desde pages/ y desde admin/.
 */
export function rutaSitio(ruta) {
  return /\/(pages|admin)\//.test(window.location.pathname) ? `../${ruta}` : ruta;
}

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

/**
 * Links del menú que dependen de la sesión: "Mis favoritas" (cualquier cuenta)
 * y "Admin" (solo roles administrativos). Se agregan o quitan sin duplicarse.
 */
function mostrarLinkMenu(clave, texto, ruta, visible) {
  const lista = document.querySelector(".navbar_links");
  if (!lista) return;
  const existente = lista.querySelector(`[data-link-sesion="${clave}"]`);
  if (!visible) {
    existente?.remove();
    return;
  }
  if (existente) return;

  const link = document.createElement("a");
  link.href = rutaSitio(ruta);
  link.textContent = texto;
  const item = document.createElement("li");
  item.dataset.linkSesion = clave;
  item.append(link);
  lista.append(item);
  marcarPaginaActual(lista);
}

function mostrarUsuario(usuario) {
  mostrarLinkMenu("favoritas", "Mis favoritas", "pages/favoritas.html", true);
  mostrarLinkMenu("admin", "Admin", "admin/dashboard.html", ROLES_ADMINISTRATIVOS.includes(usuario.rol));
  const acciones = obtenerAccionesSesion();
  if (!acciones) return;

  // El saludo lleva al perfil: ahí se corrigen los datos y se puede eliminar la cuenta.
  const saludo = document.createElement("a");
  saludo.className = "navbar_usuario";
  saludo.href = rutaSitio("pages/perfil.html");
  saludo.textContent = `Hola, ${usuario.nombre}`;
  saludo.title = "Ir a mi perfil";
  if (window.location.pathname.endsWith("/perfil.html")) saludo.setAttribute("aria-current", "page");

  const boton = document.createElement("button");
  boton.className = "btn btn-outline";
  boton.type = "button";
  boton.textContent = "Cerrar sesión";
  boton.addEventListener("click", cerrarSesion);

  acciones.replaceChildren(saludo, boton);
}

function mostrarVisitante() {
  mostrarLinkMenu("favoritas", "", "", false);
  mostrarLinkMenu("admin", "", "", false);
  const acciones = obtenerAccionesSesion();
  if (!acciones) return;

  const ingresar = document.createElement("a");
  ingresar.className = "btn btn-outline";
  ingresar.href = rutaSitio("pages/login.html");
  ingresar.textContent = "Ingresar";

  const registrar = document.createElement("a");
  registrar.className = "btn btn-primary";
  registrar.href = rutaSitio("pages/registro.html");
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

/** Devuelve una promesa con el usuario de la sesión (o null si es un visitante). */
export function iniciarLayout() {
  iniciarMenu();
  iniciarCabecera();
  iniciarChatbot();
  return actualizarSesion();
}
