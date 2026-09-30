// Páginas marcadas (como un señalador) y progreso de lectura: hasta qué página se
// llegó. Los dos se guardan en .practicos.json; la lista de la barra lateral
// muestra el progreso de cada PDF.
import { t } from './idioma.js';

const DEMORA_PROGRESO_MS = 1500;

const esCampoEditable = (elemento) =>
  elemento instanceof HTMLElement && (elemento.matches('input, textarea, select') || elemento.isContentEditable);

// `visorApi`: { paginas(), paginaActual(), irAPagina(n), historial, enviar(mensaje),
// alCambiar() (se llama cada vez que cambia qué páginas están marcadas) }
export function crearMarcadores(visorApi) {
  const boton = document.getElementById('boton-marcador');
  const lista = document.getElementById('lista-marcadores');
  const ayuda = document.getElementById('ayuda-marcadores');

  let marcadores = []; // números de página, ordenados
  let habilitado = false; // false si no se pudieron leer los datos del documento
  let progreso = null; // { paginaMaxima, totalPaginas }
  let temporizadorProgreso = null;

  function cargar(practico) {
    habilitado = Boolean(practico);
    marcadores = practico && Array.isArray(practico.marcadores) ? [...practico.marcadores] : [];
    progreso = practico && practico.progreso ? { ...practico.progreso } : null;
    mostrar();
    // Si las páginas ya están, contamos la actual como leída.
    if (visorApi.paginas().length > 0) alCambiarPagina(visorApi.paginaActual());
  }

  const estaMarcada = (pagina) => marcadores.includes(pagina);

  // Pinta el señalador en las páginas, el botón de la barra y la lista del panel.
  function mostrar() {
    for (const info of visorApi.paginas()) {
      info.wrapper.classList.toggle('marcada', estaMarcada(Number(info.wrapper.dataset.numeroPagina)));
    }
    actualizarBoton();
    lista.replaceChildren();
    for (const pagina of marcadores) {
      const ir = document.createElement('button');
      ir.className = 'ancla';
      ir.title = t('Ir a la página {0}', pagina);
      const etiqueta = document.createElement('span');
      etiqueta.className = 'pagina-ancla';
      etiqueta.textContent = t('pág. {0}', pagina);
      const inicio = document.createElement('span');
      inicio.className = 'texto-ancla';
      inicio.textContent = comienzoDePagina(pagina);
      ir.append(etiqueta, inicio);
      ir.addEventListener('click', () => visorApi.irAPagina(pagina));

      const quitar = document.createElement('button');
      quitar.className = 'quitar-item';
      quitar.textContent = '×';
      quitar.title = t('Quitar el marcador (se puede deshacer con Ctrl+Z)');
      quitar.setAttribute('aria-label', t('Quitar el marcador de la página {0}', pagina));
      quitar.addEventListener('click', () => cambiarMarcador(pagina, false));

      const item = document.createElement('li');
      item.className = 'item-con-quitar';
      item.append(ir, quitar);
      lista.append(item);
    }
    ayuda.classList.toggle('oculto', marcadores.length > 0);
    visorApi.alCambiar();
  }

  // Las primeras palabras de la página, para reconocerla en la lista (si ya se leyó su texto).
  function comienzoDePagina(pagina) {
    const info = visorApi.paginas()[pagina - 1];
    const texto = info && info.texto ? info.texto.textoPlano.replace(/\s+/g, ' ').trim() : '';
    return texto.length > 60 ? `${texto.slice(0, 60)}…` : texto;
  }

  function actualizarBoton() {
    const marcada = estaMarcada(visorApi.paginaActual());
    boton.disabled = !habilitado || visorApi.paginas().length === 0;
    boton.classList.toggle('activo', marcada);
    boton.setAttribute('aria-pressed', String(marcada));
    boton.title = marcada
      ? t('Quitar el marcador de la página {0} (M)', visorApi.paginaActual())
      : t('Marcar la página {0} para volver después (M)', visorApi.paginaActual());
  }

  function cambiarMarcador(pagina, marcar, { registrar = true } = {}) {
    if (!habilitado || estaMarcada(pagina) === marcar) return;
    marcadores = marcar ? [...marcadores, pagina].sort((a, b) => a - b) : marcadores.filter((p) => p !== pagina);
    visorApi.enviar({ tipo: 'guardar-marcadores', marcadores });
    mostrar();
    if (registrar) {
      visorApi.historial.registrar({
        descripcion: marcar ? t('página {0} marcada', pagina) : t('marcador de la página {0} quitado', pagina),
        deshacer: () => cambiarMarcador(pagina, !marcar, { registrar: false }),
        rehacer: () => cambiarMarcador(pagina, marcar, { registrar: false })
      });
    }
  }

  const alternar = () => cambiarMarcador(visorApi.paginaActual(), !estaMarcada(visorApi.paginaActual()));

  // Progreso: la página más lejana a la que se llegó. Se guarda un rato después
  // del último cambio, para no escribir el archivo con cada página que pasa.
  function alCambiarPagina(numero) {
    actualizarBoton();
    const total = visorApi.paginas().length;
    if (!habilitado || total === 0) return;
    const anterior = progreso || { paginaMaxima: 0, totalPaginas: total };
    if (numero <= anterior.paginaMaxima && anterior.totalPaginas === total) return;
    progreso = { paginaMaxima: Math.min(Math.max(numero, anterior.paginaMaxima), total), totalPaginas: total };
    clearTimeout(temporizadorProgreso);
    temporizadorProgreso = setTimeout(() => visorApi.enviar({ tipo: 'guardar-progreso', progreso }), DEMORA_PROGRESO_MS);
  }

  boton.addEventListener('click', alternar);
  document.addEventListener('keydown', (evento) => {
    if (evento.key.toLowerCase() !== 'm' || evento.ctrlKey || evento.metaKey || evento.altKey) return;
    if (esCampoEditable(evento.target) || boton.disabled) return;
    evento.preventDefault();
    alternar();
  });

  return { cargar, mostrar, alCambiarPagina, marcadas: () => [...marcadores] };
}
