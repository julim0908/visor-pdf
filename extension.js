// Punto de entrada de la extensión.
// Registra el editor personalizado (el visor de PDF) y la vista lateral de prácticos.
const vscode = require('vscode');
const almacen = require('./src/almacen');
const { registrarArbolPracticos } = require('./src/arbolPracticos');

const DEMORA_GUARDADO_NOTAS_MS = 800;

// Guarda las notas de un PDF 800 ms después de la última edición.
// Vive en la extensión (y no en el webview) para poder guardar lo pendiente
// cuando se cierra la pestaña: en ese momento el webview ya no existe.
class GuardadoDeNotas {
  constructor(uriPdf, webview) {
    this.uriPdf = uriPdf;
    this.webview = webview;
    this.pendiente = null; // { notas, revision }
    this.temporizador = null;
    this.ultimoError = null;
  }

  programar(notas, revision) {
    this.pendiente = { notas, revision };
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.guardarAhora(), DEMORA_GUARDADO_NOTAS_MS);
  }

  async guardarAhora() {
    clearTimeout(this.temporizador);
    this.temporizador = null;
    if (!this.pendiente) return;
    const { notas, revision } = this.pendiente;
    this.pendiente = null;

    try {
      await almacen.actualizarPractico(this.uriPdf, { notas });
      this.ultimoError = null;
      this.avisarAlWebview({ tipo: 'notas-guardadas', revision });
    } catch (error) {
      // Si el error se repite en cada pausa al escribir, no lo mostramos una y otra vez.
      if (error.message !== this.ultimoError) vscode.window.showErrorMessage(error.message);
      this.ultimoError = error.message;
      this.avisarAlWebview({ tipo: 'notas-no-guardadas', revision });
    }
  }

  avisarAlWebview(mensaje) {
    if (this.webview) this.webview.postMessage(mensaje);
  }

  // Al cerrar la pestaña: ya no hay webview a quien avisar, pero guardamos lo pendiente.
  cerrar() {
    this.webview = null;
    return this.guardarAhora();
  }
}

// Proveedor del "Custom Editor" que VS Code usa para abrir archivos .pdf.
// Es de solo lectura (CustomReadonlyEditorProvider) porque no editamos el PDF en sí,
// solo lo mostramos (los datos propios del práctico van aparte, en src/almacen.js).
// Preferencias de lectura (color de papel, guía de lectura): son de la persona,
// no de un PDF, así que valen para todos los prácticos y se guardan en VS Code.
const CLAVE_PREFERENCIAS = 'preferenciasLectura';

class ProveedorVisorPdf {
  constructor(contextoExtension) {
    this.contextoExtension = contextoExtension;
    // Para avisarles a todos los visores abiertos cuando cambian las preferencias.
    this.webviewsAbiertos = new Set();
  }

