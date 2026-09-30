// Con VS Code en inglés, el visor entero se ve en inglés (y sigue funcionando igual).
const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirChrome, conVisor } = require('./ayudantes');

let chrome;

test.before(async () => {
  chrome = await abrirChrome();
});
test.after(() => chrome.cerrar());
test.afterEach(() => assert.deepEqual(chrome.excepciones, [], 'la página no debería tirar errores'));

const enIngles = (tarea) => conVisor(chrome, tarea, { idioma: 'en' });

test('la barra, el panel y los menús están en inglés', () =>
  enIngles(async (p) => {
    assert.equal(await p.evaluar('document.documentElement.lang'), 'en');
    assert.equal(await p.texto('#boton-resaltador .etiqueta'), 'Highlight');
    assert.equal(await p.texto('#boton-notas .etiqueta'), 'Notes');
    assert.equal(await p.texto('#etiqueta-total-paginas'), 'of 2');
    assert.equal(await p.texto('#texto-estado-actual'), 'To do');
    assert.equal(await p.evaluar(`document.getElementById('campo-busqueda').placeholder`), 'Search (Ctrl+F)');

    // Ningún texto visible del visor quedó en español (el PDF de ejemplo sí está en español: no cuenta).
    await p.clic('#boton-notas');
    const visibles = await p.evaluar(
      `[...document.querySelectorAll('#barra-herramientas, #panel-notas, #consejo')].map((e) => e.innerText).join(' ')`
    );
    for (const palabra of ['Resaltar', 'Notas', 'Buscar', 'Página', 'Leer']) {
      assert.ok(!new RegExp(`\\b${palabra}\\b`).test(visibles), `quedó "${palabra}" en español`);
    }
  }));

test('resaltar, comentar, anclar y deshacer muestran sus textos en inglés', () =>
  enIngles(async (p) => {
    await p.seleccionar('Leer en pantalla cansa');
    assert.equal(await p.texto('#texto-boton-comentar'), 'Comment');
    await p.apretar('1');
    await p.ctrlZ();
    assert.equal(await p.avisoAccion(), 'Undone: highlight in yellow');

    await p.clic('#boton-notas');
    assert.equal(await p.texto('#boton-anclar'), 'Anchor to p. 1');
    await p.clic('#campo-notas');
    await p.escribir('idea');
    await p.clic('#boton-anclar');
    assert.equal(await p.notas(), '[p. 1] idea', 'el ancla en inglés');
    assert.equal(await p.cantidad('#lista-anclas li'), 1, 'y se reconoce como ancla');

    await p.clicAfuera();
    await p.apretar('r');
    assert.match(await p.texto('#texto-aviso-modo'), /^Highlighter mode: select text to highlight it in yellow\./);
  }));
