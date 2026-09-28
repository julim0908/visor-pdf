// Pruebas de media/voz.js: cómo se divide el texto para leerlo en voz alta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dividirEnFragmentos } from '../media/voz.js';

const textos = (fragmentos) => fragmentos.map((f) => f.texto);

test('divide en frases después de un signo de puntuación', () => {
  assert.deepEqual(textos(dividirEnFragmentos('Primera frase. Segunda: tercera? Fin')), [
    'Primera frase.',
    'Segunda:',
    'tercera?',
    'Fin'
  ]);
});

test('no corta en puntos que no terminan una frase (decimales, x^1.5)', () => {
  assert.deepEqual(textos(dividirEnFragmentos('Vale 3.14 y x^1.5 también.')), ['Vale 3.14 y x^1.5 también.']);
});

test('las posiciones coinciden con el texto original (los saltos de línea pasan a espacios)', () => {
  const texto = 'Hola\nmundo. Chau';
  const [primero, segundo] = dividirEnFragmentos(texto);
  assert.equal(primero.texto, 'Hola mundo.');
  assert.equal(texto.slice(primero.inicio, primero.fin), 'Hola\nmundo.');
  assert.equal(texto.slice(segundo.inicio, segundo.fin), 'Chau');
});

test('corta las frases muy largas en un espacio', () => {
  const palabras = Array.from({ length: 60 }, (_, i) => `palabra${i}`).join(' ');
  const fragmentos = dividirEnFragmentos(palabras, 0, palabras.length, 100);
  assert.ok(fragmentos.length > 1);
  for (const f of fragmentos) {
    assert.ok(f.texto.length <= 100, f.texto);
    assert.match(f.texto, /^palabra\d+( palabra\d+)*$/); // ninguna palabra cortada al medio
  }
  assert.equal(fragmentos.map((f) => f.texto).join(' '), palabras);
});

test('respeta el tramo pedido (por ejemplo, una selección)', () => {
  const texto = 'Antes. Esto es lo elegido. Después.';
  const desde = texto.indexOf('Esto');
  const hasta = texto.indexOf(' Después');
  assert.deepEqual(textos(dividirEnFragmentos(texto, desde, hasta)), ['Esto es lo elegido.']);
});

test('ignora tramos vacíos o de solo espacios', () => {
  assert.deepEqual(dividirEnFragmentos('   \n  '), []);
});
