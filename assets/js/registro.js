/* ============================================
   registro.js
   Formulario de creación de cuenta con validación
   en vivo, medidor de contraseña y contador de
   géneros elegidos.
   ============================================ */

import { decorarConPosters } from "./auth-decoracion.js";
import { iniciarLayout } from "./layout.js";
import { crearElemento, crearEstado, mostrarToast } from "./ui.js";
import { activarBotonesContrasena, crearValidador, evaluarContrasena, reglas } from "./validacion.js";

const MAX_GENEROS = 5;

const formulario = document.getElementById("form-registro");
const tarjeta = document.getElementById("tarjeta-registro");
const botonEnviar = formulario.querySelector("[type='submit']");
const campoContrasena = document.getElementById("registro-password");
const medidor = document.getElementById("fuerza-contrasena");
const etiquetaFuerza = document.getElementById("fuerza-etiqueta");
const requisitos = document.querySelectorAll("[data-requisito]");
const contadorGeneros = document.getElementById("contador-generos");

const validador = crearValidador(formulario, {
  nombre: [
    reglas.requerido("Contanos cómo te llamás."),
    reglas.minLargo(2, "El nombre tiene que tener al menos 2 letras."),
    reglas.maxLargo(40),
    reglas.patron(/^[\p{L}' -]+$/u, "Usá solo letras y espacios."),
  ],
  email: [
    reglas.requerido("Ingresá tu email."),
    reglas.email(),
  ],
  password: [
    reglas.requerido("Creá una contraseña."),
    reglas.minLargo(8, "Tiene que tener al menos 8 caracteres."),
    reglas.patron(/[A-ZÁÉÍÓÚÑ]/, "Agregá al menos una letra mayúscula."),
    reglas.patron(/\d/, "Agregá al menos un número."),
  ],
  confirmacion: [
    reglas.requerido("Repetí la contraseña."),
    reglas.coincideCon("password", "Las contraseñas no coinciden."),
  ],
  nacimiento: [
    reglas.requerido("Ingresá tu fecha de nacimiento."),
    reglas.fechaValida(),
    reglas.fechaNoFutura(),
    reglas.edadMinima(13, "Tenés que tener al menos 13 años para registrarte."),
    reglas.edadMaxima(120),
  ],
  generos: [
    reglas.minSeleccionados(1, "Elegí al menos un género."),
    reglas.maxSeleccionados(MAX_GENEROS, `Podés elegir hasta ${MAX_GENEROS} géneros.`),
  ],
  terminos: [
    reglas.marcado("Tenés que aceptar los términos para crear la cuenta."),
  ],
}, { dependencias: { password: ["confirmacion"] } });

/* ---------- Medidor de contraseña ---------- */

function actualizarMedidor() {
  const { puntaje, etiqueta, requisitos: cumplidos } = evaluarContrasena(campoContrasena.value);
  medidor.dataset.nivel = puntaje;
  etiquetaFuerza.textContent = etiqueta ? `Seguridad: ${etiqueta}` : "";

  for (const item of requisitos) {
    const ok = cumplidos[item.dataset.requisito];
    item.classList.toggle("is-ok", ok);
    item.querySelector(".visually-hidden").textContent = ok ? "(cumplido)" : "(pendiente)";
  }
}

/* ---------- Contador de géneros ---------- */

function actualizarContadorGeneros() {
  const elegidos = formulario.querySelectorAll("input[name='generos']:checked").length;
  contadorGeneros.textContent = `${elegidos} de ${MAX_GENEROS} elegidos`;
  contadorGeneros.classList.toggle("is-excedido", elegidos > MAX_GENEROS);
}

/* ---------- Envío ---------- */

function mostrarExito(datos) {
  const generos = datos.getAll("generos");
  const exito = crearEstado({
    tipo: "exito",
    titulo: `¡Listo, ${datos.get("nombre").trim()}! Tu cuenta fue creada.`,
    mensaje: `Vamos a recomendarte películas de ${generos.join(", ")}.`,
  });
  exito.append(
    crearElemento("div", { clase: "estado_acciones" }, [
      crearElemento("a", { clase: "btn btn-primary", texto: "Ir al inicio", atributos: { href: "../index.html" } }),
      crearElemento("a", { clase: "btn btn-outline", texto: "Iniciar sesión", atributos: { href: "login.html" } }),
    ]),
    crearElemento("p", {
      clase: "estado_detalle",
      texto: "Tu cuenta quedó guardada de forma segura en el servidor.",
    }),
  );

  // El formulario se elimina y en su lugar queda el mensaje de éxito.
  tarjeta.replaceChildren(exito);
  exito.setAttribute("tabindex", "-1");
  exito.focus();
}

formulario.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  if (!validador.validarTodo()) {
    mostrarToast("Revisá los campos marcados en rojo.", { tipo: "error" });
    return;
  }

  const datos = new FormData(formulario);
  botonEnviar.disabled = true;
  botonEnviar.classList.add("is-loading");
  botonEnviar.textContent = "Creando cuenta…";

  try {
    const respuesta = await fetch("/api/auth/registro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: datos.get("nombre"),
        email: datos.get("email"),
        password: datos.get("password"),
        nacimiento: datos.get("nacimiento"),
        generos: datos.getAll("generos"),
      }),
    });
    const resultado = await respuesta.json();
    if (!respuesta.ok) throw new Error(resultado.error || "No se pudo crear la cuenta.");
    mostrarExito(datos);
  } catch (error) {
    mostrarToast(error.message, { tipo: "error" });
    botonEnviar.disabled = false;
    botonEnviar.classList.remove("is-loading");
    botonEnviar.textContent = "Crear cuenta";
  }
});

/* ---------- Inicio ---------- */

iniciarLayout();
activarBotonesContrasena(formulario);
campoContrasena.addEventListener("input", actualizarMedidor);
formulario.addEventListener("change", (evento) => {
  if (evento.target.name === "generos") actualizarContadorGeneros();
});
actualizarMedidor();
actualizarContadorGeneros();
decorarConPosters();
