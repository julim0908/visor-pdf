// Comentarios en los resaltados: escribirlos, editarlos, borrarlos y deshacerlos.
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

const comentarioDe = (p) =>
  p.evaluar(`document.querySelector('.textLayer .marca.con-comentario.fin-de-marca')?.title ?? null`);

test('click en un resaltado, Comentar, escribir y Enter lo guarda', () =>
  conVisor(chrome, async (p) => {
    await resaltarFrase(p);
    await p.clicEnTexto('pantalla');
    assert.equal(await p.texto('#texto-boton-comentar'), 'Comentar');
    await p.clic('#boton-comentar');
    assert.ok(await p.visible('editor-comentario'));
    assert.equal(await p.texto('#cita-comentario'), FRASE, 'muestra qué texto se comenta');
    assert.equal(await p.evaluar('document.activeElement.id'), 'campo-comentario', 'el cursor queda listo para escribir');

    await p.escribir('entra en el parcial');
    await p.tecla('Enter', 'Enter', 13, 0, '\r');
    assert.ok(!(await p.visible('editor-comentario')));
    assert.equal(await comentarioDe(p), 'Comentario: entra en el parcial', 'se ve al pasar el mouse');
    assert.equal(await p.texto('#lista-resaltados .comentario-item'), 'entra en el parcial');
    assert.equal((await p.guardado()).resaltados[0].comentario, 'entra en el parcial');
  }));

test('con texto seleccionado, C lo resalta y abre el comentario', () =>
  conVisor(chrome, async (p) => {
    await p.seleccionar(FRASE);
    await p.apretar('c');
    assert.equal(await p.marcas(), FRASE, 'lo resalta con el color elegido');
    assert.ok(await p.visible('editor-comentario'));
    await p.escribir('idea');
    await p.clicAfuera();
    assert.ok(!(await p.visible('editor-comentario')), 'un click afuera lo cierra...');
    assert.equal(await comentarioDe(p), 'Comentario: idea', '...y lo guarda');
  }));

test('Esc cancela sin guardar; Shift+Enter hace una línea nueva', () =>
  conVisor(chrome, async (p) => {
    await resaltarFrase(p);
    await p.clicEnTexto('pantalla');
    await p.apretar('c');
    await p.escribir('borrador');
    await p.escape();
    assert.ok(!(await p.visible('editor-comentario')));
    assert.equal(await comentarioDe(p), null);

    await p.clicEnTexto('pantalla');
    await p.apretar('c');
    await p.escribir('uno');
    await p.tecla('Enter', 'Enter', 13, 8, '\r');
    await p.escribir('dos');
    assert.equal(await p.evaluar(`document.getElementById('campo-comentario').value`), 'uno\ndos');
    await p.clic('#boton-guardar-comentario');
    assert.equal(await comentarioDe(p), 'Comentario: uno\ndos');
  }));

test('editar y borrar un comentario, y deshacer con Ctrl+Z', () =>
  conVisor(chrome, async (p) => {
    await resaltarFrase(p);
    await p.clicEnTexto('pantalla');
    await p.apretar('c');
    await p.escribir('primero');
    await p.tecla('Enter', 'Enter', 13, 0, '\r');

    await p.clicEnTexto('pantalla');
    assert.equal(await p.texto('#texto-boton-comentar'), 'Editar comentario');
    await p.apretar('c');
    assert.equal(await p.evaluar(`document.getElementById('campo-comentario').value`), 'primero');
    assert.ok(await p.visible('boton-borrar-comentario'));
    await p.clic('#boton-borrar-comentario');
    assert.equal(await comentarioDe(p), null);
    assert.equal(await p.marcas(), FRASE, 'borrar el comentario no quita el resaltado');

    await p.ctrlZ();
    assert.equal(await p.avisoAccion(), 'Deshecho: comentario borrado');
    assert.equal(await comentarioDe(p), 'Comentario: primero');
    await p.ctrlZ();
    assert.equal(await comentarioDe(p), null);
    assert.equal(await p.marcas(), FRASE);
  }));

test('el puntito del comentario no corre el texto (la selección sigue alineada)', () =>
  conVisor(chrome, async (p) => {
    await resaltarFrase(p);
    const antes = await p.rect('más que leer');
    await p.clicEnTexto('pantalla');
    await p.apretar('c');
    await p.escribir('x');
    await p.tecla('Enter', 'Enter', 13, 0, '\r');
    const despues = await p.rect('más que leer');
    assert.ok(Math.abs(despues.x1 - antes.x1) < 0.5, `se movió de ${antes.x1} a ${despues.x1}`);
  }));

test('comentar desde la lista del panel', () =>
  conVisor(chrome, async (p) => {
    await resaltarFrase(p);
    await p.clic('#boton-notas');
    await p.clic('#lista-resaltados .comentar-item');
    await p.esperarHasta(`!document.getElementById('editor-comentario').classList.contains('oculto')`);
    await p.escribir('desde la lista');
    await p.tecla('Enter', 'Enter', 13, 0, '\r');
    assert.equal(await p.texto('#lista-resaltados .comentario-item'), 'desde la lista');
  }));

test('las teclas no se disparan mientras se escribe el comentario', () =>
  conVisor(chrome, async (p) => {
    await resaltarFrase(p);
    await p.clicEnTexto('pantalla');
    await p.apretar('c');
    await p.escribir('r1n?');
    assert.equal(await p.evaluar(`document.getElementById('campo-comentario').value`), 'r1n?');
    assert.ok(!(await p.visible('aviso-modo')));
    assert.ok(!(await p.visible('panel-atajos')));
  }));
