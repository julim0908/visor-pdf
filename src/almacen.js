// Único lugar que sabe DÓNDE y CÓMO se guardan los datos de cada práctico.
// Hoy: un archivo .practicos.json en la misma carpeta que el PDF, con una entrada
// por nombre de archivo. Si mañana se guarda en otro lado (o se sincroniza con
// Moodle), solo cambia este módulo: el resto usa leerPractico/actualizarPractico.
const vscode = require('vscode');
const path = require('path');
const { t } = require('./idioma');

const NOMBRE_ARCHIVO = '.practicos.json';
const VERSION_FORMATO = 1;
const ESTADOS = ['pendiente', 'en-progreso', 'hecho'];
const COLORES_RESALTADO = ['amarillo', 'verde', 'rosa', 'celeste'];

// Función (y no un objeto fijo) para que cada práctico tenga su propia lista de resaltados.
const practicoPorDefecto = () => ({ estado: 'pendiente', notas: '', resaltados: [] });

// Un resaltado marca un tramo del texto de una página: [inicio, fin) son posiciones
// dentro de ese texto, y `texto` es lo marcado (sirve para volver a ubicarlo si
// cambia la forma en que se extrae el texto del PDF). `comentario` es opcional.
function resaltadosValidos(lista) {
  return (
    Array.isArray(lista) &&
    lista.every(
      (r) =>
        r &&
        typeof r.id === 'string' &&
        Number.isInteger(r.pagina) &&
        r.pagina >= 1 &&
        Number.isInteger(r.inicio) &&
        Number.isInteger(r.fin) &&
        r.inicio >= 0 &&
        r.fin > r.inicio &&
        COLORES_RESALTADO.includes(r.color) &&
        typeof r.texto === 'string' &&
        (r.comentario === undefined || typeof r.comentario === 'string')
    )
  );
}

const esPagina = (n) => Number.isInteger(n) && n >= 1;

// Páginas marcadas: números de página sin repetir.
const marcadoresValidos = (lista) =>
  Array.isArray(lista) && lista.every(esPagina) && new Set(lista).size === lista.length;

// Hasta qué página se llegó leyendo, de cuántas.
const progresoValido = (p) =>
  Boolean(p) && esPagina(p.paginaMaxima) && esPagina(p.totalPaginas) && p.paginaMaxima <= p.totalPaginas;

// Errores "esperables" (archivo corrupto, sin permisos, etc.) con un mensaje
// pensado para mostrarle al usuario tal cual.
class ErrorAlmacen extends Error {}

function carpetaDe(uriPdf) {
  return uriPdf.with({ path: path.posix.dirname(uriPdf.path) });
}

function uriDelJsonDeCarpeta(uriCarpeta) {
  return uriCarpeta.with({ path: path.posix.join(uriCarpeta.path, NOMBRE_ARCHIVO) });
}

function uriDelJson(uriPdf) {
  return uriDelJsonDeCarpeta(carpetaDe(uriPdf));
}

function claveDelPdf(uriPdf) {
  return path.posix.basename(uriPdf.path);
}

// Avisa cada vez que se guardan datos de un práctico (por ej. para refrescar la vista lateral).
const emisorCambios = new vscode.EventEmitter();

// Las operaciones sobre un mismo .practicos.json se hacen de a una, en orden.
// Si no, dos guardados seguidos (o dos PDFs de la misma carpeta abiertos) podrían
// leer el archivo al mismo tiempo y el segundo pisaría lo que escribió el primero.
const colas = new Map();

function enCola(clave, operacion) {
  const anterior = colas.get(clave) || Promise.resolve();
  const actual = anterior.catch(() => {}).then(operacion);
  colas.set(clave, actual);
  const limpiar = () => {
    if (colas.get(clave) === actual) colas.delete(clave);
  };
  actual.then(limpiar, limpiar);
  return actual;
}

