// Pruebas de media/geometria.js: ubicar un tramo de texto en la página del PDF.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cuadrosDeTramo } from '../media/geometria.js';

// Letra monoespaciada de mentira: cada carácter mide 1.
const medir = (texto) => texto.length;
const redondear = (cuadros) => cuadros.map((c) => c.map((n) => Math.round(n * 100) / 100));

// "Hola mundo" en tamaño 10, empezando en (100, 700), 50 unidades de ancho.
const pagina = {
  items: [
    { str: 'Hola mundo', transform: [10, 0, 0, 10, 100, 700], width: 50, height: 10, fontName: 'f1' },
    { str: 'segunda', transform: [10, 0, 0, 10, 100, 680], width: 35, height: 10, fontName: 'f1' }
  ],
  inicios: [0, 11],
  estilos: { f1: { ascent: 0.8, descent: -0.2, fontFamily: 'sans-serif' } }
};

test('un tramo dentro de un item: arriba y abajo según el tamaño de letra', () => {
  // "mundo" son las letras 5 a 10: de x = 125 a x = 150.
  assert.deepEqual(redondear(cuadrosDeTramo(pagina, 5, 10, medir)), [[125, 708, 150, 708, 125, 698, 150, 698]]);
});

test('un tramo que cruza dos renglones da un cuadro por renglón', () => {
  const cuadros = cuadrosDeTramo(pagina, 5, 14, medir);
  assert.equal(cuadros.length, 2);
  // Del segundo renglón, "seg": x de 100 a 115.
  assert.deepEqual(redondear([cuadros[1]]), [[100, 688, 115, 688, 100, 678, 115, 678]]);
});

test('no incluye los espacios de las puntas', () => {
  // " mundo" (con el espacio) queda igual que "mundo".
  assert.deepEqual(cuadrosDeTramo(pagina, 4, 10, medir), cuadrosDeTramo(pagina, 5, 10, medir));
  assert.deepEqual(cuadrosDeTramo(pagina, 4, 5, medir), [], 'solo un espacio: nada');
});

test('usa lo que mide cada letra, no solo la cantidad de letras', () => {
  // Con una letra donde "H" mide 5 y el resto 1, "ola" empieza más a la derecha.
  const medirVariable = (texto) => [...texto].reduce((suma, c) => suma + (c === 'H' ? 5 : 1), 0);
  const [cuadro] = cuadrosDeTramo(pagina, 1, 4, medirVariable);
  // Total: 5 + 9 = 14. "H" = 5/14 del ancho (50).
  assert.equal(Math.round(cuadro[0] * 100) / 100, Math.round((100 + (50 * 5) / 14) * 100) / 100);
});

test('texto girado 90°: el cuadro sigue la dirección del texto', () => {
  const girado = {
    items: [{ str: 'abcd', transform: [0, 10, -10, 0, 300, 100], width: 40, height: 10, fontName: 'f1' }],
    inicios: [0],
    estilos: pagina.estilos
  };
  // Letras 0 a 2 ("ab"): 20 unidades hacia arriba desde (300, 100); "arriba" del texto es hacia la izquierda.
  assert.deepEqual(redondear(cuadrosDeTramo(girado, 0, 2, medir)), [[292, 100, 292, 120, 302, 100, 302, 120]]);
});
