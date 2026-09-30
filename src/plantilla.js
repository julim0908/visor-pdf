// HTML del visor. extension.js le pasa las direcciones (URIs) de los archivos;
// acá solo se arma el texto. Nada de <script> inline: la CSP no lo permite.
// Los textos pasan por t() (src/idioma.js) para salir en el idioma de VS Code.
const { t, idiomaActual } = require('./idioma');

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
  miniaturas: icono('<rect x="2.5" y="2.5" width="4.5" height="5.5" rx=".5"/><rect x="9" y="2.5" width="4.5" height="5.5" rx=".5"/><rect x="2.5" y="10" width="4.5" height="3.5" rx=".5"/><rect x="9" y="10" width="4.5" height="3.5" rx=".5"/>'),
  marcador: icono('<path d="M4.5 2.5h7v11L8 10.5l-3.5 3z"/>'),
  comentario: icono('<path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z"/><path d="M5 6h6M5 8.5h4"/>'),
  teclado: icono('<rect x="1.5" y="4" width="13" height="8.5" rx="1.5"/><path d="M4 6.5h.5M6.5 6.5H7M9 6.5h.5M11.5 6.5h.5M4 8.5h.5M11.5 8.5h.5M6.5 8.5h3M5 10.5h6"/>'),
  borrador: icono('<path d="m9.5 2.5 4 4-7 7h-3l-2-2a1.4 1.4 0 0 1 0-2z"/><path d="m6 6 4 4M7.5 13.5h7"/>')
};

// Listas con los textos ya traducidos (por eso son funciones: el idioma se lee al armar el HTML).
const papeles = () => [
  ['blanco', t('Blanco')],
  ['crema', t('Crema')],
  ['durazno', t('Durazno')],
  ['celeste', t('Celeste')],
  ['verde', t('Verde')],
  ['gris', t('Gris')],
  ['oscuro', t('Oscuro')]
];

// Cada color tiene además su propia forma, para distinguirlos sin depender del color.
const colores = () => [
  ['amarillo', t('Amarillo'), t('fondo'), '1'],
  ['verde', t('Verde'), t('subrayado'), '2'],
  ['rosa', t('Rosa'), t('doble subrayado'), '3'],
  ['celeste', t('Celeste'), t('subrayado punteado'), '4']
];

const estados = () => [
  ['pendiente', t('Pendiente')],
  ['en-progreso', t('En progreso')],
  ['hecho', t('Hecho')]
];

// Panel "Atajos de teclado": [título, [[teclas, qué hace], ...]]. Las teclas separadas
// por espacios se dibujan cada una en su recuadro; "/" separa alternativas.
const atajos = () => [
  [t('Moverse'), [
    [t('RePág / AvPág'), t('Página anterior / siguiente')],
    ['+ / −', t('Acercar / alejar')],
    ['M', t('Marcar (o desmarcar) la página actual')],
    ['Alt+←', t('Volver después de seguir un link')],
    ['↑ / ↓', t('Mover la guía de lectura (si está activa)')]
  ]],
  [t('Buscar'), [
    ['Ctrl+F', t('Ir al buscador')],
    ['Enter / Shift+Enter', t('Coincidencia siguiente / anterior')],
    ['Esc', t('Borrar la búsqueda')]
  ]],
  [t('Con texto seleccionado (o un click en un resaltado)'), [
    ['1 2 3 4', t('Resaltar en amarillo, verde, rosa o celeste')],
    ['R', t('Resaltar con el color elegido')],
    ['C', t('Escribir un comentario sobre el resaltado')],
    [t('Supr'), t('Quitar el resaltado')],
    ['N', t('Pasar el texto a las notas')],
    ['L', t('Leerlo en voz alta')]
  ]],
  [t('Modo resaltador'), [
    ['R', t('Activar o desactivar el modo (sin texto seleccionado)')],
    ['1 2 3 4', t('Cambiar el color')],
    ['5', t('Borrador: lo que selecciones deja de estar resaltado')],
    ['Esc', t('Salir del modo')]
  ]],
  [t('Deshacer'), [
    ['Ctrl+Z', t('Deshacer lo último (resaltados, notas, estado)')],
    ['Ctrl+Y', t('Rehacer')]
  ]],
  [t('Ayuda'), [['?', t('Mostrar u ocultar estos atajos')]]]
];

const teclasHtml = (teclas) =>
  teclas
    .split(' / ')
    .map((alternativa) => alternativa.split(' ').map((tecla) => `<kbd>${tecla}</kbd>`).join(''))
    .join(`<span class="separador-teclas">${t('o')}</span>`);

