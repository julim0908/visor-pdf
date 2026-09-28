// Vista "Prácticos" de la barra lateral: lista los PDFs de la carpeta abierta,
// agrupados por carpeta, con el estado de cada uno.
const vscode = require('vscode');
const path = require('path');
const almacen = require('./almacen');

const ID_VISTA = 'visorPracticos.lista';
const ID_EDITOR = 'visorPracticos.pdfViewer';

// Los íconos son PNG de media/iconos/: "<estado>.png" para temas oscuros y
// "<estado>-claro.png" (más oscuro, para que contraste) para temas claros.
const PRESENTACION_ESTADO = {
  pendiente: { etiqueta: 'Pendiente', icono: 'pendiente' },
  'en-progreso': { etiqueta: 'En progreso', icono: 'en-progreso' },
  hecho: { etiqueta: 'Hecho', icono: 'hecho' }
};

const ordenarNombres = (a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });

// En Windows la misma ruta puede llegar como "/C:/..." o "/c:/...": unificamos la letra de unidad.
function normalizarUnidad(ruta) {
  return ruta.replace(/^\/([A-Za-z]):/, (_, letra) => `/${letra.toLowerCase()}:`);
}

// Nombre que se muestra para una carpeta: relativo a la carpeta abierta en VS Code.
function nombreDeCarpeta(uriCarpeta) {
  const carpetaWorkspace = vscode.workspace.getWorkspaceFolder(uriCarpeta);
  if (!carpetaWorkspace) return uriCarpeta.fsPath;
  const relativa = path.posix.relative(
    normalizarUnidad(carpetaWorkspace.uri.path),
    normalizarUnidad(uriCarpeta.path)
  );
  const variasCarpetas = (vscode.workspace.workspaceFolders || []).length > 1;
  if (!relativa) return carpetaWorkspace.name;
  return variasCarpetas ? `${carpetaWorkspace.name}/${relativa}` : relativa;
}

function crearItemPdf(uriPdf, practico, carpetaIconos) {
  const nombre = path.posix.basename(uriPdf.path);
  const item = new vscode.TreeItem(nombre, vscode.TreeItemCollapsibleState.None);
  item.id = uriPdf.toString();
  item.resourceUri = uriPdf;
  item.contextValue = 'pdf';
  item.command = {
    command: 'vscode.openWith',
    title: 'Abrir en el Visor de Prácticos',
    arguments: [uriPdf, ID_EDITOR]
  };

  if (!practico) {
    // No se pudo leer el .practicos.json de esa carpeta.
    item.iconPath = new vscode.ThemeIcon('question');
    item.tooltip = `${nombre}\nNo se pudieron leer los datos de este práctico.`;
    return item;
  }

  const presentacion = PRESENTACION_ESTADO[practico.estado] || PRESENTACION_ESTADO.pendiente;
  item.iconPath = {
    light: vscode.Uri.joinPath(carpetaIconos, `${presentacion.icono}-claro.png`),
    dark: vscode.Uri.joinPath(carpetaIconos, `${presentacion.icono}.png`)
  };

  const notas = (practico.notas || '').trim();
  item.description = notas ? `${presentacion.etiqueta} · con notas` : presentacion.etiqueta;
  // Tooltip como texto plano (no Markdown): las notas se muestran tal cual.
  const vistaPrevia = notas.length > 300 ? `${notas.slice(0, 300)}…` : notas;
  item.tooltip = `${nombre}\nEstado: ${presentacion.etiqueta}${vistaPrevia ? `\n\n${vistaPrevia}` : ''}`;
  return item;
}

class ProveedorArbolPracticos {
  constructor(carpetaIconos) {
    this.carpetaIconos = carpetaIconos;
    this.emisorCambios = new vscode.EventEmitter();
    // VS Code escucha este evento para saber cuándo volver a pedir los elementos.
    this.onDidChangeTreeData = this.emisorCambios.event;
    this.busquedaPdfs = null; // Promise<Uri[]> guardada, para no buscar en disco en cada refresco
    this.temporizador = null;
    this.erroresYaMostrados = new Set();
  }

