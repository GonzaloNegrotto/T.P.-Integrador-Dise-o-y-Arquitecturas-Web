/* ============================================
   validacion.js
   Validación de formularios reutilizable.

   Cada campo tiene una lista de reglas. Una regla
   es una función que recibe el valor y devuelve
   true si está bien, o un texto con el error.

   Los mensajes de error se crean y se eliminan del
   DOM junto a cada campo, y se enlazan con
   aria-describedby para los lectores de pantalla.
   ============================================ */

import { crearElemento } from "./ui.js";

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function calcularEdad(fecha) {
  const hoy = new Date();
  let edad = hoy.getFullYear() - fecha.getFullYear();
  const cumpleEsteAnio = new Date(hoy.getFullYear(), fecha.getMonth(), fecha.getDate());
  if (hoy < cumpleEsteAnio) edad -= 1;
  return edad;
}

/** "2001-05-20" → Date local (sin corrimiento por zona horaria). */
function leerFecha(valor) {
  const [anio, mes, dia] = valor.split("-").map(Number);
  const fecha = new Date(anio, mes - 1, dia);
  const esValida = fecha.getFullYear() === anio && fecha.getMonth() === mes - 1 && fecha.getDate() === dia;
  return esValida ? fecha : null;
}

export const reglas = {
  requerido: (mensaje = "Este campo es obligatorio.") => (valor) =>
    String(valor).trim() !== "" || mensaje,

  email: (mensaje = "Ingresá un email válido, por ejemplo nombre@mail.com.") => (valor) =>
    REGEX_EMAIL.test(valor.trim()) || mensaje,

  minLargo: (minimo, mensaje) => (valor) =>
    valor.trim().length >= minimo || mensaje || `Tiene que tener al menos ${minimo} caracteres.`,

  maxLargo: (maximo, mensaje) => (valor) =>
    valor.trim().length <= maximo || mensaje || `Puede tener como máximo ${maximo} caracteres.`,

  patron: (regex, mensaje) => (valor) => regex.test(valor) || mensaje,

  coincideCon: (otroCampo, mensaje) => (valor, formulario) =>
    valor === formulario.elements[otroCampo].value || mensaje,

  fechaValida: (mensaje = "Ingresá una fecha válida.") => (valor) =>
    leerFecha(valor) !== null || mensaje,

  fechaNoFutura: (mensaje = "La fecha no puede ser posterior a hoy.") => (valor) => {
    const fecha = leerFecha(valor);
    return !fecha || fecha <= new Date() || mensaje;
  },

  edadMinima: (anios, mensaje) => (valor) => {
    const fecha = leerFecha(valor);
    return !fecha || calcularEdad(fecha) >= anios || mensaje || `Tenés que tener al menos ${anios} años.`;
  },

  edadMaxima: (anios, mensaje = "Revisá el año de nacimiento.") => (valor) => {
    const fecha = leerFecha(valor);
    return !fecha || calcularEdad(fecha) <= anios || mensaje;
  },

  // Para grupos de checkboxes: el valor es la lista de opciones marcadas.
  minSeleccionados: (minimo, mensaje) => (valores) => valores.length >= minimo || mensaje,
  maxSeleccionados: (maximo, mensaje) => (valores) => valores.length <= maximo || mensaje,

  // Para un checkbox solo: el valor es true / false.
  marcado: (mensaje = "Tenés que marcar esta opción.") => (valor) => valor === true || mensaje,
};

/**
 * Conecta un formulario con sus reglas.
 *
 * esquema: { nombreDelCampo: [regla, regla, ...] }
 * opciones.dependencias: { campo: ["otroCampo"] } → si cambia "campo",
 *   se vuelve a validar "otroCampo" (ej: contraseña → confirmación).
 * opciones.validarAlSalir: valida cuando el foco sale del campo.
 */
