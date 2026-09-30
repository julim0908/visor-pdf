// Dónde está un tramo de texto dentro de la página, en coordenadas del PDF (las
// mismas que usa el archivo, con el origen abajo a la izquierda). Sirve para
// exportar los resaltados como anotaciones del PDF.
//
// Cada "cuadro" es [x1, y1, x2, y2, x3, y3, x4, y4]: arriba a la izquierda, arriba
// a la derecha, abajo a la izquierda y abajo a la derecha (el orden de los
// QuadPoints que usan Acrobat y pdf.js).

// Alto de las letras sobre la línea de base, como fracción del tamaño de letra,
// con la misma regla que la capa de texto de pdf.js.
function ascensoDe(estilo) {
  if (estilo && estilo.ascent) return estilo.ascent;
  if (estilo && estilo.descent) return 1 + estilo.descent;
  return 0.8;
}

// `items`, `inicios` y `estilos` salen de getTextContent (ver obtenerTextoPagina en
// viewer.js). `medir(texto, familia)` devuelve el ancho del texto con esa familia de
// letra (en cualquier unidad): sirve para saber dónde empieza cada letra dentro del item.
export function cuadrosDeTramo({ items, inicios, estilos }, inicio, fin, medir) {
  const cuadros = [];
  items.forEach((item, i) => {
    const desdeItem = inicios[i];
    const texto = item.str;
    let a = Math.max(inicio, desdeItem) - desdeItem;
    let b = Math.min(fin, desdeItem + texto.length) - desdeItem;
    // Sin los espacios de las puntas: un resaltado no empieza ni termina en blanco.
    while (a < b && /\s/.test(texto[a])) a++;
    while (b > a && /\s/.test(texto[b - 1])) b--;
    if (b <= a || !item.width) return;

    const [ta, tb, tc, td, te, tf] = item.transform;
    const largo = Math.hypot(ta, tb) || 1;
    const ux = ta / largo; // dirección del texto
    const uy = tb / largo;
    const tamano = Math.hypot(tc, td) || item.height || 1;
    const estilo = estilos[item.fontName];
    const arriba = ascensoDe(estilo) * tamano;
    const abajo = arriba - tamano;

    // Posición de las letras a y b a lo largo del item, según lo que miden.
    const familia = (estilo && estilo.fontFamily) || 'sans-serif';
    const total = medir(texto, familia);
    const proporcion = (k) => (total > 0 ? medir(texto.slice(0, k), familia) / total : k / texto.length);
    const x0 = item.width * proporcion(a);
    const x1 = item.width * proporcion(b);

    // Punto a `t` unidades por la línea de base y `s` hacia arriba de ella.
    const punto = (t, s) => [te + ux * t - uy * s, tf + uy * t + ux * s];
    cuadros.push([...punto(x0, arriba), ...punto(x1, arriba), ...punto(x0, abajo), ...punto(x1, abajo)]);
  });
  return cuadros;
}
