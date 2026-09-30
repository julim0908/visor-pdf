// Resaltador: marcar texto del PDF con colores, quitar resaltados, pasarlos a las
// notas y listarlos en el panel. Los resaltados se guardan en .practicos.json (lo
// hace la extensión: acá solo se le manda la lista completa cada vez que cambia).
// Cada cambio queda en el historial, así se puede deshacer con Ctrl+Z.
import { posicionEnTexto } from './marcas.js';
import { crearMenuDesplegable } from './menus.js';
import { t } from './idioma.js';

const NOMBRES_COLOR = { amarillo: t('Amarillo'), verde: t('Verde'), rosa: t('Rosa'), celeste: t('Celeste') };
const COLOR_POR_TECLA = { 1: 'amarillo', 2: 'verde', 3: 'rosa', 4: 'celeste' };
// "Color" especial del botón Resaltar: en vez de marcar, borra lo que se seleccione.
const BORRADOR = 'borrar';

const esCampoEditable = (elemento) =>
  elemento instanceof HTMLElement && (elemento.matches('input, textarea, select') || elemento.isContentEditable);

// Arma un texto traducido con elementos adentro: en "Modo {0}: …" el {0} es `elementos[0]`.
function llenarConElementos(contenedor, plantilla, elementos) {
  const partes = plantilla.split(/\{(\d+)\}/);
  contenedor.replaceChildren(...partes.map((parte, i) => (i % 2 === 1 ? elementos[Number(parte)] : parte)));
}

