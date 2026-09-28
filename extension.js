// Punto de entrada de la extensión.
// Registra el editor personalizado (el visor de PDF) y la vista lateral de prácticos.
const vscode = require('vscode');
const path = require('path');
const almacen = require('./src/almacen');
const { armarResumen } = require('./src/resumen');
const { armarHtmlDelVisor } = require('./src/plantilla');
const { registrarArbolPracticos } = require('./src/arbolPracticos');
const { registrarDecoraciones } = require('./src/decoraciones');

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
      } else if (mensaje.tipo === 'exportar-resumen') {
        await this.exportarResumen(documento.uri, guardadoNotas);
      } else if (mensaje.tipo === 'abrir-link' && typeof mensaje.url === 'string') {
        await this.abrirLink(mensaje.url);
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

  // Guarda un .md con las notas y resaltados del práctico y lo abre al costado.
  async exportarResumen(uriPdf, guardadoNotas) {
    try {
      // Que el resumen incluya lo último que se escribió, aunque no hayan pasado los 800 ms.
      await guardadoNotas.guardarAhora();
      const practico = await almacen.leerPractico(uriPdf);
      const nombrePdf = path.posix.basename(uriPdf.path);
      const carpeta = path.posix.dirname(uriPdf.path);
      const destino = await vscode.window.showSaveDialog({
        title: 'Exportar resumen',
        saveLabel: 'Guardar resumen',
        defaultUri: uriPdf.with({ path: path.posix.join(carpeta, `${nombrePdf.replace(/\.pdf$/i, '')} - resumen.md`) }),
        filters: { Markdown: ['md'] }
      });
      if (!destino) return; // la persona canceló

      await vscode.workspace.fs.writeFile(destino, new TextEncoder().encode(armarResumen(nombrePdf, practico)));
      const documentoResumen = await vscode.workspace.openTextDocument(destino);
      await vscode.window.showTextDocument(documentoResumen, { viewColumn: vscode.ViewColumn.Beside, preview: false });
    } catch (error) {
      vscode.window.showErrorMessage(`No se pudo exportar el resumen: ${error.message}`);
    }
  }

  // Links externos del PDF. El webview no puede abrir páginas por su cuenta:
  // se lo pide a la extensión, que solo acepta web y mail.
  async abrirLink(url) {
    let uri;
    try {
      uri = vscode.Uri.parse(url, true);
    } catch {
      return;
    }
    if (!['http', 'https', 'mailto'].includes(uri.scheme)) return;
    // VS Code pide confirmación antes de abrir un sitio que la persona no marcó como confiable.
    await vscode.env.openExternal(uri);
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

  // Calcula las direcciones de los archivos que usa el webview; el HTML (con su
  // Content Security Policy estricta) está en src/plantilla.js.
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

    // Estos datos los necesita viewer.js pero no podemos usar un <script> inline
    // por la CSP, así que van en un bloque JSON no ejecutable que viewer.js lee.
    const configuracion = JSON.stringify({
      uriPdfjs: uriPdfjs.toString(),
      uriPdfWorker: uriPdfWorker.toString()
    });

    return armarHtmlDelVisor({
      cspSource: webview.cspSource,
      uriViewerCss,
      uriViewerJs,
      uriIcono,
      configuracion
    });
  }
}

function activate(contextoExtension) {
  contextoExtension.subscriptions.push(ProveedorVisorPdf.register(contextoExtension));
  registrarArbolPracticos(contextoExtension);
  registrarDecoraciones(contextoExtension);
}

function deactivate() {}

module.exports = { activate, deactivate };
