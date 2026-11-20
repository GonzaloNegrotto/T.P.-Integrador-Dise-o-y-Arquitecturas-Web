/* ============================================
   admin.js
   Panel de administración: cuentas (rol y
   bloqueo), auditoría y caché. Solo para los
   roles administrador y superadministrador.
   Las reglas de permisos se aplican en el
   servidor; acá se replican para deshabilitar
   lo que no se puede hacer y explicar por qué.
   ============================================ */

import { api } from "./api.js";
import { iniciarLayout, rutaSitio } from "./layout.js";
import { confirmar } from "./modal.js";
import { crearElemento, crearEstado, crearEstadoError, mostrarToast } from "./ui.js";

const ROLES_ADMINISTRATIVOS = ["administrador", "superadministrador"];
const LIMITE_AUDITORIA = 50;
const ESPERA_BUSQUEDA_MS = 300;
const URL_LOGIN = rutaSitio(`pages/login.html?volver=${encodeURIComponent("/admin/dashboard.html")}`);

const formatoFecha = new Intl.DateTimeFormat("es-AR", { dateStyle: "short" });
const formatoFechaHora = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });

const estado = {
  actor: null, // usuario con la sesión iniciada
  roles: [], // [{ nombre, descripcion }]
  usuarios: [],
  pedidoUsuarios: null, // AbortController de la búsqueda en curso
  temporizador: null,
};

const dom = {
  rol: document.getElementById("admin-rol"),
  acceso: document.getElementById("admin-acceso"),
  contenido: document.getElementById("admin-contenido"),
  formUsuarios: document.getElementById("form-usuarios"),
  buscador: document.getElementById("buscar-usuarios"),
  estadoUsuarios: document.getElementById("usuarios-estado"),
  filasUsuarios: document.getElementById("filas-usuarios"),
  estadoAuditoria: document.getElementById("auditoria-estado"),
  filasAuditoria: document.getElementById("filas-auditoria"),
  botonAuditoria: document.getElementById("actualizar-auditoria"),
  botonCache: document.getElementById("vaciar-cache"),
};

const esSuperadmin = () => estado.actor?.rol === "superadministrador";

/* ---------- Utilidades ---------- */

/** Una fila que ocupa toda la tabla, para estados (cargando, vacío, error). */
function mostrarEnTabla(tbody, columnas, contenido) {
  tbody.replaceChildren(
    crearElemento("tr", { clase: "admin_fila-estado" }, [
      crearElemento("td", { atributos: { colspan: columnas } }, [contenido]),
    ]),
  );
}

function celda(etiqueta, hijos, clase) {
  // data-label: en celular cada fila se muestra como tarjeta y la celda lleva su título.
  return crearElemento("td", { clase, datos: { label: etiqueta } }, hijos);
}

function fecha(iso, formato = formatoFecha) {
  return iso ? formato.format(new Date(iso)) : "—";
}

/** Por qué no se puede tocar una cuenta (null si se puede). Mismas reglas que el servidor. */
function motivoBloqueo(usuario) {
  if (usuario.id === estado.actor.id) return "Es tu cuenta: no podés cambiar tu rol ni bloquearla.";
  if (!esSuperadmin() && usuario.rol === "superadministrador") {
    return "Solo un superadministrador puede modificar a otro superadministrador.";
  }
  return null;
}

/* ---------- Usuarios ---------- */

function crearSelectRol(usuario, motivo) {
  const select = crearElemento("select", {
    clase: "admin_rol",
    atributos: { "aria-label": `Rol de ${usuario.nombre}`, disabled: Boolean(motivo), title: motivo },
    datos: { usuarioId: usuario.id, anterior: usuario.rol },
  }, estado.roles.map((rol) => crearElemento("option", {
    texto: rol.nombre,
    atributos: {
      value: rol.nombre,
      selected: rol.nombre === usuario.rol,
      // Un administrador no puede dar el rol superadministrador.
      disabled: rol.nombre === "superadministrador" && !esSuperadmin() && usuario.rol !== rol.nombre,
    },
  })));
  return select;
}

