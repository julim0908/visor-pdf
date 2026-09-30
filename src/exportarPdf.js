// Arma una copia del PDF con los resaltados como anotaciones de verdad (las que
// entiende cualquier lector: Acrobat, Edge, Chrome, Firefox). Así se pueden ver,
// mover o borrar en otro programa, y los comentarios aparecen como notas.
// No usa VS Code: recibe los bytes del PDF y los resaltados, y devuelve bytes.
//
// Se usa el archivo único de pdf-lib (trae todo adentro), para que el paquete de
// la extensión no tenga que llevar sus dependencias por separado.
const { PDFDocument, PDFHexString } = require('pdf-lib/dist/pdf-lib.min.js');

// Cada color con su forma, como en el visor: amarillo es fondo, verde y rosa
// subrayado y celeste un subrayado ondulado (el más parecido al punteado).
const ESTILOS = {
  amarillo: { subtipo: 'Highlight', color: [1, 0.87, 0] },
  verde: { subtipo: 'Underline', color: [0, 0.63, 0.25] },
  rosa: { subtipo: 'Underline', color: [0.84, 0, 0.45] },
  celeste: { subtipo: 'Squiggly', color: [0, 0.43, 0.86] }
};

// `codigo` ('protegido' o 'ilegible') le permite a la extensión explicarlo en el idioma de VS Code.
class ErrorExportar extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

// Fecha en el formato de los PDF: D:AAAAMMDDHHmmSSZ
function fechaPdf(fecha = new Date()) {
  const dosCifras = (n) => String(n).padStart(2, '0');
  return (
    `D:${fecha.getUTCFullYear()}${dosCifras(fecha.getUTCMonth() + 1)}${dosCifras(fecha.getUTCDate())}` +
    `${dosCifras(fecha.getUTCHours())}${dosCifras(fecha.getUTCMinutes())}${dosCifras(fecha.getUTCSeconds())}Z`
  );
}

// `resaltados`: [{ pagina, color, texto, comentario?, cuadros: [[8 números], ...] }]
// (los cuadros los calcula el visor con media/geometria.js).
async function agregarResaltadosAlPdf(bytesPdf, resaltados) {
  let documento;
  try {
    documento = await PDFDocument.load(bytesPdf, { updateMetadata: false });
  } catch (error) {
    if (/encrypted/i.test(error.message)) throw new ErrorExportar('protegido', error.message);
    throw new ErrorExportar('ilegible', error.message);
  }

  const paginas = documento.getPages();
  let agregados = 0;
  for (const r of resaltados) {
    const pagina = paginas[r.pagina - 1];
    const estilo = ESTILOS[r.color];
    const cuadros = (r.cuadros || []).filter((c) => Array.isArray(c) && c.length === 8 && c.every(Number.isFinite));
    if (!pagina || !estilo || cuadros.length === 0) continue;

    const xs = cuadros.flatMap((c) => [c[0], c[2], c[4], c[6]]);
    const ys = cuadros.flatMap((c) => [c[1], c[3], c[5], c[7]]);
    const datos = {
      Type: 'Annot',
      Subtype: estilo.subtipo,
      Rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      QuadPoints: cuadros.flat(),
      C: estilo.color,
      CA: estilo.subtipo === 'Highlight' ? 0.45 : 1,
      F: 4, // se imprime
      M: PDFHexString.fromText(fechaPdf()),
      T: PDFHexString.fromText('Visor PDF')
    };
    if (r.comentario) datos.Contents = PDFHexString.fromText(r.comentario);
    const anotacion = documento.context.register(documento.context.obj(datos));
    pagina.node.addAnnot(anotacion);
    agregados++;
  }
  // Sin "apariencia" (/AP): los lectores dibujan este tipo de anotación por su cuenta.
  return { bytes: await documento.save(), agregados };
}

module.exports = { agregarResaltadosAlPdf, ErrorExportar, ESTILOS };
