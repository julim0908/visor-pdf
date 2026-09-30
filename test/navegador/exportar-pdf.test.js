// Exportar un PDF con los resaltados: la anotación tiene que caer sobre el texto.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { abrirChrome, conVisor } = require('./ayudantes');

let chrome;
let pdfjs;

test.before(async () => {
  chrome = await abrirChrome();
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
});
test.after(() => chrome.cerrar());
test.afterEach(() => assert.deepEqual(chrome.excepciones, [], 'la página no debería tirar errores'));

async function esperarArchivo(ruta, ms = 5000) {
  const limite = Date.now() + ms;
  while (!fs.existsSync(ruta)) {
    if (Date.now() > limite) throw new Error(`No apareció ${ruta}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 200)); // que termine de escribirse
}

test('el PDF exportado tiene el resaltado y el comentario, justo sobre el texto', () =>
  conVisor(chrome, async (p) => {
    await p.seleccionar('pantalla');
    await p.apretar('c');
    await p.escribir('ojo');
    await p.tecla('Enter', 'Enter', 13, 0, '\r');
    await p.seleccionar('más que leer');
    await p.apretar('2');

    await p.clic('#boton-notas');
    await p.clic('#boton-exportar-pdf');
    const ruta = path.join(p.carpeta, 'guia-de-lectura - con resaltados.pdf');
    await esperarArchivo(ruta);

    const documento = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(ruta)), verbosity: 0 }).promise;
    const pagina = await documento.getPage(1);
    const anotaciones = await pagina.getAnnotations();
    assert.deepEqual(anotaciones.map((a) => a.subtype), ['Highlight', 'Underline']);
    assert.equal(anotaciones[0].contentsObj.str, 'ojo');

    // El renglón donde está "pantalla", según el texto del mismo PDF.
    const { items } = await pagina.getTextContent();
    const renglon = items.find((item) => item.str.includes('pantalla'));
    const [, , , , x, y] = renglon.transform;
    const [x1, y1, x2, y2] = anotaciones[0].rect;
    assert.ok(y1 < y && y < y2, `la línea de base (${y}) queda dentro del resaltado (${y1}–${y2})`);
    assert.ok(x1 > x && x2 < x + renglon.width, 'empieza después del comienzo del renglón y termina antes del final');
    // "pantalla" arranca después de "Leer en ": con cualquier letra, más de un 15 % del renglón "Leer en pantalla cansa…".
    assert.ok(x1 - x > 20, `empieza donde está "pantalla" (${x1 - x} desde el comienzo)`);
    await documento.destroy();
  }));
