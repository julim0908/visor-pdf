// Pruebas de media/historial.js: deshacer y rehacer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crearHistorial } from '../media/historial.js';

// Una "lista" de prueba y acciones que le agregan un elemento.
function crearEscenario() {
  const lista = [];
  const historial = crearHistorial();
  const agregar = (valor) => {
    lista.push(valor);
    historial.registrar({
      descripcion: `agregar ${valor}`,
      deshacer: () => lista.pop(),
      rehacer: () => lista.push(valor)
    });
  };
  return { lista, historial, agregar };
}

test('deshace en orden inverso y rehace en el mismo orden', () => {
  const { lista, historial, agregar } = crearEscenario();
  agregar('a');
  agregar('b');
  agregar('c');
  assert.equal(historial.deshacer().descripcion, 'agregar c');
  assert.equal(historial.deshacer().descripcion, 'agregar b');
  assert.deepEqual(lista, ['a']);
  assert.equal(historial.rehacer().descripcion, 'agregar b');
  assert.deepEqual(lista, ['a', 'b']);
});

test('sin nada para deshacer o rehacer devuelve null', () => {
  const { historial } = crearEscenario();
  assert.equal(historial.deshacer(), null);
  assert.equal(historial.rehacer(), null);
});

test('una acción nueva borra lo que se podía rehacer', () => {
  const { lista, historial, agregar } = crearEscenario();
  agregar('a');
  agregar('b');
  historial.deshacer();
  agregar('x');
  assert.equal(historial.rehacer(), null);
  assert.deepEqual(lista, ['a', 'x']);
});

test('ultima() devuelve la última acción hecha', () => {
  const { historial, agregar } = crearEscenario();
  assert.equal(historial.ultima(), null);
  agregar('a');
  assert.equal(historial.ultima().descripcion, 'agregar a');
  historial.deshacer();
  assert.equal(historial.ultima(), null);
});
