// Genera las imágenes de presentación (capturas, GIF y portada) en docs/imagenes/.
// Maneja el visor en un Chrome sin ventana (protocolo de depuración, sin dependencias)
// con un PDF de ejemplo de texto propio. La voz se simula (no suena) para poder
// mostrar cómo se marca la palabra que se lee.
//
// Uso:  npm run capturas
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { generarDemoPdf } = require('./generar-demo-pdf');
const { crearGif, decodificarPng } = require('./gif');

const RAIZ = path.resolve(__dirname, '..', '..');
const SALIDA = path.join(RAIZ, 'docs', 'imagenes');
const PUERTO_BANCO = 5757;
const PUERTO_CHROME = 9333;
const URL_VISOR = `http://localhost:${PUERTO_BANCO}/?archivo=guia-de-lectura.pdf`;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function buscarChrome() {
  const candidatos = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  const encontrado = candidatos.find((ruta) => fs.existsSync(ruta));
  if (!encontrado) throw new Error('No encontré Chrome ni Edge para generar las imágenes');
  return encontrado;
}

function matar(proceso) {
  if (!proceso || proceso.killed) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${proceso.pid} /T /F`, { stdio: 'ignore' });
    else proceso.kill();
  } catch {
    // ya había terminado
  }
}

async function esperarServidor(url, ms = 15000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    try {
      await fetch(url);
      return;
    } catch {
      await esperar(200);
    }
  }
  throw new Error(`No respondió ${url}`);
}

// ---------- Cliente mínimo del protocolo de depuración de Chrome ----------

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pendientes = new Map();
    ws.addEventListener('message', (evento) => {
      const mensaje = JSON.parse(evento.data);
      const espera = this.pendientes.get(mensaje.id);
      if (!espera) return;
      this.pendientes.delete(mensaje.id);
      if (mensaje.error) espera.rechazar(new Error(`${mensaje.error.message}`));
      else espera.resolver(mensaje.result);
    });
  }

  static async conectar(puerto) {
    let pestana;
    for (let intento = 0; intento < 50 && !pestana; intento++) {
      try {
        const lista = await (await fetch(`http://127.0.0.1:${puerto}/json`)).json();
        pestana = lista.find((t) => t.type === 'page');
      } catch {
        // Chrome todavía está arrancando
      }
      if (!pestana) await esperar(200);
    }
    if (!pestana) throw new Error('Chrome no abrió una pestaña');
    const ws = new WebSocket(pestana.webSocketDebuggerUrl);
    await new Promise((resolver, rechazar) => {
      ws.addEventListener('open', resolver, { once: true });
      ws.addEventListener('error', rechazar, { once: true });
    });
    return new Cdp(ws);
  }

  enviar(metodo, parametros = {}) {
    const id = ++this.id;
    return new Promise((resolver, rechazar) => {
      this.pendientes.set(id, { resolver, rechazar });
      this.ws.send(JSON.stringify({ id, method: metodo, params: parametros }));
    });
  }

  async evaluar(expresion) {
    const { result, exceptionDetails } = await this.enviar('Runtime.evaluate', {
      expression: expresion,
      awaitPromise: true,
      returnByValue: true
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    }
    return result.value;
  }

  async esperarHasta(expresion, ms = 10000) {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
      if (await this.evaluar(`Boolean(${expresion})`).catch(() => false)) return;
      await esperar(100);
    }
    throw new Error(`Se agotó el tiempo esperando: ${expresion}`);
  }

  async captura() {
    const { data } = await this.enviar('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(data, 'base64');
  }

  cerrar() {
    this.ws.close();
  }
}

// ---------- Lo que se inyecta en la página ----------