function crearFilaUsuario(usuario) {
  const motivo = motivoBloqueo(usuario);
  const bloqueada = usuario.estado === "bloqueado";
  const propia = usuario.id === estado.actor.id;

  const accion = motivo
    ? crearElemento("span", { clase: "admin_nota", texto: propia ? "Tu cuenta" : "Protegida", atributos: { title: motivo } })
    : crearElemento("button", {
        clase: `btn btn-sm ${bloqueada ? "btn-outline" : "btn-danger"}`,
        texto: bloqueada ? "Desbloquear" : "Bloquear",
        atributos: { type: "button", "aria-label": `${bloqueada ? "Desbloquear" : "Bloquear"} a ${usuario.nombre}` },
        datos: { cambiarEstado: bloqueada ? "activo" : "bloqueado", usuarioId: usuario.id },
      });

  return crearElemento("tr", { datos: { usuarioId: usuario.id } }, [
    celda("Nombre", [
      crearElemento("span", { clase: "admin_nombre", texto: usuario.nombre }),
      propia && crearElemento("span", { clase: "badge badge--soft", texto: "Vos" }),
    ]),
    celda("Email", [crearElemento("span", { clase: "admin_email", texto: usuario.email })]),
    celda("Rol", [crearSelectRol(usuario, motivo)]),
    celda("Estado", [crearElemento("span", {
      clase: `admin_estado admin_estado--${usuario.estado}`,
      texto: bloqueada ? "Bloqueado" : "Activo",
    })]),
    celda("Alta", [fecha(usuario.creado_en)]),
    celda("Acciones", [accion], "admin_acciones"),
  ]);
}

function renderizarUsuarios() {
  const consulta = dom.buscador.value.trim();
  if (!estado.usuarios.length) {
    dom.estadoUsuarios.textContent = "";
    mostrarEnTabla(dom.filasUsuarios, 6, crearEstado({
      tipo: "vacio",
      titulo: consulta ? `No hay cuentas que coincidan con «${consulta}»` : "Todavía no hay cuentas registradas",
      mensaje: consulta ? "Probá con otra parte del nombre o del email." : null,
    }));
    return;
  }
  const cantidad = estado.usuarios.length;
  dom.estadoUsuarios.textContent = `${cantidad} ${cantidad === 1 ? "cuenta" : "cuentas"}${consulta ? ` para «${consulta}»` : ""}.`;
  dom.filasUsuarios.replaceChildren(...estado.usuarios.map(crearFilaUsuario));
}

async function cargarUsuarios() {
  estado.pedidoUsuarios?.abort();
  estado.pedidoUsuarios = new AbortController();
  const { signal } = estado.pedidoUsuarios;

  dom.estadoUsuarios.textContent = "Cargando cuentas…";
  dom.filasUsuarios.setAttribute("aria-busy", "true");
  try {
    const { usuarios } = await api.adminUsuarios(dom.buscador.value.trim(), { signal });
    estado.usuarios = usuarios;
    renderizarUsuarios();
  } catch (error) {
    if (signal.aborted) return;
    manejarError(error);
    dom.estadoUsuarios.textContent = "No se pudieron cargar las cuentas.";
    mostrarEnTabla(dom.filasUsuarios, 6, crearEstadoError(error, cargarUsuarios));
  } finally {
    if (!signal.aborted) dom.filasUsuarios.removeAttribute("aria-busy");
  }
}

/** Reemplaza los datos de una cuenta y vuelve a dibujar solo su fila. */
function actualizarUsuario(cambios) {
  const indice = estado.usuarios.findIndex((u) => u.id === cambios.id);
  if (indice === -1) return null;
  estado.usuarios[indice] = { ...estado.usuarios[indice], rol: cambios.rol, estado: cambios.estado };
  const fila = dom.filasUsuarios.querySelector(`tr[data-usuario-id="${cambios.id}"]`);
  const nueva = crearFilaUsuario(estado.usuarios[indice]);
  fila?.replaceWith(nueva);
  return nueva;
}

async function cambiarRol(select) {
  const usuario = estado.usuarios.find((u) => u.id === Number(select.dataset.usuarioId));
  const rolNuevo = select.value;
  const anterior = select.dataset.anterior;

  if (rolNuevo === "superadministrador") {
    const ok = await confirmar({
      titulo: "Dar rol superadministrador",
      mensaje: `${usuario.nombre} va a tener control total: podrá administrar a otros superadministradores.`,
      textoConfirmar: "Asignar rol",
      disparador: select,
    });
    if (!ok) {
      select.value = anterior;
      return;
    }
  }

  select.disabled = true;
  try {
    const { usuario: actualizado } = await api.asignarRol(usuario.id, rolNuevo);
    const fila = actualizarUsuario(actualizado);
    fila?.querySelector("select")?.focus();
    mostrarToast(`${usuario.nombre} ahora tiene el rol ${actualizado.rol}.`, { tipo: "exito" });
    cargarAuditoria();
  } catch (error) {
    select.value = anterior;
    select.disabled = false;
    manejarError(error);
    mostrarToast(error.message, { tipo: "error" });
  }
}