  static register(contextoExtension) {
    const proveedor = new ProveedorVisorPdf(contextoExtension);
    return vscode.window.registerCustomEditorProvider(
      'visorPracticos.pdfViewer',
      proveedor,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false
      }
    );
  }

  // VS Code llama esto para obtener el "documento" asociado al archivo.
  // Como no mantenemos estado editable propio del PDF, devolvemos algo mínimo.
  async openCustomDocument(uri) {
    return { uri, dispose: () => {} };
  }

  // Acá se arma el webview: el HTML, los permisos, y la comunicación con la extensión.
  async resolveCustomEditor(documento, panelWebview) {
    const carpetaMedia = vscode.Uri.joinPath(this.contextoExtension.extensionUri, 'media');
    const carpetaPdfjs = vscode.Uri.joinPath(
      this.contextoExtension.extensionUri,
      'node_modules',
      'pdfjs-dist',
      'build'
    );

    panelWebview.webview.options = {
      enableScripts: true,
      // Solo estas dos carpetas pueden ser leídas por el webview: nuestro código
      // de UI (media/) y los archivos de pdf.js necesarios para renderizar.
      localResourceRoots: [carpetaMedia, carpetaPdfjs]
    };

    panelWebview.webview.html = this.obtenerHtml(panelWebview.webview);

    const webview = panelWebview.webview;
    const guardadoNotas = new GuardadoDeNotas(documento.uri, webview);
    this.webviewsAbiertos.add(webview);

    const suscripcion = webview.onDidReceiveMessage(async (mensaje) => {
      if (!mensaje) return;
      if (mensaje.tipo === 'listo') {
        // Primero las preferencias, así el PDF aparece directamente con el color elegido.
        webview.postMessage({
          tipo: 'preferencias',
          preferencias: this.contextoExtension.globalState.get(CLAVE_PREFERENCIAS) || null
        });
        await Promise.all([
          this.enviarPdfAlWebview(documento.uri, webview),
          this.enviarDatosPractico(documento.uri, webview)
        ]);
      } else if (mensaje.tipo === 'guardar-vista') {
        await this.guardarVista(documento.uri, mensaje.vista);
      } else if (mensaje.tipo === 'cambiar-estado') {
        await this.cambiarEstado(documento.uri, mensaje.estado, webview);
      } else if (mensaje.tipo === 'editar-notas' && typeof mensaje.notas === 'string') {
        guardadoNotas.programar(mensaje.notas, mensaje.revision);
      } else if (mensaje.tipo === 'guardar-resaltados') {
        await this.guardarResaltados(documento.uri, mensaje.resaltados);
      } else if (mensaje.tipo === 'guardar-preferencias') {
        await this.guardarPreferencias(mensaje.preferencias, webview);
      }
    });

    panelWebview.onDidDispose(() => {
      this.webviewsAbiertos.delete(webview);
      suscripcion.dispose();
      guardadoNotas.cerrar();
    });
  }

  async guardarResaltados(uriPdf, resaltados) {
    try {
      await almacen.actualizarPractico(uriPdf, { resaltados });
    } catch (error) {
      // En pantalla los resaltados quedan igual; se vuelven a guardar con el próximo cambio.
      vscode.window.showErrorMessage(`No se pudieron guardar los resaltados: ${error.message}`);
    }
  }

  async guardarPreferencias(preferencias, webviewOrigen) {
    if (!preferencias || typeof preferencias !== 'object') return;
    try {
      await this.contextoExtension.globalState.update(CLAVE_PREFERENCIAS, preferencias);
    } catch (error) {
      console.error('No se pudieron guardar las preferencias de lectura', error);
    }
    for (const webview of this.webviewsAbiertos) {
      if (webview !== webviewOrigen) webview.postMessage({ tipo: 'preferencias', preferencias });
    }
  }

  // Si no se puede leer .practicos.json, avisamos y mandamos `null`: el visor
  // sigue funcionando, solo deshabilita los controles del práctico.
  // `inicial: true` le indica al visor que cargue también el texto de las notas
  // (en las demás respuestas no, para no pisar lo que se está escribiendo).
  async enviarDatosPractico(uriPdf, webview) {
    try {
      const practico = await almacen.leerPractico(uriPdf);
      webview.postMessage({ tipo: 'datos-practico', practico, inicial: true });
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
      webview.postMessage({ tipo: 'datos-practico', practico: null, inicial: true });
    }
  }

  async cambiarEstado(uriPdf, estado, webview) {
    try {
      const practico = await almacen.actualizarPractico(uriPdf, { estado });
      webview.postMessage({ tipo: 'datos-practico', practico });
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
      // El visor ya mostraba el estado nuevo: lo volvemos a lo que realmente quedó guardado.
      const practico = await almacen.leerPractico(uriPdf).catch(() => null);
      webview.postMessage({ tipo: 'datos-practico', practico });
    }
  }

  // El zoom y la última página vista son preferencias de esta compu, no datos
  // del práctico: por eso van al globalState de VS Code y no a .practicos.json.
  claveVista(uri) {
    return `vista:${uri.toString()}`;
  }

  async guardarVista(uri, vista) {
    try {
      await this.contextoExtension.globalState.update(this.claveVista(uri), vista);
    } catch (error) {
      console.error('No se pudo guardar la vista del PDF', error);
    }
  }

  // Lee el PDF del disco (con la API de archivos de VS Code, no con fetch/XHR)
  // y se lo manda al webview por postMessage. El webview nunca toca el filesystem.
  async enviarPdfAlWebview(uriPdf, webview) {
    try {
      const bytes = await vscode.workspace.fs.readFile(uriPdf);
      const vista = this.contextoExtension.globalState.get(this.claveVista(uriPdf));
      // readFile devuelve un Buffer de Node, que postMessage serializa como objeto
      // común; copiándolo a un Uint8Array puro llega como bytes al webview.
      webview.postMessage({ tipo: 'cargar-pdf', datos: new Uint8Array(bytes), vista });
    } catch (error) {
      const mensajeError = `No se pudo leer el archivo PDF: ${error.message}`;
      vscode.window.showErrorMessage(mensajeError);
      webview.postMessage({ tipo: 'error', mensaje: mensajeError });
    }
  }

  // Arma el HTML del webview con una Content Security Policy estricta:
  // nada de scripts inline, todo cargado desde media/ o desde pdfjs-dist.
  obtenerHtml(webview) {
    const uriViewerJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.contextoExtension.extensionUri, 'media', 'viewer.js')
    );
    const uriViewerCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.contextoExtension.extensionUri, 'media', 'viewer.css')
    );
    const uriPdfjs = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.contextoExtension.extensionUri,
        'node_modules',
        'pdfjs-dist',
        'build',
        'pdf.min.mjs'
      )
    );
    const uriPdfWorker = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.contextoExtension.extensionUri,
        'node_modules',
        'pdfjs-dist',
        'build',
        'pdf.worker.min.mjs'
      )
    );
    const uriIcono = (archivo) =>
      webview.asWebviewUri(
        vscode.Uri.joinPath(this.contextoExtension.extensionUri, 'media', 'iconos', archivo)
      );
    // Dos versiones de cada ícono; viewer.css muestra la que corresponde al tema.
    const iconosEstado = (estado) =>
      `<img class="icono-estado para-oscuro" src="${uriIcono(`${estado}.png`)}" alt="">` +
      `<img class="icono-estado para-claro" src="${uriIcono(`${estado}-claro.png`)}" alt="">`;

    // Estos datos los necesita viewer.js pero no podemos usar un <script> inline
    // por la CSP, así que van en un bloque JSON no ejecutable que viewer.js lee.
    const configuracion = JSON.stringify({
      uriPdfjs: uriPdfjs.toString(),
      uriPdfWorker: uriPdfWorker.toString()
    });

    const opcionesPapel = [
      ['blanco', 'Blanco'],
      ['crema', 'Crema'],
      ['durazno', 'Durazno'],
      ['celeste', 'Celeste'],
      ['verde', 'Verde'],
      ['gris', 'Gris']
    ]
      .map(
        ([valor, nombre]) =>
          `<button class="opcion-papel" role="radio" aria-checked="false" data-papel="${valor}"><span class="muestra-papel papel-${valor}"></span>${nombre}</button>`
      )
      .join('');

    // Cada color tiene además su propia forma de marca, para distinguirlos sin depender del color.
    const botonesColor = [
      ['amarillo', 'Amarillo (fondo)', '1'],
      ['verde', 'Verde (subrayado)', '2'],
      ['rosa', 'Rosa (doble subrayado)', '3'],
      ['celeste', 'Celeste (subrayado punteado)', '4']
    ]
      .map(
        ([color, nombre, tecla]) =>
          `<button class="boton-color" data-color="${color}" title="${nombre} — tecla ${tecla}" aria-label="${nombre}"><span class="muestra-marca marca-${color}">Ab</span></button>`
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src ${webview.cspSource}; font-src ${webview.cspSource}; connect-src ${webview.cspSource}; worker-src blob:;">
<link rel="stylesheet" href="${uriViewerCss}">
<title>Visor de Prácticos</title>
</head>
<body>
<div id="barra-herramientas">
  <div class="grupo">
    <button id="boton-alejar" title="Alejar" aria-label="Alejar" disabled>−</button>
    <span id="etiqueta-zoom">100%</span>
    <button id="boton-acercar" title="Acercar" aria-label="Acercar" disabled>+</button>
    <button id="boton-ajustar-ancho" title="Ajustar al ancho" disabled>Ajustar al ancho</button>
  </div>
  <div class="grupo">
    <label for="campo-pagina">Página</label>
    <input id="campo-pagina" type="number" min="1" value="1" disabled>
    <span id="etiqueta-total-paginas">de –</span>
  </div>
  <div class="grupo" id="grupo-busqueda" role="search">
    <input id="campo-busqueda" type="search" placeholder="Buscar (Ctrl+F)" aria-label="Buscar en el PDF" disabled>
    <span id="resultado-busqueda" aria-live="polite"></span>
    <button id="boton-anterior" title="Anterior (Shift+Enter)" aria-label="Coincidencia anterior" disabled>↑</button>
    <button id="boton-siguiente" title="Siguiente (Enter)" aria-label="Coincidencia siguiente" disabled>↓</button>
  </div>
  <div class="grupo" id="grupo-estado" role="group" aria-label="Estado del práctico">
    <button class="boton-estado" data-estado="pendiente" aria-pressed="false" disabled>${iconosEstado('pendiente')}Pendiente</button>
    <button class="boton-estado" data-estado="en-progreso" aria-pressed="false" disabled>${iconosEstado('en-progreso')}En progreso</button>
    <button class="boton-estado" data-estado="hecho" aria-pressed="false" disabled>${iconosEstado('hecho')}Hecho</button>
  </div>
  <div class="grupo">
    <button id="boton-notas" aria-pressed="false" aria-controls="panel-notas" title="Mostrar u ocultar las notas">Notas</button>
  </div>
  <div class="grupo" id="grupo-lectura">
    <button id="boton-lectura" aria-haspopup="dialog" aria-expanded="false" aria-controls="menu-lectura" title="Opciones de lectura">Aa</button>
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
    </div>
  </div>
</div>
<div id="area-principal">
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
      <button id="boton-a-notas" title="Copiar el texto a las notas, anclado a su página">A notas</button>
      <button id="boton-quitar-resaltado" title="Quitar este resaltado (tecla Supr)">Quitar</button>
    </div>
  </div>
  <aside id="panel-notas" class="oculto" aria-label="Notas del práctico">
    <div class="panel-encabezado">
      <span class="panel-titulo">Notas</span>
      <span id="estado-guardado" aria-live="polite"></span>
    </div>
    <textarea id="campo-notas" placeholder="Escribí tus notas acá…" disabled></textarea>
    <button id="boton-anclar" title="Agrega [pág. N] a la línea donde está el cursor" disabled>Anclar a pág. 1</button>
    <div class="panel-titulo">Notas por página</div>
    <p id="ayuda-anclas">Las líneas con <code>[pág. N]</code> aparecen acá; hacé click para ir a esa página.</p>
    <ul id="lista-anclas"></ul>
    <div class="panel-titulo">Resaltados</div>
    <p id="ayuda-resaltados">Seleccioná texto del PDF y elegí un color para resaltarlo.</p>
    <ul id="lista-resaltados"></ul>
  </aside>
</div>
<script id="config-datos" type="application/json">${configuracion}</script>
<script type="module" src="${uriViewerJs}"></script>
</body>
</html>`;
  }
}

function activate(contextoExtension) {
  contextoExtension.subscriptions.push(ProveedorVisorPdf.register(contextoExtension));
  registrarArbolPracticos(contextoExtension);
}

function deactivate() {}

module.exports = { activate, deactivate };
