// HTML del visor. extension.js le pasa las direcciones (URIs) de los archivos;
// acá solo se arma el texto. Nada de <script> inline: la CSP no lo permite.

// Íconos de 16x16 dibujados con líneas: toman el color del texto del tema.
const icono = (trazos) =>
  `<svg class="icono" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${trazos}</svg>`;

const ICONOS = {
  indice: icono('<path d="M6 4h8M6 8h8M6 12h8"/><path d="M2.5 4h.5M2.5 8h.5M2.5 12h.5"/>'),
  notas: icono('<path d="M3.5 2.5h6l3 3v8h-9z"/><path d="M9.5 2.5v3h3M5.5 8.5h5M5.5 11h5"/>'),
  anterior: icono('<path d="M10 3.5 5.5 8l4.5 4.5"/>'),
  siguiente: icono('<path d="M6 3.5 10.5 8 6 12.5"/>'),
  menos: icono('<path d="M3.5 8h9"/>'),
  mas: icono('<path d="M3.5 8h9M8 3.5v9"/>'),
  ancho: icono('<path d="M1.5 8h13M4 5.5 1.5 8 4 10.5M12 5.5l2.5 2.5-2.5 2.5"/>'),
  resaltador: icono('<path d="m10 2 4 4-6.5 6.5h-4v-4z"/><path d="M7.5 4.5l4 4M1.5 14.5h6"/>'),
  parlante: icono('<path d="M2.5 6h2.5l3.5-3v10L5 10H2.5z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.7a6 6 0 0 1 0 8.6"/>'),
  pausa: icono('<path d="M5.5 3.5v9M10.5 3.5v9"/>'),
  seguir: icono('<path d="M5 3.5v9l7-4.5z"/>'),
  detener: icono('<rect x="4" y="4" width="8" height="8" rx="1"/>'),
  lupa: icono('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>'),
  arriba: icono('<path d="M3.5 10 8 5.5l4.5 4.5"/>'),
  abajo: icono('<path d="M3.5 6 8 10.5 12.5 6"/>'),
  desplegar: icono('<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>'),
  cerrar: icono('<path d="m4 4 8 8M12 4l-8 8"/>'),
  teclado: icono('<rect x="1.5" y="4" width="13" height="8.5" rx="1.5"/><path d="M4 6.5h.5M6.5 6.5H7M9 6.5h.5M11.5 6.5h.5M4 8.5h.5M11.5 8.5h.5M6.5 8.5h3M5 10.5h6"/>'),
  borrador: icono('<path d="m9.5 2.5 4 4-7 7h-3l-2-2a1.4 1.4 0 0 1 0-2z"/><path d="m6 6 4 4M7.5 13.5h7"/>')
};

const PAPELES = [
  ['blanco', 'Blanco'],
  ['crema', 'Crema'],
  ['durazno', 'Durazno'],
  ['celeste', 'Celeste'],
  ['verde', 'Verde'],
  ['gris', 'Gris']
];

// Cada color tiene además su propia forma, para distinguirlos sin depender del color.
const COLORES = [
  ['amarillo', 'Amarillo', 'fondo', '1'],
  ['verde', 'Verde', 'subrayado', '2'],
  ['rosa', 'Rosa', 'doble subrayado', '3'],
  ['celeste', 'Celeste', 'subrayado punteado', '4']
];

const ESTADOS = [
  ['pendiente', 'Pendiente'],
  ['en-progreso', 'En progreso'],
  ['hecho', 'Hecho']
];

