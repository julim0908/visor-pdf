// Código que corre DENTRO del webview (aislado, sin acceso a Node ni al filesystem).
// Se encarga de: cargar pdf.js, pedirle el PDF a la extensión, renderizar páginas
// y manejar la barra de herramientas (zoom y navegación).

const vscode = acquireVsCodeApi();

// Los datos vienen del bloque <script id="config-datos"> que arma extension.js.
const configuracion = JSON.parse(document.getElementById('config-datos').textContent);

const visor = document.getElementById('visor');
const contenedorPaginas = document.getElementById('paginas');
const elementoError = document.getElementById('mensaje-error');
const botonAlejar = document.getElementById('boton-alejar');
const botonAcercar = document.getElementById('boton-acercar');
const botonAjustarAncho = document.getElementById('boton-ajustar-ancho');
const etiquetaZoom = document.getElementById('etiqueta-zoom');
const campoPagina = document.getElementById('campo-pagina');
const etiquetaTotalPaginas = document.getElementById('etiqueta-total-paginas');
const grupoEstado = document.getElementById('grupo-estado');
const botonesEstado = [...document.querySelectorAll('.boton-estado')];
const botonNotas = document.getElementById('boton-notas');
const panelNotas = document.getElementById('panel-notas');
const campoNotas = document.getElementById('campo-notas');
const estadoGuardado = document.getElementById('estado-guardado');
const botonAnclar = document.getElementById('boton-anclar');
const listaAnclas = document.getElementById('lista-anclas');
const ayudaAnclas = document.getElementById('ayuda-anclas');

const PASOS_ZOOM = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const ZOOM_MINIMO = PASOS_ZOOM[0];
const ZOOM_MAXIMO = PASOS_ZOOM[PASOS_ZOOM.length - 1];
// Espacio a los costados de la página en "ajustar al ancho".
// Tiene que coincidir con el padding horizontal de #paginas en viewer.css.
const MARGEN_HORIZONTAL = 48;
// Cuánto por debajo del borde superior del visor miramos para decidir la página actual.
const DESPLAZAMIENTO_DETECCION = 24;

const estado = {
  paginas: [], // { pagina, anchoBase, altoBase, wrapper, canvas, renderizada, tareaRender }
  zoom: 1,
  modoZoom: 'ancho', // 'ancho': se recalcula si cambia el tamaño del visor. 'manual': fijo.
  paginaActual: 1,
  observador: null,
  scrollDelSalto: null,
  ultimaVistaEnviada: '',
  panelNotasVisible: false,
  // Cada edición de las notas incrementa la revisión; la extensión nos dice qué
  // revisión guardó, así sabemos si lo que se ve en pantalla ya está guardado.
  revisionNotas: 0
};

function mostrarError(mensaje) {
  elementoError.textContent = mensaje;
  elementoError.classList.remove('oculto');
}

async function iniciar() {
  try {
    // pdf.js es un módulo ES normal, lo importamos dinámicamente porque
    // su ruta depende de la URI que nos dio la extensión (asWebviewUri).
    const pdfjsLib = await import(configuracion.uriPdfjs);

    // El worker de pdf.js falla si se lo referencia directo por URL en un webview
    // (origen cruzado), así que lo bajamos nosotros y armamos un Blob URL local.
    const respuestaWorker = await fetch(configuracion.uriPdfWorker);
    const blobWorker = await respuestaWorker.blob();
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blobWorker);

    window.addEventListener('message', (evento) => {
      const mensaje = evento.data;
      if (mensaje.tipo === 'cargar-pdf') {
        cargarPdf(pdfjsLib, mensaje.datos, mensaje.vista);
      } else if (mensaje.tipo === 'datos-practico') {
        mostrarDatosPractico(mensaje.practico);
        if (mensaje.inicial) cargarNotas(mensaje.practico);
      } else if (mensaje.tipo === 'notas-guardadas') {
        confirmarGuardadoNotas(mensaje.revision, true);
      } else if (mensaje.tipo === 'notas-no-guardadas') {
        confirmarGuardadoNotas(mensaje.revision, false);
      } else if (mensaje.tipo === 'error') {
        mostrarError(mensaje.mensaje);
      }
    });

    configurarBarra();
    configurarNotas();

    // Avisamos a la extensión que ya podemos recibir el PDF.
    vscode.postMessage({ tipo: 'listo' });
  } catch (error) {
    mostrarError(`No se pudo inicializar el visor: ${error.message}`);
  }
}