// La voz simulada guarda cada frase que se "diría" (window.__enunciado) y deja
// disparar a mano el aviso de "estoy leyendo esta palabra".
// Los ayudantes seleccionan texto del PDF y mueven la guía como lo haría una persona.
const AYUDANTES = `(() => {
  const voces = [
    { name: 'Microsoft Sabina - Spanish (Mexico)', lang: 'es-MX', voiceURI: 'sabina' },
    { name: 'Microsoft Raul - Spanish (Mexico)', lang: 'es-MX', voiceURI: 'raul' }
  ];
  window.SpeechSynthesisUtterance = class { constructor(texto) { this.text = texto; } };
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      getVoices: () => voces,
      addEventListener() {},
      speak(frase) { window.__enunciado = frase; },
      cancel() { window.__enunciado = null; },
      pause() {},
      resume() {}
    }
  });

  window.__demo = {
    // Selecciona desde el texto \`inicio\` hasta el final del texto \`fin\` (pueden estar en renglones distintos).
    seleccionar(pagina, inicio, fin = inicio) {
      const capa = document.querySelector('.pagina-wrapper[data-numero-pagina="' + pagina + '"] .textLayer');
      const recorrido = document.createTreeWalker(capa, NodeFilter.SHOW_TEXT);
      const renglon = (nodo) => nodo.parentElement.closest('.textLayer > span') || nodo.parentElement;
      let texto = '';
      const mapa = [];
      let anterior = null;
      for (let nodo = recorrido.nextNode(); nodo; nodo = recorrido.nextNode()) {
        if (anterior && renglon(nodo) !== renglon(anterior)) {
          texto += ' ';
          mapa.push(null);
        }
        for (let k = 0; k < nodo.textContent.length; k++) mapa.push([nodo, k]);
        texto += nodo.textContent;
        anterior = nodo;
      }
      const desde = texto.indexOf(inicio);
      if (desde < 0) throw new Error('No encontré: ' + inicio);
      const hasta = texto.indexOf(fin, desde);
      if (hasta < 0) throw new Error('No encontré: ' + fin);
      const primero = mapa[desde];
      const ultimo = mapa[hasta + fin.length - 1];
      const rango = document.createRange();
      rango.setStart(primero[0], primero[1]);
      rango.setEnd(ultimo[0], ultimo[1] + 1);
      getSelection().removeAllRanges();
      getSelection().addRange(rango);
      ultimo[0].parentElement.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    },
    color(nombre) {
      document.querySelector('#menu-resaltar .boton-color[data-color="' + nombre + '"]').click();
    },
    guia(y) {
      const visor = document.getElementById('visor');
      visor.dispatchEvent(new MouseEvent('mousemove', { clientY: y, bubbles: true }));
    },
    // Un click como el de una persona: apretar, soltar y hacer click (el visor cierra
    // el menú de colores al apretar en otro lado).
    clic(id) {
      const elemento = document.getElementById(id);
      elemento.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      elemento.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      elemento.click();
    },
    guiaActiva(activa) {
      const casilla = document.getElementById('casilla-guia');
      casilla.checked = activa;
      casilla.dispatchEvent(new Event('change', { bubbles: true }));
    },
    palabra(k) {
      const frase = window.__enunciado;
      const coincidencia = [...frase.text.matchAll(/\\S+/g)][k];
      frase.onboundary({ name: 'word', charIndex: coincidencia.index, charLength: coincidencia[0].length });
    },
    siguienteFrase() { window.__enunciado.onend(); },
    escribirNotas(texto) {
      const campo = document.getElementById('campo-notas');
      campo.value = texto;
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    },
    tecla(key) { document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); }
  };
})();`;

// ---------- Frases del PDF de ejemplo que se resaltan ----------

const FRASE_1 = 'Leer en pantalla cansa más que leer en papel';
const FRASE_2 = ['otras prefieren escuchar el texto', 'con la vista'];
const FRASE_3 = 'reduce el deslumbramiento sin quitar contraste al texto';
const FRASE_4 = 'Lo importante es poder elegir';
const PARRAFO_LECTURA = ['Algunas necesitan menos brillo', 'sea más llevadero'];

// ---------- Ejecución ----------

async function conBanco(carpetaPdfs, tarea) {
  const banco = spawn(process.execPath, [path.join(RAIZ, 'test', 'banco', 'servidor.js'), carpetaPdfs], {
    stdio: 'ignore'
  });
  try {
    await esperarServidor(`http://localhost:${PUERTO_BANCO}/puente.js`);
    return await tarea();
  } finally {
    matar(banco);
    await esperar(300);
  }
}