async function leerJson(uriJson) {
  let bytes;
  try {
    bytes = await vscode.workspace.fs.readFile(uriJson);
  } catch (error) {
    // Que todavía no exista es normal: se crea al guardar el primer dato.
    if (error.code === 'FileNotFound') return { version: VERSION_FORMATO, practicos: {} };
    throw new ErrorAlmacen(t('No se pudo leer {0}: {1}', NOMBRE_ARCHIVO, error.message));
  }

  const texto = new TextDecoder().decode(bytes);
  if (texto.trim() === '') return { version: VERSION_FORMATO, practicos: {} };

  let datos;
  try {
    datos = JSON.parse(texto);
  } catch (error) {
    throw new ErrorAlmacen(
      t('{0} tiene un error de formato ({1}). No se va a modificar hasta que lo corrijas.', NOMBRE_ARCHIVO, error.message)
    );
  }

  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    throw new ErrorAlmacen(t('{0} no tiene el formato esperado.', NOMBRE_ARCHIVO));
  }
  if (datos.practicos === undefined) datos.practicos = {};
  if (!datos.practicos || typeof datos.practicos !== 'object' || Array.isArray(datos.practicos)) {
    throw new ErrorAlmacen(t('{0}: "practicos" no tiene el formato esperado.', NOMBRE_ARCHIVO));
  }
  return datos;
}

async function escribirJson(uriJson, datos) {
  // Indentado y con salto de línea final, para que los diffs de git sean legibles.
  const texto = `${JSON.stringify(datos, null, 2)}\n`;
  try {
    await vscode.workspace.fs.writeFile(uriJson, new TextEncoder().encode(texto));
  } catch (error) {
    throw new ErrorAlmacen(t('No se pudo guardar {0}: {1}', NOMBRE_ARCHIVO, error.message));
  }
}

// Devuelve los datos guardados de un práctico (o los valores por defecto si no hay nada).
function leerPractico(uriPdf) {
  const uriJson = uriDelJson(uriPdf);
  return enCola(uriJson.toString(), async () => {
    const datos = await leerJson(uriJson);
    return { ...practicoPorDefecto(), ...datos.practicos[claveDelPdf(uriPdf)] };
  });
}

// Mezcla `cambios` con lo que ya había guardado y lo escribe. Devuelve el resultado.
// `marcarActualizado: false` no toca la fecha de última modificación (para datos
// que cambian solo por leer, como el progreso).
function actualizarPractico(uriPdf, cambios, { marcarActualizado = true } = {}) {
  if (cambios.estado !== undefined && !ESTADOS.includes(cambios.estado)) {
    return Promise.reject(new ErrorAlmacen(t('Estado inválido: "{0}".', cambios.estado)));
  }
  if (cambios.notas !== undefined && typeof cambios.notas !== 'string') {
    return Promise.reject(new ErrorAlmacen(t('Las notas tienen que ser texto.')));
  }
  if (cambios.resaltados !== undefined && !resaltadosValidos(cambios.resaltados)) {
    return Promise.reject(new ErrorAlmacen(t('Los resaltados no tienen el formato esperado.')));
  }
  if (cambios.marcadores !== undefined && !marcadoresValidos(cambios.marcadores)) {
    return Promise.reject(new ErrorAlmacen(t('Los marcadores no tienen el formato esperado.')));
  }
  if (cambios.progreso !== undefined && !progresoValido(cambios.progreso)) {
    return Promise.reject(new ErrorAlmacen(t('El progreso no tiene el formato esperado.')));
  }

  const uriJson = uriDelJson(uriPdf);
  return enCola(uriJson.toString(), async () => {
    const datos = await leerJson(uriJson);
    const clave = claveDelPdf(uriPdf);
    const practico = { ...practicoPorDefecto(), ...datos.practicos[clave], ...cambios };
    if (marcarActualizado) practico.actualizado = new Date().toISOString();
    datos.practicos[clave] = practico;
    if (datos.version === undefined) datos.version = VERSION_FORMATO;
    await escribirJson(uriJson, datos);
    emisorCambios.fire({ uriPdf, practico });
    return practico;
  });
}

// Lee de una sola vez los datos de varios PDFs de una misma carpeta.
// Devuelve un Map nombreDeArchivo -> práctico (con valores por defecto si no hay datos).
function leerPracticosDeCarpeta(uriCarpeta, nombresPdf) {
  const uriJson = uriDelJsonDeCarpeta(uriCarpeta);
  return enCola(uriJson.toString(), async () => {
    const datos = await leerJson(uriJson);
    return new Map(nombresPdf.map((nombre) => [nombre, { ...practicoPorDefecto(), ...datos.practicos[nombre] }]));
  });
}

module.exports = {
  ESTADOS,
  COLORES_RESALTADO,
  NOMBRE_ARCHIVO,
  ErrorAlmacen,
  alCambiar: emisorCambios.event,
  leerPractico,
  leerPracticosDeCarpeta,
  actualizarPractico
};
