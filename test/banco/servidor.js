// Banco de pruebas: abre el visor en un navegador común, sin VS Code.
// Carga el extension.js real con un `vscode` simulado y hace de puente entre la
// extensión y la página, imitando cómo VS Code pasa los mensajes.
//
// Uso:  npm run banco            (usa PDFs de prueba generados en test/banco/pdfs)
//       npm run banco -- <carpeta con PDFs>
// Después abrí http://localhost:5757/?archivo=practico-largo.pdf
//
// Rutas útiles: /estado muestra lo guardado (preferencias, .practicos.json,
// avisos de error) y /cerrar simula que se cierra la pestaña.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { crearVscodeFalso, instalarVscodeFalso } = require('../ayudantes/vscode-falso');
const { generarPdfs } = require('../ayudantes/generar-pdf');

const PUERTO = 5757;
const ORIGEN = `http://localhost:${PUERTO}`;
const raizExtension = path.resolve(__dirname, '..', '..');
const carpetaPdfs = path.resolve(process.argv[2] || path.join(__dirname, 'pdfs'));
if (!process.argv[2] && !fs.existsSync(path.join(carpetaPdfs, 'practico-largo.pdf'))) generarPdfs(carpetaPdfs);

const tiposMime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.json': 'application/json'
};

const { vscode, registro } = crearVscodeFalso();
instalarVscodeFalso(vscode);

const estadoGlobal = new Map();
require(path.join(raizExtension, 'extension.js')).activate({
  extensionUri: vscode.Uri.file(raizExtension),
  subscriptions: [],
  globalState: {
    get: (clave) => estadoGlobal.get(clave),
    update: async (clave, valor) => estadoGlobal.set(clave, valor)
  }
});

let clientesEventos = [];
let manejadorMensajes = null;
let panelActual = null;

function crearPanel() {
  let cerrado = false;
  let alCerrar = () => {};
  const webview = {
    options: {},
    html: '',
    cspSource: ORIGEN,
    asWebviewUri: (uri) => {
      const url = `${ORIGEN}/ext/${path.relative(raizExtension, uri.fsPath).replace(/\\/g, '/')}`;
      return { toString: () => url };
    },
    onDidReceiveMessage: (funcion) => {
      manejadorMensajes = funcion;
      return { dispose() {} };
    },
    postMessage: async (mensaje) => {
      if (cerrado) throw new Error('Webview is disposed');
      // JSON como VS Code, pero los TypedArray viajan como binario. Un Buffer de
      // Node tiene toJSON(), así que no llega como TypedArray (igual que en VS Code).
      const texto = JSON.stringify(mensaje, (_clave, valor) =>
        ArrayBuffer.isView(valor)
          ? { __bytes: Buffer.from(valor.buffer, valor.byteOffset, valor.byteLength).toString('base64') }
          : valor
      );
      for (const cliente of clientesEventos) cliente.write(`data: ${texto}\n\n`);
      return true;
    }
  };
  return {
    webview,
    onDidDispose: (funcion) => {
      alCerrar = funcion;
      return { dispose() {} };
    },
    cerrar: () => {
      cerrado = true;
      alCerrar();
    }
  };
}

// Reemplaza a acquireVsCodeApi() dentro de la página.
const PUENTE = `(() => {
  const fuente = new EventSource('/eventos');
  const abierto = new Promise((r) => fuente.addEventListener('open', r, { once: true }));
  fuente.onmessage = (e) => {
    const mensaje = JSON.parse(e.data, (_k, v) => (v && typeof v === 'object' && typeof v.__bytes === 'string')
      ? Uint8Array.from(atob(v.__bytes), (c) => c.charCodeAt(0)) : v);
    window.postMessage(mensaje, '*');
  };
  let usada = false;
  window.acquireVsCodeApi = () => {
    if (usada) throw new Error('acquireVsCodeApi ya fue llamada');
    usada = true;
    return {
      postMessage: async (m) => { await abierto; fetch('/mensaje', { method: 'POST', body: JSON.stringify(m) }); },
      getState() {}, setState() {}
    };
  };
})();`;

