// Panel de miniaturas: una imagen chiquita de cada página para saltar rápido,
// sobre todo en PDFs sin índice. Se dibujan de a una y solo las que se ven en el
// panel, así un PDF largo no se pone lento.
import { t } from './idioma.js';

const ANCHO_MINIATURA = 120; // píxeles de pantalla

// `visorApi`: { paginas(), paginaActual(), irAPagina(n), marcadas() }
export function crearMiniaturas(visorApi) {
  const lista = document.getElementById('lista-miniaturas');
  let construidas = false;
  let observador = null;
  const pendientes = []; // miniaturas visibles que falta dibujar, en orden
  let dibujando = false;

  // Arma los botones (sin dibujar). Se hace recién la primera vez que se abre el panel.
  function construir() {
    if (construidas || visorApi.paginas().length === 0) return;
    construidas = true;
    observador = new IntersectionObserver(alVerse, { root: lista, rootMargin: '200px 0px' });
    for (const info of visorApi.paginas()) {
      const numero = Number(info.wrapper.dataset.numeroPagina);
      const boton = document.createElement('button');
      boton.className = 'miniatura';
      boton.dataset.pagina = String(numero);
      boton.title = t('Ir a la página {0}', numero);
      boton.setAttribute('aria-label', t('Página {0}', numero));

      const hoja = document.createElement('span');
      hoja.className = 'hoja-miniatura';
      // Reservamos el lugar con la proporción de la página, antes de dibujarla.
      hoja.style.aspectRatio = `${info.anchoBase} / ${info.altoBase}`;
      const numeroVisible = document.createElement('span');
      numeroVisible.className = 'numero-miniatura';
      numeroVisible.textContent = String(numero);
      boton.append(hoja, numeroVisible);
      boton.addEventListener('click', () => visorApi.irAPagina(numero));

      const item = document.createElement('li');
      item.append(boton);
      lista.append(item);
      observador.observe(boton);
    }
    actualizar();
  }

  function alVerse(entradas) {
    for (const entrada of entradas) {
      if (!entrada.isIntersecting || entrada.target.dataset.dibujada) continue;
      entrada.target.dataset.dibujada = 'pendiente';
      pendientes.push(entrada.target);
    }
    dibujarSiguiente();
  }

  async function dibujarSiguiente() {
    if (dibujando || pendientes.length === 0) return;
    dibujando = true;
    const boton = pendientes.shift();
    try {
      const info = visorApi.paginas()[Number(boton.dataset.pagina) - 1];
      const escala = (ANCHO_MINIATURA * (window.devicePixelRatio || 1)) / info.anchoBase;
      const viewport = info.pagina.getViewport({ scale: escala });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await info.pagina.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      boton.querySelector('.hoja-miniatura').append(canvas);
      boton.dataset.dibujada = 'si';
    } catch (error) {
      console.warn('No se pudo dibujar la miniatura', error);
    } finally {
      dibujando = false;
      dibujarSiguiente();
    }
  }

  // Marca la página actual y las marcadas, y deja la actual a la vista en el panel.
  function actualizar() {
    if (!construidas) return;
    const actual = visorApi.paginaActual();
    const marcadas = visorApi.marcadas();
    for (const boton of lista.querySelectorAll('.miniatura')) {
      const numero = Number(boton.dataset.pagina);
      const esActual = numero === actual;
      boton.classList.toggle('actual', esActual);
      boton.classList.toggle('marcada', marcadas.includes(numero));
      if (esActual) boton.setAttribute('aria-current', 'page');
      else boton.removeAttribute('aria-current');
    }
    if (lista.offsetParent) {
      const botonActual = lista.querySelector('.miniatura.actual');
      if (botonActual) botonActual.scrollIntoView({ block: 'nearest' });
    }
  }

  return { construir, actualizar };
}
