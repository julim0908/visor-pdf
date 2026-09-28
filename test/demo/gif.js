// Codificador de GIF animado sin dependencias: lee capturas PNG, reduce todos los
// cuadros a una sola paleta de 256 colores y guarda solo la parte de la imagen que
// cambia entre un cuadro y el siguiente (por eso el archivo pesa poco).
const zlib = require('zlib');

// ---------- Leer un PNG (RGB o RGBA de 8 bits, sin entrelazado: lo que da Chrome) ----------

function decodificarPng(buffer) {
  const ancho = buffer.readUInt32BE(16);
  const alto = buffer.readUInt32BE(20);
  const profundidad = buffer[24];
  const tipoColor = buffer[25];
  if (profundidad !== 8 || ![2, 6].includes(tipoColor) || buffer[28] !== 0) {
    throw new Error('Solo PNG RGB/RGBA de 8 bits sin entrelazado');
  }
  const canales = tipoColor === 6 ? 4 : 3;
  const partes = [];
  for (let i = 8; i < buffer.length; ) {
    const largo = buffer.readUInt32BE(i);
    if (buffer.toString('latin1', i + 4, i + 8) === 'IDAT') partes.push(buffer.subarray(i + 8, i + 8 + largo));
    i += 12 + largo;
  }
  const crudo = zlib.inflateSync(Buffer.concat(partes));
  const fila = ancho * canales;
  const pixeles = Buffer.alloc(alto * fila);
  for (let y = 0; y < alto; y++) {
    const filtro = crudo[y * (fila + 1)];
    for (let x = 0; x < fila; x++) {
      const valor = crudo[y * (fila + 1) + 1 + x];
      const a = x >= canales ? pixeles[y * fila + x - canales] : 0;
      const b = y > 0 ? pixeles[(y - 1) * fila + x] : 0;
      const c = x >= canales && y > 0 ? pixeles[(y - 1) * fila + x - canales] : 0;
      let prediccion = 0;
      if (filtro === 1) prediccion = a;
      else if (filtro === 2) prediccion = b;
      else if (filtro === 3) prediccion = (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        prediccion = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixeles[y * fila + x] = (valor + prediccion) & 0xff;
    }
  }
  return { ancho, alto, canales, pixeles };
}

// ---------- Paleta común para todos los cuadros (corte por la mediana) ----------

const binDe = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

function crearPaleta(imagenes, cantidad = 256) {
  const total = new Float64Array(32768);
  const suma = [new Float64Array(32768), new Float64Array(32768), new Float64Array(32768)];
  for (const { pixeles, canales } of imagenes) {
    for (let i = 0; i < pixeles.length; i += canales) {
      const bin = binDe(pixeles[i], pixeles[i + 1], pixeles[i + 2]);
      total[bin]++;
      suma[0][bin] += pixeles[i];
      suma[1][bin] += pixeles[i + 1];
      suma[2][bin] += pixeles[i + 2];
    }
  }
  const colores = [];
  for (let bin = 0; bin < 32768; bin++) {
    if (total[bin] === 0) continue;
    colores.push({
      bin,
      cuenta: total[bin],
      canal: [suma[0][bin] / total[bin], suma[1][bin] / total[bin], suma[2][bin] / total[bin]]
    });
  }

  const cajas = [colores];
  while (cajas.length < cantidad) {
    // Partimos la caja con más píxeles que todavía se pueda partir.
    let elegida = -1;
    let mayor = 0;
    cajas.forEach((caja, i) => {
      if (caja.length < 2) return;
      const peso = caja.reduce((s, c) => s + c.cuenta, 0);
      if (peso > mayor) {
        mayor = peso;
        elegida = i;
      }
    });
    if (elegida === -1) break;
    const caja = cajas[elegida];
    const rangos = [0, 1, 2].map((k) => {
      const valores = caja.map((c) => c.canal[k]);
      return Math.max(...valores) - Math.min(...valores);
    });
    const eje = rangos.indexOf(Math.max(...rangos));
    caja.sort((a, b) => a.canal[eje] - b.canal[eje]);
    const mitad = caja.reduce((s, c) => s + c.cuenta, 0) / 2;
    let acumulado = 0;
    let corte = 1;
    for (let i = 0; i < caja.length - 1; i++) {
      acumulado += caja[i].cuenta;
      corte = i + 1;
      if (acumulado >= mitad) break;
    }
    cajas.splice(elegida, 1, caja.slice(0, corte), caja.slice(corte));
  }

  const paleta = cajas.map((caja) => {
    const peso = caja.reduce((s, c) => s + c.cuenta, 0);
    return [0, 1, 2].map((k) => Math.round(caja.reduce((s, c) => s + c.canal[k] * c.cuenta, 0) / peso));
  });
  while (paleta.length < 256) paleta.push([0, 0, 0]);

  // Para cada color posible (15 bits), el número del color más parecido de la paleta.
  const tabla = new Uint8Array(32768);
  for (const { bin, canal } of colores) {
    let mejor = 0;
    let menor = Infinity;
    for (let i = 0; i < cajas.length; i++) {
      const [r, g, b] = paleta[i];
      const d = (r - canal[0]) ** 2 + (g - canal[1]) ** 2 + (b - canal[2]) ** 2;
      if (d < menor) {
        menor = d;
        mejor = i;
      }
    }
    tabla[bin] = mejor;
  }
  return { paleta, tabla };
}

function indexar({ pixeles, canales }, tabla) {
  const indices = new Uint8Array(pixeles.length / canales);
  for (let i = 0, j = 0; i < pixeles.length; i += canales, j++) {
    indices[j] = tabla[binDe(pixeles[i], pixeles[i + 1], pixeles[i + 2])];
  }
  return indices;
}

// ---------- Compresión LZW del GIF ----------

function comprimirLzw(indices, tamanoMinimo = 8) {
  const limpiar = 1 << tamanoMinimo;
  const fin = limpiar + 1;
  const bytes = [];
  let acumulado = 0;
  let bits = 0;
  let tamanoCodigo = tamanoMinimo + 1;
  let siguiente = fin + 1;
  let tabla = new Map();

  const emitir = (codigo) => {
    acumulado |= codigo << bits;
    bits += tamanoCodigo;
    while (bits >= 8) {
      bytes.push(acumulado & 0xff);
      acumulado >>>= 8;
      bits -= 8;
    }
  };

  emitir(limpiar);
  let prefijo = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const clave = (prefijo << 8) | k;
    const existente = tabla.get(clave);
    if (existente !== undefined) {
      prefijo = existente;
      continue;
    }
    emitir(prefijo);
    if (siguiente === 4096) {
      emitir(limpiar);
      tabla = new Map();
      siguiente = fin + 1;
      tamanoCodigo = tamanoMinimo + 1;
    } else {
      if (siguiente >= 1 << tamanoCodigo) tamanoCodigo++;
      tabla.set(clave, siguiente++);
    }
    prefijo = k;
  }
  emitir(prefijo);
  emitir(fin);
  if (bits > 0) bytes.push(acumulado & 0xff);
  return Buffer.from(bytes);
}