// Algunas variables de un tema oscuro de VS Code, para que se vea parecido.
const TEMA = `html { --vscode-editor-background:#1f1f1f; --vscode-foreground:#cccccc; --vscode-font-family:Segoe UI, sans-serif;
  --vscode-font-size:13px; --vscode-editorWidget-background:#202020; --vscode-panel-border:#2b2b2b;
  --vscode-button-background:#0078d4; --vscode-button-foreground:#fff; --vscode-button-hoverBackground:#026ec1;
  --vscode-button-secondaryBackground:#313131; --vscode-button-secondaryForeground:#ccc;
  --vscode-button-secondaryHoverBackground:#3c3c3c; --vscode-input-background:#313131; --vscode-input-foreground:#ccc;
  --vscode-input-border:#3c3c3c; --vscode-focusBorder:#0078d4; --vscode-descriptionForeground:#9d9d9d;
  --vscode-charts-yellow:#cca700; --vscode-charts-green:#89d185; --vscode-sideBar-background:#181818;
  --vscode-list-hoverBackground:#2a2d2e; --vscode-textLink-foreground:#4daafc; --vscode-errorForeground:#f85149;
  --vscode-input-placeholderForeground:#989898; --vscode-dropdown-background:#313131; --vscode-dropdown-foreground:#ccc;
  --vscode-inputValidation-errorBackground:#5a1d1d; --vscode-inputValidation-errorBorder:#be1100; }`;

function responder(res, estado, tipo, cuerpo) {
  res.writeHead(estado, tipo ? { 'Content-Type': tipo } : {});
  res.end(cuerpo);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, ORIGEN);
    const ruta = decodeURIComponent(url.pathname);
    try {
      if (ruta === '/') {
        panelActual = crearPanel();
        const archivo = url.searchParams.get('archivo') || 'practico-largo.pdf';
        const documento = await registro.proveedorEditor.openCustomDocument(vscode.Uri.file(path.join(carpetaPdfs, archivo)));
        await registro.proveedorEditor.resolveCustomEditor(documento, panelActual);
        const html = panelActual.webview.html
          .replace('<head>', `<head><link rel="stylesheet" href="${ORIGEN}/tema.css">`)
          .replace('<script type="module"', `<script src="${ORIGEN}/puente.js"></script><script type="module"`);
        return responder(res, 200, 'text/html; charset=utf-8', html);
      }
      if (ruta === '/puente.js') return responder(res, 200, 'text/javascript', PUENTE);
      if (ruta === '/tema.css') return responder(res, 200, 'text/css', TEMA);
      if (ruta === '/estado') {
        const json = path.join(carpetaPdfs, '.practicos.json');
        return responder(
          res,
          200,
          'application/json',
          JSON.stringify({
            globalState: Object.fromEntries(estadoGlobal),
            errores: registro.errores,
            documentosAbiertos: registro.documentosAbiertos,
            linksAbiertos: registro.linksAbiertos,
            practicosJson: fs.existsSync(json) ? fs.readFileSync(json, 'utf8') : null
          })
        );
      }
      if (ruta === '/eventos') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(': ok\n\n');
        clientesEventos = [res];
        req.on('close', () => (clientesEventos = clientesEventos.filter((c) => c !== res)));
        return;
      }
      if (ruta === '/mensaje' && req.method === 'POST') {
        let cuerpo = '';
        req.on('data', (parte) => (cuerpo += parte));
        req.on('end', async () => {
          await manejadorMensajes(JSON.parse(cuerpo));
          responder(res, 204);
        });
        return;
      }
      if (ruta === '/cerrar') {
        clientesEventos = [];
        panelActual.cerrar();
        return responder(res, 204);
      }
      if (ruta.startsWith('/ext/')) {
        // Igual que VS Code: solo se sirven archivos dentro de localResourceRoots.
        const archivo = path.join(raizExtension, ruta.slice(5));
        const raices = (panelActual.webview.options.localResourceRoots || []).map((u) => u.fsPath + path.sep);
        if (!raices.some((raiz) => archivo.startsWith(raiz))) {
          console.log('[bloqueado por localResourceRoots]', archivo);
          return responder(res, 403);
        }
        const datos = await fs.promises.readFile(archivo);
        return responder(res, 200, tiposMime[path.extname(archivo)] || 'application/octet-stream', datos);
      }
      responder(res, 404);
    } catch (error) {
      console.error(error);
      responder(res, 500, 'text/plain', String(error));
    }
  })
  .listen(PUERTO, () => {
    console.log(`Banco de pruebas en ${ORIGEN}/?archivo=practico-largo.pdf`);
    console.log(`PDFs de: ${carpetaPdfs}`);
  });
