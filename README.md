# MediaLens

Plataforma web para buscar, comparar y descubrir películas: tendencias, rankings, estadísticas, recomendaciones
personalizadas, lista de favoritas y cines cercanos. Los datos de películas vienen de la API de
[TMDB](https://www.themoviedb.org) y las cuentas se guardan en una base PostgreSQL.

Trabajo Práctico Integrador de **Diseño y Arquitecturas Web**, Universidad Abierta Interamericana (Sede Centro,
comisión 4-J). Docente: Gustavo Emanuel Escandell.

**Integrantes:** Luján Netri · Gonzalo Cusmai · Gonzalo Negrotto

---

## 1. Requisitos

| Herramienta | Versión | Para qué |
| --- | --- | --- |
| [Python](https://www.python.org/downloads/) | 3.12 | Servidor (Flask) |
| [Git](https://git-scm.com/downloads) | cualquiera reciente | Clonar el repositorio |
| PostgreSQL | cualquier versión actual | Base de datos. Puede ser [Neon](https://neon.tech) (en la nube, gratis) o una instalación local |
| Cuenta en TMDB | — | Token de acceso a la API de películas (gratis) |

El frontend es HTML, CSS y JavaScript sin frameworks: no hace falta Node ni ningún paso de compilación.

## 2. Instalación paso a paso

Los comandos se ejecutan desde una terminal. En cada paso está la versión para **Windows (PowerShell)** y para
**Linux / macOS** cuando cambia.

### 2.1. Clonar el repositorio

```bash
git clone https://github.com/GonzaloNegrotto/T.P.-Integrador-Dise-o-y-Arquitecturas-Web.git
cd T.P.-Integrador-Dise-o-y-Arquitecturas-Web
```

### 2.2. Crear y activar el entorno virtual

Windows (PowerShell):

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

Linux / macOS:

```bash
python3 -m venv venv
source venv/bin/activate
```

Con el entorno activo, la terminal muestra `(venv)` al principio de la línea. **Todos los comandos siguientes se
ejecutan con el entorno activo y desde la raíz del proyecto.**

### 2.3. Instalar las dependencias

```bash
pip install -r requirements.txt
```

### 2.4. Configurar el archivo `.env`

Copiar la plantilla:

```powershell
copy .env.example .env      # Windows
```

```bash
cp .env.example .env        # Linux / macOS
```

Abrir `.env` con un editor y completar cada variable. El archivo `.env` está en `.gitignore`: **nunca se sube al
repositorio**.

| Variable | Qué es | Cómo obtenerla |
| --- | --- | --- |
| `DATABASE_URL` | Dirección de conexión a PostgreSQL | **Neon:** crear un proyecto en [neon.tech](https://neon.tech), botón *Connect* y copiar la *connection string* (`postgresql://usuario:contraseña@host/base?sslmode=require`). **Local:** crear una base vacía (`createdb medialens`) y usar `postgresql://postgres:TU_CONTRASEÑA@localhost:5432/medialens` |
| `API_READ_ACCESS_TOKEN` | Token con el que el servidor consulta TMDB | Crear una cuenta en [themoviedb.org](https://www.themoviedb.org/signup), ir a *Configuración → API*, solicitar una clave (uso educativo) y copiar el **API Read Access Token** (el texto largo que empieza con `eyJ`) |
| `API_KEY` | Clave v3 de TMDB | En la misma pantalla, la **API Key** corta. El servidor no la usa (trabaja con el token); se deja como referencia y puede quedar vacía |
| `SECRET_KEY` | Clave para firmar la cookie de sesión | Generarla con el comando de abajo y pegar el resultado |
| `CHATBOT_API_KEY` | *(Opcional)* Key de Gemini para que el chatbot responda con IA | Ver la sección [Chatbot](#8-chatbot-asistente-de-películas). Si queda vacía, el chatbot funciona igual, con respuestas automáticas |
| `CHATBOT_MODELO` | *(Opcional)* Modelo de Gemini | Vacío usa `gemini-3.5-flash-lite` |
| `FLASK_DEBUG` | *(Opcional, solo para desarrollo)* Modo debug de Flask | Vacío o `0`: apagado (lo correcto para usar o entregar el sitio). `1`: recarga el servidor al guardar cambios y muestra los errores detallados |

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Ejemplo de `.env` completo (con valores inventados):

```ini
API_READ_ACCESS_TOKEN=eyJhbGciOiJIUzI1NiJ9.ejemplo.ejemplo
API_KEY=
DATABASE_URL=postgresql://usuario:contraseña@ep-ejemplo.sa-east-1.aws.neon.tech/neondb?sslmode=require
SECRET_KEY=3f6c...64 caracteres hexadecimales...
CHATBOT_API_KEY=
CHATBOT_MODELO=
```

### 2.5. Crear las tablas de la base de datos

```bash
flask --app Back/app.py db upgrade
```

Aplica las migraciones de la carpeta `migrations/`: crea las tablas `usuarios`, `roles`, `favoritos` y `auditoria`,
y carga los tres roles. Se puede volver a ejecutar sin problema: solo aplica lo que falte.

**Alternativa: script SQL.** `database/medialens.sql` crea el mismo esquema final (tablas, claves, restricciones,
índices y roles) directamente en PostgreSQL, sin Flask. Sirve para revisar el modelo o para crear la base a mano:

```bash
psql "postgresql://usuario:contraseña@host/base" -f database/medialens.sql
```

Se ejecuta **sobre una base vacía** y en lugar de `db upgrade` (no los dos). El script deja registrada la versión de
migración, así que después las migraciones nuevas se siguen aplicando con `flask --app Back/app.py db upgrade`.

### 2.6. Levantar el sitio

```bash
python Back/app.py
```

Abrir **http://localhost:5000** en el navegador. Para detener el servidor: `Ctrl + C`.

> El sitio tiene que abrirse desde esa dirección. Si se abre un `.html` con doble clic, las páginas no pueden
> comunicarse con el servidor (el sitio lo avisa con un cartel).

### 2.7. Crear el primer administrador

1. En el sitio, ir a **Registrarse** y crear una cuenta.
2. Con el servidor detenido o desde otra terminal (con el entorno activo), promoverla a superadministrador:

   ```bash
   flask --app Back/app.py crear-admin tu-email@ejemplo.com
   ```

3. Recargar el sitio: en el menú aparece **Admin**, que lleva al panel de administración (`admin/dashboard.html`).

El comando solo promueve cuentas que ya existen (no crea cuentas nuevas), reactiva la cuenta si estaba bloqueada
y deja la acción registrada en la auditoría.

## 3. Roles y permisos

| Rol | Qué puede hacer |
| --- | --- |
| **Visitante** (sin cuenta) | Buscar películas con filtros, ver detalles, tendencias, rankings, estadísticas generales y cines cercanos |
| **usuario** (se asigna al registrarse) | Todo lo anterior, más: guardar favoritas, recomendaciones personalizadas, estadísticas de sus favoritas y Mi perfil (corregir datos, cambiar la contraseña, eliminar la cuenta) |
| **administrador** | Todo lo anterior, más el panel de administración: buscar cuentas, cambiar roles, bloquear y desbloquear cuentas, ver la auditoría y vaciar la caché. **No puede** modificar a un superadministrador ni asignar ese rol |
| **superadministrador** | Todo, incluido asignar o quitar el rol superadministrador y administrar a otros superadministradores |

Reglas que valida el servidor (no solo la interfaz):

- Nadie puede cambiar su propio rol ni bloquear su propia cuenta.
- Una cuenta bloqueada no puede iniciar sesión, y si tenía una sesión abierta la pierde en el siguiente pedido.
- Cada acción administrativa queda registrada en la tabla `auditoria` (quién, qué, sobre quién y cuándo).

**Cómo probarlo:**

1. Registrar tres cuentas, por ejemplo A, B y C.
2. Promover A con `crear-admin` (paso 2.7) e ingresar con A. En **Admin**, darle a B el rol *administrador*.
3. Ingresar con B: en el panel, la fila de A aparece como *Protegida* y en el selector no se puede elegir
   *superadministrador*.
4. Ingresar con C (rol *usuario*) y abrir `/admin/dashboard.html`: muestra «No tenés permisos».
5. Desde A o B, bloquear a C (pide confirmación) e intentar ingresar con C: «La cuenta está bloqueada».
6. Revisar la sección **Auditoría** del panel: aparecen todas las acciones anteriores.

## 4. Funcionalidades y páginas

| Funcionalidad | Página |
| --- | --- |
| Búsqueda por título con filtros (género, año, idioma, puntaje, orden), tendencias, Top 5 y géneros | Inicio (`index.html`) |
| Ventana de detalle: sinopsis, reparto, dirección, duración | Desde cualquier tarjeta de película |
| Rankings por puntaje o popularidad, con filtros | `pages/rankings.html` |
| Estadísticas por género y por década, y de las favoritas | `pages/estadisticas.html` |
| Recomendaciones según géneros y favoritas | `pages/recomendaciones.html` |
| Mis favoritas (corazón en cada película) | `pages/favoritas.html` |
| Cines cercanos por GPS o dirección, con mapa y enlace a reservas | `pages/cines.html` |
| Registro, inicio de sesión y Mi perfil | `pages/registro.html`, `pages/login.html`, `pages/perfil.html` |
| Política de privacidad | `pages/privacidad.html` |
| Panel de administración | `admin/dashboard.html` |
| Asistente de películas (chatbot) | Botón 💬 abajo a la derecha, en todas las páginas |

## 5. Respaldo de la base de datos

`Back/respaldo.py` agrega comandos para guardar y recuperar todos los datos en un archivo JSON comprimido
(`respaldos/medialens-AAAAMMDD-HHMMSS.json.gz`). No necesita `pg_dump`.

```bash
flask --app Back/app.py respaldo crear                                     # nuevo respaldo en respaldos/
flask --app Back/app.py respaldo listar                                    # respaldos disponibles
flask --app Back/app.py respaldo restaurar respaldos/medialens-AAAAMMDD-HHMMSS.json.gz
```

**Qué se guarda:** las 4 tablas (`roles`, `usuarios`, `favoritos` y `auditoria`) y la versión de migración de la
base. El catálogo de películas no hace falta respaldarlo: se consulta a TMDB.

### 5.1. Frecuencia

| Cuándo | Cómo |
| --- | --- |
| **Todos los días** (03:00) | Tarea programada que ejecuta `respaldo crear` (ver abajo) |
| **Antes de cada migración** (`db upgrade`) | `respaldo crear` a mano |
| **Antes de cada entrega** o de una prueba que modifique datos | `respaldo crear` a mano |
| Antes de restaurar | Automático: `respaldo restaurar` guarda primero el estado actual |

Se conservan los 10 respaldos más recientes (con el diario, unos 10 días de historia). Se puede cambiar con
`RESPALDOS_A_CONSERVAR` en el `.env`; la carpeta, con `RESPALDO_DIR`. Además, Neon guarda su propio historial y
permite volver la base a un momento de las últimas horas desde su panel (*Restore*).

**Programar el respaldo diario en Windows** (una sola vez, en PowerShell desde la carpeta del proyecto; la tarea
se ve y se borra desde el *Programador de tareas*):

```powershell
$accion = New-ScheduledTaskAction -Execute "$PWD\venv\Scripts\flask.exe" -Argument "--app Back/app.py respaldo crear" -WorkingDirectory "$PWD"
Register-ScheduledTask -TaskName "MediaLens respaldo" -Action $accion -Trigger (New-ScheduledTaskTrigger -Daily -At 03:00)
```

En Linux o macOS, con `crontab -e`:

```cron
0 3 * * * cd /ruta/al/proyecto && venv/bin/flask --app Back/app.py respaldo crear
```

### 5.2. Recuperación paso a paso

1. **Detener el servidor** (`Ctrl + C`) para que nadie escriba datos mientras se recupera.
2. **Elegir el respaldo:** `flask --app Back/app.py respaldo listar` muestra los archivos con fecha y tamaño.
3. **Si la base se perdió o es nueva**, crear primero las tablas: `flask --app Back/app.py db upgrade` (o el script
   `database/medialens.sql`). La base tiene que estar en la misma versión de migración que el respaldo; si no,
   el comando avisa y no toca nada.
4. **Restaurar:** `flask --app Back/app.py respaldo restaurar respaldos/medialens-AAAAMMDD-HHMMSS.json.gz`.
   Pide confirmación, guarda un respaldo del estado actual y reemplaza todos los datos en una sola transacción:
   si algo falla, la base queda como estaba.
5. **Verificar:** levantar el servidor, iniciar sesión con una cuenta administradora y revisar en el panel que
   estén los usuarios y la auditoría.
6. **Si el resultado no es el esperado**, restaurar el respaldo que se generó en el paso 4 (el más reciente de
   `respaldo listar`) para volver al estado anterior.

La carpeta `respaldos/` está excluida del repositorio porque contiene datos personales.

## 6. Cumplimiento de la Ley 25.326 (Protección de Datos Personales)

| Requisito | Dónde está |
| --- | --- |
| Información al titular (art. 6) | Política de privacidad en `pages/privacidad.html`, enlazada desde el pie de todas las páginas, y aviso breve en el registro |
| Consentimiento expreso (art. 5) | Casilla obligatoria en `pages/registro.html`. El servidor rechaza el registro si no llega `acepta_privacidad: true` o si la persona tiene menos de 13 años |
| Seguridad (art. 9) | Contraseñas guardadas solo como hash con sal (`werkzeug.security.generate_password_hash`); cookie de sesión firmada, `HttpOnly` y `SameSite=Lax`; credenciales fuera del código (`.env`) |
| Rectificación y supresión (art. 16) | En Mi perfil la persona corrige sus datos y elimina su cuenta (junto con sus favoritas) |
| Minimización | La ubicación para buscar cines no se guarda ni se asocia a la cuenta; la auditoría no copia datos personales |
| Chatbot | Las conversaciones no se guardan en la base ni en los registros del servidor (los errores se registran sin el texto del usuario). El panel avisa que no se compartan datos personales y la política informa el envío de las preguntas a Google |

## 7. Arquitectura

- **Cliente–servidor.** El navegador carga páginas HTML/CSS/JS y pide los datos con `fetch` a la API propia
  (`/api/...`). Todas las llamadas pasan por `assets/js/api.js`, que centraliza el manejo de errores.
- **Servidor Flask** (`Back/app.py`). Sirve el sitio, expone la API y hace de intermediario con TMDB: el token
  nunca llega al navegador. Guarda en memoria (caché) las respuestas de TMDB para responder más rápido y para
  seguir funcionando si TMDB falla.
- **Servicios externos.** TMDB (películas), Nominatim/OpenStreetMap (cines y direcciones) y, opcionalmente,
  Google Gemini (redacción de las respuestas del chatbot). Todos se consultan desde el servidor.
- **Base relacional.** PostgreSQL con SQLAlchemy (`Back/modeloDatos.py`) y migraciones versionadas con
  Flask-Migrate (`migrations/`). El esquema final también está como script SQL en `database/medialens.sql`.
- **Utilidades.** `scripts/pruebaApi.py` prueba la conexión con TMDB usando el token del `.env`
  (`python scripts/pruebaApi.py`).

## 8. Chatbot (asistente de películas)

El botón 💬 abre un chat que responde preguntas sobre películas con datos de TMDB (RF12). Funciona así:

1. El servidor (`POST /api/chatbot`) interpreta la pregunta y busca datos en TMDB: un género, las tendencias o una
   película por título (con su detalle y reparto).
2. Con una key configurada, le pasa esos datos a **Gemini** (`gemini-3.5-flash-lite`), con la instrucción de
   responder en español rioplatense, en forma breve, solo sobre películas y **usando únicamente esos datos**.
3. Las películas que menciona la respuesta aparecen como tarjetas; al tocarlas se abre su detalle. Solo se
   muestran películas que vinieron de TMDB, así que el chatbot no puede inventar una tarjeta.

### Cómo obtener la key de Gemini

1. Entrar a [Google AI Studio](https://aistudio.google.com/apikey) con una cuenta de Google y aceptar los términos.
2. Crear una key (*Create API key*) y copiarla.
3. Pegarla en el `.env` como `CHATBOT_API_KEY=...` y reiniciar el servidor (`Ctrl + C` y `python Back/app.py`).

La capa gratuita alcanza para probar el chatbot. En esa capa, Google puede usar el contenido de las preguntas para
mejorar sus productos: por eso el chat avisa que no se escriban datos personales.

### Sin key (o si la IA falla)

El chatbot **funciona igual**: si no hay key, si Gemini devuelve un error o si tarda más de 10 segundos, responde
con reglas a partir de los mismos datos de TMDB. Esas respuestas se marcan con «Respuesta automática, sin IA».
Así se puede probar sin crear ninguna cuenta.

### Ejemplos de preguntas

- «Recomendame una de terror» (también comedia, drama, ciencia ficción, animadas, de amor, de suspenso…)
- «¿Qué es tendencia esta semana?» o «Recomendame algo»
- «¿De qué trata Interstellar?», «¿Quién actúa en El Padrino?», «Hablame de Titanic»
- «Hola» o «¿Qué podés hacer?»: muestra una ayuda con ejemplos

### Límites

- Preguntas de hasta 300 caracteres; como contexto se envían los últimos 6 mensajes de la conversación.
- 10 preguntas por minuto por cuenta (o por dirección IP, sin sesión). Después responde «Hiciste muchas
  preguntas seguidas» hasta que pase el minuto.
- La conversación vive solo en la página abierta: se borra al recargar o con el botón «Limpiar».

## 9. Limitaciones conocidas

- Solo se trabaja con **películas**: las series no están incluidas.
- La **asociación entre película y cine** (RF09: qué cines proyectan una película) no está implementada. La página
  de cines muestra los cines cercanos y enlaza a su sitio para consultar la cartelera.

## 10. Problemas frecuentes

| Síntoma | Causa y solución |
| --- | --- |
| `column ... does not exist` o `relation ... does not exist` | Faltan migraciones en la base: ejecutar `flask --app Back/app.py db upgrade` |
| `RuntimeError: Falta DATABASE_URL en el archivo .env` | No existe `.env` en la raíz o la variable está vacía (paso 2.4) |
| `ModuleNotFoundError: No module named 'flask'` | El entorno virtual no está activo o faltó `pip install -r requirements.txt` |
| PowerShell no deja ejecutar `Activate.ps1` | Ejecutar `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` y volver a activar |
| Las películas no cargan («El servicio de películas no está respondiendo») | Revisar `API_READ_ACCESS_TOKEN` y la conexión a internet; el resto del sitio sigue funcionando |
| `crear-admin` responde «No hay ninguna cuenta con el email…» | Primero hay que registrarse en el sitio con ese email |
| El panel dice «No tenés permisos» | La cuenta tiene rol *usuario*: promoverla con `crear-admin` o desde otra cuenta administradora |
| «Usar mi ubicación» no funciona | El navegador solo permite la ubicación en `localhost` o con HTTPS, y hay que aceptar el permiso. Se puede buscar escribiendo una dirección |
| `Address already in use` o el puerto 5000 ocupado | Ya hay otra instancia del servidor abierta: cerrarla con `Ctrl + C` |
| El chatbot siempre dice «Respuesta automática, sin IA» | No hay `CHATBOT_API_KEY` en el `.env`, el servidor no se reinició después de agregarla, la key es inválida o se agotó la cuota gratuita. La consola del servidor muestra el motivo |
| El chatbot responde «Hiciste muchas preguntas seguidas» | Se superó el límite de 10 preguntas por minuto: esperar el tiempo que indica |
