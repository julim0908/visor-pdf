// Ayudantes para las pruebas de punta a punta: abren el visor en un Chrome sin
// ventana (con la extensión de verdad detrás, vía el banco) y lo manejan con
// mouse y teclado reales, como una persona.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  Cdp,
  AYUDANTES,
  buscarChrome,
  matar,
  esperar,
  conBanco,
  PUERTO_CHROME,
  URL_VISOR
} = require('../demo/capturar.js');
const { generarDemoPdf } = require('../demo/generar-demo-pdf.js');

// Un Chrome para todo un archivo de pruebas.
async function abrirChrome() {
  const trabajo = fs.mkdtempSync(path.join(os.tmpdir(), 'visor-e2e-'));
  const proceso = spawn(
    buscarChrome(),
    [
      '--headless=new',
      `--remote-debugging-port=${PUERTO_CHROME}`,
      `--user-data-dir=${path.join(trabajo, 'chrome')}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank'
    ],
    { stdio: 'ignore' }
  );
  const cdp = await Cdp.conectar(PUERTO_CHROME);
  await cdp.enviar('Page.enable');
  await cdp.enviar('Runtime.enable');
  await cdp.enviar('Page.addScriptToEvaluateOnNewDocument', { source: AYUDANTES });
  await cdp.enviar('Emulation.setDeviceMetricsOverride', { width: 1400, height: 850, deviceScaleFactor: 1, mobile: false });

  const excepciones = [];
  cdp.ws.addEventListener('message', (evento) => {
    const mensaje = JSON.parse(evento.data);
    if (mensaje.method === 'Runtime.exceptionThrown') {
      const detalle = mensaje.params.exceptionDetails;
      excepciones.push(detalle.exception?.description || detalle.text);
    }
  });

  return {
    cdp,
    excepciones,
    trabajo,
    async cerrar() {
      cdp.cerrar();
      matar(proceso);
      await esperar(500);
      try {
        fs.rmSync(trabajo, { recursive: true, force: true });
      } catch {
        // Windows a veces tarda en soltar los archivos de Chrome
      }
    }
  };
}

// Abre el PDF de ejemplo en una carpeta nueva (sin notas ni resaltados) y le pasa
// a `tarea` los ayudantes para manejar la página. `idioma`: el de VS Code ('es' o 'en').
async function conVisor(chrome, tarea, { idioma = 'es' } = {}) {
  const carpeta = fs.mkdtempSync(path.join(chrome.trabajo, 'pdfs-'));
  generarDemoPdf(carpeta);
  const { cdp } = chrome;
  chrome.excepciones.length = 0;

  // El banco (un proceso aparte) hereda esta variable y simula VS Code en ese idioma.
  process.env.VISOR_IDIOMA = idioma;
  await conBanco(carpeta, async () => {
    await cdp.enviar('Page.navigate', { url: URL_VISOR });
    await cdp.esperarHasta(`document.querySelector('.pagina-wrapper[data-numero-pagina="1"] .textLayer span')`);
    await esperar(600);
    await cdp.evaluar(`document.getElementById('consejo').classList.add('oculto')`);
    try {
      await tarea(crearPagina(cdp, carpeta));
    } finally {
      // Cerramos la página antes de apagar el banco: si no, algo que el visor guarda
      // con demora (como el progreso) fallaría al no encontrar el servidor.
      await cdp.enviar('Page.navigate', { url: 'about:blank' });
      await esperar(200);
    }
  });
}

function crearPagina(cdp, carpeta) {
  const evaluar = (expresion) => cdp.evaluar(expresion);

  const mouse = (type, x, y, buttons = 0, clickCount = 1) =>
    cdp.enviar('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: type === 'mouseMoved' && !buttons ? 'none' : 'left',
      buttons,
      clickCount
    });

  async function clicEn(x, y) {
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, 1);
    await mouse('mouseReleased', x, y, 0);
    await esperar(250);
  }

  async function arrastrar(x1, y1, x2, y2) {
    await mouse('mouseMoved', x1, y1);
    await mouse('mousePressed', x1, y1, 1);
    for (let i = 1; i <= 12; i++) {
      await mouse('mouseMoved', x1 + ((x2 - x1) * i) / 12, y1 + ((y2 - y1) * i) / 12, 1);
    }
    await mouse('mouseReleased', x2, y2, 0);
    await esperar(300);
  }

  // Rectángulo (en pantalla) de la primera aparición de `texto` en la página 1.
  const rect = (texto) =>
    evaluar(`(() => {
      const capa = document.querySelector('.pagina-wrapper[data-numero-pagina="1"] .textLayer');
      const recorrido = document.createTreeWalker(capa, NodeFilter.SHOW_TEXT);
      for (let n = recorrido.nextNode(); n; n = recorrido.nextNode()) {
        const i = n.textContent.indexOf(${JSON.stringify(texto)});
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + ${JSON.stringify(texto)}.length);
        const b = r.getBoundingClientRect();
        return { x1: b.left, x2: b.right, y: (b.top + b.bottom) / 2 };
      }
      return null;
    })()`);

  async function tecla(key, code, codigoVirtual, modificadores = 0, texto) {
    const base = { key, code, windowsVirtualKeyCode: codigoVirtual, modifiers: modificadores };
    await cdp.enviar('Input.dispatchKeyEvent', { ...base, type: texto ? 'keyDown' : 'rawKeyDown', text: texto });
    await cdp.enviar('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
    await esperar(120);
  }

  const CTRL = 2;
  const SHIFT = 8;

  const pagina = {
    carpeta, // donde está el PDF de ejemplo (y su .practicos.json)
    evaluar,
    mouse,
    arrastrar,
    rect,
    tecla,
    esperar,
    esperarHasta: (expresion, ms = 3000) => cdp.esperarHasta(expresion, ms),

    async clic(selector) {
      const r = await evaluar(`(() => {
        const e = document.querySelector(${JSON.stringify(selector)});
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2, ancho: b.width };
      })()`);
      if (!r || !r.ancho) throw new Error(`No se ve ${selector} para hacerle click`);
      await clicEn(r.x, r.y);
    },

    // Click sobre un texto del PDF (sin arrastrar).
    async clicEnTexto(texto) {
      const r = await rect(texto);
      await clicEn((r.x1 + r.x2) / 2, r.y);
    },

    // Selecciona `texto` de la página 1 arrastrando el mouse.
    async seleccionar(texto) {
      const r = await rect(texto);
      if (!r) throw new Error(`No encontré "${texto}" en la página 1`);
      await arrastrar(r.x1 + 1, r.y, r.x2 - 1, r.y);
    },

    // Click en un lugar vacío, para soltar la selección.
    async clicAfuera() {
      await clicEn(700, 830);
      await esperar(100);
    },

    // Una letra, un número o un signo, sin modificadores (salvo Shift para "?" y "+").
    async apretar(caracter) {
      const especiales = {
        '?': ['Slash', 191, SHIFT],
        '+': ['Equal', 187, SHIFT],
        '-': ['Minus', 189, 0]
      };
      const [code, virtual, mods] = especiales[caracter] || ['', caracter.toUpperCase().charCodeAt(0), 0];
      await tecla(caracter, code, virtual, mods, caracter);
    },

    escape: () => tecla('Escape', 'Escape', 27),
    suprimir: () => tecla('Delete', 'Delete', 46),
    ctrlZ: () => tecla('z', 'KeyZ', 90, CTRL),
    ctrlY: () => tecla('y', 'KeyY', 89, CTRL),

    async escribir(texto) {
      for (const c of texto) {
        if (c === '\n') await tecla('Enter', 'Enter', 13, 0, '\r');
        // El código de tecla solo importa para letras, números y espacio; para el
        // resto va 0 (por ejemplo, el del "." coincidiría con el de Supr).
        else await tecla(c, '', /^[a-z0-9 ]$/i.test(c) ? c.toUpperCase().charCodeAt(0) : 0, 0, c);
      }
    },

    // Estado de la página, para las verificaciones.
    marcas: () => evaluar(`[...document.querySelectorAll('.textLayer .marca')].map((m) => m.textContent).join('|')`),
    notas: () => evaluar(`document.getElementById('campo-notas').value`),
    avisoAccion: () => evaluar(`document.getElementById('aviso-accion').textContent`),
    texto: (selector) => evaluar(`document.querySelector(${JSON.stringify(selector)}).textContent`),
    visible: (id) => evaluar(`!document.getElementById(${JSON.stringify(id)}).classList.contains('oculto')`),
    cantidad: (selector) => evaluar(`document.querySelectorAll(${JSON.stringify(selector)}).length`),

    // Lo que quedó guardado en el .practicos.json (espera a que se escriba).
    async guardado() {
      await esperar(1500);
      const json = JSON.parse(fs.readFileSync(path.join(carpeta, '.practicos.json'), 'utf8'));
      return Object.values(json.practicos || json)[0];
    }
  };
  return pagina;
}

module.exports = { abrirChrome, conVisor };
