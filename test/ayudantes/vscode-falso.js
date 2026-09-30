// Un módulo `vscode` simulado, para correr el código de la extensión con Node,
// sin abrir VS Code. Imita solo lo que usa la extensión, incluidos dos detalles
// que ya causaron errores: readFile devuelve un Buffer de Node, y un archivo que
// no existe da un error con code 'FileNotFound'.
const Module = require('module');
const fs = require('fs');
const path = require('path');

class UriFalsa {
  constructor(fsPath) {
    this.scheme = 'file';
    this.fsPath = fsPath;
    this.path = '/' + fsPath.replace(/\\/g, '/');
  }
  with({ path: nuevaRuta }) {
    return new UriFalsa(nuevaRuta.slice(1).replace(/\//g, path.sep));
  }
  toString() {
    return 'file://' + this.path;
  }
}

class EventEmitter {
  constructor() {
    this.oyentes = [];
    this.event = (oyente) => {
      this.oyentes.push(oyente);
      return { dispose: () => (this.oyentes = this.oyentes.filter((o) => o !== oyente)) };
    };
  }
  fire(valor) {
    for (const oyente of this.oyentes) oyente(valor);
  }
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  constructor(id, color) {
    this.id = id;
    this.color = color;
  }
}
ThemeIcon.Folder = new ThemeIcon('folder');

class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}

class FileDecoration {
  constructor(badge, tooltip, color) {
    this.badge = badge;
    this.tooltip = tooltip;
    this.color = color;
  }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function buscarPdfs(carpeta) {
  return fs.readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const completo = path.join(carpeta, entrada.name);
    if (entrada.isDirectory()) return buscarPdfs(completo);
    return /\.pdf$/i.test(entrada.name) ? [new UriFalsa(completo)] : [];
  });
}

