// Pruebas de src/arbolPracticos.js: la vista "Prácticos" de la barra lateral.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { UriFalsa, crearVscodeFalso, instalarVscodeFalso } = require('./ayudantes/vscode-falso');

const { vscode, registro } = crearVscodeFalso();
instalarVscodeFalso(vscode);
const almacen = require('../src/almacen');
const { registrarArbolPracticos } = require('../src/arbolPracticos');

const carpetaExtension = path.resolve(__dirname, '..');
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'raiz-'));
// Como en VS Code en Windows: la carpeta abierta llega con "c:" y los PDFs con "C:".
vscode.workspace.workspaceFolders = [
  { uri: new UriFalsa(raiz[0].toLowerCase() + raiz.slice(1)), name: path.basename(raiz) }
];

function crearArchivo(relativo, contenido = '%PDF-1.4') {
  const completo = path.join(raiz, relativo);
  fs.mkdirSync(path.dirname(completo), { recursive: true });
  fs.writeFileSync(completo, contenido);
}

crearArchivo('intro.pdf');
crearArchivo('Análisis II/TP10.pdf');
crearArchivo('Análisis II/TP2.pdf');
crearArchivo('Análisis II/TP1.pdf');
crearArchivo(
  'Análisis II/.practicos.json',
  JSON.stringify({
    version: 1,
    practicos: {
      'TP1.pdf': { estado: 'hecho', progreso: { paginaMaxima: 8, totalPaginas: 8 } },
      'TP2.pdf': {
        estado: 'en-progreso',
        notas: 'dudas en el ej 3',
        progreso: { paginaMaxima: 12, totalPaginas: 40 },
        marcadores: [3, 7]
      }
    }
  })
);
crearArchivo('Física/Parcial.PDF');
crearArchivo('Roto/x.pdf');
crearArchivo('Roto/.practicos.json', '{ roto');

registrarArbolPracticos({ subscriptions: [], extensionUri: new UriFalsa(carpetaExtension) });
const proveedor = registro.proveedorArbol;

test.after(() => fs.rmSync(raiz, { recursive: true, force: true }));

const nombreIcono = (icono) =>
  icono.dark ? path.basename(icono.dark.fsPath, '.png') : icono.id;

async function grupos() {
  const lista = await proveedor.getChildren();
  return Promise.all(
    lista.map(async (grupo) => ({
      nombre: grupo.label,
      descripcion: grupo.description,
      icono: grupo.iconPath.id,
      pdfs: await proveedor.getChildren(grupo)
    }))
  );
}
const grupo = async (nombre) => (await grupos()).find((g) => g.nombre === nombre);

// Espera el próximo refresco de la vista (o falla a los 2 segundos).
function esperarRefresco() {
  return new Promise((resolve, reject) => {
    const limite = setTimeout(() => reject(new Error('la vista no se refrescó')), 2000);
    const suscripcion = proveedor.onDidChangeTreeData(() => {
      clearTimeout(limite);
      suscripcion.dispose();
      resolve();
    });
  });
}

test('agrupa los PDFs por carpeta', async () => {
  const nombres = (await grupos()).map((g) => g.nombre).sort();
  assert.deepEqual(nombres, ['Análisis II', 'Física', 'Roto', path.basename(raiz)].sort());
});

test('los nombres de carpeta no muestran rutas con "../" (letra de unidad en otro caso)', async () => {
  for (const g of await grupos()) assert.ok(!g.nombre.includes('..'), g.nombre);
});

test('ordena los PDFs en orden natural: TP1, TP2, TP10', async () => {
  const { pdfs } = await grupo('Análisis II');
  assert.deepEqual(pdfs.map((p) => p.label), ['TP1.pdf', 'TP2.pdf', 'TP10.pdf']);
});

test('muestra el progreso de cada carpeta', async () => {
  assert.equal((await grupo('Análisis II')).descripcion, '1/3 hechos');
});

