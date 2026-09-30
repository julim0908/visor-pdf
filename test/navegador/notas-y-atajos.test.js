// Notas ancladas (crear, borrar) y atajos de teclado.
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

test('anclar una línea y pasar texto a las notas', () =>
  conVisor(chrome, async (p) => {
    await p.clic('#boton-notas');
    await p.clic('#campo-notas');
    await p.escribir('repasar');
    await p.clic('#boton-anclar');
    assert.equal(await p.notas(), '[pág. 1] repasar');

    await p.seleccionar(FRASE);
    await p.clic('#boton-a-notas');
    assert.equal(await p.notas(), `[pág. 1] repasar\n[pág. 1] «${FRASE}»`);
    assert.equal(await p.cantidad('#lista-anclas li.item-con-quitar'), 2);
  }));

test('la × borra solo esa nota, y Ctrl+Z la devuelve', () =>
  conVisor(chrome, async (p) => {
    await p.clic('#boton-notas');
    await p.clic('#campo-notas');
    await p.escribir('[pág. 1] primera\n[pág. 2] segunda');
    await p.clic('#lista-anclas li:first-child .quitar-item');
    assert.equal(await p.notas(), '[pág. 2] segunda');
    assert.equal((await p.guardado()).notas, '[pág. 2] segunda');
    await p.ctrlZ();
    assert.equal(await p.notas(), '[pág. 1] primera\n[pág. 2] segunda');
  }));

test('? abre el panel de atajos; Esc, un click afuera o ? de nuevo lo cierran', () =>
  conVisor(chrome, async (p) => {
    await p.apretar('?');
    assert.ok(await p.visible('panel-atajos'));
    assert.ok((await p.cantidad('#panel-atajos dt')) >= 15, 'lista los atajos');
    await p.escape();
    assert.ok(!(await p.visible('panel-atajos')));

    await p.clic('#boton-atajos');
    assert.ok(await p.visible('panel-atajos'));
    await p.clicAfuera();
    assert.ok(!(await p.visible('panel-atajos')));

    await p.apretar('?');
    await p.apretar('?');
    assert.ok(!(await p.visible('panel-atajos')));
  }));

test('+ y − cambian el zoom', () =>
  conVisor(chrome, async (p) => {
    const zoom = async () => parseInt(await p.texto('#etiqueta-zoom'), 10);
    // Esperamos a que el zoom inicial ("ajustar al ancho") quede quieto.
    await p.esperarHasta(`document.getElementById('boton-ajustar-ancho').getAttribute('aria-pressed') === 'true'`);
    await p.esperar(800);
    const antes = await zoom();
    await p.apretar('+');
    await p.esperarHasta(`parseInt(document.getElementById('etiqueta-zoom').textContent, 10) > ${antes}`);
    const acercado = await zoom();
    await p.apretar('-');
    await p.esperarHasta(`parseInt(document.getElementById('etiqueta-zoom').textContent, 10) < ${acercado}`);
  }));

test('R resalta la selección y, sin selección, prende y apaga el modo', () =>
  conVisor(chrome, async (p) => {
    await p.seleccionar(FRASE);
    await p.apretar('r');
    assert.equal(await p.marcas(), FRASE);

    await p.apretar('r');
    assert.ok(await p.visible('aviso-modo'));
    assert.match(await p.texto('#texto-aviso-modo'), /Ctrl\+Z/, 'la franja muestra las teclas del modo');
    await p.apretar('r');
    assert.ok(!(await p.visible('aviso-modo')));
  }));

test('con texto seleccionado: 1–4 resaltan, N lo pasa a las notas', () =>
  conVisor(chrome, async (p) => {
    await p.seleccionar(FRASE);
    await p.apretar('3');
    assert.equal(await p.cantidad('.textLayer .marca-rosa'), 1);

    await p.seleccionar('más que leer');
    await p.apretar('n');
    assert.equal(await p.notas(), '[pág. 1] «más que leer»');
  }));

test('las letras no son atajos mientras se escribe en las notas', () =>
  conVisor(chrome, async (p) => {
    await p.clic('#boton-notas');
    await p.clic('#campo-notas');
    await p.escribir('r?n');
    assert.equal(await p.notas(), 'r?n');
    assert.ok(!(await p.visible('aviso-modo')));
    assert.ok(!(await p.visible('panel-atajos')));
  }));

test('los botones del menú de la selección muestran su tecla', () =>
  conVisor(chrome, async (p) => {
    await p.seleccionar(FRASE);
    const teclas = await p.evaluar(
      `[...document.querySelectorAll('#menu-resaltar button:not(.oculto) kbd')].map((k) => k.textContent).join(' ')`
    );
    assert.equal(teclas, '1 2 3 4 L C N');
  }));
