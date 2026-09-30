// Menús desplegables de la barra (estado del práctico, color del resaltador):
// se abren con su botón, se cierran con Esc o con un click afuera, y las
// opciones se recorren con las flechas.
export function crearMenuDesplegable(boton, menu) {
  const opciones = () => [...menu.querySelectorAll('[role^="menuitem"]')];

  function abrir() {
    menu.classList.remove('oculto');
    boton.setAttribute('aria-expanded', 'true');
    const elegida = opciones().find((o) => o.getAttribute('aria-checked') === 'true');
    (elegida || opciones()[0])?.focus();
  }

  function cerrar(devolverFoco = false) {
    if (menu.classList.contains('oculto')) return;
    menu.classList.add('oculto');
    boton.setAttribute('aria-expanded', 'false');
    if (devolverFoco) boton.focus();
  }

  const estaAbierto = () => !menu.classList.contains('oculto');

  boton.addEventListener('click', () => (estaAbierto() ? cerrar() : abrir()));

  document.addEventListener('pointerdown', (evento) => {
    if (estaAbierto() && !menu.contains(evento.target) && !boton.contains(evento.target)) cerrar();
  });

  menu.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') {
      evento.stopPropagation();
      cerrar(true);
      return;
    }
    const paso = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[evento.key];
    const lista = opciones();
    // Sin opciones (un panel de solo lectura), las flechas desplazan como siempre.
    if (!paso || lista.length === 0) return;
    evento.preventDefault();
    const indice = lista.indexOf(document.activeElement);
    lista[(indice + paso + lista.length) % lista.length].focus();
  });

  // Al elegir una opción, el menú se cierra solo.
  menu.addEventListener('click', (evento) => {
    if (evento.target.closest('[role^="menuitem"]')) cerrar(true);
  });

  return { abrir, cerrar, estaAbierto };
}
