// Pruebas de src/exportarPdf.js: el PDF exportado lleva los resaltados como
// anotaciones, y pdf.js (el mismo lector de Firefox) las entiende.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { agregarResaltadosAlPdf, ErrorExportar } = require('../src/exportarPdf');
const { PDFDocument, StandardFonts } = require('pdf-lib/dist/pdf-lib.min.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

async function pdfDePrueba() {
  const documento = await PDFDocument.create();
  const fuente = await documento.embedFont(StandardFonts.Helvetica);
  for (const texto of ['Primera página', 'Segunda página']) {
    const pagina = documento.addPage([400, 300]);
    pagina.drawText(texto, { x: 50, y: 200, size: 20, font: fuente });
  }
  return documento.save();
}

async function anotacionesDe(bytes) {
  const documento = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const porPagina = [];
  for (let n = 1; n <= documento.numPages; n++) {
    porPagina.push(await (await documento.getPage(n)).getAnnotations());
  }
  await documento.destroy();
  return porPagina;
}

const cuadro = [50, 215, 150, 215, 50, 196, 150, 196];

test('agrega una anotación por resaltado, con su forma, color y comentario', async () => {
  const { bytes, agregados } = await agregarResaltadosAlPdf(await pdfDePrueba(), [
    { pagina: 1, color: 'amarillo', texto: 'Primera', comentario: 'entra en el parcial', cuadros: [cuadro] },
    { pagina: 2, color: 'verde', texto: 'Segunda', cuadros: [cuadro] },
    { pagina: 2, color: 'celeste', texto: 'página', cuadros: [cuadro] }
  ]);
  assert.equal(agregados, 3);

  const [primera, segunda] = await anotacionesDe(bytes);
  assert.equal(primera.length, 1);
  assert.equal(primera[0].subtype, 'Highlight');
  assert.equal(primera[0].contentsObj.str, 'entra en el parcial');
  assert.deepEqual(primera[0].rect, [50, 196, 150, 215]);
  assert.deepEqual([...primera[0].color], [255, 222, 0]);
  assert.deepEqual(segunda.map((a) => a.subtype), ['Underline', 'Squiggly']);
});

test('ignora resaltados sin cuadros o de páginas que no existen', async () => {
  const { agregados } = await agregarResaltadosAlPdf(await pdfDePrueba(), [
    { pagina: 9, color: 'amarillo', texto: 'x', cuadros: [cuadro] },
    { pagina: 1, color: 'amarillo', texto: 'x', cuadros: [] },
    { pagina: 1, color: 'amarillo', texto: 'x', cuadros: [[1, 2, 3]] }
  ]);
  assert.equal(agregados, 0);
});

test('un archivo que no es PDF da un error claro', async () => {
  await assert.rejects(agregarResaltadosAlPdf(new TextEncoder().encode('hola'), []), ErrorExportar);
});