// Panel "Atajos de teclado": [título, [[teclas, qué hace], ...]]. Las teclas separadas
// por espacios se dibujan cada una en su recuadro; "/" separa alternativas.
const ATAJOS = [
  ['Moverse', [
    ['RePág / AvPág', 'Página anterior / siguiente'],
    ['+ / −', 'Acercar / alejar'],
    ['Alt+←', 'Volver después de seguir un link'],
    ['↑ / ↓', 'Mover la guía de lectura (si está activa)']
  ]],
  ['Buscar', [
    ['Ctrl+F', 'Ir al buscador'],
    ['Enter / Shift+Enter', 'Coincidencia siguiente / anterior'],
    ['Esc', 'Borrar la búsqueda']
  ]],
  ['Con texto seleccionado', [
    ['1 2 3 4', 'Resaltar en amarillo, verde, rosa o celeste'],
    ['R', 'Resaltar con el color elegido'],
    ['Supr', 'Quitar el resaltado'],
    ['N', 'Pasar el texto a las notas'],
    ['L', 'Leerlo en voz alta']
  ]],
  ['Modo resaltador', [
    ['R', 'Activar o desactivar el modo (sin texto seleccionado)'],
    ['1 2 3 4', 'Cambiar el color'],
    ['5', 'Borrador: lo que selecciones deja de estar resaltado'],
    ['Esc', 'Salir del modo']
  ]],
  ['Deshacer', [
    ['Ctrl+Z', 'Deshacer lo último (resaltados, notas, estado)'],
    ['Ctrl+Y', 'Rehacer']
  ]],
  ['Ayuda', [['?', 'Mostrar u ocultar estos atajos']]]
];

const teclasHtml = (teclas) =>
  teclas
    .split(' / ')
    .map((alternativa) => alternativa.split(' ').map((t) => `<kbd>${t}</kbd>`).join(''))
    .join('<span class="separador-teclas">o</span>');

const atajosHtml = ATAJOS.map(
  ([titulo, filas]) =>
    `<section><h3>${titulo}</h3><dl>${filas
      .map(([teclas, accion]) => `<dt>${teclasHtml(teclas)}</dt><dd>${accion}</dd>`)
      .join('')}</dl></section>`
).join('');

