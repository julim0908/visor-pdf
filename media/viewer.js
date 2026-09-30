// Código que corre DENTRO del webview (aislado, sin acceso a Node ni al filesystem).
// Se encarga de: cargar pdf.js, pedirle el PDF a la extensión, renderizar páginas
// y manejar la barra de herramientas (zoom, navegación y búsqueda).
import { armarTextoPagina, normalizarConMapa, normalizarConsulta, buscarEnTexto } from './busqueda.js';
import { marcarEnCapa } from './marcas.js';
import { crearLectura } from './lectura.js';
import { crearResaltador } from './resaltador.js';
import { crearHistorial } from './historial.js';
import { resolverDestino, armarIndice, renderizarLinks } from './indice.js';
import { crearLector, hayVoz } from './voz.js';
import { crearMenuDesplegable } from './menus.js';

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
const botonEstado = document.getElementById('boton-estado');
const menuEstado = document.getElementById('menu-estado');
const iconoEstadoActual = document.getElementById('icono-estado-actual');
const textoEstadoActual = document.getElementById('texto-estado-actual');
const botonesEstado = [...menuEstado.querySelectorAll('.boton-estado')];
const botonPaginaAnterior = document.getElementById('boton-pagina-anterior');
const botonPaginaSiguiente = document.getElementById('boton-pagina-siguiente');
const botonLeer = document.getElementById('boton-leer');
const botonDetenerLectura = document.getElementById('boton-detener-lectura');
const consejo = document.getElementById('consejo');
const botonCerrarConsejo = document.getElementById('boton-cerrar-consejo');
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
const botonAtajos = document.getElementById('boton-atajos');
const panelAtajos = document.getElementById('panel-atajos');

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

// Lo que se puede deshacer con Ctrl+Z: resaltados, notas y el estado del documento.
// (No confundir con estado.historial, que guarda las posiciones para "Volver".)
const acciones = crearHistorial();

// Lo que el resaltador necesita del visor.
const resaltador = crearResaltador({
  paginas: () => estado.paginas,
  remarcarTodas: marcarTodas,
  irAMarca,
  agregarLineasANotas,
  historial: acciones,
  enviar: (mensaje) => vscode.postMessage(mensaje),
  leerTramos: (tramos) => leerEnVozAlta(tramos),
  // Si ya resaltó algo, el consejo de cómo resaltar no hace más falta.
  alResaltar: () => cerrarConsejo()
});

// ---------- Lectura en voz alta ----------

// Qué se está leyendo, para marcarlo en la página: { pagina, inicio, fin } o null.
const lecturaEnCurso = { frase: null, palabra: null };
let tramosALeer = null; // null = desde la página actual hasta el final

