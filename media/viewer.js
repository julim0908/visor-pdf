// Código que corre DENTRO del webview (aislado, sin acceso a Node ni al filesystem).
// Se encarga de: cargar pdf.js, pedirle el PDF a la extensión, renderizar páginas
// y manejar la barra de herramientas (zoom, navegación y búsqueda).
import { armarTextoPagina, normalizarConMapa, normalizarConsulta, buscarEnTexto } from './busqueda.js';
import { marcarEnCapa } from './marcas.js';
import { crearLectura } from './lectura.js';
import { crearResaltador } from './resaltador.js';
import { resolverDestino, armarIndice, renderizarLinks } from './indice.js';

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
const campoBusqueda = document.getElementById('campo-busqueda');
const resultadoBusqueda = document.getElementById('resultado-busqueda');
const botonAnterior = document.getElementById('boton-anterior');
const botonSiguiente = document.getElementById('boton-siguiente');
const botonIndice = document.getElementById('boton-indice');
const panelIndice = document.getElementById('panel-indice');
const listaIndice = document.getElementById('lista-indice');
const botonVolver = document.getElementById('boton-volver');
const botonExportar = document.getElementById('boton-exportar');

const PASOS_ZOOM = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const ZOOM_MINIMO = PASOS_ZOOM[0];
const ZOOM_MAXIMO = PASOS_ZOOM[PASOS_ZOOM.length - 1];
// Espacio a los costados de la página en "ajustar al ancho".
// Tiene que coincidir con el padding horizontal de #paginas en viewer.css.
const MARGEN_HORIZONTAL = 48;
// Cuánto por debajo del borde superior del visor miramos para decidir la página actual.
const DESPLAZAMIENTO_DETECCION = 24;

