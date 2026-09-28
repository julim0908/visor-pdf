// Pruebas de extension.js: los mensajes que el visor le manda a la extensión.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { UriFalsa, crearVscodeFalso, instalarVscodeFalso } = require('./ayudantes/vscode-falso');

const { vscode, registro } = crearVscodeFalso();
instalarVscodeFalso(vscode);
const extension = require('../extension');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-'));
test.after(() => fs.rmSync(carpeta, { recursive: true, force: true }));

const estadoGlobal = new Map();
extension.activate({
  extensionUri: new UriFalsa(path.resolve(__dirname, '..')),
  subscriptions: [],
  globalState: { get: (k) => estadoGlobal.get(k), update: async (k, v) => estadoGlobal.set(k, v) }
});

// Abre un "visor" para tp1.pdf y devuelve una función para mandarle mensajes
// como si vinieran del webview, más la lista de lo que la extensión le contestó.
async function abrirVisor() {
  let manejador = null;
  const recibidos = [];
  const panel = {
    webview: {
      options: {},
      cspSource: 'vscode-webview://prueba',
      asWebviewUri: (uri) => uri,
      onDidReceiveMessage: (funcion) => {
        manejador = funcion;
        return { dispose() {} };
      },
      postMessage: async (mensaje) => recibidos.push(mensaje)
    },
    onDidDispose: () => ({ dispose() {} })
  };
  const documento = await registro.proveedorEditor.openCustomDocument(new UriFalsa(path.join(carpeta, 'tp1.pdf')));
  await registro.proveedorEditor.resolveCustomEditor(documento, panel);
  return { enviar: (mensaje) => manejador(mensaje), recibidos, panel };
}

test('oculta .practicos.json en el explorador de VS Code', () => {
  const paquete = require('../package.json');
  assert.equal(paquete.contributes.configurationDefaults['files.exclude']['**/.practicos.json'], true);
});

test('el HTML del visor tiene una Content Security Policy estricta', async () => {
  const { panel } = await abrirVisor();
  assert.match(panel.webview.html, /default-src 'none'/);
  assert.match(panel.webview.html, /worker-src blob:/);
  assert.doesNotMatch(panel.webview.html, /unsafe-inline|unsafe-eval/);
});

test('exporta el resumen junto al PDF, incluyendo las notas sin guardar todavía', async () => {
  const { enviar } = await abrirVisor();
  await enviar({ tipo: 'guardar-resaltados', resaltados: [
    { id: 'r-1', pagina: 2, inicio: 0, fin: 10, color: 'verde', texto: 'Definición', creado: 'x' }
  ] });
  // Notas recién escritas: todavía no pasaron los 800 ms del guardado automático.
  await enviar({ tipo: 'editar-notas', notas: '[pág. 2] repasar', revision: 1 });
  await enviar({ tipo: 'exportar-resumen' });

  const archivo = path.join(carpeta, 'tp1 - resumen.md');
  const resumen = fs.readFileSync(archivo, 'utf8');
  assert.match(resumen, /## Página 2/);
  assert.match(resumen, /> Definición \*\(verde\)\*/);
  assert.match(resumen, /- repasar/);
  assert.equal(registro.documentosAbiertos.at(-1), archivo);
});

test('si se cancela el diálogo, no guarda nada', async (t) => {
  const { enviar } = await abrirVisor();
  registro.respuestaDialogoGuardar = null;
  t.after(() => (registro.respuestaDialogoGuardar = undefined));
  const antes = fs.readdirSync(carpeta).length;
  await enviar({ tipo: 'exportar-resumen' });
  assert.equal(fs.readdirSync(carpeta).length, antes);
});

test('abre links web y de mail, pero no otros tipos', async () => {
  const { enviar } = await abrirVisor();
  registro.linksAbiertos.length = 0;
  for (const url of ['https://example.com/a', 'mailto:catedra@example.com', 'javascript:alert(1)', 'file:///C:/secreto.txt', 'no es una url']) {
    await enviar({ tipo: 'abrir-link', url });
  }
  assert.deepEqual(registro.linksAbiertos, ['https://example.com/a', 'mailto:catedra@example.com']);
});

test('guarda las preferencias de lectura y se las manda a los otros visores abiertos', async () => {
  const primero = await abrirVisor();
  const segundo = await abrirVisor();
  await primero.enviar({ tipo: 'guardar-preferencias', preferencias: { papel: 'crema', guia: true, altoGuia: 'fina' } });
  assert.deepEqual(estadoGlobal.get('preferenciasLectura'), { papel: 'crema', guia: true, altoGuia: 'fina' });
  assert.ok(segundo.recibidos.some((m) => m.tipo === 'preferencias' && m.preferencias.papel === 'crema'));
  assert.ok(!primero.recibidos.some((m) => m.tipo === 'preferencias'));
});

test('avisa si los resaltados no tienen el formato esperado', async () => {
  const { enviar } = await abrirVisor();
  const errores = registro.errores.length;
  await enviar({ tipo: 'guardar-resaltados', resaltados: [{ id: 'x', color: 'violeta' }] });
  assert.equal(registro.errores.length, errores + 1);
  assert.match(registro.errores.at(-1), /resaltados/);
});