function armarHtmlDelVisor({ cspSource, uriViewerCss, uriViewerJs, uriIcono, configuracion }) {
  // Dos versiones de cada ícono de estado; viewer.css muestra la que corresponde al tema.
  const iconosEstado = (estado) =>
    `<img class="icono-estado para-oscuro" src="${uriIcono(`${estado}.png`)}" alt="">` +
    `<img class="icono-estado para-claro" src="${uriIcono(`${estado}-claro.png`)}" alt="">`;

  const opcionesPapel = PAPELES.map(
    ([valor, nombre]) =>
      `<button class="opcion-papel" role="radio" aria-checked="false" data-papel="${valor}"><span class="muestra-papel papel-${valor}"></span>${nombre}</button>`
  ).join('');

  // Menú flotante que aparece al seleccionar texto.
  const botonesColor = COLORES.map(
    ([color, nombre, forma, tecla]) =>
      `<button class="boton-color" data-color="${color}" title="Resaltar en ${nombre.toLowerCase()} (${forma}) — tecla ${tecla}" aria-label="${nombre}, ${forma}" aria-keyshortcuts="${tecla}"><span class="muestra-marca marca-${color}">Ab</span><kbd class="tecla-mini">${tecla}</kbd></button>`
  ).join('');

  // Menú del botón "Resaltar" de la barra.
  const opcionesColor =
    COLORES.map(
      ([color, nombre, forma, tecla]) =>
        `<button role="menuitemradio" aria-checked="false" class="opcion-color" data-color="${color}"><span class="muestra-marca marca-${color}">Ab</span><span>${nombre} <span class="detalle">· ${forma}</span></span><kbd>${tecla}</kbd></button>`
    ).join('') +
    // El borrador quita resaltados: seleccionás texto resaltado y se borra esa parte.
    `<span class="separador-menu" role="separator"></span>` +
    `<button role="menuitemradio" aria-checked="false" class="opcion-color" data-color="borrar"><span class="muestra-borrador">${ICONOS.borrador}</span><span>Borrador <span class="detalle">· quita resaltados</span></span><kbd>5</kbd></button>`;

  const opcionesEstado = ESTADOS.map(
    ([estado, nombre]) =>
      `<button role="menuitemradio" aria-checked="false" class="boton-estado" data-estado="${estado}">${iconosEstado(estado)}<span class="nombre-estado">${nombre}</span></button>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src ${cspSource}; script-src ${cspSource}; font-src ${cspSource}; connect-src ${cspSource}; worker-src blob:;">
<link rel="stylesheet" href="${uriViewerCss}">
<title>Visor PDF</title>
</head>
<body>
<div id="barra-herramientas" role="toolbar" aria-label="Herramientas del visor">
  <div class="grupo">
    <button id="boton-indice" class="boton-icono con-etiqueta" aria-pressed="false" aria-controls="panel-indice" title="Este PDF no tiene índice" disabled>${ICONOS.indice}<span class="etiqueta">Índice</span></button>
  </div>
  <span class="separador" aria-hidden="true"></span>
  <div class="grupo" role="group" aria-label="Páginas">
    <button id="boton-pagina-anterior" class="boton-icono" title="Página anterior (RePág)" aria-label="Página anterior" disabled>${ICONOS.anterior}</button>
    <input id="campo-pagina" type="number" min="1" value="1" aria-label="Página actual" disabled>
    <span id="etiqueta-total-paginas">de –</span>
    <button id="boton-pagina-siguiente" class="boton-icono" title="Página siguiente (AvPág)" aria-label="Página siguiente" disabled>${ICONOS.siguiente}</button>
  </div>
  <div class="grupo" role="group" aria-label="Zoom">
    <button id="boton-alejar" class="boton-icono" title="Alejar (−)" aria-label="Alejar" aria-keyshortcuts="-" disabled>${ICONOS.menos}</button>
    <span id="etiqueta-zoom">100%</span>
    <button id="boton-acercar" class="boton-icono" title="Acercar (+)" aria-label="Acercar" aria-keyshortcuts="+" disabled>${ICONOS.mas}</button>
    <button id="boton-ajustar-ancho" class="boton-icono" title="Ajustar al ancho" aria-label="Ajustar al ancho" disabled>${ICONOS.ancho}</button>
  </div>
  <span class="separador" aria-hidden="true"></span>
  <div class="grupo" id="grupo-resaltador">
    <div class="boton-dividido">
      <button id="boton-resaltador" class="boton-icono con-etiqueta" aria-pressed="false" aria-keyshortcuts="R" title="Resaltar (R): con texto seleccionado lo resalta; si no, activa el modo resaltador para marcar varias partes seguidas" disabled>${ICONOS.resaltador}<span id="color-resaltador-actual" class="muestra-color color-amarillo" aria-hidden="true"></span><span class="etiqueta">Resaltar</span></button>
      <button id="boton-color-resaltador" class="boton-icono boton-flecha" aria-haspopup="menu" aria-expanded="false" aria-controls="menu-color-resaltador" title="Elegir color o borrador" aria-label="Elegir color del resaltador o el borrador" disabled>${ICONOS.desplegar}</button>
    </div>
    <div id="menu-color-resaltador" class="menu-flotante menu-lista oculto" role="menu" aria-label="Color del resaltador">${opcionesColor}</div>
  </div>
  <div class="grupo" id="grupo-voz">
    <button id="boton-leer" class="boton-icono con-etiqueta" data-estado="detenido" title="Leer en voz alta (si hay texto seleccionado, lee solo eso)" disabled><span class="icono-leer">${ICONOS.parlante}</span><span class="icono-pausa">${ICONOS.pausa}</span><span class="icono-seguir">${ICONOS.seguir}</span><span class="etiqueta">Leer</span></button>
    <button id="boton-detener-lectura" class="boton-icono oculto" title="Detener la lectura" aria-label="Detener la lectura">${ICONOS.detener}</button>
  </div>
  <div class="grupo" id="grupo-busqueda" role="search">
    <div class="campo-con-icono">${ICONOS.lupa}<input id="campo-busqueda" type="search" placeholder="Buscar (Ctrl+F)" aria-label="Buscar en el PDF" disabled></div>
    <span id="resultado-busqueda" aria-live="polite"></span>
    <button id="boton-anterior" class="boton-icono" title="Anterior (Shift+Enter)" aria-label="Coincidencia anterior" disabled>${ICONOS.arriba}</button>
    <button id="boton-siguiente" class="boton-icono" title="Siguiente (Enter)" aria-label="Coincidencia siguiente" disabled>${ICONOS.abajo}</button>
  </div>
  <div class="grupo" id="grupo-lectura">
    <button id="boton-lectura" class="boton-icono boton-aa" aria-haspopup="dialog" aria-expanded="false" aria-controls="menu-lectura" title="Opciones de lectura: color de papel, guía y voz">Aa</button>
    <div id="menu-lectura" class="menu-flotante oculto" role="dialog" aria-label="Opciones de lectura">
      <div class="menu-titulo" id="titulo-papel">Color de papel</div>
      <div class="opciones-papel" role="radiogroup" aria-labelledby="titulo-papel">${opcionesPapel}</div>
      <div class="menu-titulo">Guía de lectura</div>
      <label class="opcion-menu"><input type="checkbox" id="casilla-guia"> Mostrar la franja</label>
      <label class="opcion-menu">Alto
        <select id="selector-alto-guia">
          <option value="fina">Fino (1 renglón)</option>
          <option value="media">Medio</option>
          <option value="ancha">Ancho (2 renglones)</option>
        </select>
      </label>
      <p class="menu-ayuda">La franja sigue al mouse. También podés bajar renglón por renglón con las flechas ↑ ↓.</p>
      <div class="menu-titulo">Lectura en voz alta</div>
      <div id="opciones-voz">
        <label class="opcion-menu">Voz <select id="selector-voz"></select></label>
        <label class="opcion-menu">Velocidad
          <select id="selector-velocidad">
            <option value="0.75">Lenta (0,75×)</option>
            <option value="1">Normal</option>
            <option value="1.25">Rápida (1,25×)</option>
            <option value="1.5">Muy rápida (1,5×)</option>
          </select>
        </label>
        <button id="boton-probar-voz">Probar la voz</button>
      </div>
      <p id="sin-voces" class="menu-ayuda oculto">No hay voces instaladas. En Windows se agregan en Configuración → Hora e idioma → Voz.</p>
    </div>
  </div>
  <div class="grupo" id="grupo-estado">
    <button id="boton-estado" aria-haspopup="menu" aria-expanded="false" aria-controls="menu-estado" title="Estado del documento" disabled><span id="icono-estado-actual"></span><span id="texto-estado-actual">Pendiente</span>${ICONOS.desplegar}</button>
    <div id="menu-estado" class="menu-flotante menu-lista oculto" role="menu" aria-label="Estado del documento">${opcionesEstado}</div>
  </div>
  <!-- Notas va a la derecha de todo, justo arriba de donde se abre su panel. -->
  <div class="grupo" id="grupo-atajos">
    <button id="boton-atajos" class="boton-icono" aria-haspopup="dialog" aria-expanded="false" aria-controls="panel-atajos" aria-keyshortcuts="?" title="Atajos de teclado (?)" aria-label="Atajos de teclado">${ICONOS.teclado}</button>
    <div id="panel-atajos" class="menu-flotante oculto" role="dialog" aria-label="Atajos de teclado" tabindex="-1">
      <div class="panel-atajos-encabezado"><span class="menu-titulo">Atajos de teclado</span><span class="menu-ayuda">No funcionan mientras escribís en las notas o en el buscador.</span></div>
      <div class="columnas-atajos">${atajosHtml}</div>
    </div>
    <button id="boton-notas" class="boton-icono con-etiqueta" aria-pressed="false" aria-controls="panel-notas" title="Notas y resaltados de este documento">${ICONOS.notas}<span class="etiqueta">Notas</span></button>
  </div>
</div>
<div id="aviso-modo" class="franja-aviso oculto" role="status">
  ${ICONOS.resaltador}<span id="texto-aviso-modo">Modo resaltador: seleccioná texto para resaltarlo en <strong>amarillo</strong>.</span>
  <button id="boton-salir-modo">Salir (Esc)</button>
</div>
<div id="consejo" class="franja-aviso consejo oculto" role="note">
  <span><strong>Consejo:</strong> seleccioná texto del PDF para resaltarlo, subrayarlo, escucharlo o pasarlo a tus notas. Con <strong>Resaltar</strong> podés marcar varias partes seguidas, y <kbd>Ctrl+Z</kbd> deshace. Apretá <kbd>?</kbd> para ver todos los atajos.</span>
  <button id="boton-cerrar-consejo" class="boton-icono" title="No mostrar más" aria-label="Cerrar el consejo">${ICONOS.cerrar}</button>
</div>
<div id="area-principal">
  <aside id="panel-indice" class="oculto" aria-label="Índice del PDF">
    <div class="panel-titulo">Índice</div>
    <ul id="lista-indice" class="arbol-indice"></ul>
  </aside>
  <div id="zona-visor">
    <div id="visor">
      <div id="mensaje-error" class="oculto"></div>
      <div id="paginas"></div>
    </div>
    <div id="guia-lectura" class="oculto" aria-hidden="true">
      <div class="sombra-guia arriba"></div>
      <div class="franja-guia"></div>
      <div class="sombra-guia abajo"></div>
    </div>
    <div id="menu-resaltar" class="menu-flotante oculto" role="toolbar" aria-label="Resaltar el texto seleccionado">
      ${botonesColor}
      <span class="separador" aria-hidden="true"></span>
      <button id="boton-leer-seleccion" title="Leer en voz alta el texto seleccionado — tecla L" aria-label="Leer en voz alta" aria-keyshortcuts="L">${ICONOS.parlante}<kbd class="tecla-mini">L</kbd></button>
      <button id="boton-a-notas" title="Copiar el texto a las notas, anclado a su página — tecla N" aria-keyshortcuts="N">A notas<kbd class="tecla-mini">N</kbd></button>
      <button id="boton-quitar-resaltado" class="boton-quitar-resaltado" title="Quitar el resaltado — tecla Supr (se puede deshacer con Ctrl+Z)" aria-keyshortcuts="Delete">${ICONOS.borrador}Quitar resaltado<kbd class="tecla-mini">Supr</kbd></button>
    </div>
    <button id="boton-volver" class="oculto" title="Volver a donde estabas (Alt+←)">← Volver</button>
    <div id="aviso-accion" class="oculto" role="status" aria-live="polite"></div>
  </div>
  <aside id="panel-notas" class="oculto" aria-label="Notas del documento">
    <div class="panel-encabezado">
      <span class="panel-titulo">Notas</span>
      <span id="estado-guardado" aria-live="polite"></span>
    </div>
    <textarea id="campo-notas" placeholder="Escribí tus notas acá…" disabled></textarea>
    <button id="boton-anclar" title="Agrega [pág. N] a la línea donde está el cursor" disabled>Anclar a pág. 1</button>
    <div class="panel-titulo">Notas por página</div>
    <p id="ayuda-anclas">Las líneas con <code>[pág. N]</code> aparecen acá: hacé click para ir a esa página, o borrala con su <strong>×</strong>.</p>
    <ul id="lista-anclas"></ul>
    <div class="panel-titulo">Resaltados</div>
    <p id="ayuda-resaltados">Seleccioná texto del PDF y elegí un color, o usá el botón <strong>Resaltar</strong> de la barra.</p>
    <ul id="lista-resaltados"></ul>
    <button id="boton-exportar" title="Guarda un archivo Markdown con tus notas y resaltados, ordenados por página" disabled>Exportar resumen…</button>
  </aside>
</div>
<script id="config-datos" type="application/json">${configuracion}</script>
<script type="module" src="${uriViewerJs}"></script>
</body>
</html>`;
}

module.exports = { armarHtmlDelVisor };