const atajosHtml = () =>
  atajos()
    .map(
      ([titulo, filas]) =>
        `<section><h3>${titulo}</h3><dl>${filas
          .map(([teclas, accion]) => `<dt>${teclasHtml(teclas)}</dt><dd>${accion}</dd>`)
          .join('')}</dl></section>`
    )
    .join('');

function armarHtmlDelVisor({ cspSource, uriViewerCss, uriViewerJs, uriIcono, configuracion }) {
  // Dos versiones de cada ícono de estado; viewer.css muestra la que corresponde al tema.
  const iconosEstado = (estado) =>
    `<img class="icono-estado para-oscuro" src="${uriIcono(`${estado}.png`)}" alt="">` +
    `<img class="icono-estado para-claro" src="${uriIcono(`${estado}-claro.png`)}" alt="">`;

  const opcionesPapel = papeles().map(
    ([valor, nombre]) =>
      `<button class="opcion-papel" role="radio" aria-checked="false" data-papel="${valor}"><span class="muestra-papel papel-${valor}"></span>${nombre}</button>`
  ).join('');

  // Menú flotante que aparece al seleccionar texto.
  const botonesColor = colores().map(
    ([color, nombre, forma, tecla]) =>
      `<button class="boton-color" data-color="${color}" title="${t('Resaltar en {0} ({1}) — tecla {2}', nombre.toLowerCase(), forma, tecla)}" aria-label="${nombre}, ${forma}" aria-keyshortcuts="${tecla}"><span class="muestra-marca marca-${color}">Ab</span><kbd class="tecla-mini">${tecla}</kbd></button>`
  ).join('');

  // Menú del botón "Resaltar" de la barra.
  const opcionesColor =
    colores().map(
      ([color, nombre, forma, tecla]) =>
        `<button role="menuitemradio" aria-checked="false" class="opcion-color" data-color="${color}"><span class="muestra-marca marca-${color}">Ab</span><span>${nombre} <span class="detalle">· ${forma}</span></span><kbd>${tecla}</kbd></button>`
    ).join('') +
    // El borrador quita resaltados: seleccionás texto resaltado y se borra esa parte.
    `<span class="separador-menu" role="separator"></span>` +
    `<button role="menuitemradio" aria-checked="false" class="opcion-color" data-color="borrar"><span class="muestra-borrador">${ICONOS.borrador}</span><span>${t('Borrador')} <span class="detalle">· ${t('quita resaltados')}</span></span><kbd>5</kbd></button>`;

  const opcionesEstado = estados().map(
    ([estado, nombre]) =>
      `<button role="menuitemradio" aria-checked="false" class="boton-estado" data-estado="${estado}">${iconosEstado(estado)}<span class="nombre-estado">${nombre}</span></button>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="${idiomaActual()}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src ${cspSource}; script-src ${cspSource}; font-src ${cspSource}; connect-src ${cspSource}; worker-src blob:;">
<link rel="stylesheet" href="${uriViewerCss}">
<title>Visor PDF</title>
</head>
<body>
<div id="barra-herramientas" role="toolbar" aria-label="${t('Herramientas del visor')}">
  <div class="grupo">
    <button id="boton-indice" class="boton-icono con-etiqueta" aria-pressed="false" aria-controls="panel-indice" title="${t('Este PDF no tiene índice')}" disabled>${ICONOS.indice}<span class="etiqueta">${t('Índice')}</span></button>
    <button id="boton-miniaturas" class="boton-icono con-etiqueta" aria-pressed="false" aria-controls="panel-miniaturas" title="${t('Mostrar u ocultar las miniaturas de las páginas')}" disabled>${ICONOS.miniaturas}<span class="etiqueta">${t('Páginas')}</span></button>
  </div>
  <span class="separador" aria-hidden="true"></span>
  <div class="grupo" role="group" aria-label="${t('Páginas')}">
    <button id="boton-pagina-anterior" class="boton-icono" title="${t('Página anterior (RePág)')}" aria-label="${t('Página anterior')}" disabled>${ICONOS.anterior}</button>
    <input id="campo-pagina" type="number" min="1" value="1" aria-label="${t('Página actual')}" disabled>
    <span id="etiqueta-total-paginas">${t('de {0}', '–')}</span>
    <button id="boton-pagina-siguiente" class="boton-icono" title="${t('Página siguiente (AvPág)')}" aria-label="${t('Página siguiente')}" disabled>${ICONOS.siguiente}</button>
    <button id="boton-marcador" class="boton-icono" aria-pressed="false" aria-keyshortcuts="M" title="${t('Marcar esta página para volver después (M)')}" aria-label="${t('Marcar esta página')}" disabled>${ICONOS.marcador}</button>
  </div>
  <div class="grupo" role="group" aria-label="Zoom">
    <button id="boton-alejar" class="boton-icono" title="${t('Alejar (−)')}" aria-label="${t('Alejar')}" aria-keyshortcuts="-" disabled>${ICONOS.menos}</button>
    <span id="etiqueta-zoom">100%</span>
    <button id="boton-acercar" class="boton-icono" title="${t('Acercar (+)')}" aria-label="${t('Acercar')}" aria-keyshortcuts="+" disabled>${ICONOS.mas}</button>
    <button id="boton-ajustar-ancho" class="boton-icono" title="${t('Ajustar al ancho')}" aria-label="${t('Ajustar al ancho')}" disabled>${ICONOS.ancho}</button>
  </div>
  <span class="separador" aria-hidden="true"></span>
  <div class="grupo" id="grupo-resaltador">
    <div class="boton-dividido">
      <button id="boton-resaltador" class="boton-icono con-etiqueta" aria-pressed="false" aria-keyshortcuts="R" title="${t('Resaltar (R): con texto seleccionado lo resalta; si no, activa el modo resaltador para marcar varias partes seguidas')}" disabled>${ICONOS.resaltador}<span id="color-resaltador-actual" class="muestra-color color-amarillo" aria-hidden="true"></span><span class="etiqueta">${t('Resaltar')}</span></button>
      <button id="boton-color-resaltador" class="boton-icono boton-flecha" aria-haspopup="menu" aria-expanded="false" aria-controls="menu-color-resaltador" title="${t('Elegir color o borrador')}" aria-label="${t('Elegir color del resaltador o el borrador')}" disabled>${ICONOS.desplegar}</button>
    </div>
    <div id="menu-color-resaltador" class="menu-flotante menu-lista oculto" role="menu" aria-label="${t('Color del resaltador')}">${opcionesColor}</div>
  </div>
  <div class="grupo" id="grupo-voz">
    <button id="boton-leer" class="boton-icono con-etiqueta" data-estado="detenido" title="${t('Leer en voz alta (si hay texto seleccionado, lee solo eso)')}" disabled><span class="icono-leer">${ICONOS.parlante}</span><span class="icono-pausa">${ICONOS.pausa}</span><span class="icono-seguir">${ICONOS.seguir}</span><span class="etiqueta">${t('Leer')}</span></button>
    <button id="boton-detener-lectura" class="boton-icono oculto" title="${t('Detener la lectura')}" aria-label="${t('Detener la lectura')}">${ICONOS.detener}</button>
  </div>
  <div class="grupo" id="grupo-busqueda" role="search">
    <div class="campo-con-icono">${ICONOS.lupa}<input id="campo-busqueda" type="search" placeholder="${t('Buscar (Ctrl+F)')}" aria-label="${t('Buscar en el PDF')}" disabled></div>
    <span id="resultado-busqueda" aria-live="polite"></span>
    <button id="boton-anterior" class="boton-icono" title="${t('Anterior (Shift+Enter)')}" aria-label="${t('Coincidencia anterior')}" disabled>${ICONOS.arriba}</button>
    <button id="boton-siguiente" class="boton-icono" title="${t('Siguiente (Enter)')}" aria-label="${t('Coincidencia siguiente')}" disabled>${ICONOS.abajo}</button>
  </div>
  <div class="grupo" id="grupo-lectura">
    <button id="boton-lectura" class="boton-icono boton-aa" aria-haspopup="dialog" aria-expanded="false" aria-controls="menu-lectura" title="${t('Opciones de lectura: color de papel, guía y voz')}">Aa</button>
    <div id="menu-lectura" class="menu-flotante oculto" role="dialog" aria-label="${t('Opciones de lectura')}">
      <div class="menu-titulo" id="titulo-papel">${t('Color de papel')}</div>
      <div class="opciones-papel" role="radiogroup" aria-labelledby="titulo-papel">${opcionesPapel}</div>
      <div class="menu-titulo">${t('Guía de lectura')}</div>
      <label class="opcion-menu"><input type="checkbox" id="casilla-guia"> ${t('Mostrar la franja')}</label>
      <label class="opcion-menu">${t('Alto')}
        <select id="selector-alto-guia">
          <option value="fina">${t('Fino (1 renglón)')}</option>
          <option value="media">${t('Medio')}</option>
          <option value="ancha">${t('Ancho (2 renglones)')}</option>
        </select>
      </label>
      <p class="menu-ayuda">${t('La franja sigue al mouse. También podés bajar renglón por renglón con las flechas ↑ ↓.')}</p>
      <div class="menu-titulo">${t('Lectura en voz alta')}</div>
      <div id="opciones-voz">
        <label class="opcion-menu">${t('Voz')} <select id="selector-voz"></select></label>
        <label class="opcion-menu">${t('Velocidad')}
          <select id="selector-velocidad">
            <option value="0.75">${t('Lenta (0,75×)')}</option>
            <option value="1">${t('Normal')}</option>
            <option value="1.25">${t('Rápida (1,25×)')}</option>
            <option value="1.5">${t('Muy rápida (1,5×)')}</option>
          </select>
        </label>
        <button id="boton-probar-voz">${t('Probar la voz')}</button>
      </div>
      <p id="sin-voces" class="menu-ayuda oculto">${t('No hay voces instaladas. En Windows se agregan en Configuración → Hora e idioma → Voz.')}</p>
    </div>
  </div>
  <div class="grupo" id="grupo-estado">
    <button id="boton-estado" aria-haspopup="menu" aria-expanded="false" aria-controls="menu-estado" title="${t('Estado del documento')}" disabled><span id="icono-estado-actual"></span><span id="texto-estado-actual">${t('Pendiente')}</span>${ICONOS.desplegar}</button>
    <div id="menu-estado" class="menu-flotante menu-lista oculto" role="menu" aria-label="${t('Estado del documento')}">${opcionesEstado}</div>
  </div>
  <!-- Notas va a la derecha de todo, justo arriba de donde se abre su panel. -->
  <div class="grupo" id="grupo-atajos">
    <button id="boton-atajos" class="boton-icono" aria-haspopup="dialog" aria-expanded="false" aria-controls="panel-atajos" aria-keyshortcuts="?" title="${t('Atajos de teclado (?)')}" aria-label="${t('Atajos de teclado')}">${ICONOS.teclado}</button>
    <div id="panel-atajos" class="menu-flotante oculto" role="dialog" aria-label="${t('Atajos de teclado')}" tabindex="-1">
      <div class="panel-atajos-encabezado"><span class="menu-titulo">${t('Atajos de teclado')}</span><span class="menu-ayuda">${t('No funcionan mientras escribís en las notas o en el buscador.')}</span></div>
      <div class="columnas-atajos">${atajosHtml()}</div>
    </div>
    <button id="boton-notas" class="boton-icono con-etiqueta" aria-pressed="false" aria-controls="panel-notas" title="${t('Notas y resaltados de este documento')}">${ICONOS.notas}<span class="etiqueta">${t('Notas')}</span></button>
  </div>
</div>
<div id="aviso-modo" class="franja-aviso oculto" role="status">
  ${ICONOS.resaltador}<span id="texto-aviso-modo"></span>
  <button id="boton-salir-modo">${t('Salir (Esc)')}</button>
</div>
<div id="consejo" class="franja-aviso consejo oculto" role="note">
  <span>${t('<strong>Consejo:</strong> seleccioná texto del PDF para resaltarlo, subrayarlo, escucharlo o pasarlo a tus notas. Con <strong>Resaltar</strong> podés marcar varias partes seguidas, y <kbd>Ctrl+Z</kbd> deshace. Apretá <kbd>?</kbd> para ver todos los atajos.')}</span>
  <button id="boton-cerrar-consejo" class="boton-icono" title="${t('No mostrar más')}" aria-label="${t('Cerrar el consejo')}">${ICONOS.cerrar}</button>
</div>
<div id="area-principal">
  <aside id="panel-indice" class="oculto" aria-label="${t('Índice del PDF')}">
    <div class="panel-titulo">${t('Índice')}</div>
    <ul id="lista-indice" class="arbol-indice"></ul>
  </aside>
  <aside id="panel-miniaturas" class="oculto" aria-label="${t('Miniaturas de las páginas')}">
    <div class="panel-titulo">${t('Páginas')}</div>
    <ul id="lista-miniaturas"></ul>
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
    <div id="menu-resaltar" class="menu-flotante oculto" role="toolbar" aria-label="${t('Resaltar el texto seleccionado')}">
      ${botonesColor}
      <span class="separador" aria-hidden="true"></span>
      <button id="boton-leer-seleccion" title="${t('Leer en voz alta el texto seleccionado — tecla L')}" aria-label="${t('Leer en voz alta')}" aria-keyshortcuts="L">${ICONOS.parlante}<kbd class="tecla-mini">L</kbd></button>
      <button id="boton-comentar" class="boton-con-icono" title="${t('Escribir un comentario sobre este resaltado — tecla C')}" aria-keyshortcuts="C">${ICONOS.comentario}<span id="texto-boton-comentar">${t('Comentar')}</span><kbd class="tecla-mini">C</kbd></button>
      <button id="boton-a-notas" title="${t('Copiar el texto a las notas, anclado a su página — tecla N')}" aria-keyshortcuts="N">${t('A notas')}<kbd class="tecla-mini">N</kbd></button>
      <button id="boton-quitar-resaltado" class="boton-quitar-resaltado" title="${t('Quitar el resaltado — tecla Supr (se puede deshacer con Ctrl+Z)')}" aria-keyshortcuts="Delete">${ICONOS.borrador}${t('Quitar resaltado')}<kbd class="tecla-mini">${t('Supr')}</kbd></button>
    </div>
    <div id="editor-comentario" class="menu-flotante oculto" role="dialog" aria-labelledby="titulo-comentario">
      <label id="titulo-comentario" class="menu-titulo" for="campo-comentario">${t('Comentario')}</label>
      <blockquote id="cita-comentario"></blockquote>
      <textarea id="campo-comentario" rows="3" placeholder="${t('Por ejemplo: esto entra en el parcial')}"></textarea>
      <p class="menu-ayuda">${t('<kbd>Enter</kbd> guarda · <kbd>Shift+Enter</kbd> nueva línea · <kbd>Esc</kbd> cancela')}</p>
      <div class="botones-comentario">
        <button id="boton-borrar-comentario">${t('Borrar comentario')}</button>
        <button id="boton-cancelar-comentario">${t('Cancelar')}</button>
        <button id="boton-guardar-comentario" class="boton-principal">${t('Guardar')}</button>
      </div>
    </div>
    <button id="boton-volver" class="oculto" title="${t('Volver a donde estabas (Alt+←)')}">${t('← Volver')}</button>
    <div id="aviso-accion" class="oculto" role="status" aria-live="polite"></div>
  </div>
  <aside id="panel-notas" class="oculto" aria-label="${t('Notas del documento')}">
    <div class="panel-encabezado">
      <span class="panel-titulo">${t('Notas')}</span>
      <span id="estado-guardado" aria-live="polite"></span>
    </div>
    <textarea id="campo-notas" placeholder="${t('Escribí tus notas acá…')}" disabled></textarea>
    <button id="boton-anclar" title="${t('Agrega [pág. N] a la línea donde está el cursor')}" disabled>${t('Anclar a pág. {0}', 1)}</button>
    <div class="panel-titulo">${t('Notas por página')}</div>
    <p id="ayuda-anclas">${t('Las líneas con <code>[pág. N]</code> aparecen acá: hacé click para ir a esa página, o borrala con su <strong>×</strong>.')}</p>
    <ul id="lista-anclas"></ul>
    <div class="panel-titulo">${t('Páginas marcadas')}</div>
    <p id="ayuda-marcadores">${t('Con el señalador de la barra (o la tecla <kbd>M</kbd>) marcás una página para volver después.')}</p>
    <ul id="lista-marcadores"></ul>
    <div class="panel-titulo">${t('Resaltados')}</div>
    <p id="ayuda-resaltados">${t('Seleccioná texto del PDF y elegí un color, o usá el botón <strong>Resaltar</strong> de la barra.')}</p>
    <ul id="lista-resaltados"></ul>
    <div class="botones-exportar">
      <button id="boton-exportar" title="${t('Guarda un archivo Markdown con tus notas y resaltados, ordenados por página')}" disabled>${t('Exportar resumen…')}</button>
      <button id="boton-exportar-pdf" title="${t('Guarda una copia del PDF con tus resaltados y comentarios, para abrirla en cualquier lector o compartirla')}" disabled>${t('PDF con resaltados…')}</button>
    </div>
  </aside>
</div>
<script id="config-datos" type="application/json">${configuracion}</script>
<script type="module" src="${uriViewerJs}"></script>
</body>
</html>`;
}

module.exports = { armarHtmlDelVisor };