async function cambiarEstado(boton) {
  const usuario = estado.usuarios.find((u) => u.id === Number(boton.dataset.usuarioId));
  const nuevo = boton.dataset.cambiarEstado;
  const bloquear = nuevo === "bloqueado";

  const ok = await confirmar({
    titulo: bloquear ? "Bloquear cuenta" : "Desbloquear cuenta",
    mensaje: bloquear
      ? `${usuario.nombre} (${usuario.email}) no va a poder ingresar y se cerrará su sesión.`
      : `${usuario.nombre} (${usuario.email}) va a poder volver a ingresar.`,
    textoConfirmar: bloquear ? "Bloquear" : "Desbloquear",
    peligroso: bloquear,
    disparador: boton,
  });
  if (!ok) return;

  boton.disabled = true;
  try {
    const { usuario: actualizado } = await api.cambiarEstado(usuario.id, nuevo);
    const fila = actualizarUsuario(actualizado);
    fila?.querySelector("[data-cambiar-estado]")?.focus();
    mostrarToast(`La cuenta de ${usuario.nombre} quedó ${bloquear ? "bloqueada" : "activa"}.`, { tipo: "exito" });
    cargarAuditoria();
  } catch (error) {
    boton.disabled = false;
    manejarError(error);
    mostrarToast(error.message, { tipo: "error" });
  }
}

/* ---------- Auditoría ---------- */

/** Texto legible para el campo detalle (es JSON y cambia según la acción). */
function describirDetalle(entrada) {
  const d = entrada.detalle || {};
  const partes = [];
  if (d.rol) partes.push(d.rol_anterior ? `${d.rol_anterior} → ${d.rol}` : `rol ${d.rol}`);
  else if (d.rol_id) partes.push(`rol n.º ${d.rol_id}`);
  if (Array.isArray(d.campos)) partes.push(`campos: ${d.campos.join(", ")}`);
  if (typeof d.entradas === "number") partes.push(`${d.entradas} ${d.entradas === 1 ? "entrada" : "entradas"}`);
  if (d.origen === "consola") partes.push("desde la consola");
  else if (d.origen) partes.push(`desde ${d.origen}`);
  return partes.join(" · ") || "—";
}

function describirActor(entrada) {
  if (entrada.actor) return entrada.actor;
  if (entrada.detalle?.origen === "consola") return "Consola";
  if (entrada.accion === "eliminar cuenta") return "La propia cuenta";
  return "—";
}

function crearFilaAuditoria(entrada) {
  return crearElemento("tr", {}, [
    celda("Fecha", [fecha(entrada.fecha, formatoFechaHora)]),
    celda("Quién", [crearElemento("span", { clase: "admin_email", texto: describirActor(entrada) })]),
    celda("Acción", [entrada.accion]),
    celda("Sobre", [entrada.entidad_id ? `${entrada.entidad} n.º ${entrada.entidad_id}` : entrada.entidad]),
    celda("Detalle", [describirDetalle(entrada)]),
  ]);
}

async function cargarAuditoria() {
  dom.estadoAuditoria.textContent = "Cargando…";
  dom.filasAuditoria.setAttribute("aria-busy", "true");
  try {
    const { auditoria } = await api.adminAuditoria(LIMITE_AUDITORIA);
    if (!auditoria.length) {
      dom.estadoAuditoria.textContent = "";
      mostrarEnTabla(dom.filasAuditoria, 5, crearEstado({ tipo: "vacio", titulo: "Todavía no hay acciones registradas" }));
      return;
    }
    dom.estadoAuditoria.textContent = `Últimas ${auditoria.length} acciones.`;
    dom.filasAuditoria.replaceChildren(...auditoria.map(crearFilaAuditoria));
  } catch (error) {
    manejarError(error);
    dom.estadoAuditoria.textContent = "No se pudo cargar la auditoría.";
    mostrarEnTabla(dom.filasAuditoria, 5, crearEstadoError(error, cargarAuditoria));
  } finally {
    dom.filasAuditoria.removeAttribute("aria-busy");
  }
}

/* ---------- Caché ---------- */

async function vaciarCache() {
  const ok = await confirmar({
    titulo: "Vaciar la caché",
    mensaje: "Las próximas consultas van a pedir los datos de nuevo a TMDB, por lo que tardarán un poco más.",
    textoConfirmar: "Vaciar caché",
    peligroso: true,
    disparador: dom.botonCache,
  });
  if (!ok) return;

  dom.botonCache.disabled = true;
  try {
    const { entradas_eliminadas: cantidad } = await api.vaciarCache();
    mostrarToast(`Caché vaciada: se eliminaron ${cantidad} ${cantidad === 1 ? "entrada" : "entradas"}.`, { tipo: "exito" });
    cargarAuditoria();
  } catch (error) {
    manejarError(error);
    mostrarToast(error.message, { tipo: "error" });
  } finally {
    dom.botonCache.disabled = false;
  }
}