async function cargarPdf(pdfjsLib, datosPdf, vistaGuardada) {
  // Antes de calcular "ajustar al ancho", porque el panel le quita ancho al visor.
  mostrarPanelNotas(Boolean(vistaGuardada && vistaGuardada.panelNotas));

  try {
    const documentoPdf = await pdfjsLib.getDocument({ data: datosPdf }).promise;
    await construirPaginas(documentoPdf);
  } catch (error) {
    mostrarError(`No se pudo abrir el PDF: ${error.message}`);
    return;
  }

  if (vistaGuardada && vistaGuardada.modoZoom === 'manual') {
    estado.modoZoom = 'manual';
    estado.zoom = limitarZoom(vistaGuardada.zoom);
  } else {
    estado.modoZoom = 'ancho';
    estado.zoom = calcularZoomAjustadoAlAncho();
  }

  habilitarBarra();
  aplicarZoom();
  irAPagina((vistaGuardada && vistaGuardada.pagina) || 1);
}

// Crea un contenedor por página, sin dibujar todavía: eso lo hace el
// IntersectionObserver a medida que cada página se acerca a la pantalla.
async function construirPaginas(documentoPdf) {
  contenedorPaginas.innerHTML = '';
  estado.paginas = [];

  for (let numeroPagina = 1; numeroPagina <= documentoPdf.numPages; numeroPagina++) {
    const pagina = await documentoPdf.getPage(numeroPagina);
    const viewport = pagina.getViewport({ scale: 1 });

    const wrapper = document.createElement('div');
    wrapper.className = 'pagina-wrapper';
    wrapper.dataset.numeroPagina = String(numeroPagina);

    const canvas = document.createElement('canvas');
    wrapper.appendChild(canvas);
    contenedorPaginas.appendChild(wrapper);

    estado.paginas.push({
      pagina,
      anchoBase: viewport.width,
      altoBase: viewport.height,
      wrapper,
      canvas,
      renderizada: false,
      tareaRender: null
    });
  }
}

// ---------- Zoom ----------

function limitarZoom(zoom) {
  return Math.min(Math.max(Number(zoom) || 1, ZOOM_MINIMO), ZOOM_MAXIMO);
}

function calcularZoomAjustadoAlAncho() {
  if (estado.paginas.length === 0) return 1;
  const anchoMaximo = Math.max(...estado.paginas.map((info) => info.anchoBase));
  return limitarZoom((visor.clientWidth - MARGEN_HORIZONTAL) / anchoMaximo);
}

function siguientePasoZoom(direccion) {
  if (direccion > 0) {
    return PASOS_ZOOM.find((paso) => paso > estado.zoom + 0.001) ?? ZOOM_MAXIMO;
  }
  return [...PASOS_ZOOM].reverse().find((paso) => paso < estado.zoom - 0.001) ?? ZOOM_MINIMO;
}

// Cambia el tamaño de todas las páginas al zoom actual y marca todas para
// volver a dibujarse (solo se redibujan las que están cerca de la pantalla).
function aplicarZoom() {
  for (const info of estado.paginas) {
    info.wrapper.style.width = `${Math.floor(info.anchoBase * estado.zoom)}px`;
    info.wrapper.style.height = `${Math.floor(info.altoBase * estado.zoom)}px`;
    info.renderizada = false;
  }

  etiquetaZoom.textContent = `${Math.round(estado.zoom * 100)}%`;
  botonAlejar.disabled = estado.zoom <= ZOOM_MINIMO;
  botonAcercar.disabled = estado.zoom >= ZOOM_MAXIMO;
  botonAjustarAncho.classList.toggle('activo', estado.modoZoom === 'ancho');
  botonAjustarAncho.setAttribute('aria-pressed', String(estado.modoZoom === 'ancho'));

  observarPaginas();
}