const nuevoId = () => `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const copiar = (lista) => lista.map((r) => ({ ...r }));

// `visorApi` es lo que el resaltador necesita del visor (ver viewer.js).
export function crearResaltador(visorApi) {
  const zona = document.getElementById('zona-visor');
  const visor = document.getElementById('visor');
  const menu = document.getElementById('menu-resaltar');
  const botonesColor = [...menu.querySelectorAll('.boton-color')];
  const botonANotas = document.getElementById('boton-a-notas');
  const botonQuitar = document.getElementById('boton-quitar-resaltado');
  const lista = document.getElementById('lista-resaltados');
  const ayuda = document.getElementById('ayuda-resaltados');
  const botonLeerSeleccion = document.getElementById('boton-leer-seleccion');
  // Botón "Resaltar" de la barra, su menú de colores y el aviso del modo resaltador.
  const botonResaltador = document.getElementById('boton-resaltador');
  const botonColorResaltador = document.getElementById('boton-color-resaltador');
  const menuColor = document.getElementById('menu-color-resaltador');
  const opcionesColor = [...menuColor.querySelectorAll('.opcion-color')];
  const muestraColorActual = document.getElementById('color-resaltador-actual');
  const avisoModo = document.getElementById('aviso-modo');
  const textoAvisoModo = document.getElementById('texto-aviso-modo');
  const botonSalirModo = document.getElementById('boton-salir-modo');
  crearMenuDesplegable(botonColorResaltador, menuColor);
  // Comentarios: el botón del menú flotante y el cuadro donde se escriben.
  const botonComentar = document.getElementById('boton-comentar');
  const textoBotonComentar = document.getElementById('texto-boton-comentar');
  const editor = document.getElementById('editor-comentario');
  const citaComentario = document.getElementById('cita-comentario');
  const campoComentario = document.getElementById('campo-comentario');
  const botonGuardarComentario = document.getElementById('boton-guardar-comentario');
  const botonCancelarComentario = document.getElementById('boton-cancelar-comentario');
  const botonBorrarComentario = document.getElementById('boton-borrar-comentario');
  let comentando = null; // id del resaltado cuyo comentario se está escribiendo

  let colorActual = 'amarillo';
  let ultimoColor = 'amarillo'; // el último color de verdad (no el borrador)
  // Con el modo resaltador activo, todo lo que se selecciona se resalta (o se borra,
  // con el borrador) directo, sin menú.
  let modoResaltador = false;

  // Como se guardan en .practicos.json; en memoria además llevan `perdido`
  // (true si su texto ya no aparece en la página).
  let resaltados = [];
  // La última lista "confirmada": es el punto al que vuelve Ctrl+Z.
  let confirmados = [];
  let habilitado = false; // false si no se pudieron leer los datos del documento
  // null, { tipo: 'crear', tramos } (hay texto seleccionado) o { tipo: 'editar', id }.
  let modo = null;
  let listaPendiente = false;

  function cargar(guardados, puedeGuardar) {
    resaltados = copiar(guardados || []);
    habilitado = puedeGuardar;
    botonResaltador.disabled = !puedeGuardar;
    botonColorResaltador.disabled = !puedeGuardar;
    if (!puedeGuardar) activarModoResaltador(false);
    ordenar();
    confirmados = copiar(resaltados);
    actualizarLista();
    visorApi.remarcarTodas();
  }

  // Marcas de una página, en el formato de marcarEnCapa. De paso verifica que cada
  // resaltado siga coincidiendo con el texto de la página.
  function marcasDePagina(pagina, texto) {
    const marcas = [];
    for (const r of resaltados) {
      if (r.pagina !== pagina) continue;
      const estabaPerdido = r.perdido;
      reubicar(r, texto.textoPlano);
      if (r.perdido !== estabaPerdido) programarLista();
      if (r.perdido) continue;
      const marca = { inicio: r.inicio, fin: r.fin, clases: ['marca', `marca-${r.color}`], id: r.id };
      if (r.comentario) {
        marca.clases.push('con-comentario');
        marca.titulo = t('Comentario: {0}', r.comentario);
      }
      marcas.push(marca);
    }
    return marcas;
  }

  // Si el texto guardado ya no está en esa posición (por ejemplo, porque otra
  // versión de pdf.js extrae el texto un poco distinto), lo buscamos en la página
  // y nos quedamos con la aparición más cercana a donde estaba.
  function reubicar(r, textoPlano) {
    if (textoPlano.slice(r.inicio, r.fin) === r.texto) {
      r.perdido = false;
      return;
    }
    let mejor = -1;
    for (let i = textoPlano.indexOf(r.texto); r.texto && i !== -1; i = textoPlano.indexOf(r.texto, i + 1)) {
      if (mejor === -1 || Math.abs(i - r.inicio) < Math.abs(mejor - r.inicio)) mejor = i;
    }
    if (mejor === -1) {
      r.perdido = true;
      return;
    }
    r.inicio = mejor;
    r.fin = mejor + r.texto.length;
    r.perdido = false;
  }

  const textoDePagina = (pagina) => {
    const info = visorApi.paginas()[pagina - 1];
    return info && info.texto ? info.texto.textoPlano : null;
  };

  // Convierte la selección actual en tramos { pagina, inicio, fin, texto }:
  // uno por página, porque una selección puede cruzar de una página a otra.
  function tramosDeSeleccion() {
    const seleccion = document.getSelection();
    if (!seleccion || seleccion.rangeCount === 0 || seleccion.isCollapsed) return [];
    const rango = seleccion.getRangeAt(0);
    const tramos = [];

    for (const info of visorApi.paginas()) {
      const capa = info.capaTexto;
      if (!capa || !capa.contenedor || !info.texto || !rango.intersectsNode(capa.contenedor)) continue;
      const textoPlano = info.texto.textoPlano;
      let inicio = capa.contenedor.contains(rango.startContainer)
        ? posicionEnTexto(capa, info.texto, rango.startContainer, rango.startOffset, true)
        : 0;
      let fin = capa.contenedor.contains(rango.endContainer)
        ? posicionEnTexto(capa, info.texto, rango.endContainer, rango.endOffset, false)
        : textoPlano.length;
      while (inicio < fin && /\s/.test(textoPlano[inicio])) inicio++;
      while (fin > inicio && /\s/.test(textoPlano[fin - 1])) fin--;
      if (fin > inicio) {
        tramos.push({
          pagina: Number(info.wrapper.dataset.numeroPagina),
          inicio,
          fin,
          texto: textoPlano.slice(inicio, fin)
        });
      }
    }
    return tramos;
  }

  const seTocan = (r, tramo) => r.pagina === tramo.pagina && r.inicio < tramo.fin && r.fin > tramo.inicio;
  const hayResaltadosEn = (tramos) => resaltados.some((r) => tramos.some((tramo) => seTocan(r, tramo)));

  // ---------- Menú flotante ----------

  function mostrarMenu(nuevoModo, rectReferencia) {
    modo = nuevoModo;
    const editando = modo.tipo === 'editar';
    const colorDelResaltado = editando ? (resaltados.find((r) => r.id === modo.id) || {}).color : null;
    for (const boton of botonesColor) {
      boton.setAttribute('aria-pressed', String(boton.dataset.color === colorDelResaltado));
    }
    // "Quitar resaltado" aparece al tocar un resaltado o al seleccionar texto que ya lo tiene.
    botonQuitar.classList.toggle('oculto', !editando && !hayResaltadosEn(modo.tramos));
    const conComentario = editando && resaltados.some((r) => r.id === modo.id && r.comentario);
    textoBotonComentar.textContent = conComentario ? t('Editar comentario') : t('Comentar');
    menu.classList.remove('oculto');
    ubicar(menu, rectReferencia);
  }

  // Pone un elemento flotante debajo de `rectReferencia` (o arriba si no entra),
  // sin salirse del visor.
  function ubicar(elemento, rectReferencia) {
    const zonaRect = zona.getBoundingClientRect();
    let izquierda = rectReferencia.left - zonaRect.left;
    let arriba = rectReferencia.bottom - zonaRect.top + 6;
    if (arriba + elemento.offsetHeight > zona.clientHeight) {
      arriba = rectReferencia.top - zonaRect.top - elemento.offsetHeight - 6;
    }
    izquierda = Math.min(Math.max(izquierda, 4), zona.clientWidth - elemento.offsetWidth - 4);
    elemento.style.left = `${izquierda}px`;
    elemento.style.top = `${Math.max(arriba, 4)}px`;
  }

  function ocultarMenu() {
    modo = null;
    menu.classList.add('oculto');
  }

  // ---------- Acciones (todas quedan en el historial) ----------

  function crearResaltados(tramos, color) {
    for (const tramo of tramos) {
      // Un resaltado nuevo reemplaza a los que quedan completamente adentro suyo.
      resaltados = resaltados.filter((r) => !(r.pagina === tramo.pagina && r.inicio >= tramo.inicio && r.fin <= tramo.fin));
      resaltados.push({ id: nuevoId(), ...tramo, color, creado: new Date().toISOString() });
    }
    document.getSelection().removeAllRanges();
    cambiaron(t('resaltado en {0}', NOMBRES_COLOR[color].toLowerCase()));
    if (visorApi.alResaltar) visorApi.alResaltar();
  }

  // Borra los resaltados solo en los tramos elegidos, como una goma: si un resaltado
  // queda cortado, lo que sobra a los costados sigue resaltado.
  function borrarEn(tramos) {
    if (!hayResaltadosEn(tramos)) {
      document.getSelection().removeAllRanges();
      return;
    }
    const resultado = [];
    for (const r of resaltados) {
      const tramo = tramos.find((otro) => seTocan(r, otro));
      if (!tramo) {
        resultado.push(r);
        continue;
      }
      const textoPlano = textoDePagina(r.pagina);
      if (!textoPlano) continue;
      for (let [inicio, fin] of [
        [r.inicio, Math.min(r.fin, tramo.inicio)],
        [Math.max(r.inicio, tramo.fin), r.fin]
      ]) {
        while (inicio < fin && /\s/.test(textoPlano[inicio])) inicio++;
        while (fin > inicio && /\s/.test(textoPlano[fin - 1])) fin--;
        if (fin > inicio) resultado.push({ ...r, id: nuevoId(), inicio, fin, texto: textoPlano.slice(inicio, fin) });
      }
    }
    resaltados = resultado;
    document.getSelection().removeAllRanges();
    cambiaron(t('resaltado borrado'));
  }

  function quitarPorId(id) {
    resaltados = resaltados.filter((r) => r.id !== id);
    cambiaron(t('resaltado quitado'));
  }

  function aplicarColor(color) {
    if (!modo) return;
    if (modo.tipo === 'crear') {
      const { tramos } = modo;
      ocultarMenu();
      crearResaltados(tramos, color);
      return;
    }
    const resaltado = resaltados.find((r) => r.id === modo.id);
    ocultarMenu();
    if (!resaltado || resaltado.color === color) return;
    resaltado.color = color;
    cambiaron(t('color cambiado a {0}', NOMBRES_COLOR[color].toLowerCase()));
  }

  function quitar() {
    if (!modo) return;
    const actual = modo;
    ocultarMenu();
    if (actual.tipo === 'editar') quitarPorId(actual.id);
    else borrarEn(actual.tramos);
  }

  function pasarANotas() {
    if (!modo) return;
    const tramos = modo.tipo === 'crear' ? modo.tramos : resaltados.filter((r) => r.id === modo.id);
    visorApi.agregarLineasANotas(
      tramos.map((tramo) => `${t('[pág. {0}]', tramo.pagina)} ${t('«{0}»', tramo.texto.replace(/\s+/g, ' '))}`)
    );
    if (modo.tipo === 'crear') document.getSelection().removeAllRanges();
    ocultarMenu();
  }

  // ---------- Comentarios ----------

  const selectorDe = (id) => `.textLayer [data-resaltado="${CSS.escape(id)}"]`;

  // Botón "Comentar" del menú: sobre un resaltado edita su comentario; sobre texto
  // seleccionado primero lo resalta (con el color elegido) y después lo comenta.
  function comentarModoActual() {
    if (!modo) return;
    const actual = modo;
    ocultarMenu();
    let id = actual.id;
    if (actual.tipo === 'crear') {
      const existentes = new Set(resaltados.map((r) => r.id));
      crearResaltados(actual.tramos, colorActual === BORRADOR ? ultimoColor : colorActual);
      const nuevo = resaltados.find((r) => !existentes.has(r.id));
      if (!nuevo) return;
      id = nuevo.id;
    }
    abrirEditorComentario(id);
  }

  function abrirEditorComentario(id) {
    const r = resaltados.find((x) => x.id === id);
    const tramos = zona.querySelectorAll(selectorDe(id));
    if (!r || tramos.length === 0) return;
    comentando = id;
    citaComentario.textContent = r.texto.replace(/\s+/g, ' ');
    campoComentario.value = r.comentario || '';
    botonBorrarComentario.classList.toggle('oculto', !r.comentario);
    editor.classList.remove('oculto');
    ubicar(editor, tramos[tramos.length - 1].getBoundingClientRect());
    campoComentario.focus();
    campoComentario.setSelectionRange(campoComentario.value.length, campoComentario.value.length);
  }

  // Desde la lista del panel: primero va hasta el resaltado (puede tener que
  // dibujar la página) y recién ahí abre el cuadro al lado.
  function comentarDesdeLista(r) {
    visorApi.irAMarca(r.pagina, selectorDe(r.id));
    const limite = performance.now() + 3000;
    const intentar = () => {
      // Dos cuadros más, para que el scroll del salto ya haya pasado.
      if (zona.querySelector(selectorDe(r.id))) {
        requestAnimationFrame(() => requestAnimationFrame(() => abrirEditorComentario(r.id)));
      } else if (performance.now() < limite) {
        requestAnimationFrame(intentar);
      }
    };
    requestAnimationFrame(intentar);
  }

  // Cerrar guardando (Enter, "Guardar", click afuera) o descartando (Esc, "Cancelar").
  function cerrarEditorComentario(guardar) {
    if (comentando === null) return;
    const id = comentando;
    comentando = null;
    editor.classList.add('oculto');
    if (guardar) cambiarComentario(id, campoComentario.value);
  }

  function cambiarComentario(id, texto) {
    const r = resaltados.find((x) => x.id === id);
    if (!r) return;
    const anterior = r.comentario || '';
    const nuevo = texto.trim();
    if (nuevo === anterior) return;
    if (nuevo) r.comentario = nuevo;
    else delete r.comentario;
    cambiaron(!anterior ? t('comentario agregado') : nuevo ? t('comentario editado') : t('comentario borrado'));
  }

  function ordenar() {
    resaltados.sort((a, b) => a.pagina - b.pagina || a.inicio - b.inicio);
  }

  // Muestra, guarda y registra en el historial el cambio que se acaba de hacer.
  function cambiaron(descripcion) {
    ordenar();
    const antes = confirmados;
    const despues = copiar(resaltados);
    confirmados = despues;
    visorApi.historial.registrar({
      descripcion,
      deshacer: () => restaurar(antes),
      rehacer: () => restaurar(despues)
    });
    mostrarYGuardar();
  }

  function restaurar(lista) {
    ocultarMenu();
    resaltados = copiar(lista);
    confirmados = copiar(lista);
    mostrarYGuardar();
  }

  function mostrarYGuardar() {
    visorApi.remarcarTodas();
    actualizarLista();
    // `perdido` es solo de esta sesión: no se guarda.
    visorApi.enviar({
      tipo: 'guardar-resaltados',
      resaltados: resaltados.map(({ perdido, ...guardable }) => guardable)
    });
  }

  // ---------- Botón "Resaltar", borrador y modo resaltador ----------

  function elegirColor(color) {
    colorActual = color;
    if (color !== BORRADOR) ultimoColor = color;
    muestraColorActual.className = `muestra-color color-${color}`;
    for (const opcion of opcionesColor) {
      opcion.setAttribute('aria-checked', String(opcion.dataset.color === color));
    }
    avisoModo.classList.toggle('borrador', color === BORRADOR);
    actualizarAvisoModo();
  }

  function actualizarAvisoModo() {
    const destacado = document.createElement('strong');
    if (colorActual === BORRADOR) {
      destacado.textContent = t('borrador');
      llenarConElementos(textoAvisoModo, t('Modo {0}: seleccioná texto resaltado para quitarle el resaltado.'), [destacado]);
    } else {
      destacado.textContent = NOMBRES_COLOR[colorActual].toLowerCase();
      llenarConElementos(textoAvisoModo, t('Modo resaltador: seleccioná texto para resaltarlo en {0}.'), [destacado]);
    }
    // Las teclas del modo, a la vista mientras se usa.
    const tecla = (texto) => Object.assign(document.createElement('kbd'), { textContent: texto });
    const atajos = document.createElement('span');
    atajos.className = 'atajos-modo';
    llenarConElementos(atajos, t('{0}–{1} color · {2} borrador · {3} deshace'), [tecla('1'), tecla('4'), tecla('5'), tecla('Ctrl+Z')]);
    textoAvisoModo.append(atajos);
  }

  function activarModoResaltador(activo) {
    modoResaltador = activo;
    // El borrador es solo para el modo: al salir, Resaltar vuelve a resaltar.
    if (!activo && colorActual === BORRADOR) elegirColor(ultimoColor);
    botonResaltador.setAttribute('aria-pressed', String(activo));
    botonResaltador.classList.toggle('activo', activo);
    avisoModo.classList.toggle('oculto', !activo);
    document.body.classList.toggle('modo-resaltador', activo);
  }

  // Lo que hace el color actual con la selección: resaltar o, con el borrador, borrar.
  function usarColorActual(tramos) {
    if (colorActual === BORRADOR) borrarEn(tramos);
    else crearResaltados(tramos, colorActual);
  }

  // Con texto seleccionado lo resalta (o lo borra); si no, prende o apaga el modo.
  function usarResaltador() {
    const tramos = tramosDeSeleccion();
    if (tramos.length > 0) usarColorActual(tramos);
    else activarModoResaltador(!modoResaltador);
  }

  function leerModoActual() {
    if (!modo) return;
    const tramos = modo.tipo === 'crear' ? modo.tramos : resaltados.filter((r) => r.id === modo.id);
    ocultarMenu();
    document.getSelection().removeAllRanges();
    visorApi.leerTramos(tramos);
  }

  // ---------- Lista del panel de notas ----------

  function programarLista() {
    if (listaPendiente) return;
    listaPendiente = true;
    queueMicrotask(() => {
      listaPendiente = false;
      actualizarLista();
    });
  }

  // Todo con textContent (nunca innerHTML): el texto viene del PDF y del JSON.
  function actualizarLista() {
    lista.replaceChildren();
    for (const r of resaltados) {
      const muestra = document.createElement('span');
      muestra.className = `muestra-marca marca-${r.color}`;
      muestra.textContent = 'Ab';
      muestra.setAttribute('aria-hidden', 'true');

      const etiqueta = document.createElement('span');
      etiqueta.className = 'pagina-ancla';
      etiqueta.textContent = t('pág. {0}', r.pagina);

      const resumen = document.createElement('span');
      resumen.className = 'texto-ancla';
      resumen.textContent = r.texto.replace(/\s+/g, ' ');

      const boton = document.createElement('button');
      boton.className = 'ancla';
      boton.classList.toggle('perdido', Boolean(r.perdido));
      boton.title = r.perdido
        ? t('Este texto ya no se encuentra en la página (¿cambió el PDF?)')
        : t('Ir al resaltado de la página {0}', r.pagina);
      boton.setAttribute('aria-label', t('{0}, página {1}: {2}', NOMBRES_COLOR[r.color], r.pagina, resumen.textContent));
      boton.append(muestra, etiqueta, resumen);
      if (r.comentario) {
        const comentario = document.createElement('span');
        comentario.className = 'comentario-item';
        comentario.textContent = r.comentario.replace(/\s+/g, ' ');
        comentario.title = r.comentario;
        boton.append(comentario);
      }
      boton.addEventListener('click', () =>
        visorApi.irAMarca(r.pagina, `[data-resaltado="${CSS.escape(r.id)}"]`)
      );

      const botonComentarItem = document.createElement('button');
      botonComentarItem.className = 'comentar-item';
      botonComentarItem.append(botonComentar.querySelector('svg').cloneNode(true));
      botonComentarItem.title = r.comentario ? t('Editar el comentario') : t('Escribir un comentario');
      botonComentarItem.setAttribute(
        'aria-label',
        r.comentario
          ? t('Editar el comentario del resaltado de la página {0}: {1}', r.pagina, resumen.textContent)
          : t('Comentar el resaltado de la página {0}: {1}', r.pagina, resumen.textContent)
      );
      botonComentarItem.disabled = Boolean(r.perdido);
      botonComentarItem.addEventListener('click', () => comentarDesdeLista(r));

      const botonQuitarItem = document.createElement('button');
      botonQuitarItem.className = 'quitar-item';
      botonQuitarItem.textContent = '×';
      botonQuitarItem.title = t('Quitar este resaltado (se puede deshacer con Ctrl+Z)');
      botonQuitarItem.setAttribute('aria-label', t('Quitar el resaltado de la página {0}: {1}', r.pagina, resumen.textContent));
      botonQuitarItem.addEventListener('click', () => quitarPorId(r.id));

      const item = document.createElement('li');
      item.className = 'item-con-quitar';
      item.append(boton, botonComentarItem, botonQuitarItem);
      lista.append(item);
    }
    ayuda.classList.toggle('oculto', resaltados.length > 0);
  }

  // ---------- Eventos ----------

  // Al tocar fuera del menú, se cierra (y si se está seleccionando algo nuevo,
  // se vuelve a abrir al soltar el mouse).
  document.addEventListener('pointerdown', (evento) => {
    if (!menu.contains(evento.target)) ocultarMenu();
    // Un click afuera del cuadro del comentario lo guarda, como las notas.
    if (!editor.contains(evento.target)) cerrarEditorComentario(true);
  });

  document.addEventListener('pointerup', (evento) => {
    // Soltar el mouse sobre la barra, un menú o un panel no es terminar una selección.
    if (!habilitado || evento.target.closest('#barra-herramientas, .menu-flotante, .franja-aviso, aside')) return;
    // Esperamos a que el navegador termine de actualizar la selección.
    setTimeout(() => {
      const tramos = tramosDeSeleccion();
      if (tramos.length === 0) return;
      if (modoResaltador) {
        usarColorActual(tramos);
        return;
      }
      const rects = document.getSelection().getRangeAt(0).getClientRects();
      if (rects.length > 0) mostrarMenu({ tipo: 'crear', tramos }, rects[rects.length - 1]);
    }, 0);
  });

  // Click (sin arrastrar) sobre un resaltado: menú para cambiarle el color o quitarlo.
  document.addEventListener('click', (evento) => {
    if (!habilitado || modoResaltador || !(evento.target instanceof Element)) return;
    const tramo = evento.target.closest('.textLayer [data-resaltado]');
    if (!tramo || !document.getSelection().isCollapsed) return;
    mostrarMenu({ tipo: 'editar', id: tramo.dataset.resaltado }, tramo.getBoundingClientRect());
  });

  visor.addEventListener('scroll', () => {
    ocultarMenu();
    cerrarEditorComentario(true);
  });

  // En el comentario: Enter guarda, Shift+Enter hace una línea nueva y Esc cancela.
  campoComentario.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter' && !evento.shiftKey && !evento.isComposing) {
      evento.preventDefault();
      cerrarEditorComentario(true);
    } else if (evento.key === 'Escape') {
      evento.preventDefault();
      evento.stopPropagation();
      cerrarEditorComentario(false);
    }
  });
  botonGuardarComentario.addEventListener('click', () => cerrarEditorComentario(true));
  botonCancelarComentario.addEventListener('click', () => cerrarEditorComentario(false));
  botonBorrarComentario.addEventListener('click', () => {
    campoComentario.value = '';
    cerrarEditorComentario(true);
  });
  botonComentar.addEventListener('click', comentarModoActual);

  // En modo resaltador (sin el menú flotante abierto): 1-4 cambian el color, 5 es el
  // borrador y Esc sale.
  document.addEventListener('keydown', (evento) => {
    if (modo || !modoResaltador || esCampoEditable(evento.target) || evento.ctrlKey || evento.metaKey || evento.altKey) return;
    if (menuColor.contains(evento.target)) return;
    if (COLOR_POR_TECLA[evento.key] || evento.key === '5') {
      evento.preventDefault();
      elegirColor(COLOR_POR_TECLA[evento.key] || BORRADOR);
      activarModoResaltador(true);
    } else if (evento.key === 'Escape') {
      activarModoResaltador(false);
    }
  });

  // R: lo mismo que el botón Resaltar. Con texto seleccionado lo resalta con el
  // color elegido; si no, prende o apaga el modo resaltador.
  document.addEventListener('keydown', (evento) => {
    if (evento.key.toLowerCase() !== 'r' || !habilitado || esCampoEditable(evento.target)) return;
    if (evento.ctrlKey || evento.metaKey || evento.altKey || (modo && modo.tipo === 'editar')) return;
    evento.preventDefault();
    const tramos = modo ? modo.tramos : tramosDeSeleccion();
    ocultarMenu();
    if (tramos.length > 0) usarColorActual(tramos);
    else activarModoResaltador(!modoResaltador);
  });

  // Con el menú flotante abierto: 1-4 eligen color, Supr quita, C comenta,
  // N pasa a notas, L lee en voz alta y Esc cierra.
  document.addEventListener('keydown', (evento) => {
    if (!modo || esCampoEditable(evento.target) || evento.ctrlKey || evento.metaKey || evento.altKey) return;
    const letra = evento.key.toLowerCase();
    if (COLOR_POR_TECLA[evento.key]) {
      evento.preventDefault();
      aplicarColor(COLOR_POR_TECLA[evento.key]);
    } else if (letra === 'n') {
      evento.preventDefault();
      pasarANotas();
    } else if (letra === 'c') {
      evento.preventDefault();
      comentarModoActual();
    } else if (letra === 'l') {
      evento.preventDefault();
      leerModoActual();
    } else if (evento.key === 'Delete' || evento.key === 'Backspace') {
      if (!botonQuitar.classList.contains('oculto')) {
        evento.preventDefault();
        quitar();
      }
    } else if (evento.key === 'Escape') {
      ocultarMenu();
    }
  });

  for (const boton of botonesColor) boton.addEventListener('click', () => aplicarColor(boton.dataset.color));
  botonANotas.addEventListener('click', pasarANotas);
  botonQuitar.addEventListener('click', quitar);
  botonLeerSeleccion.addEventListener('click', leerModoActual);

  botonResaltador.addEventListener('click', usarResaltador);
  botonSalirModo.addEventListener('click', () => activarModoResaltador(false));
  for (const opcion of opcionesColor) {
    opcion.addEventListener('click', () => {
      elegirColor(opcion.dataset.color);
      // Elegir un color con texto seleccionado lo aplica; si no, deja el modo listo para usar.
      const tramos = tramosDeSeleccion();
      if (tramos.length === 0) activarModoResaltador(true);
      else {
        usarColorActual(tramos);
        if (!modoResaltador && colorActual === BORRADOR) elegirColor(ultimoColor);
      }
    });
  }
  elegirColor(colorActual);

  // Copia de los resaltados que se ven en la página (sin los que ya no se encuentran).
  const visibles = () => copiar(resaltados.filter((r) => !r.perdido));

  return { cargar, marcasDePagina, tramosDeSeleccion, visibles };
}