/* ---------- Acceso ---------- */

function irAlLogin() {
  window.location.replace(URL_LOGIN);
}

/** Si la sesión se perdió (o la cuenta se bloqueó) en medio del uso, se vuelve al login. */
function manejarError(error) {
  console.error(error);
  if (error.tipo === "sesion") irAlLogin();
}

function mostrarAcceso(bloque, textoCabecera) {
  dom.rol.textContent = textoCabecera;
  dom.contenido.hidden = true;
  dom.acceso.replaceChildren(bloque);
}

function mostrarSinPermisos() {
  const bloque = crearEstado({
    tipo: "error",
    titulo: "No tenés permisos para ver esta página",
    mensaje: "El panel de administración es solo para cuentas con rol administrador o superadministrador.",
  });
  bloque.append(crearElemento("div", { clase: "estado_acciones" }, [
    crearElemento("a", { clase: "btn btn-primary", texto: "Volver al inicio", atributos: { href: rutaSitio("index.html") } }),
  ]));
  mostrarAcceso(bloque, "Tu cuenta no tiene permisos de administración.");
}

/** iniciarLayout() devuelve null tanto sin sesión como con el servidor apagado: acá se distinguen. */
async function resolverSinUsuario() {
  let respuesta = null;
  try {
    respuesta = await fetch("/api/auth/me");
  } catch {
    // Sin conexión: se muestra el error abajo.
  }
  if (respuesta && [401, 403].includes(respuesta.status)) {
    irAlLogin();
    return;
  }
  mostrarAcceso(crearEstado({
    tipo: "error",
    titulo: "No se pudo verificar tu sesión",
    mensaje: "Verificá que el servidor esté funcionando y volvé a intentar.",
    textoAccion: "Reintentar",
    alAccionar: () => window.location.reload(),
  }), "No se pudo verificar tus permisos.");
}

/* ---------- Eventos e inicio ---------- */

function registrarEventos() {
  dom.formUsuarios.addEventListener("submit", (evento) => {
    evento.preventDefault();
    clearTimeout(estado.temporizador);
    cargarUsuarios();
  });
  // Búsqueda mientras se escribe, esperando a que se deje de tipear.
  dom.buscador.addEventListener("input", () => {
    clearTimeout(estado.temporizador);
    estado.temporizador = setTimeout(cargarUsuarios, ESPERA_BUSQUEDA_MS);
  });

  // Delegación: las filas se vuelven a crear después de cada cambio.
  dom.filasUsuarios.addEventListener("change", (evento) => {
    if (evento.target.matches("select.admin_rol")) cambiarRol(evento.target);
  });
  dom.filasUsuarios.addEventListener("click", (evento) => {
    const boton = evento.target.closest("[data-cambiar-estado]");
    if (boton) cambiarEstado(boton);
  });

  dom.botonAuditoria.addEventListener("click", cargarAuditoria);
  dom.botonCache.addEventListener("click", vaciarCache);

  // Si se cierra la sesión desde el menú, el panel deja de estar disponible.
  document.addEventListener("sesion:cambio", ({ detail }) => {
    if (estado.actor && !detail.usuario) irAlLogin();
  });
}

async function iniciar() {
  const usuario = await iniciarLayout();
  if (!usuario) {
    await resolverSinUsuario();
    return;
  }
  if (!ROLES_ADMINISTRATIVOS.includes(usuario.rol)) {
    mostrarSinPermisos();
    return;
  }

  estado.actor = usuario;
  dom.rol.textContent = esSuperadmin()
    ? "Ingresaste como superadministrador: podés administrar todas las cuentas."
    : "Ingresaste como administrador: podés administrar las cuentas, salvo las de superadministradores.";
  dom.contenido.hidden = false;
  registrarEventos();
  cargarAuditoria();

  // Los roles hacen falta para dibujar el selector de cada fila.
  mostrarEnTabla(dom.filasUsuarios, 6, crearEstado({ tipo: "vacio", titulo: "Cargando cuentas…" }));
  try {
    ({ roles: estado.roles } = await api.adminRoles());
  } catch (error) {
    manejarError(error);
    mostrarEnTabla(dom.filasUsuarios, 6, crearEstadoError(error, () => window.location.reload()));
    return;
  }
  cargarUsuarios();
}

iniciar();
