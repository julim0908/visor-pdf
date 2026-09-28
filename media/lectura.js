// Opciones de lectura del menú "Aa": color de papel, guía de lectura y voz.
// Son preferencias de la persona (no de un PDF): la extensión las guarda y las
// aplica a todos los visores abiertos.
import { hayVoz, listarVoces, alCambiarVoces, probarVoz } from './voz.js';

const PREFERENCIAS_POR_DEFECTO = {
  papel: 'blanco',
  guia: false,
  altoGuia: 'media',
  voz: '', // voiceURI de la voz elegida ('' = elegir una en español automáticamente)
  velocidadVoz: 1,
  consejoVisto: false
};
const VELOCIDADES = [0.75, 1, 1.25, 1.5];
const PAPELES = ['blanco', 'crema', 'durazno', 'celeste', 'verde', 'gris'];
// Alto de la franja con zoom 100%, en píxeles; se multiplica por el zoom
// para que siempre abarque más o menos la misma cantidad de texto.
const ALTOS_GUIA = { fina: 22, media: 34, ancha: 52 };

const esCampoEditable = (elemento) =>
  elemento instanceof HTMLElement && (elemento.matches('input, textarea, select') || elemento.isContentEditable);

// `guardar(preferencias)` se llama cada vez que la persona cambia algo.
export function crearLectura({ visor, paginas, obtenerZoom, guardar }) {
  const botonLectura = document.getElementById('boton-lectura');
  const menu = document.getElementById('menu-lectura');
  const opcionesPapel = [...menu.querySelectorAll('.opcion-papel')];
  const casillaGuia = document.getElementById('casilla-guia');
  const selectorAlto = document.getElementById('selector-alto-guia');
  const guia = document.getElementById('guia-lectura');
  const opcionesVoz = document.getElementById('opciones-voz');
  const selectorVoz = document.getElementById('selector-voz');
  const selectorVelocidad = document.getElementById('selector-velocidad');
  const botonProbarVoz = document.getElementById('boton-probar-voz');
  const avisoSinVoces = document.getElementById('sin-voces');

  let preferencias = { ...PREFERENCIAS_POR_DEFECTO };
  let posicionGuia = null; // píxeles desde el borde de arriba del visor

  function aplicar(nuevas) {
    preferencias = { ...PREFERENCIAS_POR_DEFECTO, ...(nuevas || {}) };
    if (!PAPELES.includes(preferencias.papel)) preferencias.papel = 'blanco';
    if (!ALTOS_GUIA[preferencias.altoGuia]) preferencias.altoGuia = 'media';
    preferencias.guia = Boolean(preferencias.guia);
    if (!VELOCIDADES.includes(Number(preferencias.velocidadVoz))) preferencias.velocidadVoz = 1;
    preferencias.velocidadVoz = Number(preferencias.velocidadVoz);
    selectorVelocidad.value = String(preferencias.velocidadVoz);
    llenarVoces();

    // viewer.css tiñe las páginas según este atributo.
    paginas.dataset.papel = preferencias.papel;
    for (const opcion of opcionesPapel) {
      opcion.setAttribute('aria-checked', String(opcion.dataset.papel === preferencias.papel));
      opcion.tabIndex = opcion.dataset.papel === preferencias.papel ? 0 : -1;
    }
    casillaGuia.checked = preferencias.guia;
    selectorAlto.value = preferencias.altoGuia;
    selectorAlto.disabled = !preferencias.guia;
    guia.classList.toggle('oculto', !preferencias.guia);
    botonLectura.classList.toggle('con-opciones', preferencias.papel !== 'blanco' || preferencias.guia);
    dibujarGuia();
  }

  function cambiar(cambios) {
    aplicar({ ...preferencias, ...cambios });
    guardar(preferencias);
  }

  // ---------- Voz ----------

  // Las voces las da el sistema operativo y pueden llegar un rato después de abrir.
  function llenarVoces() {
    const voces = listarVoces();
    const sinVoces = voces.length === 0;
    opcionesVoz.classList.toggle('oculto', sinVoces);
    avisoSinVoces.classList.toggle('oculto', !sinVoces || !hayVoz());
    if (sinVoces) return;

    const automatica = document.createElement('option');
    automatica.value = '';
    automatica.textContent = 'Automática (español)';
    const opciones = voces.map((voz) => {
      const opcion = document.createElement('option');
      opcion.value = voz.voiceURI;
      opcion.textContent = `${voz.name} (${voz.lang})`;
      return opcion;
    });
    selectorVoz.replaceChildren(automatica, ...opciones);
    selectorVoz.value = voces.some((v) => v.voiceURI === preferencias.voz) ? preferencias.voz : '';
  }

  alCambiarVoces(llenarVoces);
  selectorVoz.addEventListener('change', () => cambiar({ voz: selectorVoz.value }));
  selectorVelocidad.addEventListener('change', () => cambiar({ velocidadVoz: Number(selectorVelocidad.value) }));
  botonProbarVoz.addEventListener('click', () => probarVoz(preferencias.voz, preferencias.velocidadVoz));
  if (!hayVoz()) opcionesVoz.classList.add('oculto');

  // ---------- Guía de lectura ----------

  function altoGuia() {
    return Math.min(ALTOS_GUIA[preferencias.altoGuia] * obtenerZoom(), visor.clientHeight);
  }

  function dibujarGuia() {
    if (!preferencias.guia) return;
    const alto = altoGuia();
    if (posicionGuia === null) posicionGuia = visor.clientHeight / 3;
    posicionGuia = Math.min(Math.max(posicionGuia, 0), Math.max(visor.clientHeight - alto, 0));
    guia.style.setProperty('--guia-y', `${posicionGuia}px`);
    guia.style.setProperty('--guia-alto', `${alto}px`);
  }

  // Mueve la franja un renglón. Cerca de los bordes se mueve la página en vez
  // de la franja, así se puede leer todo el PDF sin soltar las flechas.
  function moverGuia(direccion) {
    const alto = altoGuia();
    let y = (posicionGuia ?? visor.clientHeight / 3) + direccion * alto;
    const limiteAbajo = visor.clientHeight * 0.7 - alto;
    const limiteArriba = visor.clientHeight * 0.2;
    if (direccion > 0 && y > limiteAbajo) {
      visor.scrollTop += y - limiteAbajo;
      y = limiteAbajo;
    } else if (direccion < 0 && y < limiteArriba && visor.scrollTop > 0) {
      visor.scrollTop -= limiteArriba - y;
      y = limiteArriba;
    }
    posicionGuia = y;
    dibujarGuia();
  }

  visor.addEventListener('mousemove', (evento) => {
    if (!preferencias.guia) return;
    posicionGuia = evento.clientY - visor.getBoundingClientRect().top - altoGuia() / 2;
    dibujarGuia();
  });
  new ResizeObserver(dibujarGuia).observe(visor);

  document.addEventListener('keydown', (evento) => {
    if (!preferencias.guia || evento.altKey || evento.ctrlKey || evento.metaKey) return;
    if (evento.key !== 'ArrowDown' && evento.key !== 'ArrowUp') return;
    if (esCampoEditable(evento.target) || menu.contains(evento.target)) return;
    evento.preventDefault();
    moverGuia(evento.key === 'ArrowDown' ? 1 : -1);
  });

  // ---------- Menú "Aa" ----------

  function abrirMenu(abrir) {
    menu.classList.toggle('oculto', !abrir);
    botonLectura.setAttribute('aria-expanded', String(abrir));
    botonLectura.classList.toggle('activo', abrir);
    if (abrir) {
      const elegida = opcionesPapel.find((o) => o.getAttribute('aria-checked') === 'true');
      (elegida || opcionesPapel[0]).focus();
    }
  }

  botonLectura.addEventListener('click', () => abrirMenu(menu.classList.contains('oculto')));

  document.addEventListener('pointerdown', (evento) => {
    if (menu.classList.contains('oculto')) return;
    if (!menu.contains(evento.target) && !botonLectura.contains(evento.target)) abrirMenu(false);
  });

  menu.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') {
      abrirMenu(false);
      botonLectura.focus();
      return;
    }
    // Las opciones de papel se recorren con las flechas, como cualquier grupo de opciones.
    const indice = opcionesPapel.indexOf(evento.target);
    if (indice === -1) return;
    const paso = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[evento.key];
    if (!paso) return;
    evento.preventDefault();
    const siguiente = opcionesPapel[(indice + paso + opcionesPapel.length) % opcionesPapel.length];
    cambiar({ papel: siguiente.dataset.papel });
    siguiente.focus();
  });

  for (const opcion of opcionesPapel) {
    opcion.addEventListener('click', () => cambiar({ papel: opcion.dataset.papel }));
  }
  casillaGuia.addEventListener('change', () => cambiar({ guia: casillaGuia.checked }));
  selectorAlto.addEventListener('change', () => cambiar({ altoGuia: selectorAlto.value }));

  aplicar(PREFERENCIAS_POR_DEFECTO);

  return {
    aplicar,
    cambiar,
    obtener: () => preferencias,
    // El alto de la franja depende del zoom.
    alCambiarZoom: dibujarGuia
  };
}
