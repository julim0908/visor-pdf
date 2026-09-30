// Pruebas de src/novedades.js: cuándo aparece el aviso de novedades.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { UriFalsa, esperar, crearVscodeFalso, crearContextoFalso, instalarVscodeFalso } = require('./ayudantes/vscode-falso');

const { vscode, registro } = crearVscodeFalso();
instalarVscodeFalso(vscode);
const { registrarNovedades, textoDelAviso, NOVEDADES } = require('../src/novedades');
const { version } = require('../package.json');

const novedades = { '2.0.0': 'cosas nuevas' };

test('después de actualizar muestra las novedades de la versión nueva', () => {
  assert.equal(textoDelAviso({ ultimaVista: '1.0.0', versionActual: '2.0.0', yaLaUsaba: true, novedades }), 'cosas nuevas');
});

test('no avisa dos veces la misma versión', () => {
  assert.equal(textoDelAviso({ ultimaVista: '2.0.0', versionActual: '2.0.0', yaLaUsaba: true, novedades }), null);
});

test('en una instalación nueva no avisa (todo es nuevo)', () => {
  assert.equal(textoDelAviso({ ultimaVista: undefined, versionActual: '2.0.0', yaLaUsaba: false, novedades }), null);
});

test('quien usaba una versión que no guardaba la última vista también recibe el aviso', () => {
  assert.equal(textoDelAviso({ ultimaVista: undefined, versionActual: '2.0.0', yaLaUsaba: true, novedades }), 'cosas nuevas');
});

test('un arreglo chico sin novedades propias no vuelve a mostrar las anteriores', () => {
  assert.equal(textoDelAviso({ ultimaVista: '2.0.0', versionActual: '2.0.1', yaLaUsaba: true, novedades }), null);
});

test('quien salta varias versiones ve las novedades que no vio', () => {
  assert.equal(textoDelAviso({ ultimaVista: '1.0.0', versionActual: '2.0.1', yaLaUsaba: true, novedades }), 'cosas nuevas');
});

test('con varias versiones sin ver, muestra la más nueva (y no una futura)', () => {
  const varias = { '1.5.0': 'viejo', '1.10.0': 'nuevo', '3.0.0': 'futuro' };
  assert.equal(textoDelAviso({ ultimaVista: '1.0.0', versionActual: '2.0.0', yaLaUsaba: true, novedades: varias }), 'nuevo');
});

test('quien viene de 0.5.0 ve las novedades al instalar la versión del package.json', () => {
  assert.ok(textoDelAviso({ ultimaVista: undefined, versionActual: version, yaLaUsaba: true, novedades: NOVEDADES }));
});

test('con la extensión en uso: avisa una vez y "Ver novedades" abre el CHANGELOG', async () => {
  const estadoGlobal = new Map([['vista:file:///tp1.pdf', { zoom: 1 }]]);
  const contexto = crearContextoFalso(new UriFalsa(path.resolve(__dirname, '..')), estadoGlobal);
  registro.respuestaAviso = 'Ver novedades';

  registrarNovedades(contexto, (clave) => clave.startsWith('vista:'));
  await esperar(20);
  assert.equal(registro.avisos.length, 1);
  assert.match(registro.avisos[0], new RegExp(`^Visor PDF ${version.replace(/\./g, '\\.')}: `));
  assert.equal(estadoGlobal.get('ultimaVersionVista'), version);
  const [comando, uri] = registro.comandosEjecutados.at(-1);
  assert.equal(comando, 'markdown.showPreview');
  assert.ok(uri.fsPath.endsWith('CHANGELOG.md'));

  // La próxima vez que arranca, ya no avisa.
  registrarNovedades(contexto, (clave) => clave.startsWith('vista:'));
  await esperar(20);
  assert.equal(registro.avisos.length, 1);
});
