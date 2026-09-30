// Arma un resumen en Markdown con las notas y los resaltados de un práctico,
// ordenado por página, para repasar o compartir. No usa VS Code: recibe los
// datos (los de almacen.leerPractico) y devuelve el texto. `t` traduce los textos
// (ver src/idioma.js); si no se pasa, queda en español.

// Mismo formato de ancla que en media/viewer.js: "[pág. 3]" (con o sin tilde ni
// punto), o en inglés "[p. 3]" / "[page 3]".
const PATRON_ANCLA = /\[(?:p[áa]g|page|p)\.?\s*(\d+)\]/i;
const NOMBRES_ESTADO = { pendiente: 'Pendiente', 'en-progreso': 'En progreso', hecho: 'Hecho' };

const sinTraducir = (texto, ...valores) => texto.replace(/\{(\d+)\}/g, (_, i) => String(valores[Number(i)]));

// El texto resaltado viene del PDF: escapamos lo que Markdown tomaría como formato.
// Las notas no se escapan: son de la persona y pueden tener Markdown a propósito.
function escaparMarkdown(texto) {
  return texto
    .replace(/[\\`*_[\]<>|~]/g, '\\$&')
    .replace(/^(\s*)([#+-])/, '$1\\$2') // título o lista con viñeta
    .replace(/^(\s*)(\d+)\./, '$1$2\\.'); // lista numerada
}

const unaLinea = (texto) => texto.replace(/\s+/g, ' ').trim();

function formatearFecha(iso, t) {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  // La "traducción" de es-AR es el formato de fecha del otro idioma (en-US).
  return fecha.toLocaleDateString(t('es-AR'), { day: 'numeric', month: 'long', year: 'numeric' });
}

function armarResumen(nombrePdf, practico, t = sinTraducir) {
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

  const lineas = [t('# Resumen: {0}', escaparMarkdown(nombrePdf)), ''];
  lineas.push(t('- **Estado:** {0}', t(NOMBRES_ESTADO[practico.estado] || NOMBRES_ESTADO.pendiente)));
  const fecha = practico.actualizado && formatearFecha(practico.actualizado, t);
  if (fecha) lineas.push(t('- **Última modificación:** {0}', fecha));
  if (practico.marcadores && practico.marcadores.length > 0) {
    lineas.push(t('- **Páginas marcadas:** {0}', practico.marcadores.join(', ')));
  }
  lineas.push('');

  if (notasGenerales.length > 0) {
    lineas.push(t('## Notas generales'), '', ...notasGenerales.map((n) => `- ${n}`), '');
  }

  for (const pagina of [...porPagina.keys()].sort((a, b) => a - b)) {
    const { resaltados, notas } = porPagina.get(pagina);
    lineas.push(t('## Página {0}', pagina), '');
    for (const r of [...resaltados].sort((a, b) => a.inicio - b.inicio)) {
      lineas.push(`> ${escaparMarkdown(unaLinea(r.texto))} *(${t(r.color)})*`);
      // El comentario, como las notas, es de la persona: no se escapa.
      if (r.comentario && r.comentario.trim()) lineas.push('>', t('> **Comentario:** {0}', unaLinea(r.comentario)));
      lineas.push('');
    }
    if (notas.length > 0) lineas.push(...notas.map((n) => `- ${n}`), '');
  }

  if (notasGenerales.length === 0 && porPagina.size === 0) {
    lineas.push(t('*Todavía no hay notas ni resaltados.*'), '');
  }
  return lineas.join('\n');
}

module.exports = { armarResumen };