test('cada estado tiene su ícono (con versión para tema claro) y descripción', async () => {
  const [tp1, tp2, tp10] = (await grupo('Análisis II')).pdfs;
  assert.equal(nombreIcono(tp1.iconPath), 'hecho');
  assert.equal(path.basename(tp1.iconPath.light.fsPath), 'hecho-claro.png');
  assert.equal(nombreIcono(tp2.iconPath), 'en-progreso');
  assert.equal(tp2.description, 'En progreso · pág. 12/40 · con notas');
  assert.equal(nombreIcono(tp10.iconPath), 'pendiente');
  for (const p of [tp1, tp2, tp10]) {
    assert.ok(fs.existsSync(p.iconPath.dark.fsPath), p.iconPath.dark.fsPath);
    assert.ok(fs.existsSync(p.iconPath.light.fsPath), p.iconPath.light.fsPath);
  }
});

test('muestra hasta qué página se leyó y las páginas marcadas', async () => {
  const [tp1, tp2] = (await grupo('Análisis II')).pdfs;
  assert.match(tp2.tooltip, /Leído hasta la página 12 de 40 \(30 %\)/);
  assert.match(tp2.tooltip, /Páginas marcadas: 3, 7/);
  // Un documento hecho no muestra la página en la descripción (sí en el tooltip).
  assert.equal(tp1.description, 'Hecho');
  assert.match(tp1.tooltip, /página 8 de 8 \(100 %\)/);
});

test('encuentra PDFs con extensión en mayúsculas', async () => {
  assert.equal((await grupo('Física')).pdfs[0].label, 'Parcial.PDF');
});

test('con un .practicos.json roto, marca la carpeta y avisa una sola vez', async () => {
  const roto = await grupo('Roto');
  assert.equal(roto.icono, 'warning');
  await grupos();
  assert.equal(registro.errores.filter((e) => e.startsWith('Roto:')).length, 1);
});

test('el click abre el PDF en el visor', async () => {
  const [tp1] = (await grupo('Análisis II')).pdfs;
  assert.equal(tp1.command.command, 'vscode.openWith');
  assert.equal(tp1.command.arguments[1], 'visorPracticos.pdfViewer');
});

test('se refresca sola al cambiar un estado desde el visor', async () => {
  const refresco = esperarRefresco();
  await almacen.actualizarPractico(new UriFalsa(path.join(raiz, 'Análisis II', 'TP10.pdf')), { estado: 'hecho' });
  await refresco;
  assert.equal((await grupo('Análisis II')).descripcion, '2/3 hechos');
});

test('se refresca al agregar un PDF', async () => {
  crearArchivo('Física/TP1.pdf');
  const refresco = esperarRefresco();
  registro.vigilantes.find((v) => v.patron.includes('pdf')).crear.fire();
  await refresco;
  assert.equal((await grupo('Física')).pdfs.length, 2);
});

test('se refresca si el .practicos.json cambia desde afuera (git pull, edición a mano)', async () => {
  crearArchivo('Física/.practicos.json', JSON.stringify({ practicos: { 'Parcial.PDF': { estado: 'hecho' } } }));
  const refresco = esperarRefresco();
  registro.vigilantes.find((v) => v.patron.includes('practicos')).cambiar.fire();
  await refresco;
  assert.equal((await grupo('Física')).descripcion, '1/2 hechos');
});

test('varios guardados seguidos producen un solo refresco', async () => {
  let refrescos = 0;
  const suscripcion = proveedor.onDidChangeTreeData(() => refrescos++);
  for (let i = 0; i < 5; i++) {
    await almacen.actualizarPractico(new UriFalsa(path.join(raiz, 'intro.pdf')), { notas: `n${i}` });
  }
  await new Promise((r) => setTimeout(r, 400));
  suscripcion.dispose();
  assert.equal(refrescos, 1);
});

test('registra el comando para actualizar la lista', () => {
  assert.equal(typeof registro.comandos['visorPracticos.refrescar'], 'function');
});
