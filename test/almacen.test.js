// Pruebas de src/almacen.js: dónde y cómo se guardan los datos de cada práctico.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { UriFalsa, crearVscodeFalso, instalarVscodeFalso } = require('./ayudantes/vscode-falso');

const { vscode } = crearVscodeFalso({ demoraMaxima: 15 });
instalarVscodeFalso(vscode);
const almacen = require('../src/almacen');

function carpetaTemporal(t) {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'almacen-'));
  t.after(() => fs.rmSync(carpeta, { recursive: true, force: true }));
  return carpeta;
}
const pdf = (carpeta, nombre) => new UriFalsa(path.join(carpeta, nombre));
const leerJson = (carpeta) => JSON.parse(fs.readFileSync(path.join(carpeta, '.practicos.json'), 'utf8'));

const resaltadoValido = { id: 'r-1', pagina: 2, inicio: 5, fin: 9, color: 'verde', texto: 'hola', creado: 'x' };

test('un PDF sin datos devuelve los valores por defecto', async (t) => {
  const carpeta = carpetaTemporal(t);
  const practico = await almacen.leerPractico(pdf(carpeta, 'tp1.pdf'));
  assert.deepEqual(practico, { estado: 'pendiente', notas: '', resaltados: [] });
});

test('guarda el estado y las notas, y los vuelve a leer', async (t) => {
  const carpeta = carpetaTemporal(t);
  await almacen.actualizarPractico(pdf(carpeta, 'tp1.pdf'), { estado: 'hecho' });
  await almacen.actualizarPractico(pdf(carpeta, 'tp1.pdf'), { notas: '[pág. 2] repasar' });
  const practico = await almacen.leerPractico(pdf(carpeta, 'tp1.pdf'));
  assert.equal(practico.estado, 'hecho');
  assert.equal(practico.notas, '[pág. 2] repasar');
  assert.equal(leerJson(carpeta).version, 1);
});

test('guardados simultáneos en la misma carpeta no se pisan', async (t) => {
  const carpeta = carpetaTemporal(t);
  const nombres = Array.from({ length: 10 }, (_, i) => `tp${i + 1}.pdf`);
  await Promise.all(nombres.map((n) => almacen.actualizarPractico(pdf(carpeta, n), { estado: 'hecho' })));
  assert.equal(Object.keys(leerJson(carpeta).practicos).length, 10);
});

test('conserva campos y prácticos que no conoce', async (t) => {
  const carpeta = carpetaTemporal(t);
  fs.writeFileSync(
    path.join(carpeta, '.practicos.json'),
    JSON.stringify({ version: 1, materia: 'Análisis II', practicos: { 'otro.pdf': { estado: 'hecho', extra: 42 } } })
  );
  await almacen.actualizarPractico(pdf(carpeta, 'tp1.pdf'), { estado: 'en-progreso' });
  const datos = leerJson(carpeta);
  assert.equal(datos.materia, 'Análisis II');
  assert.deepEqual(datos.practicos['otro.pdf'], { estado: 'hecho', extra: 42 });
});

test('rechaza un estado inválido sin escribir nada', async (t) => {
  const carpeta = carpetaTemporal(t);
  await assert.rejects(almacen.actualizarPractico(pdf(carpeta, 'tp1.pdf'), { estado: 'casi' }), almacen.ErrorAlmacen);
  assert.equal(fs.existsSync(path.join(carpeta, '.practicos.json')), false);
});

test('valida los resaltados', async (t) => {
  const carpeta = carpetaTemporal(t);
  const casos = [
    ['uno válido', [resaltadoValido], true],
    ['lista vacía', [], true],
    ['color inventado', [{ ...resaltadoValido, color: 'violeta' }], false],
    ['fin antes que inicio', [{ ...resaltadoValido, fin: 3 }], false],
    ['página 0', [{ ...resaltadoValido, pagina: 0 }], false],
    ['sin texto', [{ ...resaltadoValido, texto: undefined }], false],
    ['con comentario', [{ ...resaltadoValido, comentario: 'entra en el parcial' }], true],
    ['comentario que no es texto', [{ ...resaltadoValido, comentario: 42 }], false],
    ['no es una lista', 'hola', false]
  ];
  for (const [nombre, resaltados, esperado] of casos) {
    const aceptado = await almacen.actualizarPractico(pdf(carpeta, 'tp1.pdf'), { resaltados }).then(
      () => true,
      () => false
    );
    assert.equal(aceptado, esperado, nombre);
  }
});

