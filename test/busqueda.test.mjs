// Pruebas de media/busqueda.js: normalizar texto y encontrar coincidencias.
// Es un módulo ES (corre en el webview), por eso esta prueba es .mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { armarTextoPagina, normalizarConMapa, normalizarConsulta, buscarEnTexto } from '../media/busqueda.js';

// Devuelve los pedazos del texto original que coinciden con la consulta.
function buscar(texto, consulta) {
  return buscarEnTexto(normalizarConMapa(texto), normalizarConsulta(consulta)).map(([i, f]) => texto.slice(i, f));
}

test('arma el texto de la página con un salto de línea donde termina cada renglón', () => {
  const { texto, inicios } = armarTextoPagina([
    { str: 'Práctico', hasEOL: false },
    { str: ' 1', hasEOL: true },
    { str: 'Ejercicio', hasEOL: false }
  ]);
  assert.equal(texto, 'Práctico 1\nEjercicio');
  assert.deepEqual(inicios, [0, 8, 11]);
});

test('normaliza mayúsculas, tildes, ligaduras y espacios', () => {
  assert.equal(normalizarConMapa('Página  DEﬁNICIÓN\n\tÑandú').normal, 'pagina definicion nandu');
});

test('no distingue mayúsculas ni tildes', () => {
  assert.deepEqual(buscar('Página 1 de 30', 'PAGINA'), ['Página']);
  assert.deepEqual(buscar('la integral', 'íntegral'), ['integral']);
});

test('encuentra palabras con ligaduras (PDFs hechos con LaTeX)', () => {
  assert.deepEqual(buscar('La deﬁnición formal', 'definicion'), ['deﬁnición']);
});

test('encuentra texto que sigue en el renglón de abajo', () => {
  assert.deepEqual(buscar('resolver la\nintegral', 'la integral'), ['la\nintegral']);
});

test('encuentra todas las apariciones', () => {
  assert.deepEqual(buscar('x^1, x^10, x^19', 'x^1'), ['x^1', 'x^1', 'x^1']);
});

test('una consulta vacía no encuentra nada', () => {
  assert.deepEqual(buscar('algo', '   '), []);
});