// `demoraMaxima`: milisegundos al azar en cada lectura/escritura, para que
// operaciones simultáneas se crucen (y así probar que no se pisan).
function crearVscodeFalso({ demoraMaxima = 0 } = {}) {
  const registro = {
    errores: [], // mensajes de showErrorMessage
    avisos: [], // mensajes de showInformationMessage
    respuestaAviso: undefined, // el botón que se "toca" en esos avisos
    comandos: {},
    comandosEjecutados: [], // [id, ...argumentos] de executeCommand
    vigilantes: [], // FileSystemWatcher creados: { patron, crear, cambiar, borrar }
    proveedorArbol: null,
    proveedorEditor: null,
    proveedorDecoraciones: null,
    documentosAbiertos: [], // rutas abiertas con showTextDocument
    linksAbiertos: [], // direcciones abiertas con env.openExternal
    // Qué "elige" la persona en el diálogo de guardar: undefined = acepta la ruta
    // propuesta, null = cancela, o una UriFalsa.
    respuestaDialogoGuardar: undefined
  };
  const demora = () => (demoraMaxima ? esperar(Math.random() * demoraMaxima) : Promise.resolve());

  const vscode = {
    EventEmitter,
    TreeItem,
    ThemeIcon,
    ThemeColor,
    FileDecoration,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ViewColumn: { Beside: -2 },
    Uri: {
      file: (ruta) => new UriFalsa(ruta),
      joinPath: (base, ...partes) => new UriFalsa(path.join(base.fsPath, ...partes)),
      parse: (texto) => {
        const esquema = /^([a-z][a-z0-9+.-]*):/i.exec(texto);
        if (!esquema) throw new Error(`URI inválida: ${texto}`);
        return { scheme: esquema[1].toLowerCase(), toString: () => texto };
      }
    },
    env: {
      // Idioma de VS Code; el banco lo toma de la variable VISOR_IDIOMA (por ejemplo, "en").
      language: process.env.VISOR_IDIOMA || 'es',
      openExternal: async (uri) => {
        registro.linksAbiertos.push(uri.toString());
        return true;
      }
    },
    workspace: {
      workspaceFolders: undefined,
      getWorkspaceFolder(uri) {
        return (this.workspaceFolders || []).find((c) => uri.path.toLowerCase().startsWith(c.uri.path.toLowerCase()));
      },
      async findFiles() {
        return (this.workspaceFolders || []).flatMap((c) => buscarPdfs(c.uri.fsPath));
      },
      createFileSystemWatcher(patron) {
        const vigilante = { patron, crear: new EventEmitter(), cambiar: new EventEmitter(), borrar: new EventEmitter() };
        vigilante.onDidCreate = vigilante.crear.event;
        vigilante.onDidChange = vigilante.cambiar.event;
        vigilante.onDidDelete = vigilante.borrar.event;
        vigilante.dispose = () => {};
        registro.vigilantes.push(vigilante);
        return vigilante;
      },
      onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
      openTextDocument: async (uri) => ({ uri }),
      fs: {
        async readFile(uri) {
          await demora();
          try {
            return await fs.promises.readFile(uri.fsPath); // un Buffer, como en VS Code
          } catch (error) {
            if (error.code === 'ENOENT') throw Object.assign(new Error(`${uri} no existe`), { code: 'FileNotFound' });
            throw error;
          }
        },
        async writeFile(uri, bytes) {
          await demora();
          // Un archivo "<nombre>.bloquear" al lado simula que no hay permiso de escritura.
          if (fs.existsSync(`${uri.fsPath}.bloquear`)) throw new Error('EPERM: permiso denegado (simulado)');
          await fs.promises.writeFile(uri.fsPath, bytes);
        }
      }
    },
    window: {
      showErrorMessage: (mensaje) => registro.errores.push(mensaje),
      // Devuelve el botón que "eligió" la persona (registro.respuestaAviso).
      showInformationMessage: async (mensaje) => {
        registro.avisos.push(mensaje);
        return registro.respuestaAviso;
      },
      createTreeView: (_id, opciones) => {
        registro.proveedorArbol = opciones.treeDataProvider;
        return { dispose() {} };
      },
      registerCustomEditorProvider: (_tipo, proveedor) => {
        registro.proveedorEditor = proveedor;
        return { dispose() {} };
      },
      registerFileDecorationProvider: (proveedor) => {
        registro.proveedorDecoraciones = proveedor;
        return { dispose() {} };
      },
      showSaveDialog: async (opciones) =>
        registro.respuestaDialogoGuardar === undefined ? opciones.defaultUri : registro.respuestaDialogoGuardar,
      showTextDocument: async (documento) => {
        registro.documentosAbiertos.push(documento.uri.fsPath);
      }
    },
    commands: {
      registerCommand: (id, funcion) => {
        registro.comandos[id] = funcion;
        return { dispose() {} };
      },
      executeCommand: async (id, ...argumentos) => {
        registro.comandosEjecutados.push([id, ...argumentos]);
      }
    }
  };

  return { vscode, registro };
}

// El `context` que VS Code le pasa a activate(). `estadoGlobal` es un Map.
function crearContextoFalso(extensionUri, estadoGlobal = new Map()) {
  return {
    extensionUri,
    extension: { packageJSON: require('../../package.json') },
    subscriptions: [],
    globalState: {
      get: (clave) => estadoGlobal.get(clave),
      update: async (clave, valor) => estadoGlobal.set(clave, valor),
      keys: () => [...estadoGlobal.keys()]
    }
  };
}

// Hace que require('vscode') devuelva el simulado. Llamarlo antes de cargar
// cualquier módulo de la extensión.
function instalarVscodeFalso(vscode) {
  const resolverOriginal = Module._resolveFilename;
  Module._resolveFilename = function (pedido, ...resto) {
    return pedido === 'vscode' ? 'vscode' : resolverOriginal.call(this, pedido, ...resto);
  };
  require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscode };
}

module.exports = { UriFalsa, esperar, crearVscodeFalso, crearContextoFalso, instalarVscodeFalso };