test('valida los marcadores y el progreso', async (t) => {
  const carpeta = carpetaTemporal(t);
  const casos = [
    ['marcadores válidos', { marcadores: [2, 5] }, true],
    ['marcador repetido', { marcadores: [2, 2] }, false],
    ['marcador en la página 0', { marcadores: [0] }, false],
    ['progreso válido', { progreso: { paginaMaxima: 3, totalPaginas: 10 } }, true],
    ['progreso más allá del total', { progreso: { paginaMaxima: 11, totalPaginas: 10 } }, false],
    ['progreso sin total', { progreso: { paginaMaxima: 3 } }, false]
  ];
  for (const [nombre, cambios, esperado] of casos) {
    const aceptado = await almacen.actualizarPractico(pdf(carpeta, 'tp1.pdf'), cambios).then(
      () => true,
      () => false
    );
    assert.equal(aceptado, esperado, nombre);
  }
});

test('guardar el progreso no cambia la fecha de última modificación', async (t) => {
  const carpeta = carpetaTemporal(t);
  const uri = pdf(carpeta, 'tp1.pdf');
  const { actualizado } = await almacen.actualizarPractico(uri, { notas: 'x' });
  const conProgreso = await almacen.actualizarPractico(
    uri,
    { progreso: { paginaMaxima: 2, totalPaginas: 5 } },
    { marcarActualizado: false }
  );
  assert.equal(conProgreso.actualizado, actualizado);
  assert.deepEqual((await almacen.leerPractico(uri)).progreso, { paginaMaxima: 2, totalPaginas: 5 });
});

test('no sobrescribe un .practicos.json con errores de formato', async (t) => {
  const carpeta = carpetaTemporal(t);
  const archivo = path.join(carpeta, '.practicos.json');
  fs.writeFileSync(archivo, '{ roto');
  await assert.rejects(almacen.leerPractico(pdf(carpeta, 'tp1.pdf')), /error de formato/);
  await assert.rejects(almacen.actualizarPractico(pdf(carpeta, 'tp1.pdf'), { estado: 'hecho' }), /error de formato/);
  assert.equal(fs.readFileSync(archivo, 'utf8'), '{ roto');
});

test('un .practicos.json vacío cuenta como sin datos', async (t) => {
  const carpeta = carpetaTemporal(t);
  fs.writeFileSync(path.join(carpeta, '.practicos.json'), '');
  const practico = await almacen.leerPractico(pdf(carpeta, 'tp1.pdf'));
  assert.equal(practico.estado, 'pendiente');
});

test('si no se puede escribir, avisa con un error claro', async (t) => {
  const carpeta = carpetaTemporal(t);
  fs.writeFileSync(path.join(carpeta, '.practicos.json.bloquear'), '');
  await assert.rejects(almacen.actualizarPractico(pdf(carpeta, 'tp1.pdf'), { estado: 'hecho' }), /No se pudo guardar/);
});

test('avisa cada vez que se guarda (alCambiar)', async (t) => {
  const carpeta = carpetaTemporal(t);
  const avisos = [];
  const suscripcion = almacen.alCambiar((cambio) => avisos.push(cambio.practico.estado));
  t.after(() => suscripcion.dispose());
  await almacen.actualizarPractico(pdf(carpeta, 'tp1.pdf'), { estado: 'hecho' });
  assert.deepEqual(avisos, ['hecho']);
});

test('leerPracticosDeCarpeta devuelve todos, con valores por defecto', async (t) => {
  const carpeta = carpetaTemporal(t);
  await almacen.actualizarPractico(pdf(carpeta, 'tp1.pdf'), { estado: 'hecho' });
  const practicos = await almacen.leerPracticosDeCarpeta(new UriFalsa(carpeta), ['tp1.pdf', 'tp2.pdf']);
  assert.equal(practicos.get('tp1.pdf').estado, 'hecho');
  assert.equal(practicos.get('tp2.pdf').estado, 'pendiente');
});
