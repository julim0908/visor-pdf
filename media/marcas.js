// Marcas sobre la capa de texto de una página (coincidencias de búsqueda y
// resaltados), y traducción de una selección del mouse a posiciones en el texto.
//
// "Posición" siempre es un índice dentro del texto de la página que arma
// armarTextoPagina (busqueda.js): los items de pdf.js uno tras otro.

// Pinta las marcas en los <span> de la capa de texto (hay uno por item de texto).
// Cada marca es { inicio, fin, clases: [...], id?, titulo? }. Si dos marcas se
// superponen, ese tramo lleva las clases de ambas. El `titulo` se ve al pasar el
// mouse, y el último tramo de una marca con título lleva además la clase
// "fin-de-marca" (para dibujarle un indicador). Devuelve el primer elemento con la
// clase "actual" (la coincidencia de búsqueda seleccionada), o null.
export function marcarEnCapa(divsTexto, textosItems, inicios, marcas) {
  let elementoActual = null;

  divsTexto.forEach((div, i) => {
    const textoItem = textosItems[i];
    const inicioItem = inicios[i];
    const finItem = inicioItem + textoItem.length;
    const tocan = marcas.filter((m) => m.fin > inicioItem && m.inicio < finItem);

    // Sin marcas: texto plano (así se borran las marcas anteriores).
    if (tocan.length === 0) {
      if (div.childElementCount > 0) div.textContent = textoItem;
      return;
    }

    // Cortamos el texto del item en cada borde de marca y armamos un tramo por pedazo.
    const cortes = new Set([0, textoItem.length]);
    for (const m of tocan) {
      cortes.add(Math.max(m.inicio, inicioItem) - inicioItem);
      cortes.add(Math.min(m.fin, finItem) - inicioItem);
    }
    const puntos = [...cortes].sort((a, b) => a - b);

    const partes = [];
    for (let k = 0; k < puntos.length - 1; k++) {
      const desde = puntos[k];
      const hasta = puntos[k + 1];
      const pedazo = textoItem.slice(desde, hasta);
      const activas = tocan.filter((m) => m.inicio - inicioItem <= desde && m.fin - inicioItem >= hasta);
      if (activas.length === 0) {
        partes.push(document.createTextNode(pedazo));
        continue;
      }
      const tramo = document.createElement('span');
      tramo.className = [...new Set(activas.flatMap((m) => m.clases))].join(' ');
      const conId = activas.find((m) => m.id);
      if (conId) tramo.dataset.resaltado = conId.id;
      const conTitulo = activas.find((m) => m.titulo);
      if (conTitulo) {
        tramo.title = conTitulo.titulo;
        if (conTitulo.fin - inicioItem === hasta) tramo.classList.add('fin-de-marca');
      }
      tramo.textContent = pedazo;
      partes.push(tramo);
      if (!elementoActual && tramo.classList.contains('actual')) elementoActual = tramo;
    }
    div.replaceChildren(...partes);
  });

  return elementoActual;
}

// Traduce un extremo de la selección (nodo + offset del DOM) a una posición en el
// texto de la página. `capa` es { contenedor, divs } y `texto` el de obtenerTextoPagina.
// `esInicio` decide hacia dónde redondear si el punto cae entre dos <span>.
export function posicionEnTexto(capa, texto, nodo, offset, esInicio) {
  const { divs } = capa;
  const { inicios, textosItems } = texto;

  // ¿El punto está dentro de uno de los <span> de texto (o de una marca adentro de él)?
  let elemento = nodo.nodeType === Node.TEXT_NODE ? nodo.parentElement : nodo;
  while (elemento && elemento !== capa.contenedor) {
    const indice = divs.indexOf(elemento);
    if (indice !== -1) {
      const rango = document.createRange();
      rango.setStart(elemento, 0);
      rango.setEnd(nodo, offset);
      return inicios[indice] + Math.min(rango.toString().length, textosItems[indice].length);
    }
    elemento = elemento.parentElement;
  }

  // El punto cae entre elementos (en el contenedor o en .endOfContent):
  // usamos el <span> más cercano en el orden del documento.
  const rangoDiv = document.createRange();
  if (esInicio) {
    for (let i = 0; i < divs.length; i++) {
      if (!divs[i].isConnected) continue;
      rangoDiv.selectNodeContents(divs[i]);
      if (rangoDiv.comparePoint(nodo, offset) <= 0) return inicios[i];
    }
    return texto.textoPlano.length;
  }
  for (let i = divs.length - 1; i >= 0; i--) {
    if (!divs[i].isConnected) continue;
    rangoDiv.selectNodeContents(divs[i]);
    if (rangoDiv.comparePoint(nodo, offset) >= 0) return inicios[i] + textosItems[i].length;
  }
  return 0;
}
