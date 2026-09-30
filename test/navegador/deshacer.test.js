// Ctrl+Z / Ctrl+Y: resaltados, notas y estado del documento.
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

async function resaltarFrase(p) {
  await p.seleccionar(FRASE);
  await p.clic('#menu-resaltar .boton-color[data-color="amarillo"]');
  await p.clicAfuera();
}

test('Ctrl+Z quita el resaltado, Ctrl+Y lo devuelve, y avisa qué hizo', () =>
  conVisor(chrome, async (p) => {
    await resaltarFrase(p);
    await p.ctrlZ();
    assert.equal(await p.marcas(), '');
    assert.equal(await p.avisoAccion(), 'Deshecho: resaltado en amarillo');
    await p.ctrlY();
    assert.equal(await p.marcas(), FRASE);
    assert.equal(await p.avisoAccion(), 'Rehecho: resaltado en amarillo');
    assert.equal((await p.guardado()).resaltados.length, 1, 'lo rehecho también se guarda');
  }));

test('sin nada para deshacer, lo dice', () =>
  conVisor(chrome, async (p) => {
    await p.ctrlZ();
    assert.equal(await p.avisoAccion(), 'No hay nada para deshacer');
  }));

test("también responde al execCommand('undo') que manda VS Code, sin deshacer dos veces", () =>
  conVisor(chrome, async (p) => {
    await resaltarFrase(p);
    await p.evaluar(`document.execCommand('undo')`);
    assert.equal(await p.marcas(), '');
    await p.evaluar(`document.execCommand('redo')`);
    assert.equal(await p.marcas(), FRASE);
    // La tecla y el execCommand de una misma pulsación cuentan una sola vez.
    await p.ctrlZ();
    await p.evaluar(`document.execCommand('undo')`);
    await p.ctrlY();
    assert.equal(await p.marcas(), FRASE);
  }));

test('deshace quitar un resaltado y el borrador', () =>
  conVisor(chrome, async (p) => {
    await resaltarFrase(p);
    await p.seleccionar('pantalla');
    await p.clic('#boton-quitar-resaltado');
    assert.equal(await p.marcas(), 'Leer en|cansa');
    await p.ctrlZ();
    assert.equal(await p.marcas(), FRASE);

    await p.clic('#boton-color-resaltador');
    await p.clic('#menu-color-resaltador [data-color="borrar"]');
    await p.seleccionar(FRASE);
    assert.equal(await p.marcas(), '');
    await p.ctrlZ();
    assert.equal(await p.marcas(), FRASE);
  }));

test('lo escrito de corrido en las notas se deshace de una vez', () =>
  conVisor(chrome, async (p) => {
    await p.clic('#boton-notas');
    await p.clic('#campo-notas');
    await p.escribir('hola mundo');
    assert.equal(await p.notas(), 'hola mundo');
    await p.ctrlZ();
    assert.equal(await p.notas(), '');
    await p.ctrlY();
    assert.equal(await p.notas(), 'hola mundo');
    assert.equal((await p.guardado()).notas, 'hola mundo');
  }));

test('un solo historial para notas y resaltados, en orden', () =>
  conVisor(chrome, async (p) => {
    await p.clic('#boton-notas');
    await p.clic('#campo-notas');
    await p.escribir('idea');
    await resaltarFrase(p);
    await p.ctrlZ();
    assert.equal(await p.marcas(), '', 'primero se deshace lo último: el resaltado');
    assert.equal(await p.notas(), 'idea');
    await p.ctrlZ();
    assert.equal(await p.notas(), '');
  }));

test('deshace el cambio de estado del documento', () =>
  conVisor(chrome, async (p) => {
    const antes = await p.texto('#texto-estado-actual');
    await p.clic('#boton-estado');
    await p.clic('#menu-estado [role^="menuitem"]:not([aria-checked="true"])');
    const despues = await p.texto('#texto-estado-actual');
    assert.notEqual(despues, antes);
    await p.clicAfuera();
    await p.ctrlZ();
    await p.esperar(300);
    assert.equal(await p.texto('#texto-estado-actual'), antes);
  }));

test('en el buscador, Ctrl+Z deshace lo escrito ahí y no toca los resaltados', () =>
  conVisor(chrome, async (p) => {
    await resaltarFrase(p);
    await p.clic('#campo-busqueda');
    await p.escribir('abc');
    await p.ctrlZ();
    assert.equal(await p.marcas(), FRASE);
  }));
