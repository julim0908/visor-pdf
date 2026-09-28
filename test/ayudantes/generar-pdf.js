// Genera PDFs de prueba sin dependencias:
// - practico-largo.pdf: 30 páginas con texto, un índice (marcadores) y links.
// - practico-roto.pdf: un archivo que no es un PDF, para probar los errores.
// Uso desde la terminal: node test/ayudantes/generar-pdf.js <carpeta>
const fs = require('fs');
const path = require('path');

const CANTIDAD_PAGINAS = 30;

function generarPdfs(carpeta) {
  fs.mkdirSync(carpeta, { recursive: true });

  // Primero reservamos los números de objeto (para poder referirnos a objetos
  // que todavía no escribimos) y después definimos su contenido.
  const objetos = [];
  const reservar = () => objetos.push(null);
  const definir = (id, contenido) => {
    objetos[id - 1] = contenido;
  };

  const idCatalogo = reservar();
  const idPaginas = reservar();
  const idFuente = reservar();
  const idsPagina = Array.from({ length: CANTIDAD_PAGINAS }, reservar);
  const idsContenido = Array.from({ length: CANTIDAD_PAGINAS }, reservar);
  const [idIndice, idIntro, idEjercicios, idEj10, idEj20, idAnexo] = Array.from({ length: 6 }, reservar);
  const [idLinkInterno, idLinkExterno] = [reservar(), reservar()];

  const pagina = (numero) => `${idsPagina[numero - 1]} 0 R`;

  definir(
    idCatalogo,
    `<< /Type /Catalog /Pages ${idPaginas} 0 R /Outlines ${idIndice} 0 R /PageMode /UseOutlines ` +
      `/Dests << /anexo [${pagina(30)} /Fit] >> >>`
  );
  definir(idFuente, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  for (let i = 1; i <= CANTIDAD_PAGINAS; i++) {
    const renglones = [
      `BT /F1 36 Tf 72 720 Td (Pr\xe1ctico de prueba) Tj ET`,
      `BT /F1 24 Tf 72 670 Td (P\xe1gina ${i} de ${CANTIDAD_PAGINAS}) Tj ET`,
      `BT /F1 12 Tf 72 630 Td (Ejercicio ${i}: resolver la integral de x^${i} dx.) Tj ET`,
      `0.2 0.4 0.8 RG 4 w 72 100 468 ${40 + i * 15} re S`
    ];
    if (i === 1) {
      renglones.push(
        `0 0 0.8 rg BT /F1 14 Tf 72 565 Td (Ver el ejercicio 10) Tj ET`,
        `0 0 0.8 rg BT /F1 14 Tf 72 535 Td (Sitio de la c\xe1tedra) Tj ET`
      );
    }
    const contenido = renglones.join('\n');
    definir(idsContenido[i - 1], `<< /Length ${Buffer.byteLength(contenido, 'latin1')} >>\nstream\n${contenido}\nendstream`);
    const links = i === 1 ? ` /Annots [${idLinkInterno} 0 R ${idLinkExterno} 0 R]` : '';
    definir(
      idsPagina[i - 1],
      `<< /Type /Page /Parent ${idPaginas} 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${idFuente} 0 R >> >> /Contents ${idsContenido[i - 1]} 0 R${links} >>`
    );
  }
  definir(
    idPaginas,
    `<< /Type /Pages /Kids [${idsPagina.map((id) => `${id} 0 R`).join(' ')}] /Count ${CANTIDAD_PAGINAS} >>`
  );

  // Índice: 1. Introducción / 2. Ejercicios (cerrado, con dos hijos) / 3. Anexo (destino con nombre).
  definir(idIndice, `<< /Type /Outlines /First ${idIntro} 0 R /Last ${idAnexo} 0 R /Count 3 >>`);
  definir(
    idIntro,
    `<< /Title (1. Introducci\xf3n) /Parent ${idIndice} 0 R /Next ${idEjercicios} 0 R /Dest [${pagina(1)} /XYZ 0 792 null] >>`
  );
  definir(
    idEjercicios,
    `<< /Title (2. Ejercicios) /Parent ${idIndice} 0 R /Prev ${idIntro} 0 R /Next ${idAnexo} 0 R ` +
      `/First ${idEj10} 0 R /Last ${idEj20} 0 R /Count -2 /Dest [${pagina(3)} /XYZ 0 792 null] >>`
  );
  definir(
    idEj10,
    `<< /Title (Ejercicio 10) /Parent ${idEjercicios} 0 R /Next ${idEj20} 0 R /Dest [${pagina(10)} /XYZ 72 640 null] >>`
  );
  definir(idEj20, `<< /Title (Ejercicio 20) /Parent ${idEjercicios} 0 R /Prev ${idEj10} 0 R /Dest [${pagina(20)} /Fit] >>`);
  definir(idAnexo, `<< /Title (3. Anexo) /Parent ${idIndice} 0 R /Prev ${idEjercicios} 0 R /Dest /anexo >>`);

  // Links de la página 1: uno a la página 10 y otro a una web.
  definir(
    idLinkInterno,
    `<< /Type /Annot /Subtype /Link /Rect [70 560 220 580] /Border [0 0 0] /Dest [${pagina(10)} /XYZ 72 640 null] >>`
  );
  definir(
    idLinkExterno,
    `<< /Type /Annot /Subtype /Link /Rect [70 530 220 550] /Border [0 0 0] /A << /S /URI /URI (https://example.com/catedra) >> >>`
  );

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

  fs.writeFileSync(path.join(carpeta, 'practico-largo.pdf'), Buffer.from(salida, 'latin1'));
  fs.writeFileSync(path.join(carpeta, 'practico-roto.pdf'), 'esto no es un PDF');
}

module.exports = { generarPdfs };

if (require.main === module) {
  const carpeta = process.argv[2];
  if (!carpeta) {
    console.error('Uso: node test/ayudantes/generar-pdf.js <carpeta>');
    process.exit(1);
  }
  generarPdfs(carpeta);
  console.log(`PDFs de prueba generados en ${carpeta}`);
}