const estado = {
  pdfjsLib: null,
  documentoPdf: null,
  panelIndiceVisible: false,
  // Lugares desde donde se saltó con un link o el índice, para el botón "Volver".
  historial: [],
  // Por página: { pagina, anchoBase, altoBase, wrapper, canvas, renderizada, tareaRender,
  //   promesaTexto, texto, capaTexto }
  paginas: [],
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

const busqueda = {
  consulta: '', // ya normalizada (minúsculas, sin tildes)
  coincidencias: [], // { pagina, rango: [inicio, fin] } en orden de lectura
  porPagina: new Map(), // número de página -> [{ rango, indiceGlobal }]
  indiceActual: -1,
  // Cada búsqueda nueva invalida la anterior si todavía estaba recorriendo páginas.
  version: 0
};

// Si queremos ir a una marca (coincidencia o resaltado) de una página que todavía
// no tiene capa de texto, vamos a la página y nos desplazamos hasta la marca recién
// cuando la capa se termina de armar: { pagina, selector } o null.
let desplazamientoPendiente = null;

const lectura = crearLectura({
  visor,
  paginas: contenedorPaginas,
  obtenerZoom: () => estado.zoom,
  guardar: (preferencias) => vscode.postMessage({ tipo: 'guardar-preferencias', preferencias })
});

// Lo que el resaltador necesita del visor.
const resaltador = crearResaltador({
  paginas: () => estado.paginas,
  remarcarTodas: marcarTodas,
  irAMarca,
  agregarLineaANotas,
  enviar: (mensaje) => vscode.postMessage(mensaje)
});

function mostrarError(mensaje) {
  elementoError.textContent = mensaje;
  elementoError.classList.remove('oculto');
}

async function iniciar() {
  try {
    // pdf.js es un módulo ES normal, lo importamos dinámicamente porque
    // su ruta depende de la URI que nos dio la extensión (asWebviewUri).
    const pdfjsLib = await import(configuracion.uriPdfjs);
    estado.pdfjsLib = pdfjsLib;

    // El worker de pdf.js falla si se lo referencia directo por URL en un webview
    // (origen cruzado), así que lo bajamos nosotros y armamos un Blob URL local.
    const respuestaWorker = await fetch(configuracion.uriPdfWorker);
    const blobWorker = await respuestaWorker.blob();
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blobWorker);

    window.addEventListener('message', (evento) => {
      const mensaje = evento.data;
      if (mensaje.tipo === 'cargar-pdf') {
        cargarPdf(pdfjsLib, mensaje.datos, mensaje.vista);
      } else if (mensaje.tipo === 'preferencias') {
        lectura.aplicar(mensaje.preferencias);
      } else if (mensaje.tipo === 'datos-practico') {
        mostrarDatosPractico(mensaje.practico);
        if (mensaje.inicial) {
          cargarNotas(mensaje.practico);
          resaltador.cargar(mensaje.practico ? mensaje.practico.resaltados : [], Boolean(mensaje.practico));
        }
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
    configurarBusqueda();
    configurarSeleccion();
    configurarIndice();

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
    estado.documentoPdf = documentoPdf;
    await construirPaginas(documentoPdf);
  } catch (error) {
    mostrarError(`No se pudo abrir el PDF: ${error.message}`);
    return;
  }

  // El índice también va antes del zoom: si su panel está abierto, ocupa ancho.
  const entradasIndice = await estado.documentoPdf.getOutline().catch(() => null);
  if (entradasIndice && entradasIndice.length > 0) {
    armarIndice(listaIndice, entradasIndice, irAEntradaIndice);
    botonIndice.disabled = false;
    botonIndice.title = 'Mostrar u ocultar el índice';
    mostrarPanelIndice(Boolean(vistaGuardada && vistaGuardada.panelIndice));
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
      tareaRender: null,
      promesaTexto: null,
      texto: null,
      capaTexto: null,
      linksArmados: false
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
    // La capa de texto de pdf.js se dimensiona con esta variable CSS: así acompaña
    // el zoom sin tener que volver a armarla.
    info.wrapper.style.setProperty('--scale-factor', String(estado.zoom));
    info.renderizada = false;
  }

  etiquetaZoom.textContent = `${Math.round(estado.zoom * 100)}%`;
  botonAlejar.disabled = estado.zoom <= ZOOM_MINIMO;
  botonAcercar.disabled = estado.zoom >= ZOOM_MAXIMO;
  botonAjustarAncho.classList.toggle('activo', estado.modoZoom === 'ancho');
  botonAjustarAncho.setAttribute('aria-pressed', String(estado.modoZoom === 'ancho'));

  lectura.alCambiarZoom();
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
        if (!info) continue;
        if (!info.renderizada) {
          info.renderizada = true;
          renderizarPagina(info);
        }
        if (!info.capaTexto) renderizarCapaTexto(info);
        if (!info.linksArmados) {
          info.linksArmados = true;
          renderizarLinks(info, {
            alLinkExterno: (url) => vscode.postMessage({ tipo: 'abrir-link', url }),
            alLinkInterno: irADestino,
            alAccion: ejecutarAccion
          }).catch((error) => console.warn('Links de la página', info.wrapper.dataset.numeroPagina, error));
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

// Texto de una página según pdf.js. Se pide una sola vez y lo comparten
// la capa de texto y la búsqueda.
function obtenerTextoPagina(info) {
  if (!info.promesaTexto) {
    info.promesaTexto = info.pagina.getTextContent().then(
      (contenido) => {
        const items = contenido.items.filter((item) => item.str !== undefined);
        const { texto, inicios } = armarTextoPagina(items);
        info.texto = {
          contenido,
          textoPlano: texto,
          textosItems: items.map((item) => item.str),
          inicios,
          normalizado: normalizarConMapa(texto)
        };
        return info.texto;
      },
      (error) => {
        info.promesaTexto = null; // que se pueda reintentar
        throw error;
      }
    );
  }
  return info.promesaTexto;
}

// Capa de <span> transparentes ubicados exactamente sobre el texto del canvas:
// es lo que permite seleccionar y copiar. Se arma una vez por página.
async function renderizarCapaTexto(info) {
  info.capaTexto = 'armando';
  try {
    const { contenido } = await obtenerTextoPagina(info);
    const contenedor = document.createElement('div');
    contenedor.className = 'textLayer';
    const capa = new estado.pdfjsLib.TextLayer({
      textContentSource: contenido,
      container: contenedor,
      viewport: info.pagina.getViewport({ scale: estado.zoom })
    });
    await capa.render();

    // Como en el visor oficial de pdf.js: mejora la selección al arrastrar
    // más allá del último renglón.
    const finDeContenido = document.createElement('div');
    finDeContenido.className = 'endOfContent';
    contenedor.append(finDeContenido);
    registrarCapaSeleccionable(contenedor, finDeContenido);

    info.wrapper.append(contenedor);
    info.capaTexto = { contenedor, divs: capa.textDivs };
    marcarPagina(info);
  } catch (error) {
    // Sin capa de texto la página se ve igual; solo no se puede seleccionar.
    info.capaTexto = null;
    console.warn(`Capa de texto de la página ${info.wrapper.dataset.numeroPagina}:`, error);
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
    panelNotas: estado.panelNotasVisible,
    panelIndice: estado.panelIndiceVisible
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
  botonExportar.disabled = !practico;
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

// Agrega una línea al final de las notas (y abre el panel para que se vea).
function agregarLineaANotas(linea) {
  if (campoNotas.disabled) return;
  if (!estado.panelNotasVisible) {
    mostrarPanelNotas(true);
    guardarVista();
  }
  const texto = campoNotas.value;
  const separador = texto === '' || texto.endsWith('\n') ? '' : '\n';
  campoNotas.value = `${texto}${separador}${linea}`;
  campoNotas.scrollTop = campoNotas.scrollHeight;
  alEditarNotas();
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

// ---------- Búsqueda ----------

async function buscar(texto) {
  const version = ++busqueda.version;
  busqueda.consulta = normalizarConsulta(texto);
  if (!busqueda.consulta || estado.paginas.length === 0) {
    limpiarBusqueda();
    return;
  }

  mostrarResultadoBusqueda('Buscando…');
  const coincidencias = [];
  let caracteresTotales = 0;
  // La primera búsqueda tiene que leer el texto de todas las páginas;
  // después queda guardado y las siguientes son instantáneas.
  for (const info of estado.paginas) {
    let textoPagina;
    try {
      textoPagina = await obtenerTextoPagina(info);
    } catch {
      continue;
    }
    if (version !== busqueda.version) return; // se escribió otra cosa mientras tanto
    caracteresTotales += textoPagina.normalizado.normal.trim().length;
    const pagina = Number(info.wrapper.dataset.numeroPagina);
    for (const rango of buscarEnTexto(textoPagina.normalizado, busqueda.consulta)) {
      coincidencias.push({ pagina, rango });
    }
  }

  busqueda.coincidencias = coincidencias;
  busqueda.porPagina = new Map();
  coincidencias.forEach(({ pagina, rango }, indiceGlobal) => {
    if (!busqueda.porPagina.has(pagina)) busqueda.porPagina.set(pagina, []);
    busqueda.porPagina.get(pagina).push({ rango, indiceGlobal });
  });

  if (coincidencias.length === 0) {
    busqueda.indiceActual = -1;
    marcarTodas();
    // Los PDFs escaneados son imágenes: no tienen texto para buscar ni copiar.
    mostrarResultadoBusqueda(caracteresTotales === 0 ? 'Este PDF no tiene texto' : 'Sin resultados', true);
    actualizarBotonesBusqueda();
    return;
  }

  // Empezamos por la primera coincidencia desde la página que se está viendo.
  const desdeAca = coincidencias.findIndex((c) => c.pagina >= estado.paginaActual);
  busqueda.indiceActual = desdeAca === -1 ? 0 : desdeAca;
  irACoincidenciaActual();
}

function limpiarBusqueda() {
  busqueda.version++;
  busqueda.consulta = '';
  busqueda.coincidencias = [];
  busqueda.porPagina = new Map();
  busqueda.indiceActual = -1;
  marcarTodas();
  mostrarResultadoBusqueda('');
  actualizarBotonesBusqueda();
}

function moverCoincidencia(paso) {
  const total = busqueda.coincidencias.length;
  if (total === 0) return;
  busqueda.indiceActual = (busqueda.indiceActual + paso + total) % total;
  irACoincidenciaActual();
}

function irACoincidenciaActual() {
  const total = busqueda.coincidencias.length;
  mostrarResultadoBusqueda(`${busqueda.indiceActual + 1} de ${total}`);
  actualizarBotonesBusqueda();
  marcarTodas();
  irAMarca(busqueda.coincidencias[busqueda.indiceActual].pagina, '.coincidencia.actual');
}

// ---------- Marcas (búsqueda + resaltados) ----------

function marcarTodas() {
  for (const info of estado.paginas) marcarPagina(info);
}

// Pinta en la capa de texto de una página sus resaltados y sus coincidencias de
// búsqueda. Si pueden superponerse, marcarEnCapa combina las clases.
function marcarPagina(info) {
  if (!info.capaTexto || !info.capaTexto.divs || !info.texto) return;
  const pagina = Number(info.wrapper.dataset.numeroPagina);

  const marcas = resaltador.marcasDePagina(pagina, info.texto);
  for (const { rango, indiceGlobal } of busqueda.porPagina.get(pagina) || []) {
    marcas.push({
      inicio: rango[0],
      fin: rango[1],
      clases: indiceGlobal === busqueda.indiceActual ? ['coincidencia', 'actual'] : ['coincidencia']
    });
  }
  marcarEnCapa(info.capaTexto.divs, info.texto.textosItems, info.texto.inicios, marcas);

  if (desplazamientoPendiente && desplazamientoPendiente.pagina === pagina) {
    const elemento = info.wrapper.querySelector(desplazamientoPendiente.selector);
    desplazamientoPendiente = null;
    if (elemento) desplazarHasta(elemento, pagina);
  }
}

// Lleva la vista hasta una marca. Si esa página todavía no tiene capa de texto,
// va a la página y marcarPagina() termina el trabajo cuando la capa está lista.
function irAMarca(pagina, selector) {
  const info = estado.paginas[pagina - 1];
  if (!info) return;
  const elemento = info.capaTexto && info.capaTexto.contenedor ? info.wrapper.querySelector(selector) : null;
  if (elemento) {
    desplazamientoPendiente = null;
    desplazarHasta(elemento, pagina);
  } else {
    desplazamientoPendiente = { pagina, selector };
    irAPagina(pagina);
  }
}

function desplazarHasta(elemento, pagina) {
  elemento.scrollIntoView({ block: 'center', inline: 'nearest' });
  // Al centrar la marca puede quedar arriba el final de la página anterior;
  // igual que en irAPagina, la página actual es a la que saltamos.
  estado.scrollDelSalto = visor.scrollTop;
  campoPagina.value = String(pagina);
  establecerPaginaActual(pagina);
}

function mostrarResultadoBusqueda(texto, esError = false) {
  resultadoBusqueda.textContent = texto;
  resultadoBusqueda.classList.toggle('sin-resultados', esError);
}

function actualizarBotonesBusqueda() {
  const hayCoincidencias = busqueda.coincidencias.length > 0;
  botonAnterior.disabled = !hayCoincidencias;
  botonSiguiente.disabled = !hayCoincidencias;
}

function configurarBusqueda() {
  let temporizador = null;
  campoBusqueda.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => buscar(campoBusqueda.value), 250);
  });

  campoBusqueda.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') {
      evento.preventDefault();
      // Si todavía no se buscó lo que está escrito (Enter antes de la pausa), buscamos ya.
      if (normalizarConsulta(campoBusqueda.value) !== busqueda.consulta) {
        clearTimeout(temporizador);
        buscar(campoBusqueda.value);
      } else {
        moverCoincidencia(evento.shiftKey ? -1 : 1);
      }
    } else if (evento.key === 'Escape') {
      clearTimeout(temporizador);
      campoBusqueda.value = '';
      limpiarBusqueda();
      campoBusqueda.blur();
    }
  });

  botonSiguiente.addEventListener('click', () => moverCoincidencia(1));
  botonAnterior.addEventListener('click', () => moverCoincidencia(-1));

  // Ctrl+F (Cmd+F en Mac) lleva al campo de búsqueda.
  document.addEventListener('keydown', (evento) => {
    if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'f') {
      evento.preventDefault();
      if (campoBusqueda.disabled) return;
      campoBusqueda.focus();
      campoBusqueda.select();
    }
  });

}

// ---------- Selección de texto ----------
// Adaptado de TextLayerBuilder (pdfjs-dist/web/pdf_viewer.mjs). En Chromium, que
// es lo que usa VS Code, la selección se anula si el mouse termina sobre
// .endOfContent (que no es seleccionable). Por eso, mientras se selecciona,
// lo movemos justo después del punto donde va terminando la selección.

const capasSeleccionables = new Map(); // div .textLayer -> su div .endOfContent

function registrarCapaSeleccionable(contenedor, finDeContenido) {
  contenedor.addEventListener('mousedown', () => contenedor.classList.add('selecting'));
  capasSeleccionables.set(contenedor, finDeContenido);
}

function devolverFinDeContenido(finDeContenido, contenedor) {
  contenedor.append(finDeContenido);
  finDeContenido.style.width = '';
  finDeContenido.style.height = '';
  contenedor.classList.remove('selecting');
}

function configurarSeleccion() {
  const devolverTodos = () => capasSeleccionables.forEach(devolverFinDeContenido);
  let punteroApretado = false;
  document.addEventListener('pointerdown', () => {
    punteroApretado = true;
  });
  document.addEventListener('pointerup', () => {
    punteroApretado = false;
    devolverTodos();
  });
  window.addEventListener('blur', () => {
    punteroApretado = false;
    devolverTodos();
  });
  document.addEventListener('keyup', () => {
    if (!punteroApretado) devolverTodos();
  });

  let rangoAnterior = null;
  document.addEventListener('selectionchange', () => {
    const seleccion = document.getSelection();
    if (seleccion.rangeCount === 0) {
      devolverTodos();
      return;
    }
    const rango = seleccion.getRangeAt(0);
    for (const [contenedor, finDeContenido] of capasSeleccionables) {
      if (rango.intersectsNode(contenedor)) contenedor.classList.add('selecting');
      else devolverFinDeContenido(finDeContenido, contenedor);
    }

    // ¿Se está moviendo el principio o el final de la selección?
    const cambiaElInicio =
      rangoAnterior &&
      (rango.compareBoundaryPoints(Range.END_TO_END, rangoAnterior) === 0 ||
        rango.compareBoundaryPoints(Range.START_TO_END, rangoAnterior) === 0);
    let ancla = cambiaElInicio ? rango.startContainer : rango.endContainer;
    if (ancla.nodeType === Node.TEXT_NODE) ancla = ancla.parentNode;

    const capa = ancla.parentElement && ancla.parentElement.closest('.textLayer');
    const finDeContenido = capasSeleccionables.get(capa);
    if (finDeContenido) {
      finDeContenido.style.width = capa.style.width;
      finDeContenido.style.height = capa.style.height;
      ancla.parentElement.insertBefore(finDeContenido, cambiaElInicio ? ancla : ancla.nextSibling);
    }
    rangoAnterior = rango.cloneRange();
  });
}

// ---------- Índice, links y "Volver" ----------

function mostrarPanelIndice(visible) {
  estado.panelIndiceVisible = visible;
  panelIndice.classList.toggle('oculto', !visible);
  botonIndice.classList.toggle('activo', visible);
  botonIndice.setAttribute('aria-pressed', String(visible));
}

async function irAEntradaIndice(entrada) {
  if (entrada.dest) await irADestino(entrada.dest);
  else if (entrada.url) vscode.postMessage({ tipo: 'abrir-link', url: entrada.url });
  else if (entrada.action) ejecutarAccion(entrada.action);
}

async function irADestino(destino) {
  let lugar = null;
  try {
    lugar = await resolverDestino(estado.documentoPdf, destino);
  } catch (error) {
    console.warn('Destino del PDF que no se pudo resolver', destino, error);
  }
  const info = lugar && estado.paginas[lugar.pagina - 1];
  if (!info) return;

  recordarPosicion();
  if (lugar.arriba === null) {
    irAPagina(lugar.pagina);
    return;
  }
  // Convertimos la altura del PDF (que se mide desde abajo) a píxeles de la página.
  const [, y] = info.pagina.getViewport({ scale: estado.zoom }).convertToViewportPoint(0, lugar.arriba);
  visor.scrollTop = info.wrapper.offsetTop + Math.max(y, 0) - 8;
  estado.scrollDelSalto = visor.scrollTop;
  campoPagina.value = String(lugar.pagina);
  establecerPaginaActual(lugar.pagina);
}

// Links que en vez de un destino tienen una acción ("página siguiente", etc.).
function ejecutarAccion(accion) {
  const destinos = {
    NextPage: estado.paginaActual + 1,
    PrevPage: estado.paginaActual - 1,
    FirstPage: 1,
    LastPage: estado.paginas.length
  };
  if (accion === 'GoBack') {
    volver();
  } else if (destinos[accion] !== undefined) {
    recordarPosicion();
    irAPagina(destinos[accion]);
  }
}

// Guardamos la posición como "página + fracción de la página", para que siga
// siendo correcta aunque después cambie el zoom.
function recordarPosicion() {
  if (estado.paginas.length === 0) return;
  const pagina = paginaEnPosicion(visor.scrollTop);
  const wrapper = estado.paginas[pagina - 1].wrapper;
  estado.historial.push({
    pagina: estado.paginaActual,
    paginaAncla: pagina,
    fraccion: (visor.scrollTop - wrapper.offsetTop) / wrapper.offsetHeight
  });
  actualizarBotonVolver();
}

function volver() {
  const anterior = estado.historial.pop();
  if (!anterior) return;
  const wrapper = estado.paginas[anterior.paginaAncla - 1].wrapper;
  visor.scrollTop = wrapper.offsetTop + anterior.fraccion * wrapper.offsetHeight;
  estado.scrollDelSalto = visor.scrollTop;
  campoPagina.value = String(anterior.pagina);
  establecerPaginaActual(anterior.pagina);
  actualizarBotonVolver();
}

function actualizarBotonVolver() {
  const anterior = estado.historial[estado.historial.length - 1];
  botonVolver.classList.toggle('oculto', !anterior);
  if (anterior) botonVolver.textContent = `← Volver a la pág. ${anterior.pagina}`;
}

function configurarIndice() {
  botonIndice.addEventListener('click', () => {
    mostrarPanelIndice(!estado.panelIndiceVisible);
    guardarVista();
  });
  botonVolver.addEventListener('click', volver);
  document.addEventListener('keydown', (evento) => {
    if (evento.altKey && evento.key === 'ArrowLeft') {
      evento.preventDefault();
      volver();
    }
  });
  botonExportar.addEventListener('click', () => vscode.postMessage({ tipo: 'exportar-resumen' }));
}

// ---------- Barra de herramientas ----------

function habilitarBarra() {
  botonAjustarAncho.disabled = false;
  campoPagina.disabled = false;
  campoPagina.max = String(estado.paginas.length);
  etiquetaTotalPaginas.textContent = `de ${estado.paginas.length}`;
  campoBusqueda.disabled = false;
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
