// Genera "guia-de-lectura.pdf": un PDF de ejemplo con texto propio (título, secciones,
// una lista y un índice) para las capturas y el GIF de presentación. Sin dependencias.
// Uso desde la terminal: node test/demo/generar-demo-pdf.js <carpeta>
const fs = require('fs');
const path = require('path');

// Ancho aproximado de cada letra en Helvetica (milésimas de em).
const ANCHOS = {
  ' ': 278, '!': 278, ',': 278, '.': 278, ':': 278, ';': 278, i: 222, j: 222, l: 222, f: 278, t: 278, r: 333,
  I: 278, J: 500, s: 500, c: 500, k: 500, v: 500, x: 500, y: 500, z: 500, m: 833, w: 722, M: 833, W: 944,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, K: 667, L: 556, N: 722, O: 778, P: 667,
  Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, X: 667, Y: 667, Z: 611, '(': 333, ')': 333, '-': 333,
  '«': 556, '»': 556, '¿': 611, '?': 556
};
const anchoTexto = (texto, tamano, negrita = false) => {
  let total = 0;
  for (const letra of texto.normalize('NFD').replace(/\p{M}/gu, '')) total += ANCHOS[letra] || 556;
  return (total * tamano * (negrita ? 1.07 : 1)) / 1000;
};

