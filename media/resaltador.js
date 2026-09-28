// Resaltador: marcar texto del PDF con colores, editarlo, pasarlo a las notas y
// listarlo en el panel. Los resaltados se guardan en .practicos.json (lo hace la
// extensión: acá solo se le manda la lista completa cada vez que cambia).
import { posicionEnTexto } from './marcas.js';
import { crearMenuDesplegable } from './menus.js';

const NOMBRES_COLOR = { amarillo: 'Amarillo', verde: 'Verde', rosa: 'Rosa', celeste: 'Celeste' };
const COLOR_POR_TECLA = { 1: 'amarillo', 2: 'verde', 3: 'rosa', 4: 'celeste' };

const esCampoEditable = (elemento) =>
  elemento instanceof HTMLElement && (elemento.matches('input, textarea, select') || elemento.isContentEditable);

const nuevoId = () => `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

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
  const nombreColorModo = document.getElementById('nombre-color-modo');
  const botonSalirModo = document.getElementById('boton-salir-modo');
  crearMenuDesplegable(botonColorResaltador, menuColor);

  let colorActual = 'amarillo';
  // Con el modo resaltador activo, todo lo que se selecciona se resalta directo (sin menú).
  let modoResaltador = false;

  // Como se guardan en .practicos.json; en memoria además llevan `perdido`
  // (true si su texto ya no aparece en la página).
  let resaltados = [];
  let habilitado = false; // false si no se pudieron leer los datos del práctico
  // null, { tipo: 'crear', tramos } (hay texto seleccionado) o { tipo: 'editar', id }.
  let modo = null;
  let listaPendiente = false;

  function cargar(guardados, puedeGuardar) {
    resaltados = (guardados || []).map((r) => ({ ...r }));
    habilitado = puedeGuardar;
    botonResaltador.disabled = !puedeGuardar;
    botonColorResaltador.disabled = !puedeGuardar;
    if (!puedeGuardar) activarModoResaltador(false);
    ordenar();
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
      if (!r.perdido) marcas.push({ inicio: r.inicio, fin: r.fin, clases: ['marca', `marca-${r.color}`], id: r.id });
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

  // ---------- Menú flotante ----------

  function mostrarMenu(nuevoModo, rectReferencia) {
    modo = nuevoModo;
    const editando = modo.tipo === 'editar';
    const colorActual = editando ? (resaltados.find((r) => r.id === modo.id) || {}).color : null;
    for (const boton of botonesColor) {
      boton.setAttribute('aria-pressed', String(boton.dataset.color === colorActual));
    }
    botonQuitar.classList.toggle('oculto', !editando);
    menu.classList.remove('oculto');

    // Debajo de la selección (o arriba si no entra), sin salirse del visor.
    const zonaRect = zona.getBoundingClientRect();
    let izquierda = rectReferencia.left - zonaRect.left;
    let arriba = rectReferencia.bottom - zonaRect.top + 6;
    if (arriba + menu.offsetHeight > zona.clientHeight) {
      arriba = rectReferencia.top - zonaRect.top - menu.offsetHeight - 6;
    }
    izquierda = Math.min(Math.max(izquierda, 4), zona.clientWidth - menu.offsetWidth - 4);
    menu.style.left = `${izquierda}px`;
    menu.style.top = `${Math.max(arriba, 4)}px`;
  }

  function ocultarMenu() {
    modo = null;
    menu.classList.add('oculto');
  }

  // ---------- Acciones ----------

  function crearResaltados(tramos, color) {
    for (const t of tramos) {
      // Un resaltado nuevo reemplaza a los que quedan completamente adentro suyo.
      resaltados = resaltados.filter((r) => !(r.pagina === t.pagina && r.inicio >= t.inicio && r.fin <= t.fin));
      resaltados.push({ id: nuevoId(), ...t, color, creado: new Date().toISOString() });
    }
    document.getSelection().removeAllRanges();
    cambiaron();
    if (visorApi.alResaltar) visorApi.alResaltar();
  }

  function aplicarColor(color) {
    if (!modo) return;
    if (modo.tipo === 'crear') {
      const { tramos } = modo;
      ocultarMenu();
      crearResaltados(tramos, color);
      return;
    } else {
      const resaltado = resaltados.find((r) => r.id === modo.id);
      if (resaltado) resaltado.color = color;
    }
    ocultarMenu();
    cambiaron();
  }

  function quitar() {
    if (!modo || modo.tipo !== 'editar') return;
    const id = modo.id;
    resaltados = resaltados.filter((r) => r.id !== id);
    ocultarMenu();
    cambiaron();
  }

  function pasarANotas() {
    if (!modo) return;
    const tramos = modo.tipo === 'crear' ? modo.tramos : resaltados.filter((r) => r.id === modo.id);
    for (const t of tramos) visorApi.agregarLineaANotas(`[pág. ${t.pagina}] «${t.texto.replace(/\s+/g, ' ')}»`);
    if (modo.tipo === 'crear') document.getSelection().removeAllRanges();
    ocultarMenu();
  }

  // ---------- Botón "Resaltar" y modo resaltador ----------

  function elegirColor(color) {
    colorActual = color;
    muestraColorActual.className = `muestra-color color-${color}`;
    for (const opcion of opcionesColor) {
      opcion.setAttribute('aria-checked', String(opcion.dataset.color === color));
    }
    nombreColorModo.textContent = NOMBRES_COLOR[color].toLowerCase();
  }

  function activarModoResaltador(activo) {
    modoResaltador = activo;
    botonResaltador.setAttribute('aria-pressed', String(activo));
    botonResaltador.classList.toggle('activo', activo);
    avisoModo.classList.toggle('oculto', !activo);
    document.body.classList.toggle('modo-resaltador', activo);
  }

  // Con texto seleccionado lo resalta; si no, prende o apaga el modo resaltador.
  function usarResaltador() {
    const tramos = tramosDeSeleccion();
    if (tramos.length > 0) crearResaltados(tramos, colorActual);
    else activarModoResaltador(!modoResaltador);
  }

  function leerModoActual() {
    if (!modo) return;
    const tramos = modo.tipo === 'crear' ? modo.tramos : resaltados.filter((r) => r.id === modo.id);
    ocultarMenu();
    document.getSelection().removeAllRanges();
    visorApi.leerTramos(tramos);
  }

  function ordenar() {
    resaltados.sort((a, b) => a.pagina - b.pagina || a.inicio - b.inicio);
  }

  function cambiaron() {
    ordenar();
    visorApi.remarcarTodas();
    actualizarLista();
    // `perdido` es solo de esta sesión: no se guarda.
    visorApi.enviar({
      tipo: 'guardar-resaltados',
      resaltados: resaltados.map(({ perdido, ...guardable }) => guardable)
    });
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
      etiqueta.textContent = `pág. ${r.pagina}`;

      const resumen = document.createElement('span');
      resumen.className = 'texto-ancla';
      resumen.textContent = r.texto.replace(/\s+/g, ' ');

      const boton = document.createElement('button');
      boton.className = 'ancla';
      boton.classList.toggle('perdido', Boolean(r.perdido));
      boton.title = r.perdido
        ? 'Este texto ya no se encuentra en la página (¿cambió el PDF?)'
        : `Ir al resaltado de la página ${r.pagina}`;
      boton.setAttribute('aria-label', `${NOMBRES_COLOR[r.color]}, página ${r.pagina}: ${resumen.textContent}`);
      boton.append(muestra, etiqueta, resumen);
      boton.addEventListener('click', () =>
        visorApi.irAMarca(r.pagina, `[data-resaltado="${CSS.escape(r.id)}"]`)
      );

      const item = document.createElement('li');
      item.append(boton);
      lista.append(item);
    }
    ayuda.classList.toggle('oculto', resaltados.length > 0);
  }

  // ---------- Eventos ----------

  // Al tocar fuera del menú, se cierra (y si se está seleccionando algo nuevo,
  // se vuelve a abrir al soltar el mouse).
  document.addEventListener('pointerdown', (evento) => {
    if (!menu.contains(evento.target)) ocultarMenu();
  });

  document.addEventListener('pointerup', (evento) => {
    // Soltar el mouse sobre la barra o un menú no es terminar una selección.
    if (!habilitado || evento.target.closest('#barra-herramientas, .menu-flotante, .franja-aviso')) return;
    // Esperamos a que el navegador termine de actualizar la selección.
    setTimeout(() => {
      const tramos = tramosDeSeleccion();
      if (tramos.length === 0) return;
      if (modoResaltador) {
        crearResaltados(tramos, colorActual);
        return;
      }
      const rects = document.getSelection().getRangeAt(0).getClientRects();
      if (rects.length > 0) mostrarMenu({ tipo: 'crear', tramos }, rects[rects.length - 1]);
    }, 0);
  });

  // Click (sin arrastrar) sobre un resaltado: menú para cambiarle el color o quitarlo.
  document.addEventListener('click', (evento) => {
    if (!habilitado || !(evento.target instanceof Element)) return;
    const tramo = evento.target.closest('.textLayer [data-resaltado]');
    if (!tramo || !document.getSelection().isCollapsed) return;
    mostrarMenu({ tipo: 'editar', id: tramo.dataset.resaltado }, tramo.getBoundingClientRect());
  });

  visor.addEventListener('scroll', ocultarMenu);

  // En modo resaltador (sin el menú flotante abierto): 1-4 cambian el color y Esc sale.
  document.addEventListener('keydown', (evento) => {
    if (modo || !modoResaltador || esCampoEditable(evento.target) || evento.ctrlKey || evento.metaKey || evento.altKey) return;
    if (menuColor.contains(evento.target)) return;
    if (COLOR_POR_TECLA[evento.key]) {
      evento.preventDefault();
      elegirColor(COLOR_POR_TECLA[evento.key]);
    } else if (evento.key === 'Escape') {
      activarModoResaltador(false);
    }
  });

  // Con el menú flotante abierto: 1-4 eligen color, Supr quita, Esc cierra.
  document.addEventListener('keydown', (evento) => {
    if (!modo || esCampoEditable(evento.target) || evento.ctrlKey || evento.metaKey || evento.altKey) return;
    if (COLOR_POR_TECLA[evento.key]) {
      evento.preventDefault();
      aplicarColor(COLOR_POR_TECLA[evento.key]);
    } else if (evento.key === 'Delete' || evento.key === 'Backspace') {
      if (modo.tipo === 'editar') {
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
      // Elegir un color con texto seleccionado lo resalta; si no, deja el modo listo para usar.
      const tramos = tramosDeSeleccion();
      if (tramos.length > 0) crearResaltados(tramos, colorActual);
      else activarModoResaltador(true);
    });
  }
  elegirColor(colorActual);

  return { cargar, marcasDePagina, tramosDeSeleccion };
}
