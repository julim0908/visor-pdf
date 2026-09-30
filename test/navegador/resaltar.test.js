// Resaltar, volver a seleccionar, quitar resaltados y el borrador, con mouse real.
const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirChrome, conVisor } = require('./ayudantes');

const FRASE = 'Leer en pantalla cansa';
let chrome;

test.before(async () => {
  chrome = await abrirChrome();
});
test.after(() => chrome.cerrar());
test.afterEach(() => assert.deepEqual(chrome.excepciones, [], 'la página no debería tirar errores'));

// Resalta FRASE en amarillo desde el menú de la selección.
async function resaltarFrase(p) {
  await p.seleccionar(FRASE);
  await p.clic('#menu-resaltar .boton-color[data-color="amarillo"]');
  await p.clicAfuera();
}

test('resaltar desde el menú de la selección y que quede guardado', () =>
  conVisor(chrome, async (p) => {
    await resaltarFrase(p);
    assert.equal(await p.marcas(), FRASE);
    const guardado = await p.guardado();
    assert.equal(guardado.resaltados.length, 1);
    assert.equal(guardado.resaltados[0].texto, FRASE);
    assert.equal(guardado.resaltados[0].color, 'amarillo');
  }));

test('se puede volver a seleccionar texto ya resaltado', () =>
  conVisor(chrome, async (p) => {
    await resaltarFrase(p);

    await p.seleccionar('pantalla');
    assert.equal(await p.evaluar('getSelection().toString()'), 'pantalla', 'arrastrando adentro del resaltado');

    // Empezando adentro (en la mitad de "cansa") y terminando afuera.
    const r = await p.rect('cansa');
    await p.clicAfuera();
    await p.arrastrar((r.x1 + r.x2) / 2, r.y, r.x2 + 120, r.y);
    const seleccion = await p.evaluar('getSelection().toString()');
    assert.match(seleccion, /^n?sa más/, 'desde adentro hacia afuera');
  }));

test('"Quitar resaltado" con una parte seleccionada quita solo esa parte', () =>
  conVisor(chrome, async (p) => {
    await resaltarFrase(p);
    await p.seleccionar('pantalla');
    assert.ok(await p.visible('boton-quitar-resaltado'));
    await p.clic('#boton-quitar-resaltado');
    assert.equal(await p.marcas(), 'Leer en|cansa');
  }));

test('click sobre un resaltado y Supr lo quita entero', () =>
  conVisor(chrome, async (p) => {
    await resaltarFrase(p);
    await p.clicEnTexto('pantalla');
    assert.ok(await p.visible('menu-resaltar'), 'el click abre el menú del resaltado');
    assert.ok(await p.visible('boton-quitar-resaltado'));
    await p.suprimir();
    assert.equal(await p.marcas(), '');
    assert.equal((await p.guardado()).resaltados.length, 0);
  }));

test('texto sin resaltar no ofrece "Quitar resaltado"', () =>
  conVisor(chrome, async (p) => {
    await p.seleccionar(FRASE);
    assert.ok(await p.visible('menu-resaltar'));
    assert.ok(!(await p.visible('boton-quitar-resaltado')));
  }));

test('la × de la lista de resaltados lo quita', () =>
  conVisor(chrome, async (p) => {
    await resaltarFrase(p);
    await p.clic('#boton-notas');
    assert.equal(await p.cantidad('#lista-resaltados li'), 1);
    await p.clic('#lista-resaltados .quitar-item');
    assert.equal(await p.marcas(), '');
    assert.equal(await p.cantidad('#lista-resaltados li'), 0);
  }));

test('el borrador recorta solo lo que se selecciona y se apaga al salir del modo', () =>
  conVisor(chrome, async (p) => {
    await resaltarFrase(p);
    await p.clic('#boton-color-resaltador');
    await p.clic('#menu-color-resaltador [data-color="borrar"]');
    assert.ok(await p.visible('aviso-modo'), 'elegir el borrador activa el modo');
    assert.match(await p.texto('#texto-aviso-modo'), /borrador/);

    await p.seleccionar('pantalla');
    assert.equal(await p.marcas(), 'Leer en|cansa');

    await p.clic('#boton-salir-modo');
    assert.ok(!(await p.visible('aviso-modo')));
    // Fuera del modo, Resaltar vuelve a resaltar (no a borrar).
    await p.seleccionar('pantalla');
    await p.clic('#boton-resaltador');
    assert.equal(await p.marcas(), 'Leer en|pantalla|cansa');
  }));

test('modo resaltador: todo lo que se selecciona se resalta con el color elegido', () =>
  conVisor(chrome, async (p) => {
    await p.clic('#boton-resaltador');
    assert.ok(await p.visible('aviso-modo'));
    await p.apretar('2');
    await p.seleccionar(FRASE);
    await p.seleccionar('más que leer');
    assert.equal(await p.cantidad('.textLayer .marca-verde'), 2);
    await p.escape();
    assert.ok(!(await p.visible('aviso-modo')));
  }));
