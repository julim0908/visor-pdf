// Aviso de novedades: la primera vez que se usa la extensión después de una
// actualización, un cartel cuenta qué hay de nuevo (una sola vez por versión).
// La lista completa está en CHANGELOG.md, que también se ve en la tienda.
const vscode = require('vscode');
const { t } = require('./idioma');

const CLAVE_ULTIMA_VERSION = 'ultimaVersionVista';

// Resumen corto de cada versión para el cartel. Si una versión no está acá
// (por ejemplo, un arreglo chico), no se muestra nada.
const NOVEDADES = {
  '0.6.0':
    'ahora podés comentar tus resaltados (click en un resaltado → Comentar, o la tecla C). También hay papel oscuro, ' +
    'marcadores, miniaturas de las páginas y un PDF con tus resaltados para compartir.'
};

// Decide qué hacer al arrancar. `yaLaUsaba` distingue una actualización de una
// instalación nueva cuando todavía no hay versión guardada (las versiones
// anteriores a esta no la guardaban). Devuelve el texto del cartel o null.
function textoDelAviso({ ultimaVista, versionActual, yaLaUsaba, novedades = NOVEDADES }) {
  if (ultimaVista === versionActual) return null;
  if (!ultimaVista && !yaLaUsaba) return null; // instalación nueva: todo es nuevo
  return novedades[versionActual] || null;
}

function abrirNovedades(contextoExtension) {
  const uri = vscode.Uri.joinPath(contextoExtension.extensionUri, 'CHANGELOG.md');
  return vscode.commands.executeCommand('markdown.showPreview', uri);
}

async function avisarNovedades(contextoExtension, clavesDeUso) {
  const { globalState } = contextoExtension;
  const versionActual = contextoExtension.extension.packageJSON.version;
  const texto = textoDelAviso({
    ultimaVista: globalState.get(CLAVE_ULTIMA_VERSION),
    versionActual,
    yaLaUsaba: globalState.keys().some((clave) => clavesDeUso(clave))
  });
  await globalState.update(CLAVE_ULTIMA_VERSION, versionActual);
  if (!texto) return;

  const verNovedades = t('Ver novedades');
  const eleccion = await vscode.window.showInformationMessage(`Visor PDF ${versionActual}: ${t(texto)}`, verNovedades);
  if (eleccion === verNovedades) await abrirNovedades(contextoExtension);
}

// `clavesDeUso(clave)` dice si una clave del globalState muestra que la extensión
// ya se usó antes (por ejemplo, la vista guardada de algún PDF).
function registrarNovedades(contextoExtension, clavesDeUso) {
  contextoExtension.subscriptions.push(
    vscode.commands.registerCommand('visorPracticos.verNovedades', () => abrirNovedades(contextoExtension))
  );
  // Sin await: el cartel no tiene que demorar la apertura del PDF.
  avisarNovedades(contextoExtension, clavesDeUso).catch((error) =>
    console.error('No se pudo mostrar el aviso de novedades', error)
  );
}

module.exports = { registrarNovedades, textoDelAviso, NOVEDADES };