const lector = crearLector({
  preferencias: () => ({
    voz: lectura.obtener().voz,
    velocidad: lectura.obtener().velocidadVoz
  }),
  // Lo que hay que leer: los tramos elegidos o, si no hay, todo desde la página actual.
  obtenerTramos: async function* () {
    if (tramosALeer) {
      for (const tramo of tramosALeer) {
        const info = estado.paginas[tramo.pagina - 1];
        const { textoPlano } = await obtenerTextoPagina(info);
        yield { pagina: tramo.pagina, texto: textoPlano, desde: tramo.inicio, hasta: tramo.fin };
      }
      return;
    }
    for (let pagina = estado.paginaActual; pagina <= estado.paginas.length; pagina++) {
      const { textoPlano } = await obtenerTextoPagina(estado.paginas[pagina - 1]);
      yield { pagina, texto: textoPlano, desde: 0, hasta: textoPlano.length };
    }
  },
  alFragmento: (pagina, inicio, fin) => marcarLectura('frase', pagina, inicio, fin),
  alPalabra: (pagina, inicio, fin) => marcarLectura('palabra', pagina, inicio, fin),
  alCambiarEstado: mostrarEstadoLectura,
  alError: (mensaje) => {
    mostrarError(mensaje);
    setTimeout(() => elementoError.classList.add('oculto'), 6000);
  }
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
        mostrarConsejoSiCorresponde();
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
    configurarVoz();
    configurarDeshacer();

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
  mostrarConsejoSiCorresponde();
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
  botonPaginaAnterior.disabled = numero <= 1;
  botonPaginaSiguiente.disabled = numero >= estado.paginas.length;
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

// El estado se elige en un menú desplegable; el botón muestra el ícono y el nombre
// del estado actual. `practico` es null cuando la extensión no pudo leer los datos:
// en ese caso deshabilitamos el botón para no intentar guardar sobre un archivo con errores.
function mostrarDatosPractico(practico) {
  const actual = practico ? practico.estado : null;
  for (const boton of botonesEstado) {
    boton.setAttribute('aria-checked', String(boton.dataset.estado === actual));
  }
  const elegido = botonesEstado.find((b) => b.dataset.estado === actual) || botonesEstado[0];
  iconoEstadoActual.replaceChildren(...[...elegido.querySelectorAll('img')].map((img) => img.cloneNode()));
  textoEstadoActual.textContent = practico ? elegido.querySelector('.nombre-estado').textContent : 'Sin datos';
  botonEstado.disabled = !practico;
  botonEstado.title = practico
    ? `Estado del documento: ${textoEstadoActual.textContent}`
    : 'No se pudieron leer los datos de este documento';
}

function cambiarEstadoPractico(estadoNuevo, { registrar = true } = {}) {
  const anterior = botonesEstado.find((b) => b.getAttribute('aria-checked') === 'true');
  // Lo mostramos al instante; la extensión responde con lo que realmente quedó
  // guardado (y si falló, eso vuelve el botón a como estaba).
  mostrarDatosPractico({ estado: estadoNuevo });
  vscode.postMessage({ tipo: 'cambiar-estado', estado: estadoNuevo });
  if (registrar && anterior && anterior.dataset.estado !== estadoNuevo) {
    const estadoAnterior = anterior.dataset.estado;
    acciones.registrar({
      descripcion: 'cambio de estado',
      deshacer: () => cambiarEstadoPractico(estadoAnterior, { registrar: false }),
      rehacer: () => cambiarEstadoPractico(estadoNuevo, { registrar: false })
    });
  }
}

// ---------- Deshacer / rehacer ----------

const avisoAccion = document.getElementById('aviso-accion');
let temporizadorAvisoAccion = null;

function mostrarAvisoAccion(texto) {
  avisoAccion.textContent = texto;
  avisoAccion.classList.remove('oculto');
  clearTimeout(temporizadorAvisoAccion);
  temporizadorAvisoAccion = setTimeout(() => avisoAccion.classList.add('oculto'), 2200);
}

function deshacer() {
  const accion = acciones.deshacer();
  mostrarAvisoAccion(accion ? `Deshecho: ${accion.descripcion}` : 'No hay nada para deshacer');
}

function rehacer() {
  const accion = acciones.rehacer();
  mostrarAvisoAccion(accion ? `Rehecho: ${accion.descripcion}` : 'No hay nada para rehacer');
}

// Dentro de VS Code, Ctrl+Z a veces no llega como tecla: el editor la intercepta y
// le pide al webview document.execCommand('undo'). Atendemos las dos vías, y como
// a veces llegan ambas por la misma pulsación, ignoramos la segunda si es inmediata.
let ultimoDeshacer = { tipo: null, hora: 0 };

// Campos con su propio deshacer (búsqueda, número de página): ahí no nos metemos.
// Las notas no cuentan: usan el historial general.
const tieneDeshacerPropio = (elemento) =>
  elemento !== campoNotas &&
  elemento instanceof HTMLElement &&
  (elemento.matches('textarea, input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button])') ||
    elemento.isContentEditable);

function atenderDeshacer(tipo) {
  const ahora = Date.now();
  if (ultimoDeshacer.tipo === tipo && ahora - ultimoDeshacer.hora < 150) return;
  ultimoDeshacer = { tipo, hora: ahora };
  if (tipo === 'undo') deshacer();
  else rehacer();
}

function configurarDeshacer() {
  document.addEventListener(
    'keydown',
    (evento) => {
      if (!(evento.ctrlKey || evento.metaKey) || evento.altKey) return;
      const tecla = evento.key.toLowerCase();
      const esDeshacer = tecla === 'z' && !evento.shiftKey;
      const esRehacer = tecla === 'y' || (tecla === 'z' && evento.shiftKey);
      if (!esDeshacer && !esRehacer) return;
      if (tieneDeshacerPropio(evento.target)) return;
      evento.preventDefault();
      atenderDeshacer(esDeshacer ? 'undo' : 'redo');
    },
    true
  );

  const execCommandOriginal = document.execCommand.bind(document);
  document.execCommand = (comando, ...resto) => {
    const nombre = String(comando).toLowerCase();
    if ((nombre === 'undo' || nombre === 'redo') && !tieneDeshacerPropio(document.activeElement)) {
      atenderDeshacer(nombre);
      return true;
    }
    return execCommandOriginal(comando, ...resto);
  };
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
    : 'No se pudieron leer los datos de este documento.';
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

// --- Historial de las notas (para Ctrl+Z) ---

const fotoNotas = () => ({ valor: campoNotas.value, inicio: campoNotas.selectionStart, fin: campoNotas.selectionEnd });

// Vuelve las notas a como estaban en `foto` (sin registrar nada nuevo).
function aplicarNotas(foto) {
  if (!estado.panelNotasVisible) {
    mostrarPanelNotas(true);
    guardarVista();
  }
  campoNotas.value = foto.valor;
  campoNotas.setSelectionRange(foto.inicio, foto.fin);
  rafagaDeEscritura = null;
  alEditarNotas();
}

// Cambia las notas desde el código (anclar, "A notas", borrar una nota) dejando
// el cambio en el historial. `cambio()` modifica campoNotas.
function modificarNotas(descripcion, cambio) {
  if (campoNotas.disabled) return;
  const antes = fotoNotas();
  cambio();
  const despues = fotoNotas();
  if (despues.valor === antes.valor) return;
  acciones.registrar({ descripcion, deshacer: () => aplicarNotas(antes), rehacer: () => aplicarNotas(despues) });
  rafagaDeEscritura = null;
  alEditarNotas();
}

// Lo que se escribe de corrido (sin pausas de más de un segundo) se deshace de una
// vez, como en cualquier editor. Esta es la acción del historial que se va armando.
let rafagaDeEscritura = null;
const PAUSA_ENTRE_RAFAGAS_MS = 1000;

function registrarEscritura(evento) {
  // El deshacer propio del campo (por ejemplo desde el menú contextual) no conoce el
  // resto del historial: lo cambiamos por el nuestro.
  if (evento.inputType === 'historyUndo' || evento.inputType === 'historyRedo') {
    evento.preventDefault();
    atenderDeshacer(evento.inputType === 'historyUndo' ? 'undo' : 'redo');
    return;
  }
  const borrando = evento.inputType.startsWith('delete');
  const ahora = Date.now();
  const sigue =
    rafagaDeEscritura &&
    acciones.ultima() === rafagaDeEscritura &&
    rafagaDeEscritura.borrando === borrando &&
    ahora - rafagaDeEscritura.hora < PAUSA_ENTRE_RAFAGAS_MS &&
    evento.inputType !== 'insertLineBreak' &&
    !evento.inputType.startsWith('insertFrom'); // pegar o arrastrar: acción aparte
  if (sigue) {
    rafagaDeEscritura.hora = ahora;
    return;
  }
  const accion = {
    descripcion: borrando ? 'borrado en las notas' : 'escritura en las notas',
    borrando,
    hora: ahora,
    antes: fotoNotas(),
    despues: null,
    deshacer() {
      // Lo escrito recién se "saca la foto" al deshacer: hasta ahí seguía creciendo.
      if (!accion.despues) accion.despues = fotoNotas();
      aplicarNotas(accion.antes);
    },
    rehacer: () => aplicarNotas(accion.despues)
  };
  acciones.registrar(accion);
  rafagaDeEscritura = accion;
}

// Agrega líneas al final de las notas (y abre el panel para que se vean).
function agregarLineasANotas(lineas) {
  if (campoNotas.disabled || lineas.length === 0) return;
  if (!estado.panelNotasVisible) {
    mostrarPanelNotas(true);
    guardarVista();
  }
  modificarNotas('texto pasado a las notas', () => {
    const texto = campoNotas.value;
    const separador = texto === '' || texto.endsWith('\n') ? '' : '\n';
    campoNotas.value = `${texto}${separador}${lineas.join('\n')}`;
    campoNotas.setSelectionRange(campoNotas.value.length, campoNotas.value.length);
  });
  campoNotas.scrollTop = campoNotas.scrollHeight;
}

// Borra una línea de las notas (la de índice `numeroLinea`).
function borrarLineaDeNotas(numeroLinea) {
  modificarNotas('nota borrada', () => {
    const lineas = campoNotas.value.split('\n');
    lineas.splice(numeroLinea, 1);
    const inicio = lineas.slice(0, numeroLinea).join('\n').length;
    campoNotas.value = lineas.join('\n');
    campoNotas.setSelectionRange(inicio, inicio);
  });
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
  modificarNotas(`nota anclada a la pág. ${estado.paginaActual}`, () => {
    campoNotas.setRangeText(`[pág. ${estado.paginaActual}] ${lineaSinAncla}`, inicioLinea, finLinea, 'end');
  });
  campoNotas.focus();
}

// Arma la lista de líneas ancladas. Todo con textContent (nunca innerHTML),
// porque el texto viene del JSON y podría tener cualquier cosa.
function actualizarListaAnclas() {
  listaAnclas.replaceChildren();

  campoNotas.value.split('\n').forEach((linea, numeroLinea) => {
    const coincidencia = linea.match(PATRON_ANCLA);
    if (!coincidencia) return;
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

    const botonBorrar = document.createElement('button');
    botonBorrar.className = 'quitar-item';
    botonBorrar.textContent = '×';
    botonBorrar.title = 'Borrar esta nota (se puede deshacer con Ctrl+Z)';
    botonBorrar.setAttribute('aria-label', `Borrar la nota de la página ${pagina}: ${resumen.textContent}`);
    botonBorrar.disabled = campoNotas.disabled;
    botonBorrar.addEventListener('click', () => borrarLineaDeNotas(numeroLinea));

    const item = document.createElement('li');
    item.className = 'item-con-quitar';
    item.append(boton, botonBorrar);
    listaAnclas.append(item);
  });

  ayudaAnclas.classList.toggle('oculto', listaAnclas.childElementCount > 0);
  botonNotas.classList.toggle('tiene-notas', campoNotas.value.trim() !== '');
}

function configurarNotas() {
  botonNotas.addEventListener('click', () => {
    mostrarPanelNotas(!estado.panelNotasVisible);
    if (estado.panelNotasVisible && !campoNotas.disabled) campoNotas.focus();
    guardarVista();
  });
  campoNotas.addEventListener('beforeinput', registrarEscritura);
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
  // Lectura en voz alta: la frase que se está leyendo y, más marcada, la palabra.
  const { frase, palabra } = lecturaEnCurso;
  if (frase && frase.pagina === pagina) marcas.push({ inicio: frase.inicio, fin: frase.fin, clases: ['leyendo-frase'] });
  if (palabra && palabra.pagina === pagina) {
    marcas.push({ inicio: palabra.inicio, fin: palabra.fin, clases: ['leyendo-palabra'] });
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
    // Si el punto cae dentro de una marca (resaltado, búsqueda, lectura), subimos
    // hasta el renglón: si .endOfContent quedara adentro del renglón, taparía el
    // texto marcado y ya no se podría seleccionar.
    while (
      ancla.parentElement &&
      !ancla.parentElement.classList.contains('textLayer') &&
      !ancla.parentElement.classList.contains('markedContent') &&
      ancla.parentElement.closest('.textLayer')
    ) {
      ancla = ancla.parentElement;
    }

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

// ---------- Lectura en voz alta (interfaz) ----------

// `tramos`: lo que hay que leer ({ pagina, inicio, fin }), o nada para leer
// desde la página actual hasta el final.
function leerEnVozAlta(tramos) {
  tramosALeer = tramos && tramos.length > 0 ? tramos : null;
  lector.leer();
}

function marcarLectura(tipo, pagina, inicio, fin) {
  const anterior = lecturaEnCurso[tipo];
  lecturaEnCurso[tipo] = pagina ? { pagina, inicio, fin } : null;
  for (const numero of new Set([anterior && anterior.pagina, pagina])) {
    if (numero && estado.paginas[numero - 1]) marcarPagina(estado.paginas[numero - 1]);
  }
  if (tipo === 'palabra' && pagina) mantenerALaVista(pagina);
}

// Mueve la página para que la palabra que se está leyendo no quede fuera de la pantalla.
function mantenerALaVista(pagina) {
  const info = estado.paginas[pagina - 1];
  const elemento = info.wrapper.querySelector('.leyendo-palabra');
  if (!elemento) {
    // La página todavía no tiene capa de texto: la traemos a la vista para que se arme.
    const { top, bottom } = info.wrapper.getBoundingClientRect();
    const zona = visor.getBoundingClientRect();
    if (bottom < zona.top || top > zona.bottom) irAPagina(pagina);
    return;
  }
  const palabra = elemento.getBoundingClientRect();
  const zona = visor.getBoundingClientRect();
  if (palabra.top < zona.top + 40 || palabra.bottom > zona.bottom - 40) {
    elemento.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
}

function mostrarEstadoLectura(estadoLector) {
  botonLeer.dataset.estado = estadoLector;
  botonLeer.classList.toggle('activo', estadoLector !== 'detenido');
  const textos = {
    detenido: ['Leer', 'Leer en voz alta (si hay texto seleccionado, lee solo eso)'],
    leyendo: ['Pausar', 'Pausar la lectura'],
    pausado: ['Seguir', 'Seguir leyendo']
  }[estadoLector];
  botonLeer.querySelector('.etiqueta').textContent = textos[0];
  botonLeer.title = textos[1];
  botonDetenerLectura.classList.toggle('oculto', estadoLector === 'detenido');
}

function configurarVoz() {
  botonLeer.addEventListener('click', () => {
    if (lector.estado() !== 'detenido') {
      lector.pausarOSeguir();
      return;
    }
    const tramos = resaltador.tramosDeSeleccion();
    if (tramos.length > 0) document.getSelection().removeAllRanges();
    leerEnVozAlta(tramos);
  });
  botonDetenerLectura.addEventListener('click', () => lector.detener());
}

// ---------- Consejo para quien abre el visor por primera vez ----------

function mostrarConsejoSiCorresponde() {
  consejo.classList.toggle('oculto', Boolean(lectura.obtener().consejoVisto) || estado.paginas.length === 0);
}

function cerrarConsejo() {
  consejo.classList.add('oculto');
  if (!lectura.obtener().consejoVisto) lectura.cambiar({ consejoVisto: true });
}

// ---------- Barra de herramientas ----------

function habilitarBarra() {
  botonAjustarAncho.disabled = false;
  campoPagina.disabled = false;
  campoPagina.max = String(estado.paginas.length);
  etiquetaTotalPaginas.textContent = `de ${estado.paginas.length}`;
  campoBusqueda.disabled = false;
  botonLeer.disabled = !hayVoz();
  if (!hayVoz()) botonLeer.title = 'Esta versión de VS Code no permite leer en voz alta';
}

const esCampoEditable = (elemento) =>
  elemento instanceof HTMLElement && (elemento.matches('input, textarea, select') || elemento.isContentEditable);

function configurarBarra() {
  botonAcercar.addEventListener('click', () => cambiarZoom(siguientePasoZoom(+1), 'manual'));
  botonAlejar.addEventListener('click', () => cambiarZoom(siguientePasoZoom(-1), 'manual'));
  botonAjustarAncho.addEventListener('click', () =>
    cambiarZoom(calcularZoomAjustadoAlAncho(), 'ancho')
  );

  crearMenuDesplegable(botonEstado, menuEstado);
  for (const boton of botonesEstado) {
    boton.addEventListener('click', () => {
      if (boton.getAttribute('aria-checked') !== 'true') cambiarEstadoPractico(boton.dataset.estado);
    });
  }

  botonPaginaAnterior.addEventListener('click', () => irAPagina(estado.paginaActual - 1));
  botonPaginaSiguiente.addEventListener('click', () => irAPagina(estado.paginaActual + 1));
  // RePág / AvPág cambian de página y + / − el zoom (salvo mientras se escribe en un campo).
  document.addEventListener('keydown', (evento) => {
    if (esCampoEditable(evento.target) || estado.paginas.length === 0) return;
    if (evento.key === 'PageDown' || evento.key === 'PageUp') {
      evento.preventDefault();
      irAPagina(estado.paginaActual + (evento.key === 'PageDown' ? 1 : -1));
    } else if (!evento.ctrlKey && !evento.metaKey && !evento.altKey && ['+', '=', '-'].includes(evento.key)) {
      evento.preventDefault();
      cambiarZoom(siguientePasoZoom(evento.key === '-' ? -1 : +1), 'manual');
    }
  });

  // Panel de atajos: con su botón o con "?".
  const menuAtajos = crearMenuDesplegable(botonAtajos, panelAtajos);
  const abrirAtajos = () => {
    menuAtajos.abrir();
    panelAtajos.focus();
  };
  botonAtajos.addEventListener('click', () => {
    if (menuAtajos.estaAbierto()) panelAtajos.focus();
  });
  document.addEventListener('keydown', (evento) => {
    if (evento.key !== '?' || evento.ctrlKey || evento.metaKey || evento.altKey || esCampoEditable(evento.target)) return;
    evento.preventDefault();
    if (menuAtajos.estaAbierto()) menuAtajos.cerrar(true);
    else abrirAtajos();
  });

  botonCerrarConsejo.addEventListener('click', cerrarConsejo);

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
