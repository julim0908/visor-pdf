// Historial para Ctrl+Z (deshacer) y Ctrl+Y (rehacer).
// Cada acción es { descripcion, deshacer(), rehacer() }. Registrar una acción
// nueva borra lo que se podía rehacer, como en cualquier editor.
const LIMITE = 200;

export function crearHistorial() {
  const hechas = [];
  const deshechas = [];

  return {
    registrar(accion) {
      hechas.push(accion);
      if (hechas.length > LIMITE) hechas.shift();
      deshechas.length = 0;
    },

    // Devuelve la acción deshecha, o null si no había nada.
    deshacer() {
      const accion = hechas.pop();
      if (!accion) return null;
      accion.deshacer();
      deshechas.push(accion);
      return accion;
    },

    rehacer() {
      const accion = deshechas.pop();
      if (!accion) return null;
      accion.rehacer();
      hechas.push(accion);
      return accion;
    },

    // La última acción hecha (para seguir sumando letras a la misma "escritura").
    ultima: () => hechas[hechas.length - 1] || null
  };
}