function cambiarZoom(nuevoZoom, modo) {
  nuevoZoom = limitarZoom(nuevoZoom);
  if (Math.abs(nuevoZoom - estado.zoom) < 0.001 && modo === estado.modoZoom) return;

  // Recordamos en qué parte de qué página estábamos, para no perder el lugar.
  const infoAncla = estado.paginas[paginaEnPosicion(visor.scrollTop) - 1];
  const fraccion = (visor.scrollTop - infoAncla.wrapper.offsetTop) / infoAncla.wrapper.offsetHeight;

  estado.zoom = nuevoZoom;
  estado.modoZoom = modo;
  aplicarZoom();

  visor.scrollTop = infoAncla.wrapper.offsetTop + fraccion * infoAncla.wrapper.offsetHeight;
  guardarVista();
}

// ---------- Renderizado ----------

function observarPaginas() {
  if (estado.observador) estado.observador.disconnect();

  // root: visor (y no la ventana) porque el scroll ocurre dentro de #visor,
  // y porque en iframes como el webview el rootMargin se ignora sin root explícito.
  estado.observador = new IntersectionObserver(
    (entradas) => {
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        const info = estado.paginas[Number(entrada.target.dataset.numeroPagina) - 1];
        if (info && !info.renderizada) {
          info.renderizada = true;
          renderizarPagina(info);
        }
      }
    },
    { root: visor, rootMargin: '300px 0px' }
  );

  for (const info of estado.paginas) estado.observador.observe(info.wrapper);
}

async function renderizarPagina(info) {
  if (info.tareaRender) info.tareaRender.cancel();

  // Dibujamos a zoom × densidad de pantalla para que se vea nítido en pantallas
  // de alta densidad; el CSS muestra el canvas al tamaño del contenedor.
  const escala = estado.zoom * (window.devicePixelRatio || 1);
  const viewport = info.pagina.getViewport({ scale: escala });

  // Dibujamos en un canvas nuevo y recién al terminar reemplazamos el viejo,
  // así al hacer zoom la página no parpadea en blanco.
  const canvasNuevo = document.createElement('canvas');
  canvasNuevo.width = Math.floor(viewport.width);
  canvasNuevo.height = Math.floor(viewport.height);

  const tarea = info.pagina.render({ canvasContext: canvasNuevo.getContext('2d'), viewport });
  info.tareaRender = tarea;

  try {
    await tarea.promise;
    info.wrapper.replaceChild(canvasNuevo, info.canvas);
    info.canvas = canvasNuevo;
  } catch (error) {
    // Cancelar es normal cuando se cambia el zoom a mitad de un dibujo.
    if (error.name !== 'RenderingCancelledException') {
      mostrarError(`Error al dibujar la página ${info.wrapper.dataset.numeroPagina}: ${error.message}`);
    }
  } finally {
    if (info.tareaRender === tarea) info.tareaRender = null;
  }
}

// ---------- Navegación ----------

// Búsqueda binaria: devuelve el número de la página que está en la posición vertical `y`.
function paginaEnPosicion(y) {
  let izquierda = 0;
  let derecha = estado.paginas.length - 1;
  while (izquierda < derecha) {
    const medio = Math.ceil((izquierda + derecha) / 2);
    if (estado.paginas[medio].wrapper.offsetTop <= y) izquierda = medio;
    else derecha = medio - 1;
  }
  return izquierda + 1;
}

function irAPagina(numero) {
  if (estado.paginas.length === 0) return;
  const numeroPedido = Math.round(Number(numero));
  if (String(numero).trim() === '' || !Number.isFinite(numeroPedido)) {
    campoPagina.value = String(estado.paginaActual);
    return;
  }
  const destino = Math.min(Math.max(numeroPedido, 1), estado.paginas.length);

  visor.scrollTop = estado.paginas[destino - 1].wrapper.offsetTop - DESPLAZAMIENTO_DETECCION / 2;
  // Cerca del final el scroll no puede llegar tan abajo; recordamos dónde quedó
  // para que el detector de página no pise el número al que saltamos.
  estado.scrollDelSalto = visor.scrollTop;

  campoPagina.value = String(destino);
  establecerPaginaActual(destino);
}

