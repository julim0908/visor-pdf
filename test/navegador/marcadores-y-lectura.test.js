// Páginas marcadas, progreso de lectura y papel oscuro.
const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirChrome, conVisor } = require('./ayudantes');

let chrome;

test.before(async () => {
  chrome = await abrirChrome();
});
test.after(() => chrome.cerrar());
test.afterEach(() => assert.deepEqual(chrome.excepciones, [], 'la página no debería tirar errores'));

const marcadas = (p) =>
  p.evaluar(`[...document.querySelectorAll('.pagina-wrapper.marcada')].map((w) => Number(w.dataset.numeroPagina))`);

test('M marca la página actual (señalador, botón y lista), y se guarda', () =>
  conVisor(chrome, async (p) => {
    await p.apretar('m');
    assert.deepEqual(await marcadas(p), [1]);
    assert.equal(await p.evaluar(`document.getElementById('boton-marcador').getAttribute('aria-pressed')`), 'true');
    await p.clic('#boton-notas');
    assert.equal(await p.cantidad('#lista-marcadores li'), 1);
    assert.ok(!(await p.visible('ayuda-marcadores')));
    assert.deepEqual((await p.guardado()).marcadores, [1]);
  }));

test('marcar otra página, ir desde la lista y quitar con la ×', () =>
  conVisor(chrome, async (p) => {
    await p.apretar('m');
    await p.tecla('PageDown', 'PageDown', 34);
    await p.clic('#boton-marcador');
    assert.deepEqual(await marcadas(p), [1, 2]);

    await p.clic('#boton-notas');
    await p.clic('#lista-marcadores li:first-child button.ancla');
    assert.equal(await p.evaluar(`document.getElementById('campo-pagina').value`), '1');

    await p.clic('#lista-marcadores li:first-child .quitar-item');
    assert.deepEqual(await marcadas(p), [2]);
    await p.ctrlZ();
    assert.deepEqual(await marcadas(p), [1, 2], 'Ctrl+Z devuelve el marcador');
  }));

test('guarda hasta qué página se leyó (y no la baja al volver atrás)', () =>
  conVisor(chrome, async (p) => {
    await p.tecla('PageDown', 'PageDown', 34);
    await p.tecla('PageUp', 'PageUp', 33);
    await p.esperar(1800);
    const guardado = await p.guardado();
    assert.deepEqual(guardado.progreso, { paginaMaxima: 2, totalPaginas: 2 });
    assert.equal(guardado.actualizado, undefined, 'leer no cuenta como modificar');
  }));

test('miniaturas: se dibujan, marcan la página actual y llevan a cada página', () =>
  conVisor(chrome, async (p) => {
    await p.clic('#boton-miniaturas');
    assert.ok(await p.visible('panel-miniaturas'));
    assert.equal(await p.cantidad('#lista-miniaturas .miniatura'), 2);
    await p.esperarHasta(`document.querySelectorAll('#lista-miniaturas canvas').length === 2`);
    assert.equal(await p.texto('.miniatura.actual .numero-miniatura'), '1');

    await p.clic('.miniatura[data-pagina="2"]');
    assert.equal(await p.evaluar(`document.getElementById('campo-pagina').value`), '2');
    assert.equal(await p.texto('.miniatura.actual .numero-miniatura'), '2');

    await p.clicAfuera();
    await p.apretar('m');
    assert.equal(await p.cantidad('.miniatura.marcada'), 1, 'el señalador también aparece en la miniatura');
  }));

test('papel oscuro: invierte la página y se recuerda como preferencia', () =>
  conVisor(chrome, async (p) => {
    await p.clic('#boton-lectura');
    await p.clic('.opcion-papel[data-papel="oscuro"]');
    assert.equal(await p.evaluar(`document.getElementById('paginas').dataset.papel`), 'oscuro');
    const filtro = await p.evaluar(`getComputedStyle(document.querySelector('.pagina-wrapper canvas')).filter`);
    assert.match(filtro, /invert/);
  }));
