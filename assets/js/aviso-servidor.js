/* ============================================
   aviso-servidor.js
   Script clásico (no módulo) a propósito: los
   módulos no se ejecutan si el HTML se abre con
   doble clic (file://), pero este sí. Si detecta
   ese caso, explica cómo levantar el sitio.
   ============================================ */

(function () {
  if (window.location.protocol !== "file:") return;

  document.addEventListener("DOMContentLoaded", function () {
    var aviso = document.createElement("div");
    aviso.className = "aviso-servidor";
    aviso.setAttribute("role", "alert");

    var titulo = document.createElement("strong");
    titulo.textContent = "Este sitio necesita el servidor para funcionar.";

    var texto = document.createElement("span");
    texto.textContent = " Abriste el archivo directamente. Desde la carpeta del proyecto, ejecutá ";

    var comando = document.createElement("code");
    comando.textContent = "python Back/app.py";

    var final = document.createElement("span");
    final.textContent = " y entrá a http://localhost:5000";

    aviso.append(titulo, texto, comando, final);
    document.body.prepend(aviso);
  });
})();