async function main() {
  fs.mkdirSync(SALIDA, { recursive: true });
  const trabajo = fs.mkdtempSync(path.join(os.tmpdir(), 'visor-capturas-'));
  const perfilChrome = path.join(trabajo, 'chrome');
  const nuevaCarpeta = (nombre) => {
    const carpeta = path.join(trabajo, nombre);
    generarDemoPdf(carpeta);
    return carpeta;
  };

  const chrome = spawn(
    buscarChrome(),
    [
      '--headless=new',
      `--remote-debugging-port=${PUERTO_CHROME}`,
      `--user-data-dir=${perfilChrome}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  let cdp;
  try {
    cdp = await Cdp.conectar(PUERTO_CHROME);
    await cdp.enviar('Page.enable');
    await cdp.enviar('Runtime.enable');
    await cdp.enviar('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp.enviar('Page.addScriptToEvaluateOnNewDocument', { source: AYUDANTES });

    const tamano = (ancho, alto, escala) =>
      cdp.enviar('Emulation.setDeviceMetricsOverride', {
        width: ancho,
        height: alto,
        deviceScaleFactor: escala,
        mobile: false
      });
    const abrirVisor = async () => {
      await cdp.enviar('Page.navigate', { url: URL_VISOR });
      await cdp.esperarHasta(
        `document.getElementById('etiqueta-total-paginas').textContent.startsWith('de ') && ` +
          `!document.getElementById('etiqueta-total-paginas').textContent.includes('–') && ` +
          `document.querySelector('.pagina-wrapper[data-numero-pagina="1"] .textLayer span')`
      );
      await esperar(600);
    };
    const hacer = async (codigo, pausa = 250) => {
      await cdp.evaluar(codigo);
      await esperar(pausa);
    };
    const guardar = async (nombre) => {
      const archivo = path.join(SALIDA, nombre);
      fs.writeFileSync(archivo, await cdp.captura());
      console.log(`  ${path.relative(RAIZ, archivo)} (${Math.round(fs.statSync(archivo).size / 1024)} KB)`);
      return archivo;
    };
    const resaltar = async (pagina, inicio, fin, color) => {
      await hacer(`__demo.seleccionar(${pagina}, ${JSON.stringify(inicio)}, ${JSON.stringify(fin)})`, 300);
      await hacer(`__demo.color('${color}')`, 350);
    };

    // 1) Vista principal: resaltados, notas y estado
    console.log('Capturas:');
    await conBanco(nuevaCarpeta('principal'), async () => {
      await tamano(1280, 800, 1.5);
      await abrirVisor();
      await hacer(`document.getElementById('boton-notas').click()`, 700);
      await resaltar(1, FRASE_1, FRASE_1, 'amarillo');
      await resaltar(1, FRASE_2[0], FRASE_2[1], 'verde');
      await resaltar(1, FRASE_3, FRASE_3, 'rosa');
      await resaltar(1, FRASE_4, FRASE_4, 'celeste');
      await hacer(
        `__demo.escribirNotas('Cambiar el color de papel me ayudó a leer más rápido.\\n[pág. 1] Probar la guía de lectura con el próximo informe.')`,
        1300
      );
      await hacer(`document.getElementById('boton-estado').click()`, 200);
      await hacer(`document.querySelector('#menu-estado [data-estado="en-progreso"]').click()`, 500);
      await hacer(`document.activeElement && document.activeElement.blur(); getSelection().removeAllRanges()`, 200);
      await guardar('visor-principal.png');
    });

    // 2) Opciones de lectura: color de papel y guía
    await conBanco(nuevaCarpeta('lectura'), async () => {
      await tamano(1280, 800, 1.5);
      await abrirVisor();
      await hacer(`document.getElementById('consejo').classList.add('oculto')`, 100);
      await hacer(`document.getElementById('boton-lectura').click()`, 200);
      await hacer(`document.querySelector('#menu-lectura [data-papel="crema"]').click()`, 200);
      await hacer(`__demo.guiaActiva(true)`, 300);
      await hacer(`__demo.guia(480)`, 400);
      await hacer(`document.activeElement && document.activeElement.blur()`, 200);
      await guardar('opciones-de-lectura.png');
    });

    // 3) Modo resaltador con el menú de colores
    await conBanco(nuevaCarpeta('resaltador'), async () => {
      await tamano(1280, 800, 1.5);
      await abrirVisor();
      await resaltar(1, FRASE_1, FRASE_1, 'amarillo');
      await hacer(`document.getElementById('consejo').classList.add('oculto')`, 100);
      await hacer(`document.getElementById('boton-color-resaltador').click()`, 200);
      await hacer(`document.querySelector('#menu-color-resaltador [data-color="rosa"]').click()`, 300);
      await hacer(`document.getElementById('boton-color-resaltador').click()`, 300);
      await guardar('modo-resaltador.png');
    });

    // 4) Lectura en voz alta con la palabra marcada
    await conBanco(nuevaCarpeta('voz'), async () => {
      await tamano(1280, 800, 1.5);
      await abrirVisor();
      await hacer(`document.getElementById('consejo').classList.add('oculto')`, 100);
      await hacer(`__demo.seleccionar(1, ${JSON.stringify(PARRAFO_LECTURA[0])}, ${JSON.stringify(PARRAFO_LECTURA[1])})`, 300);
      await hacer(`__demo.clic('boton-leer')`, 400);
      await hacer(`__demo.siguienteFrase()`, 400);
      await hacer(`__demo.palabra(8)`, 500);
      await guardar('lectura-en-voz-alta.png');
    });

    // 5) GIF: un recorrido de las funciones principales
    console.log('GIF:');
    const cuadros = [];
    await conBanco(nuevaCarpeta('gif'), async () => {
      await tamano(1100, 620, 1);
      await abrirVisor();
      const cuadro = async (demora) => cuadros.push({ png: await cdp.captura(), demora });

      await cuadro(160); // arranque, con el consejo
      await hacer(`__demo.seleccionar(1, ${JSON.stringify(FRASE_1)})`, 350);
      await cuadro(110); // selección con el menú de colores
      await hacer(`__demo.color('amarillo')`, 450);
      await cuadro(90);
      await hacer(`document.getElementById('boton-resaltador').click()`, 350);
      await cuadro(90); // modo resaltador
      await hacer(`__demo.tecla('2')`, 250);
      await hacer(`__demo.seleccionar(1, ${JSON.stringify(FRASE_2[0])}, ${JSON.stringify(FRASE_2[1])})`, 500);
      await cuadro(110); // resaltado en verde
      await hacer(`__demo.tecla('Escape')`, 250);
      await hacer(`document.getElementById('boton-lectura').click()`, 300);
      await cuadro(90); // menú Aa
      await hacer(`document.querySelector('#menu-lectura [data-papel="crema"]').click()`, 400);
      await cuadro(100); // papel crema
      await hacer(`document.getElementById('boton-lectura').click()`, 300);
      await cuadro(70);
      await hacer(`__demo.seleccionar(1, ${JSON.stringify(PARRAFO_LECTURA[0])}, ${JSON.stringify(PARRAFO_LECTURA[1])})`, 300);
      await hacer(`__demo.clic('boton-leer')`, 400);
      await hacer(`__demo.palabra(1)`, 350);
      await cuadro(80); // leyendo
      await hacer(`__demo.palabra(5)`, 350);
      await cuadro(80);
      await hacer(`__demo.palabra(9)`, 350);
      await cuadro(80);
      await hacer(`document.getElementById('boton-detener-lectura').click(); getSelection().removeAllRanges()`, 300);
      await hacer(`__demo.guiaActiva(true); __demo.guia(330)`, 450);
      await cuadro(110); // guía de lectura
      await hacer(`__demo.guia(400)`, 300);
      await cuadro(80);
      await hacer(`__demo.guiaActiva(false)`, 300);
      await hacer(`document.getElementById('boton-notas').click()`, 700);
      await hacer(`__demo.escribirNotas('Cambiar el color de papel me ayudó a leer más rápido.\\n[pág. 1] Probar la guía de lectura con el próximo informe.')`, 1300);
      await cuadro(140); // notas y lista de resaltados
      await hacer(`document.getElementById('boton-estado').click()`, 300);
      await cuadro(90);
      await hacer(`document.querySelector('#menu-estado [data-estado="hecho"]').click()`, 500);
      await cuadro(220); // final: estado "Hecho"
    });
    const gif = crearGif(cuadros);
    const archivoGif = path.join(SALIDA, 'recorrido.gif');
    fs.writeFileSync(archivoGif, gif);
    console.log(`  ${path.relative(RAIZ, archivoGif)} (${(gif.length / 1024 / 1024).toFixed(1)} MB, ${cuadros.length} cuadros)`);

    // Comprobamos con el decodificador de Chrome que el GIF se lee bien y se parece a los cuadros originales.
    await verificarGif(cdp, gif, cuadros);

    // Con --contacto se arma una hoja con todos los cuadros, para revisarlos de un vistazo.
    if (process.argv.includes('--contacto')) {
      const hoja = path.join(os.tmpdir(), 'visor-hoja-de-contacto.png');
      const html = path.join(trabajo, 'contacto.html');
      fs.writeFileSync(
        html,
        `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:6px;width:1600px">` +
          cuadros
            .map((c, i) => `<div style="position:relative"><img style="width:100%;display:block" src="data:image/png;base64,${c.png.toString('base64')}"><b style="position:absolute;left:6px;top:4px;color:#fff;background:#000a;padding:2px 6px;font:14px sans-serif">${i + 1}</b></div>`)
            .join('') +
          `</body>`
      );
      await tamano(1600, 1000, 1);
      await cdp.enviar('Page.navigate', { url: `file:///${html.replace(/\\/g, '/')}` });
      await cdp.esperarHasta(`document.readyState === 'complete' && [...document.images].every((i) => i.complete)`);
      await esperar(500);
      fs.writeFileSync(hoja, await cdp.captura());
      console.log(`  Hoja de contacto: ${hoja}`);
    }

    // 6) Portada para LinkedIn y la tienda
    console.log('Portada:');
    const logo = fs.readFileSync(path.join(RAIZ, 'media', 'icono-extension.png')).toString('base64');
    const captura = fs.readFileSync(path.join(SALIDA, 'visor-principal.png')).toString('base64');
    const archivoPortada = path.join(trabajo, 'portada.html');
    fs.writeFileSync(archivoPortada, portadaHtml(logo, captura));
    await tamano(1200, 627, 2);
    await cdp.enviar('Page.navigate', { url: `file:///${archivoPortada.replace(/\\/g, '/')}` });
    await cdp.esperarHasta(`document.readyState === 'complete' && [...document.images].every((i) => i.complete)`);
    await esperar(400);
    await guardar('portada.png');
  } finally {
    cdp?.cerrar();
    matar(chrome);
    await esperar(1500);
    // Si Windows todavía tiene abierto algún archivo de Chrome, la carpeta temporal queda
    // para que el sistema la limpie: no vale la pena fallar por eso.
    try {
      fs.rmSync(trabajo, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      // sin importancia
    }
  }
}

