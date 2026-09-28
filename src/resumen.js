// Arma un resumen en Markdown con las notas y los resaltados de un práctico,
// ordenado por página, para repasar o compartir. No usa VS Code: recibe los
// datos (los de almacen.leerPractico) y devuelve el texto.

// Mismo formato de ancla que en media/viewer.js: "[pág. 3]" (con o sin tilde ni punto).
const PATRON_ANCLA = /\[p[áa]g\.?\s*(\d+)\]/i;
const NOMBRES_ESTADO = { pendiente: 'Pendiente', 'en-progreso': 'En progreso', hecho: 'Hecho' };

// El texto resaltado viene del PDF: escapamos lo que Markdown tomaría como formato.
// Las notas no se escapan: son de la persona y pueden tener Markdown a propósito.
function escaparMarkdown(texto) {
  return texto
    .replace(/[\\`*_[\]<>|~]/g, '\\$&')
    .replace(/^(\s*)([#+-])/, '$1\\$2') // título o lista con viñeta
    .replace(/^(\s*)(\d+)\./, '$1$2\\.'); // lista numerada
}

const unaLinea = (texto) => texto.replace(/\s+/g, ' ').trim();

function formatearFecha(iso) {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function armarResumen(nombrePdf, practico) {
  // Agrupamos todo por página: resaltados y notas ancladas.
  const porPagina = new Map();
  const deLaPagina = (pagina) => {
    if (!porPagina.has(pagina)) porPagina.set(pagina, { resaltados: [], notas: [] });
    return porPagina.get(pagina);
  };

  for (const resaltado of practico.resaltados || []) deLaPagina(resaltado.pagina).resaltados.push(resaltado);

  const notasGenerales = [];
  for (const linea of (practico.notas || '').split('\n')) {
    const ancla = linea.match(PATRON_ANCLA);
    const texto = unaLinea(linea.replace(PATRON_ANCLA, ' '));
    if (!texto) continue;
    if (ancla) deLaPagina(Number(ancla[1])).notas.push(texto);
    else notasGenerales.push(texto);
  }

  const lineas = [`# Resumen: ${escaparMarkdown(nombrePdf)}`, ''];
  lineas.push(`- **Estado:** ${NOMBRES_ESTADO[practico.estado] || NOMBRES_ESTADO.pendiente}`);
  const fecha = practico.actualizado && formatearFecha(practico.actualizado);
  if (fecha) lineas.push(`- **Última modificación:** ${fecha}`);
  lineas.push('');

  if (notasGenerales.length > 0) {
    lineas.push('## Notas generales', '', ...notasGenerales.map((n) => `- ${n}`), '');
  }

  for (const pagina of [...porPagina.keys()].sort((a, b) => a - b)) {
    const { resaltados, notas } = porPagina.get(pagina);
    lineas.push(`## Página ${pagina}`, '');
    for (const r of [...resaltados].sort((a, b) => a.inicio - b.inicio)) {
      lineas.push(`> ${escaparMarkdown(unaLinea(r.texto))} *(${r.color})*`, '');
    }
    if (notas.length > 0) lineas.push(...notas.map((n) => `- ${n}`), '');
  }

  if (notasGenerales.length === 0 && porPagina.size === 0) {
    lineas.push('*Todavía no hay notas ni resaltados.*', '');
  }
  return lineas.join('\n');
}

module.exports = { armarResumen };
