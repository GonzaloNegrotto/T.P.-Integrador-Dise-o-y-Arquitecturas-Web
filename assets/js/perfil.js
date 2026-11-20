/* ============================================
   perfil.js
   Página Mi perfil (RF15 y Ley 25.326, art. 16):
   - corregir nombre, email, fecha de nacimiento y
     géneros favoritos (rectificación);
   - cambiar la contraseña;
   - eliminar la cuenta (supresión).
   Requiere sesión iniciada. Cambiar el email o la
   contraseña y eliminar la cuenta piden la
   contraseña actual.
   ============================================ */

import { api } from "./api.js";
import { actualizarSesion, iniciarLayout } from "./layout.js";
import { crearElemento, crearEstado, mostrarToast } from "./ui.js";
import { activarBotonesContrasena, crearValidador, evaluarContrasena, reglas } from "./validacion.js";

const MAX_GENEROS = 5;

const estado = {
  usuario: null, // usuario de la sesión, tal como está guardado
  cuentaEliminada: false, // evita mostrar "ingresá" justo después de borrar la cuenta
};

const dom = {
  estado: document.getElementById("perfil-estado"),
  cuenta: document.getElementById("perfil-cuenta"),

  formDatos: document.getElementById("form-datos"),
  campoPasswordEmail: document.getElementById("campo-password-email"),
  contadorGeneros: document.getElementById("contador-generos"),

  formPassword: document.getElementById("form-password"),
  medidor: document.getElementById("fuerza-contrasena"),
  etiquetaFuerza: document.getElementById("fuerza-etiqueta"),
  requisitos: document.querySelectorAll("[data-requisito]"),

  abrirEliminar: document.getElementById("abrir-eliminar"),
  cancelarEliminar: document.getElementById("cancelar-eliminar"),
  formEliminar: document.getElementById("form-eliminar"),
};

/* ============================================
   Validación
   ============================================ */

/** ¿El email escrito es distinto del que tiene la cuenta? Entonces hay que confirmar con la contraseña. */
const cambiaElEmail = () =>
  dom.formDatos.elements.email.value.trim().toLowerCase() !== (estado.usuario?.email ?? "");

