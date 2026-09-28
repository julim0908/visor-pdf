// Búsqueda de texto dentro del PDF: funciones puras (sin tocar el estado del visor),
// así se pueden probar solas. viewer.js se encarga de la barra y la navegación,
// y marcas.js de pintar las coincidencias.

// Arma el texto de una página a partir de los "items" que da pdf.js (getTextContent).
// Devuelve el texto y dónde empieza cada item dentro de él, para después poder
// ubicar una coincidencia en los <span> de la capa de texto (hay uno por item).
export function armarTextoPagina(items) {
  let texto = '';
  const inicios = [];
  for (const item of items) {
    inicios.push(texto.length);
    texto += item.str;
    if (item.hasEOL) texto += '\n';
  }
  return { texto, inicios };
}

// Pasa el texto a minúsculas, sin tildes y con los espacios colapsados, para que
// "pagina" encuentre "Página". `mapa[i]` dice de qué posición del texto original
// salió el carácter i del texto normalizado.
export function normalizarConMapa(texto) {
  let normal = '';
  const mapa = [];
  for (let i = 0; i < texto.length; i++) {
    const caracter = texto[i];
    if (/\s/.test(caracter)) {
      if (normal.endsWith(' ')) continue;
      normal += ' ';
      mapa.push(i);
      continue;
    }
    // NFKD separa letra y tilde, y también ligaduras como "ﬁ" -> "fi".
    const simple = caracter.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    for (const parte of simple) {
      normal += parte;
      mapa.push(i);
    }
  }
  return { normal, mapa };
}

export function normalizarConsulta(consulta) {
  return normalizarConMapa(consulta.trim()).normal;
}

// Devuelve las coincidencias como rangos [inicio, fin) sobre el texto ORIGINAL de la página.
export function buscarEnTexto(textoNormalizado, consultaNormalizada) {
  const rangos = [];
  if (!consultaNormalizada) return rangos;
  const { normal, mapa } = textoNormalizado;
  let desde = 0;
  for (;;) {
    const posicion = normal.indexOf(consultaNormalizada, desde);
    if (posicion === -1) break;
    const ultimo = posicion + consultaNormalizada.length - 1;
    rangos.push([mapa[posicion], mapa[ultimo] + 1]);
    desde = posicion + consultaNormalizada.length;
  }
  return rangos;
}
