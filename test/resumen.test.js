// Pruebas de src/resumen.js: el resumen en Markdown de notas y resaltados.
const test = require('node:test');
const assert = require('node:assert/strict');
const { armarResumen } = require('../src/resumen');

const resaltado = (pagina, inicio, texto, color = 'amarillo') => ({
  id: `r-${pagina}-${inicio}`,
  pagina,
  inicio,
  fin: inicio + texto.length,
  color,
  texto,
  creado: 'x'
});

test('ordena todo por página y separa las notas generales', () => {
  const md = armarResumen('TP1.pdf', {
    estado: 'hecho',
    notas: 'Repasar para el parcial\n[pág. 5] ver teorema\n[pág. 2] dudas',
    resaltados: [resaltado(5, 40, 'segundo'), resaltado(2, 0, 'Definición'), resaltado(5, 10, 'primero', 'verde')]
  });
  assert.equal(
    md,
    [
      '# Resumen: TP1.pdf',
      '',
      '- **Estado:** Hecho',
      '',
      '## Notas generales',
      '',
      '- Repasar para el parcial',
      '',
      '## Página 2',
      '',
      '> Definición *(amarillo)*',
      '',
      '- dudas',
      '',
      '## Página 5',
      '',
      '> primero *(verde)*',
      '',
      '> segundo *(amarillo)*',
      '',
      '- ver teorema',
      ''
    ].join('\n')
  );
});

test('escapa el texto del PDF que Markdown tomaría como formato', () => {
  const md = armarResumen('TP1.pdf', {
    estado: 'pendiente',
    notas: '',
    resaltados: [resaltado(1, 0, '# f(x) = x*y_1 <b>'), resaltado(1, 30, '1. primer paso')]
  });
  assert.ok(md.includes('> \\# f(x) = x\\*y\\_1 \\<b\\> *(amarillo)*'));
  assert.ok(md.includes('> 1\\. primer paso *(amarillo)*'));
});

test('junta en un renglón el texto resaltado que cruzaba renglones', () => {
  const md = armarResumen('TP1.pdf', { estado: 'pendiente', notas: '', resaltados: [resaltado(1, 0, 'de\n  area')] });
  assert.ok(md.includes('> de area *(amarillo)*'));
});

test('incluye la fecha de la última modificación', () => {
  const md = armarResumen('TP1.pdf', { estado: 'en-progreso', notas: 'x', resaltados: [], actualizado: '2026-09-28T15:00:00Z' });
  assert.ok(md.includes('- **Estado:** En progreso'));
  assert.ok(md.includes('- **Última modificación:** 28 de septiembre de 2026'));
});

test('ignora notas vacías y anclas sin texto', () => {
  const md = armarResumen('TP1.pdf', { estado: 'pendiente', notas: '\n   \n[pág. 3]\n', resaltados: [] });
  assert.ok(!md.includes('## Página 3'));
  assert.ok(md.includes('*Todavía no hay notas ni resaltados.*'));
});