function envolver(texto, tamano, anchoMaximo, negrita = false) {
  const lineas = [];
  let actual = '';
  for (const palabra of texto.split(' ')) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (actual && anchoTexto(prueba, tamano, negrita) > anchoMaximo) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = prueba;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

const TITULO = 'Leer con comodidad';
const SUBTITULO = 'Notas sobre color, espacio y sonido en la lectura digital';

const CONTENIDO = [
  { seccion: '1. Introducción' },
  {
    parrafo:
      'Leer en pantalla cansa más que leer en papel, y no todas las personas se cansan por las mismas razones. ' +
      'Algunas necesitan menos brillo, otras más espacio entre los renglones, y otras prefieren escuchar el texto ' +
      'mientras lo siguen con la vista. Este documento es un ejemplo para probar el visor: reúne algunas ideas ' +
      'simples para que leer sea más llevadero.'
  },
  { seccion: '2. Color y contraste' },
  {
    parrafo:
      'El blanco puro del papel digital puede resultar demasiado intenso, sobre todo en habitaciones oscuras. ' +
      'Un fondo crema, celeste o verde suave reduce el deslumbramiento sin quitar contraste al texto, porque las ' +
      'letras siguen siendo negras. Lo importante es poder elegir: lo que a una persona le resulta cómodo a otra ' +
      'puede molestarle.'
  },
  { seccion: '3. Espacio y guías' },
  {
    parrafo:
      'Perder el renglón es una de las dificultades más comunes al leer. Una guía que resalte solo la línea ' +
      'actual y oscurezca el resto ayuda a mantener la atención en un punto. También conviene avanzar de a un ' +
      'renglón con el teclado, sin necesidad de apuntar con el mouse.'
  },
  { seccion: '4. Escuchar el texto' },
  {
    parrafo:
      'La lectura en voz alta permite seguir el texto con el oído y con la vista al mismo tiempo. Si además se ' +
      'marca la palabra que se está leyendo, resulta más fácil no perderse. Sirve para repasar de camino a clase, ' +
      'para revisar la ortografía de un informe o simplemente para descansar los ojos.'
  },
  { seccion: '5. Subrayar lo importante' },
  {
    parrafo:
      'Subrayar es una forma de conversar con el texto. Usar distintos colores permite separar ideas: ' +
      'definiciones, ejemplos y dudas. Cuando cada color tiene además su propia forma (fondo, línea simple, ' +
      'doble línea o punteado), el código se entiende incluso sin distinguir los colores.'
  },
  { lista: ['Definiciones: lo que hay que recordar tal cual.', 'Ejemplos: casos concretos para entender.', 'Dudas: preguntas para consultar después.'] }
];

const MARGEN = 72;
const ANCHO_UTIL = 612 - 2 * MARGEN;
const escapar = (t) => t.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

// Reparte el contenido en páginas y devuelve, por página, sus instrucciones de dibujo,
// y en qué página y altura empieza cada sección (para el índice).
function maquetar() {
  const paginas = [[]];
  const secciones = [];
  let y = 700;
  const abajo = 90;
  const linea = (fuente, tamano, x, texto, gris) => {
    const color = gris === undefined ? '0.1 0.1 0.12 rg' : `${gris} ${gris} ${gris} rg`;
    paginas[paginas.length - 1].push(`${color} BT /${fuente} ${tamano} Tf ${x} ${y} Td (${escapar(texto)}) Tj ET`);
  };
  const nuevaPaginaSiHaceFalta = (alto) => {
    if (y - alto < abajo) {
      paginas.push([]);
      y = 700;
    }
  };

  y -= 0;
  linea('F2', 30, MARGEN, TITULO);
  y -= 26;
  linea('F1', 13, MARGEN, SUBTITULO, 0.4);
  y -= 34;

  for (const bloque of CONTENIDO) {
    if (bloque.seccion) {
      // El título y al menos 4 renglones de su párrafo tienen que entrar juntos.
      nuevaPaginaSiHaceFalta(26 + 4 * 18);
      secciones.push({ titulo: bloque.seccion, pagina: paginas.length, y: y + 20 });
      linea('F2', 17, MARGEN, bloque.seccion);
      y -= 26;
    } else if (bloque.parrafo) {
      const lineas = envolver(bloque.parrafo, 12, ANCHO_UTIL - 6);
      nuevaPaginaSiHaceFalta(lineas.length * 18);
      for (const texto of lineas) {
        linea('F1', 12, MARGEN, texto);
        y -= 18;
      }
      y -= 12;
    } else if (bloque.lista) {
      for (const item of bloque.lista) {
        nuevaPaginaSiHaceFalta(22);
        linea('F1', 12, MARGEN + 4, '-');
        linea('F1', 12, MARGEN + 18, item);
        y -= 20;
      }
    }
  }

  paginas.forEach((operaciones, i) => {
    operaciones.push(`0.55 0.55 0.55 rg BT /F1 9 Tf ${MARGEN} 48 Td (${escapar(TITULO)}) Tj ET`);
    operaciones.push(`0.55 0.55 0.55 rg BT /F1 9 Tf ${612 - MARGEN - 8} 48 Td (${i + 1}) Tj ET`);
  });
  return { paginas, secciones };
}

function generarDemoPdf(carpeta) {
  fs.mkdirSync(carpeta, { recursive: true });
  const { paginas, secciones } = maquetar();

  const objetos = [];
  const reservar = () => objetos.push(null);
  const definir = (id, contenido) => {
    objetos[id - 1] = contenido;
  };

  const idCatalogo = reservar();
  const idPaginas = reservar();
  const idFuente = reservar();
  const idFuenteNegrita = reservar();
  const idsPagina = paginas.map(reservar);
  const idsContenido = paginas.map(reservar);
  const idIndice = reservar();
  const idsSeccion = secciones.map(reservar);

  definir(idCatalogo, `<< /Type /Catalog /Pages ${idPaginas} 0 R /Outlines ${idIndice} 0 R >>`);
  definir(idFuente, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  definir(idFuenteNegrita, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  paginas.forEach((operaciones, i) => {
    const contenido = operaciones.join('\n');
    definir(idsContenido[i], `<< /Length ${Buffer.byteLength(contenido, 'latin1')} >>\nstream\n${contenido}\nendstream`);
    definir(
      idsPagina[i],
      `<< /Type /Page /Parent ${idPaginas} 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${idFuente} 0 R /F2 ${idFuenteNegrita} 0 R >> >> /Contents ${idsContenido[i]} 0 R >>`
    );
  });
  definir(idPaginas, `<< /Type /Pages /Kids [${idsPagina.map((id) => `${id} 0 R`).join(' ')}] /Count ${paginas.length} >>`);

  definir(idIndice, `<< /Type /Outlines /First ${idsSeccion[0]} 0 R /Last ${idsSeccion.at(-1)} 0 R /Count ${secciones.length} >>`);
  secciones.forEach((seccion, i) => {
    const anterior = i > 0 ? ` /Prev ${idsSeccion[i - 1]} 0 R` : '';
    const siguiente = i < secciones.length - 1 ? ` /Next ${idsSeccion[i + 1]} 0 R` : '';
    definir(
      idsSeccion[i],
      `<< /Title (${escapar(seccion.titulo)}) /Parent ${idIndice} 0 R${anterior}${siguiente} ` +
        `/Dest [${idsPagina[seccion.pagina - 1]} 0 R /XYZ 0 ${seccion.y} null] >>`
    );
  });

  let salida = '%PDF-1.4\n';
  const posiciones = [];
  objetos.forEach((contenido, indice) => {
    posiciones.push(Buffer.byteLength(salida, 'latin1'));
    salida += `${indice + 1} 0 obj\n${contenido}\nendobj\n`;
  });
  const inicioXref = Buffer.byteLength(salida, 'latin1');
  salida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  salida += posiciones.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('');
  salida += `trailer\n<< /Size ${objetos.length + 1} /Root ${idCatalogo} 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;

  const destino = path.join(carpeta, 'guia-de-lectura.pdf');
  fs.writeFileSync(destino, Buffer.from(salida, 'latin1'));
  return { destino, paginas: paginas.length };
}

module.exports = { generarDemoPdf };

if (require.main === module) {
  const carpeta = process.argv[2];
  if (!carpeta) {
    console.error('Uso: node test/demo/generar-demo-pdf.js <carpeta>');
    process.exit(1);
  }
  const { destino, paginas } = generarDemoPdf(carpeta);
  console.log(`${destino} (${paginas} páginas)`);
}
