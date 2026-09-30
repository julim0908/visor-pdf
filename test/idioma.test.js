// Pruebas de la traducción: cada texto que pasa por t() tiene su versión en inglés
// en l10n/en.json, y el diccionario no guarda textos que ya no se usan.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { crearVscodeFalso, instalarVscodeFalso } = require('./ayudantes/vscode-falso');

// src/novedades.js usa VS Code: con el simulado alcanza para leer sus textos.
instalarVscodeFalso(crearVscodeFalso().vscode);
const { NOVEDADES } = require('../src/novedades.js');

const RAIZ = path.resolve(__dirname, '..');
const INGLES = require('../l10n/en.json');

const ARCHIVOS = ['extension.js', ...['src', 'media'].flatMap((carpeta) =>
  fs
    .readdirSync(path.join(RAIZ, carpeta))
    .filter((nombre) => /\.(js|mjs)$/.test(nombre))
    .map((nombre) => `${carpeta}/${nombre}`)
)];

// Los textos de t('…') o t("…") escritos tal cual en el código.
function textosUsados() {
  const usados = new Map(); // texto -> archivo donde aparece
  const patron = /\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
  for (const archivo of ARCHIVOS) {
    const codigo = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');
    for (const [, , texto] of codigo.matchAll(patron)) {
      usados.set(texto.replace(/\\(['"\\])/g, '$1'), archivo);
    }
  }
  return usados;
}

// Textos que se traducen por "nombre" (sin t('…') literal): estados y colores de resaltado.
const TRADUCIDOS_POR_NOMBRE = ['Pendiente', 'En progreso', 'Hecho', 'amarillo', 'verde', 'rosa', 'celeste'];

test('todo texto que pasa por t() está traducido al inglés', () => {
  const faltan = [...textosUsados()].filter(([texto]) => !(texto in INGLES)).map(([texto, archivo]) => `${archivo}: ${texto}`);
  assert.deepEqual(faltan, []);
});

test('las novedades de cada versión también están traducidas', () => {
  for (const texto of [...Object.values(NOVEDADES), ...TRADUCIDOS_POR_NOMBRE]) {
    assert.ok(texto in INGLES, `falta: ${texto}`);
  }
});

test('el diccionario no tiene textos que ya no se usan', () => {
  const usados = new Set([...textosUsados().keys(), ...Object.values(NOVEDADES), ...TRADUCIDOS_POR_NOMBRE]);
  assert.deepEqual(Object.keys(INGLES).filter((texto) => !usados.has(texto)), []);
});

test('las traducciones conservan los {0}, {1}… del original', () => {
  const marcas = (texto) => (texto.match(/\{\d+\}/g) || []).sort().join(',');
  for (const [original, traducido] of Object.entries(INGLES)) {
    assert.equal(marcas(traducido), marcas(original), original);
  }
});