function actualizarPaginaActualSegunScroll() {
  if (estado.paginas.length === 0 || visor.scrollTop === estado.scrollDelSalto) return;
  estado.scrollDelSalto = null;

  const llegoAlFinal = visor.scrollTop + visor.clientHeight >= visor.scrollHeight - 2;
  const numero = llegoAlFinal
    ? estado.paginas.length
    : paginaEnPosicion(visor.scrollTop + DESPLAZAMIENTO_DETECCION);

  if (document.activeElement !== campoPagina) campoPagina.value = String(numero);
  establecerPaginaActual(numero);
}

function establecerPaginaActual(numero) {
  estado.paginaActual = numero;
  botonAnclar.textContent = `Anclar a pág. ${numero}`;
  guardarVista();
}

// Le manda a la extensión el zoom y la página actual, solo si cambiaron.
function guardarVista() {
  const vista = {
    modoZoom: estado.modoZoom,
    zoom: estado.modoZoom === 'manual' ? estado.zoom : null,
    pagina: estado.paginaActual,
    panelNotas: estado.panelNotasVisible
  };
  const serializada = JSON.stringify(vista);
  if (serializada === estado.ultimaVistaEnviada) return;
  estado.ultimaVistaEnviada = serializada;
  vscode.postMessage({ tipo: 'guardar-vista', vista });
}

// ---------- Estado del práctico ----------

// `practico` es null cuando la extensión no pudo leer los datos: en ese caso
// deshabilitamos los botones para no intentar guardar sobre un archivo con errores.
function mostrarDatosPractico(practico) {
  for (const boton of botonesEstado) {
    const activo = Boolean(practico) && boton.dataset.estado === practico.estado;
    boton.disabled = !practico;
    boton.classList.toggle('activo', activo);
    boton.setAttribute('aria-pressed', String(activo));
  }
  grupoEstado.title = practico ? '' : 'No se pudieron leer los datos de este práctico';
}

function cambiarEstadoPractico(estadoNuevo) {
  // Lo mostramos al instante; la extensión responde con lo que realmente quedó
  // guardado (y si falló, eso vuelve el botón a como estaba).
  mostrarDatosPractico({ estado: estadoNuevo });
  vscode.postMessage({ tipo: 'cambiar-estado', estado: estadoNuevo });
}

// ---------- Notas ----------

// Una línea de las notas que contiene "[pág. N]" queda anclada a esa página.
const PATRON_ANCLA = /\[p[áa]g\.?\s*(\d+)\]/i;

function quitarAncla(linea) {
  return linea.replace(PATRON_ANCLA, ' ').replace(/\s+/g, ' ').trim();
}

function mostrarPanelNotas(visible) {
  estado.panelNotasVisible = visible;
  panelNotas.classList.toggle('oculto', !visible);
  botonNotas.classList.toggle('activo', visible);
  botonNotas.setAttribute('aria-pressed', String(visible));
}

// Solo se llama al abrir el PDF: después, el texto en pantalla es la fuente de verdad.
function cargarNotas(practico) {
  campoNotas.disabled = !practico;
  botonAnclar.disabled = !practico;
  campoNotas.value = practico ? practico.notas || '' : '';
  campoNotas.placeholder = practico
    ? 'Escribí tus notas acá…'
    : 'No se pudieron leer los datos de este práctico.';
  mostrarEstadoGuardado('');
  actualizarListaAnclas();
}

function alEditarNotas() {
  estado.revisionNotas++;
  // Mandamos cada cambio; la extensión espera 800 ms sin cambios antes de escribir.
  vscode.postMessage({ tipo: 'editar-notas', notas: campoNotas.value, revision: estado.revisionNotas });
  mostrarEstadoGuardado('Sin guardar…');
  actualizarListaAnclas();
}

function confirmarGuardadoNotas(revision, guardadoOk) {
  // Si se siguió escribiendo después de esa revisión, todavía falta otro guardado.
  if (revision !== estado.revisionNotas) return;
  mostrarEstadoGuardado(guardadoOk ? 'Guardado' : 'No se pudo guardar', !guardadoOk);
}

function mostrarEstadoGuardado(texto, esError = false) {
  estadoGuardado.textContent = texto;
  estadoGuardado.classList.toggle('error', esError);
}

