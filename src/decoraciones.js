// Marca del estado al lado de cada PDF en el explorador de VS Code y en su
// pestaña (como la "M" que pone git): ✓ verde si está hecho, ◐ amarilla si está
// en progreso. Los pendientes no llevan marca, para no llenar la lista de ruido.
const vscode = require('vscode');
const path = require('path');
const almacen = require('./almacen');
const { t } = require('./idioma');

const DECORACIONES = {
  hecho: { marca: '✓', color: 'charts.green', estado: 'Hecho' },
  'en-progreso': { marca: '◐', color: 'charts.yellow', estado: 'En progreso' }
};

class ProveedorDecoraciones {
  constructor() {
    this.emisorCambios = new vscode.EventEmitter();
    // VS Code escucha este evento para volver a pedir las marcas.
    this.onDidChangeFileDecorations = this.emisorCambios.event;
    // El explorador pide la marca de cada archivo varias veces: guardamos el
    // estado leído hasta que algo cambie.
    this.estados = new Map(); // uri del PDF -> Promise<estado | null>
  }

  provideFileDecoration(uri) {
    if (uri.scheme !== 'file' || !/\.pdf$/i.test(uri.path)) return undefined;
    const clave = uri.toString();
    if (!this.estados.has(clave)) this.estados.set(clave, this.leerEstado(uri));
    return this.estados.get(clave).then((estado) => {
      const decoracion = DECORACIONES[estado];
      if (!decoracion) return undefined;
      const detalle = `Visor PDF: ${t(decoracion.estado)}`;
      return new vscode.FileDecoration(decoracion.marca, detalle, new vscode.ThemeColor(decoracion.color));
    });
  }

  async leerEstado(uriPdf) {
    const nombre = path.posix.basename(uriPdf.path);
    const carpeta = uriPdf.with({ path: path.posix.dirname(uriPdf.path) });
    try {
      const practicos = await almacen.leerPracticosDeCarpeta(carpeta, [nombre]);
      return practicos.get(nombre).estado;
    } catch {
      // .practicos.json roto: sin marca. El aviso ya lo dan el visor y la vista lateral.
      return null;
    }
  }

  // Cambió el estado de un PDF desde el visor: actualizamos solo esa marca.
  refrescarPdf(uriPdf) {
    this.estados.delete(uriPdf.toString());
    this.emisorCambios.fire(uriPdf);
  }

  // Cambió un .practicos.json desde afuera (git pull, edición a mano): todas.
  refrescarTodas() {
    this.estados.clear();
    this.emisorCambios.fire(undefined);
  }
}

function registrarDecoraciones(contextoExtension) {
  const proveedor = new ProveedorDecoraciones();
  const vigilante = vscode.workspace.createFileSystemWatcher(`**/${almacen.NOMBRE_ARCHIVO}`);
  const refrescarTodas = () => proveedor.refrescarTodas();

  contextoExtension.subscriptions.push(
    vscode.window.registerFileDecorationProvider(proveedor),
    almacen.alCambiar(({ uriPdf }) => proveedor.refrescarPdf(uriPdf)),
    vigilante,
    vigilante.onDidCreate(refrescarTodas),
    vigilante.onDidChange(refrescarTodas),
    vigilante.onDidDelete(refrescarTodas)
  );
  return proveedor;
}

module.exports = { registrarDecoraciones };