  // Junta varios avisos seguidos (por ej. guardados de notas) en un solo refresco.
  // `buscarPdfs`: además de los estados, volver a buscar qué PDFs hay.
  refrescar({ buscarPdfs = false } = {}) {
    if (buscarPdfs) this.busquedaPdfs = null;
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.emisorCambios.fire(), 250);
  }

  getTreeItem(elemento) {
    return elemento;
  }

  async getChildren(elemento) {
    if (elemento) return elemento.hijos || [];
    if (!vscode.workspace.workspaceFolders) return [];

    try {
      return await this.construirGrupos();
    } catch (error) {
      this.busquedaPdfs = null;
      vscode.window.showErrorMessage(`No se pudo armar la lista de prácticos: ${error.message}`);
      return [];
    }
  }

  async construirGrupos() {
    // Sin exclude explícito, findFiles respeta la configuración "files.exclude" del usuario.
    if (!this.busquedaPdfs) this.busquedaPdfs = vscode.workspace.findFiles('**/*.{pdf,PDF}');
    const pdfs = await this.busquedaPdfs;

    const porCarpeta = new Map();
    for (const uriPdf of pdfs) {
      const uriCarpeta = uriPdf.with({ path: path.posix.dirname(uriPdf.path) });
      const clave = uriCarpeta.toString();
      if (!porCarpeta.has(clave)) porCarpeta.set(clave, { uriCarpeta, pdfs: [] });
      porCarpeta.get(clave).pdfs.push(uriPdf);
    }

    const grupos = await Promise.all(
      [...porCarpeta.values()].map(({ uriCarpeta, pdfs: pdfsDeCarpeta }) =>
        this.crearGrupo(uriCarpeta, pdfsDeCarpeta)
      )
    );
    return grupos.sort((a, b) => ordenarNombres(a.label, b.label));
  }

  async crearGrupo(uriCarpeta, pdfs) {
    pdfs.sort((a, b) => ordenarNombres(path.posix.basename(a.path), path.posix.basename(b.path)));
    const nombres = pdfs.map((uri) => path.posix.basename(uri.path));

    let practicos = null;
    let error = null;
    try {
      practicos = await almacen.leerPracticosDeCarpeta(uriCarpeta, nombres);
    } catch (e) {
      error = e;
      this.avisarErrorUnaVez(`${nombreDeCarpeta(uriCarpeta)}: ${e.message}`);
    }

    const grupo = new vscode.TreeItem(
      nombreDeCarpeta(uriCarpeta),
      vscode.TreeItemCollapsibleState.Expanded
    );
    grupo.id = uriCarpeta.toString();
    grupo.contextValue = 'carpeta';
    grupo.hijos = pdfs.map((uri, i) =>
      crearItemPdf(uri, practicos && practicos.get(nombres[i]), this.carpetaIconos)
    );

    if (error) {
      grupo.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
      grupo.description = `error en ${almacen.NOMBRE_ARCHIVO}`;
      grupo.tooltip = error.message;
    } else {
      const hechos = [...practicos.values()].filter((p) => p.estado === 'hecho').length;
      grupo.iconPath = vscode.ThemeIcon.Folder;
      grupo.description = `${hechos}/${pdfs.length} hechos`;
      grupo.tooltip = uriCarpeta.fsPath;
    }
    return grupo;
  }

  // La lista se refresca seguido: sin esto, un JSON roto mostraría el mismo aviso una y otra vez.
  avisarErrorUnaVez(mensaje) {
    if (this.erroresYaMostrados.has(mensaje)) return;
    this.erroresYaMostrados.add(mensaje);
    vscode.window.showErrorMessage(mensaje);
  }
}

// Registra la vista, el comando de actualizar y todo lo que la mantiene al día.
function registrarArbolPracticos(contextoExtension) {
  const proveedor = new ProveedorArbolPracticos(
    vscode.Uri.joinPath(contextoExtension.extensionUri, 'media', 'iconos')
  );

  const vigilantePdfs = vscode.workspace.createFileSystemWatcher('**/*.{pdf,PDF}');
  const vigilanteDatos = vscode.workspace.createFileSystemWatcher(`**/${almacen.NOMBRE_ARCHIVO}`);
  const cambioEnPdfs = () => proveedor.refrescar({ buscarPdfs: true });
  const cambioEnDatos = () => proveedor.refrescar();

  contextoExtension.subscriptions.push(
    vscode.window.createTreeView(ID_VISTA, { treeDataProvider: proveedor, showCollapseAll: true }),
    vscode.commands.registerCommand('visorPracticos.refrescar', cambioEnPdfs),
    vigilantePdfs,
    vigilantePdfs.onDidCreate(cambioEnPdfs),
    vigilantePdfs.onDidDelete(cambioEnPdfs),
    vigilanteDatos,
    // El vigilante detecta también cambios hechos fuera de la extensión (git pull, edición a mano).
    vigilanteDatos.onDidCreate(cambioEnDatos),
    vigilanteDatos.onDidChange(cambioEnDatos),
    vigilanteDatos.onDidDelete(cambioEnDatos),
    // Los cambios hechos desde el visor llegan por acá al instante.
    almacen.alCambiar(cambioEnDatos),
    vscode.workspace.onDidChangeWorkspaceFolders(cambioEnPdfs)
  );
}

module.exports = { registrarArbolPracticos };