const validadorDatos = crearValidador(dom.formDatos, {
  nombre: [
    reglas.requerido("Contanos cómo te llamás."),
    reglas.minLargo(2, "El nombre tiene que tener al menos 2 letras."),
    reglas.maxLargo(40),
    reglas.patron(/^[\p{L}' -]+$/u, "Usá solo letras y espacios."),
  ],
  email: [reglas.requerido("Ingresá tu email."), reglas.email()],
  password_actual: [
    (valor) => !cambiaElEmail() || valor !== "" || "Ingresá tu contraseña actual para cambiar el email.",
  ],
  nacimiento: [
    reglas.requerido("Ingresá tu fecha de nacimiento."),
    reglas.fechaValida(),
    reglas.fechaNoFutura(),
    reglas.edadMinima(13, "Tenés que tener al menos 13 años."),
    reglas.edadMaxima(120),
  ],
  generos: [
    reglas.minSeleccionados(1, "Elegí al menos un género."),
    reglas.maxSeleccionados(MAX_GENEROS, `Podés elegir hasta ${MAX_GENEROS} géneros.`),
  ],
}, { dependencias: { email: ["password_actual"] } });

const validadorPassword = crearValidador(dom.formPassword, {
  password_actual: [reglas.requerido("Ingresá tu contraseña actual.")],
  password_nueva: [
    reglas.requerido("Creá una contraseña nueva."),
    reglas.minLargo(8, "Tiene que tener al menos 8 caracteres."),
    reglas.patron(/[A-ZÁÉÍÓÚÑ]/, "Agregá al menos una letra mayúscula."),
    reglas.patron(/\d/, "Agregá al menos un número."),
    (valor, formulario) =>
      valor !== formulario.elements.password_actual.value || "La contraseña nueva tiene que ser distinta de la actual.",
  ],
  confirmacion: [
    reglas.requerido("Repetí la contraseña nueva."),
    reglas.coincideCon("password_nueva", "Las contraseñas no coinciden."),
  ],
}, { dependencias: { password_nueva: ["confirmacion"], password_actual: ["password_nueva"] } });

const validadorEliminar = crearValidador(dom.formEliminar, {
  password_actual: [reglas.requerido("Ingresá tu contraseña para confirmar.")],
  entiendo: [reglas.marcado("Marcá la casilla para confirmar que entendés que no se puede deshacer.")],
});

/* ============================================
   Estados de la página
   ============================================ */

function mostrarBloque(bloque) {
  dom.cuenta.hidden = true;
  dom.estado.replaceChildren(bloque);
}

function mostrarCargando() {
  mostrarBloque(crearElemento("p", { clase: "text-muted", texto: "Cargando tu perfil…" }));
}

function crearAcciones(enlaces) {
  return crearElemento("div", { clase: "estado_acciones" }, enlaces.map(([texto, href, clase]) =>
    crearElemento("a", { clase: `btn ${clase}`, texto, atributos: { href } }),
  ));
}

function mostrarVisitante() {
  const bloque = crearEstado({
    tipo: "vacio",
    titulo: "Ingresá para ver tu perfil",
    mensaje: "Con tu cuenta podés corregir tus datos, cambiar tus géneros favoritos o eliminarla.",
  });
  bloque.append(crearAcciones([
    ["Ingresar", "login.html?volver=%2Fpages%2Fperfil.html", "btn-primary"],
    ["Crear cuenta", "registro.html", "btn-outline"],
  ]));
  mostrarBloque(bloque);
}

function mostrarCuentaEliminada() {
  const bloque = crearEstado({
    tipo: "exito",
    titulo: "Tu cuenta fue eliminada",
    mensaje: "Borramos tus datos personales y tu lista de favoritas. Gracias por haber usado MediaLens.",
  });
  bloque.append(crearAcciones([["Ir al inicio", "../index.html", "btn-primary"]]));
  mostrarBloque(bloque);
  bloque.setAttribute("tabindex", "-1");
  bloque.focus();
}

function mostrarCuenta() {
  dom.estado.replaceChildren();
  dom.cuenta.hidden = false;
}

/* ============================================
   Formulario de datos
   ============================================ */

function actualizarContadorGeneros() {
  const elegidos = dom.formDatos.querySelectorAll("input[name='generos']:checked").length;
  dom.contadorGeneros.textContent = `${elegidos} de ${MAX_GENEROS} elegidos`;
  dom.contadorGeneros.classList.toggle("is-excedido", elegidos > MAX_GENEROS);
}

/** La contraseña actual solo se pide cuando se cambió el email. */
function actualizarCampoPasswordEmail() {
  const necesaria = cambiaElEmail();
  dom.campoPasswordEmail.hidden = !necesaria;
  if (necesaria) return;

  // Se oculta: se vacía y se borra cualquier error que haya quedado a la vista.
  const input = dom.formDatos.elements.password_actual;
  input.value = "";
  dom.campoPasswordEmail.classList.remove("is-invalid", "is-valid");
  dom.campoPasswordEmail.querySelector(".field-error")?.remove();
  input.removeAttribute("aria-invalid");
  input.setAttribute("aria-describedby", input.dataset.describedbyBase || "ayuda-password-email");
}

function rellenarDatos(usuario) {
  const { elements } = dom.formDatos;
  elements.nombre.value = usuario.nombre;
  elements.email.value = usuario.email;
  elements.nacimiento.value = usuario.fecha_nacimiento;
  elements.password_actual.value = "";
  for (const casilla of dom.formDatos.querySelectorAll("input[name='generos']")) {
    casilla.checked = usuario.generos.includes(casilla.value);
  }
  validadorDatos.reiniciar();
  actualizarContadorGeneros();
  actualizarCampoPasswordEmail();
}

/** Bloquea el botón mientras se espera la respuesta del servidor. */
async function conBotonOcupado(boton, textoOcupado, tarea) {
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.classList.add("is-loading");
  boton.textContent = textoOcupado;
  try {
    return await tarea();
  } finally {
    boton.disabled = false;
    boton.classList.remove("is-loading");
    boton.textContent = textoOriginal;
  }
}

/** Errores comunes: si la sesión venció se muestra el estado de visitante. */
function manejarError(error) {
  if (error.tipo === "sesion") {
    estado.usuario = null;
    mostrarVisitante();
    return;
  }
  mostrarToast(error.message, { tipo: "error" });
}

dom.formDatos.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!validadorDatos.validarTodo()) {
    mostrarToast("Revisá los campos marcados en rojo.", { tipo: "error" });
    return;
  }

  const datos = new FormData(dom.formDatos);
  const boton = dom.formDatos.querySelector("[type='submit']");
  try {
    await conBotonOcupado(boton, "Guardando…", () =>
      api.actualizarPerfil({
        nombre: datos.get("nombre"),
        email: datos.get("email"),
        nacimiento: datos.get("nacimiento"),
        generos: datos.getAll("generos"),
        password_actual: datos.get("password_actual"),
      }),
    );
    mostrarToast("Cambios guardados.", { tipo: "exito" });
    // Vuelve a pedir la sesión: actualiza el saludo del encabezado y el formulario.
    await actualizarSesion();
  } catch (error) {
    manejarError(error);
  }
});

