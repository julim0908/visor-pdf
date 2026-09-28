// Índice (marcadores) del PDF y links clickeables dentro de las páginas.

// Un "destino" de PDF dice a qué página (y a veces a qué altura) apunta un
// marcador o un link. Puede venir con nombre ("anexo") o explícito:
// [referencia a la página, { name: 'XYZ' | 'Fit' | ... }, ...coordenadas].
// Devuelve { pagina, arriba } (arriba en coordenadas del PDF, o null) o null.
export async function resolverDestino(documentoPdf, destino) {
  let explicito = destino;
  if (typeof destino === 'string') explicito = await documentoPdf.getDestination(destino);
  if (!Array.isArray(explicito) || explicito.length < 2) return null;

  const [referencia, tipo, ...coordenadas] = explicito;
  let indicePagina;
  if (Number.isInteger(referencia)) {
    indicePagina = referencia; // algunos PDFs ponen directamente el número de página
  } else if (referencia && typeof referencia === 'object') {
    indicePagina = await documentoPdf.getPageIndex(referencia);
  } else {
    return null;
  }

  // Solo usamos la altura: alcanza para caer en el lugar correcto.
  const nombre = tipo && tipo.name;
  let arriba = null;
  if (nombre === 'XYZ') arriba = coordenadas[1];
  else if (nombre === 'FitH' || nombre === 'FitBH') arriba = coordenadas[0];
  else if (nombre === 'FitR') arriba = coordenadas[3];

  return { pagina: indicePagina + 1, arriba: typeof arriba === 'number' ? arriba : null };
}

// Arma el árbol del índice dentro de `lista` (un <ul>). `alElegir(entrada)` se
// llama al hacer click en una entrada (entrada es un item de getOutline()).
// Todo con textContent: los títulos vienen del PDF.
export function armarIndice(lista, entradas, alElegir) {
  lista.replaceChildren();
  for (const entrada of entradas) lista.append(armarEntrada(entrada, alElegir));
}

function armarEntrada(entrada, alElegir) {
  const item = document.createElement('li');
  const fila = document.createElement('div');
  fila.className = 'fila-indice';

  const hijos = entrada.items || [];
  const expandir = document.createElement('button');
  expandir.className = 'expandir-indice';
  if (hijos.length > 0) {
    // En el PDF, un "count" positivo indica que la sección empieza abierta.
    const abierta = entrada.count > 0;
    expandir.textContent = abierta ? '▾' : '▸';
    expandir.setAttribute('aria-expanded', String(abierta));
    expandir.setAttribute('aria-label', `${abierta ? 'Cerrar' : 'Abrir'} “${entrada.title}”`);
  } else {
    expandir.disabled = true;
    expandir.setAttribute('aria-hidden', 'true');
  }

  const boton = document.createElement('button');
  boton.className = 'entrada-indice';
  boton.textContent = entrada.title;
  boton.title = entrada.title;
  if (entrada.bold) boton.classList.add('negrita');
  if (entrada.italic) boton.classList.add('cursiva');
  boton.addEventListener('click', () => alElegir(entrada));

  fila.append(expandir, boton);
  item.append(fila);

  if (hijos.length > 0) {
    const sublista = document.createElement('ul');
    sublista.hidden = !(entrada.count > 0);
    for (const hijo of hijos) sublista.append(armarEntrada(hijo, alElegir));
    item.append(sublista);
    expandir.addEventListener('click', () => {
      sublista.hidden = !sublista.hidden;
      expandir.textContent = sublista.hidden ? '▸' : '▾';
      expandir.setAttribute('aria-expanded', String(!sublista.hidden));
      expandir.setAttribute('aria-label', `${sublista.hidden ? 'Abrir' : 'Cerrar'} “${entrada.title}”`);
    });
  }
  return item;
}

// Dibuja los links de una página como <a> transparentes encima del texto.
// Las posiciones van en porcentajes de la página, así acompañan el zoom.
// `callbacks`: { alLinkExterno(url), alLinkInterno(destino), alAccion(nombre) }.
export async function renderizarLinks(info, callbacks) {
  const anotaciones = await info.pagina.getAnnotations({ intent: 'display' });
  const links = anotaciones.filter((a) => a.subtype === 'Link' && (a.url || a.dest || a.action));
  if (links.length === 0) return;

  const capa = document.createElement('div');
  capa.className = 'capaLinks';
  const viewport = info.pagina.getViewport({ scale: 1 });

  for (const link of links) {
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(link.rect);
    const enlace = document.createElement('a');
    enlace.className = 'link-pdf';
    enlace.style.left = `${(100 * Math.min(x1, x2)) / viewport.width}%`;
    enlace.style.top = `${(100 * Math.min(y1, y2)) / viewport.height}%`;
    enlace.style.width = `${(100 * Math.abs(x2 - x1)) / viewport.width}%`;
    enlace.style.height = `${(100 * Math.abs(y2 - y1)) / viewport.height}%`;

    if (link.url) {
      // pdf.js solo completa `url` con direcciones seguras (http, https, mailto…).
      enlace.href = link.url;
      enlace.title = link.url;
      enlace.addEventListener('click', (evento) => {
        evento.preventDefault();
        callbacks.alLinkExterno(link.url);
      });
    } else {
      enlace.href = '#';
      enlace.title = 'Ir a otra parte del documento';
      enlace.addEventListener('click', (evento) => {
        evento.preventDefault();
        if (link.dest) callbacks.alLinkInterno(link.dest);
        else callbacks.alAccion(link.action);
      });
    }
    capa.append(enlace);
  }
  info.wrapper.append(capa);
}