export function crearValidador(formulario, esquema, { dependencias = {}, validarAlSalir = true } = {}) {
  const tocados = new Set();

  const controles = (nombre) => {
    const campo = formulario.elements[nombre];
    return campo instanceof RadioNodeList ? [...campo] : [campo];
  };

  const contenedor = (nombre) =>
    formulario.querySelector(`[data-campo="${nombre}"]`) ?? controles(nombre)[0].parentElement;

  function obtenerValor(nombre) {
    const lista = controles(nombre);
    if (lista.length > 1) return lista.filter((c) => c.checked).map((c) => c.value);
    const [control] = lista;
    return control.type === "checkbox" ? control.checked : control.value;
  }

  // Los mensajes se enlazan al campo (o al fieldset, en los grupos).
  function destinoAria(nombre) {
    const lista = controles(nombre);
    return lista.length > 1 ? [contenedor(nombre)] : lista;
  }

  function mostrarError(nombre, mensaje) {
    const caja = contenedor(nombre);
    caja.classList.add("is-invalid");
    caja.classList.remove("is-valid");

    let error = caja.querySelector(".field-error");
    if (!error) {
      error = crearElemento("p", { clase: "field-error", atributos: { id: `error-${formulario.id}-${nombre}` } });
      caja.append(error);
    }
    error.textContent = mensaje;

    for (const control of destinoAria(nombre)) {
      control.dataset.describedbyBase ??= control.getAttribute("aria-describedby") ?? "";
      control.setAttribute("aria-invalid", "true");
      control.setAttribute("aria-describedby", `${control.dataset.describedbyBase} ${error.id}`.trim());
    }
  }

  function limpiarError(nombre, { marcarValido = true } = {}) {
    const caja = contenedor(nombre);
    caja.classList.remove("is-invalid");
    caja.classList.toggle("is-valid", marcarValido);
    caja.querySelector(".field-error")?.remove();

    for (const control of destinoAria(nombre)) {
      control.removeAttribute("aria-invalid");
      const base = control.dataset.describedbyBase;
      if (base) control.setAttribute("aria-describedby", base);
      else control.removeAttribute("aria-describedby");
    }
  }

  function validarCampo(nombre) {
    const valor = obtenerValor(nombre);
    for (const regla of esquema[nombre]) {
      const resultado = regla(valor, formulario);
      if (resultado !== true) {
        mostrarError(nombre, resultado);
        return false;
      }
    }
    limpiarError(nombre);
    return true;
  }

  function revalidarDependientes(nombre) {
    for (const dependiente of dependencias[nombre] ?? []) {
      if (tocados.has(dependiente)) validarCampo(dependiente);
    }
  }

  /* --- Eventos --- */

  // focusout es como blur pero "burbujea": un solo listener sirve para todo el form.
  formulario.addEventListener("focusout", (evento) => {
    const { name, type } = evento.target;
    if (!validarAlSalir || !(name in esquema) || type === "checkbox") return;
    tocados.add(name);
    validarCampo(name);
  });

  // Mientras escribe: si el campo ya mostró un error, se revalida en vivo
  // para que el mensaje desaparezca apenas se corrige.
  formulario.addEventListener("input", (evento) => {
    const { name, type } = evento.target;
    if (!(name in esquema) || type === "checkbox") return;
    if (tocados.has(name)) validarCampo(name);
    revalidarDependientes(name);
  });

  formulario.addEventListener("change", (evento) => {
    const { name, type } = evento.target;
    if (!(name in esquema) || type !== "checkbox") return;
    tocados.add(name);
    validarCampo(name);
  });

  return {
    validarCampo,

    /** Valida todo, enfoca el primer campo con error y devuelve true/false. */
    validarTodo() {
      let primeroInvalido = null;
      for (const nombre of Object.keys(esquema)) {
        tocados.add(nombre);
        if (!validarCampo(nombre) && !primeroInvalido) primeroInvalido = controles(nombre)[0];
      }
      primeroInvalido?.focus();
      return primeroInvalido === null;
    },

    reiniciar() {
      tocados.clear();
      for (const nombre of Object.keys(esquema)) limpiarError(nombre, { marcarValido: false });
    },
  };
}

/**
 * Qué tan segura es una contraseña, de 0 a 4.
 * Devuelve también qué requisitos cumple, para marcarlos en pantalla.
 */
export function evaluarContrasena(valor) {
  const requisitos = {
    largo: valor.length >= 8,
    mayuscula: /[A-ZÁÉÍÓÚÑ]/.test(valor),
    numero: /\d/.test(valor),
    simbolo: /[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]/.test(valor),
  };

  let puntaje = Object.values(requisitos).filter(Boolean).length;
  if (valor.length >= 12) puntaje += 1;
  if (!requisitos.largo) puntaje = Math.min(puntaje, 1);
  puntaje = Math.min(puntaje, 4);

  const etiquetas = ["Muy débil", "Débil", "Aceptable", "Buena", "Excelente"];
  return { puntaje: valor ? puntaje : 0, etiqueta: valor ? etiquetas[puntaje] : "", requisitos };
}

/** Botones "Mostrar / Ocultar" de los campos de contraseña. */
export function activarBotonesContrasena(raiz = document) {
  for (const boton of raiz.querySelectorAll("[data-mostrar-contrasena]")) {
    const campo = document.getElementById(boton.getAttribute("aria-controls"));
    boton.addEventListener("click", () => {
      const visible = campo.type === "text";
      campo.type = visible ? "password" : "text";
      boton.setAttribute("aria-pressed", String(!visible));
      boton.textContent = visible ? "Mostrar" : "Ocultar";
      campo.focus();
    });
  }
}