function enBloques(datos) {
  const partes = [];
  for (let i = 0; i < datos.length; i += 255) {
    const pedazo = datos.subarray(i, i + 255);
    partes.push(Buffer.from([pedazo.length]), pedazo);
  }
  partes.push(Buffer.from([0]));
  return Buffer.concat(partes);
}

// ---------- Armar el GIF ----------

// `cuadros`: [{ png: Buffer, demora: centésimas de segundo }]. Devuelve un Buffer.
function crearGif(cuadros) {
  const imagenes = cuadros.map((c) => decodificarPng(c.png));
  const { ancho, alto } = imagenes[0];
  if (imagenes.some((i) => i.ancho !== ancho || i.alto !== alto)) throw new Error('Los cuadros tienen distinto tamaño');
  const { paleta, tabla } = crearPaleta(imagenes);

  const dosBytes = (n) => Buffer.from([n & 0xff, (n >> 8) & 0xff]);
  const partes = [
    Buffer.from('GIF89a', 'latin1'),
    dosBytes(ancho),
    dosBytes(alto),
    Buffer.from([0xf7, 0, 0]), // paleta global de 256 colores
    Buffer.from(paleta.flat()),
    // Repetir para siempre
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from('NETSCAPE2.0', 'latin1'),
    Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00])
  ];

  let anterior = null;
  const cuadrosGif = []; // { x, y, ancho, alto, indices, demora }
  imagenes.forEach((imagen, n) => {
    const indices = indexar(imagen, tabla);
    let x0 = 0;
    let y0 = 0;
    let x1 = ancho - 1;
    let y1 = alto - 1;
    if (anterior) {
      x0 = ancho;
      y0 = alto;
      x1 = -1;
      y1 = -1;
      for (let y = 0; y < alto; y++) {
        for (let x = 0; x < ancho; x++) {
          if (indices[y * ancho + x] !== anterior[y * ancho + x]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) {
        // Igual al cuadro anterior: se le suma la demora en vez de repetirlo.
        cuadrosGif.at(-1).demora += cuadros[n].demora;
        return;
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const recorte = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) recorte.set(indices.subarray((y0 + y) * ancho + x0, (y0 + y) * ancho + x0 + w), y * w);
    cuadrosGif.push({ x: x0, y: y0, ancho: w, alto: h, indices: recorte, demora: cuadros[n].demora });
    anterior = indices;
  });

  for (const cuadro of cuadrosGif) {
    partes.push(
      Buffer.from([0x21, 0xf9, 0x04, 0x04]), // el cuadro anterior queda debajo
      dosBytes(cuadro.demora),
      Buffer.from([0x00, 0x00]),
      Buffer.from([0x2c]),
      dosBytes(cuadro.x),
      dosBytes(cuadro.y),
      dosBytes(cuadro.ancho),
      dosBytes(cuadro.alto),
      Buffer.from([0x00]),
      Buffer.from([8]),
      enBloques(comprimirLzw(cuadro.indices))
    );
  }
  partes.push(Buffer.from([0x3b]));
  return Buffer.concat(partes);
}

module.exports = { crearGif, decodificarPng };