// Pone "[pág. N] " al principio de la línea donde está el cursor
// (reemplazando la etiqueta que ya tuviera).
function anclarLineaActual() {
  const texto = campoNotas.value;
  const cursor = campoNotas.selectionStart;
  const inicioLinea = cursor === 0 ? 0 : texto.lastIndexOf('\n', cursor - 1) + 1;
  const saltoSiguiente = texto.indexOf('\n', cursor);
  const finLinea = saltoSiguiente === -1 ? texto.length : saltoSiguiente;

  const lineaSinAncla = quitarAncla(texto.slice(inicioLinea, finLinea));
  campoNotas.setRangeText(`[pág. ${estado.paginaActual}] ${lineaSinAncla}`, inicioLinea, finLinea, 'end');
  campoNotas.focus();
  alEditarNotas();
}

// Arma la lista de líneas ancladas. Todo con textContent (nunca innerHTML),
// porque el texto viene del JSON y podría tener cualquier cosa.
function actualizarListaAnclas() {
  listaAnclas.replaceChildren();

  for (const linea of campoNotas.value.split('\n')) {
    const coincidencia = linea.match(PATRON_ANCLA);
    if (!coincidencia) continue;
    const pagina = Number(coincidencia[1]);

    const etiqueta = document.createElement('span');
    etiqueta.className = 'pagina-ancla';
    etiqueta.textContent = `pág. ${pagina}`;

    const resumen = document.createElement('span');
    resumen.className = 'texto-ancla';
    resumen.textContent = quitarAncla(linea) || '(sin texto)';

    const boton = document.createElement('button');
    boton.className = 'ancla';
    boton.title = `Ir a la página ${pagina}`;
    boton.append(etiqueta, resumen);
    boton.addEventListener('click', () => irAPagina(pagina));

    const item = document.createElement('li');
    item.append(boton);
    listaAnclas.append(item);
  }

  ayudaAnclas.classList.toggle('oculto', listaAnclas.childElementCount > 0);
  botonNotas.classList.toggle('tiene-notas', campoNotas.value.trim() !== '');
}

function configurarNotas() {
  botonNotas.addEventListener('click', () => {
    mostrarPanelNotas(!estado.panelNotasVisible);
    if (estado.panelNotasVisible && !campoNotas.disabled) campoNotas.focus();
    guardarVista();
  });
  campoNotas.addEventListener('input', alEditarNotas);
  botonAnclar.addEventListener('click', anclarLineaActual);
}

// ---------- Barra de herramientas ----------

function habilitarBarra() {
  botonAjustarAncho.disabled = false;
  campoPagina.disabled = false;
  campoPagina.max = String(estado.paginas.length);
  etiquetaTotalPaginas.textContent = `de ${estado.paginas.length}`;
}

function configurarBarra() {
  botonAcercar.addEventListener('click', () => cambiarZoom(siguientePasoZoom(+1), 'manual'));
  botonAlejar.addEventListener('click', () => cambiarZoom(siguientePasoZoom(-1), 'manual'));
  botonAjustarAncho.addEventListener('click', () =>
    cambiarZoom(calcularZoomAjustadoAlAncho(), 'ancho')
  );

  for (const boton of botonesEstado) {
    boton.addEventListener('click', () => {
      if (!boton.classList.contains('activo')) cambiarEstadoPractico(boton.dataset.estado);
    });
  }

  campoPagina.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') {
      irAPagina(campoPagina.value);
      campoPagina.select();
    }
  });
  campoPagina.addEventListener('change', () => irAPagina(campoPagina.value));
  campoPagina.addEventListener('blur', () => {
    campoPagina.value = String(estado.paginaActual);
  });

  // requestAnimationFrame: como mucho un cálculo por cuadro, aunque el scroll dispare muchos eventos.
  let cuadroPendiente = false;
  visor.addEventListener('scroll', () => {
    if (cuadroPendiente) return;
    cuadroPendiente = true;
    requestAnimationFrame(() => {
      cuadroPendiente = false;
      actualizarPaginaActualSegunScroll();
    });
  });

  // En modo "ajustar al ancho", si cambia el tamaño del editor, reajustamos.
  let temporizadorResize = null;
  new ResizeObserver(() => {
    if (estado.modoZoom !== 'ancho' || estado.paginas.length === 0) return;
    clearTimeout(temporizadorResize);
    temporizadorResize = setTimeout(() => cambiarZoom(calcularZoomAjustadoAlAncho(), 'ancho'), 150);
  }).observe(visor);
}

iniciar();
