/* ============================================
   login.js
   Formulario de ingreso: validación, mostrar /
   ocultar contraseña y "Recordarme" (guarda solo
   el email en este navegador).
   ============================================ */

import { decorarConPosters } from "./auth-decoracion.js";
import { iniciarLayout } from "./layout.js";
import { crearElemento, crearEstado, esperar, mostrarToast } from "./ui.js";
import { activarBotonesContrasena, crearValidador, reglas } from "./validacion.js";

const CLAVE_EMAIL = "medialens:email-recordado";

const formulario = document.getElementById("form-login");
const tarjeta = document.getElementById("tarjeta-login");
const botonEnviar = formulario.querySelector("[type='submit']");
const campoEmail = document.getElementById("login-email");
const casillaRecordar = document.getElementById("login-recordar");
const botonOlvido = document.getElementById("olvide-contrasena");

const validador = crearValidador(formulario, {
  email: [
    reglas.requerido("Ingresá tu email."),
    reglas.email(),
  ],
  password: [
    reglas.requerido("Ingresá tu contraseña."),
  ],
});

/* ---------- Recordarme ---------- */
// localStorage puede estar bloqueado (modo privado, permisos): por eso el try/catch.

function leerEmailRecordado() {
  try {
    return localStorage.getItem(CLAVE_EMAIL);
  } catch {
    return null;
  }
}

function guardarEmailRecordado(email) {
  try {
    if (email) localStorage.setItem(CLAVE_EMAIL, email);
    else localStorage.removeItem(CLAVE_EMAIL);
  } catch {
    // Si no se puede guardar, simplemente no se recuerda.
  }
}

/* ---------- Envío ---------- */

formulario.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!validador.validarTodo()) return;

  const email = campoEmail.value.trim();
  guardarEmailRecordado(casillaRecordar.checked ? email : null);

  botonEnviar.disabled = true;
  botonEnviar.classList.add("is-loading");
  botonEnviar.textContent = "Ingresando…";
  await esperar(800); // simula la demora de un servidor real

  const exito = crearEstado({
    tipo: "exito",
    titulo: "¡Hola de nuevo!",
    mensaje: `Ingresaste como ${email}.`,
  });
  exito.append(
    crearElemento("div", { clase: "estado_acciones" }, [
      crearElemento("a", { clase: "btn btn-primary", texto: "Ir al inicio", atributos: { href: "../index.html" } }),
    ]),
    crearElemento("p", {
      clase: "estado_detalle",
      texto: "Versión de demostración: la autenticación real se conecta en una próxima entrega.",
    }),
  );
  tarjeta.replaceChildren(exito);
  exito.setAttribute("tabindex", "-1");
  exito.focus();
});

botonOlvido.addEventListener("click", () => {
  mostrarToast("La recuperación de contraseña va a estar disponible en una próxima entrega.");
});

/* ---------- Inicio ---------- */

iniciarLayout();
activarBotonesContrasena(formulario);

const emailRecordado = leerEmailRecordado();
if (emailRecordado) {
  campoEmail.value = emailRecordado;
  casillaRecordar.checked = true;
}

decorarConPosters();