/* ============================================
   Cambio de contraseña
   ============================================ */

function actualizarMedidor() {
  const { puntaje, etiqueta, requisitos: cumplidos } = evaluarContrasena(dom.formPassword.elements.password_nueva.value);
  dom.medidor.dataset.nivel = puntaje;
  dom.etiquetaFuerza.textContent = etiqueta ? `Seguridad: ${etiqueta}` : "";
  for (const item of dom.requisitos) {
    const ok = cumplidos[item.dataset.requisito];
    item.classList.toggle("is-ok", ok);
    item.querySelector(".visually-hidden").textContent = ok ? "(cumplido)" : "(pendiente)";
  }
}

dom.formPassword.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!validadorPassword.validarTodo()) {
    mostrarToast("Revisá los campos marcados en rojo.", { tipo: "error" });
    return;
  }

  const boton = dom.formPassword.querySelector("[type='submit']");
  try {
    await conBotonOcupado(boton, "Cambiando…", () =>
      api.cambiarPassword({
        password_actual: dom.formPassword.elements.password_actual.value,
        password_nueva: dom.formPassword.elements.password_nueva.value,
      }),
    );
    dom.formPassword.reset();
    validadorPassword.reiniciar();
    actualizarMedidor();
    mostrarToast("Contraseña actualizada.", { tipo: "exito" });
  } catch (error) {
    manejarError(error);
  }
});

/* ============================================
   Eliminar la cuenta
   ============================================ */

function abrirEliminar(abierto) {
  dom.formEliminar.hidden = !abierto;
  dom.abrirEliminar.hidden = abierto;
  dom.abrirEliminar.setAttribute("aria-expanded", String(abierto));
  if (abierto) {
    dom.formEliminar.elements.password_actual.focus();
  } else {
    dom.formEliminar.reset();
    validadorEliminar.reiniciar();
    dom.abrirEliminar.focus();
  }
}

dom.abrirEliminar.addEventListener("click", () => abrirEliminar(true));
dom.cancelarEliminar.addEventListener("click", () => abrirEliminar(false));

dom.formEliminar.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!validadorEliminar.validarTodo()) return;

  const boton = dom.formEliminar.querySelector("[type='submit']");
  try {
    await conBotonOcupado(boton, "Eliminando…", () =>
      api.eliminarCuenta(dom.formEliminar.elements.password_actual.value),
    );
    estado.cuentaEliminada = true;
    mostrarCuentaEliminada();
    await actualizarSesion(); // el servidor cerró la sesión: el encabezado vuelve a mostrar Ingresar
  } catch (error) {
    manejarError(error);
  }
});

/* ============================================
   Sesión e inicio
   ============================================ */

document.addEventListener("sesion:cambio", ({ detail: { usuario } }) => {
  if (estado.cuentaEliminada) return;
  estado.usuario = usuario;
  if (!usuario) {
    mostrarVisitante();
    return;
  }
  rellenarDatos(usuario);
  mostrarCuenta();
});

dom.formDatos.addEventListener("input", (evento) => {
  if (evento.target.name === "email") actualizarCampoPasswordEmail();
});
dom.formDatos.addEventListener("change", (evento) => {
  if (evento.target.name === "generos") actualizarContadorGeneros();
});
dom.formPassword.elements.password_nueva.addEventListener("input", actualizarMedidor);

activarBotonesContrasena(document);
actualizarMedidor();
mostrarCargando();
iniciarLayout();