async function verificarGif(cdp, gif, cuadros) {
  const resultado = await cdp.evaluar(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(gif.toString('base64'))}), (c) => c.charCodeAt(0));
    const decodificador = new ImageDecoder({ data: bytes, type: 'image/gif' });
    await decodificador.tracks.ready;
    const total = decodificador.tracks.selectedTrack.frameCount;
    const lienzo = new OffscreenCanvas(1, 1);
    const pixeles = async (fuente, ancho, alto) => {
      lienzo.width = ancho; lienzo.height = alto;
      const ctx = lienzo.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(fuente, 0, 0);
      return ctx.getImageData(0, 0, ancho, alto).data;
    };
    const original = async (base64) => {
      const png = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
      return pixeles(png, png.width, png.height);
    };
    const diferencia = (a, b) => { let suma = 0; for (let i = 0; i < a.length; i += 4) suma += Math.abs(a[i] - b[i]) + Math.abs(a[i+1] - b[i+1]) + Math.abs(a[i+2] - b[i+2]); return suma / (a.length / 4) / 3; };
    const comparar = async (indiceGif, base64) => {
      const { image } = await decodificador.decode({ frameIndex: indiceGif });
      const leido = await pixeles(image, image.displayWidth, image.displayHeight);
      const dims = image.displayWidth + 'x' + image.displayHeight;
      image.close();
      return { dims, diferenciaMedia: Number(diferencia(leido, await original(base64)).toFixed(2)) };
    };
    return { total, primero: await comparar(0, ${JSON.stringify(cuadros[0].png.toString('base64'))}), ultimo: await comparar(total - 1, ${JSON.stringify(cuadros.at(-1).png.toString('base64'))}) };
  })()`);
  console.log(
    `  Verificado con Chrome: ${resultado.total} cuadros de ${resultado.primero.dims}; ` +
      `diferencia media con el original (0-255): primero ${resultado.primero.diferenciaMedia}, último ${resultado.ultimo.diferenciaMedia}`
  );
  if (resultado.primero.diferenciaMedia > 6 || resultado.ultimo.diferenciaMedia > 6) {
    throw new Error('El GIF no se parece a los cuadros originales');
  }
}

function portadaHtml(logoBase64, capturaBase64) {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1200px; height: 627px; overflow: hidden; position: relative; color: #fff;
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: radial-gradient(circle at 85% 20%, #2f6fbd 0%, rgba(47,111,189,0) 45%), linear-gradient(135deg, #0a1a33 0%, #10305c 100%); }
  .texto { position: absolute; left: 72px; top: 0; bottom: 0; width: 520px; display: flex; flex-direction: column; justify-content: center; }
  .marca { display: flex; align-items: center; gap: 22px; }
  .marca img { width: 92px; height: 92px; border-radius: 22px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
  h1 { margin: 0; font-size: 78px; line-height: 1; font-weight: 700; letter-spacing: -1px; }
  .lema { margin: 30px 0 26px; font-size: 29px; line-height: 1.35; color: #d7e6fb; }
  .chips { display: flex; flex-wrap: wrap; gap: 10px; }
  .chips span { padding: 8px 16px; border-radius: 999px; font-size: 18px; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.22); }
  .pie { margin-top: 34px; font-size: 18px; color: #9fbce3; }
  .captura { position: absolute; left: 620px; top: 88px; width: 760px; border-radius: 14px; overflow: hidden;
    box-shadow: 0 30px 70px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.14);
    transform: perspective(1600px) rotateY(-11deg) rotateX(3deg); transform-origin: left center; }
  .captura img { display: block; width: 100%; }
</style></head><body>
  <div class="texto">
    <div class="marca"><img src="data:image/png;base64,${logoBase64}" alt=""><h1>Visor PDF</h1></div>
    <p class="lema">Leé, resaltá, escuchá y tomá notas en cualquier PDF, sin salir de VS Code.</p>
    <div class="chips"><span>Resaltador</span><span>Lectura en voz alta</span><span>Guía de lectura</span><span>Color de papel</span><span>Notas</span></div>
    <div class="pie">Extensión gratuita para Visual Studio Code</div>
  </div>
  <div class="captura"><img src="data:image/png;base64,${capturaBase64}" alt=""></div>
</body></html>`;
}

// Las piezas se reutilizan en otras pruebas que manejan el visor en Chrome.
module.exports = { Cdp, AYUDANTES, buscarChrome, matar, esperar, esperarServidor, conBanco, PUERTO_CHROME, URL_VISOR };

if (require.main === module) {
  main().catch((error) => {
    console.error('Error:', error.message);
    process.exitCode = 1;
  });
}
