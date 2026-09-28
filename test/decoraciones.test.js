// Pruebas de src/decoraciones.js: la marca del estado al lado de cada PDF.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { UriFalsa, crearVscodeFalso, instalarVscodeFalso } = require('./ayudantes/vscode-falso');

const { vscode, registro } = crearVscodeFalso();
instalarVscodeFalso(vscode);
const almacen = require('../src/almacen');
const { registrarDecoraciones } = require('../src/decoraciones');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'decoraciones-'));
test.after(() => fs.rmSync(carpeta, { recursive: true, force: true }));
fs.writeFileSync(
  path.join(carpeta, '.practicos.json'),
  JSON.stringify({ practicos: { 'hecho.pdf': { estado: 'hecho' }, 'a-medias.pdf': { estado: 'en-progreso' } } })
);

const proveedor = registrarDecoraciones({ subscriptions: [] });
const archivo = (nombre) => new UriFalsa(path.join(carpeta, nombre));

test('se registra como proveedor de marcas de VS Code', () => {
  assert.equal(registro.proveedorDecoraciones, proveedor);
});

test('hecho: ✓ verde; en progreso: ◐ amarilla', async () => {
  const hecho = await proveedor.provideFileDecoration(archivo('hecho.pdf'));
  assert.equal(hecho.badge, '✓');
  assert.equal(hecho.color.id, 'charts.green');
  assert.equal(hecho.tooltip, 'Visor PDF: Hecho');
  const enProgreso = await proveedor.provideFileDecoration(archivo('a-medias.pdf'));
  assert.equal(enProgreso.badge, '◐');
  assert.equal(enProgreso.color.id, 'charts.yellow');
});

test('los pendientes y los archivos que no son PDF no llevan marca', async () => {
  assert.equal(await proveedor.provideFileDecoration(archivo('sin-datos.pdf')), undefined);
  assert.equal(await proveedor.provideFileDecoration(archivo('notas.txt')), undefined);
});

test('al cambiar el estado desde el visor, la marca se actualiza', async () => {
  assert.equal(await proveedor.provideFileDecoration(archivo('nuevo.pdf')), undefined);
  const avisado = new Promise((resolve) => proveedor.onDidChangeFileDecorations(resolve));
  await almacen.actualizarPractico(archivo('nuevo.pdf'), { estado: 'hecho' });
  const uriAvisada = await avisado;
  assert.equal(uriAvisada.toString(), archivo('nuevo.pdf').toString());
  assert.equal((await proveedor.provideFileDecoration(archivo('nuevo.pdf'))).badge, '✓');
});

test('si el .practicos.json cambia desde afuera, se actualizan todas', async () => {
  fs.writeFileSync(path.join(carpeta, '.practicos.json'), JSON.stringify({ practicos: { 'hecho.pdf': { estado: 'pendiente' } } }));
  const avisado = new Promise((resolve) => proveedor.onDidChangeFileDecorations(resolve));
  registro.vigilantes.find((v) => v.patron.includes('practicos')).cambiar.fire();
  assert.equal(await avisado, undefined); // undefined = "todas"
  assert.equal(await proveedor.provideFileDecoration(archivo('hecho.pdf')), undefined);
});

test('con el .practicos.json roto no hay marca (y no se rompe nada)', async () => {
  fs.writeFileSync(path.join(carpeta, '.practicos.json'), '{ roto');
  registro.vigilantes.find((v) => v.patron.includes('practicos')).cambiar.fire();
  assert.equal(await proveedor.provideFileDecoration(archivo('a-medias.pdf')), undefined);
});
