// Lectura en voz alta con las voces del sistema (Web Speech API).
// El texto se lee de a frases cortas: las voces fallan con textos muy largos, y
// así podemos marcar en la página la frase y la palabra que se están leyendo.

const LARGO_MAXIMO = 220;

// Divide texto[desde, hasta) en fragmentos cortos, cortando después de un signo
// de puntuación o, si una frase es muy larga, en el último espacio.
// Cada fragmento es { inicio, fin, texto }; `texto` tiene el mismo largo que el
// original (los saltos de línea pasan a espacios) para que las posiciones que
// informa la voz coincidan con las de la página.
export function dividirEnFragmentos(texto, desde = 0, hasta = texto.length, largoMaximo = LARGO_MAXIMO) {
  const fragmentos = [];
  let inicio = desde;

  const agregar = (a, b) => {
    while (a < b && /\s/.test(texto[a])) a++;
    while (b > a && /\s/.test(texto[b - 1])) b--;
    if (b > a) fragmentos.push({ inicio: a, fin: b, texto: texto.slice(a, b).replace(/\s/g, ' ') });
  };

  for (let i = desde; i < hasta; i++) {
    const finDeFrase = /[.!?;:]/.test(texto[i]) && (i + 1 >= hasta || /\s/.test(texto[i + 1]));
    if (finDeFrase) {
      agregar(inicio, i + 1);
      inicio = i + 1;
    } else if (i + 1 - inicio >= largoMaximo) {
      const ultimoEspacio = texto.slice(inicio, i + 1).search(/\s\S*$/);
      const corte = ultimoEspacio > 0 ? inicio + ultimoEspacio : i + 1;
      agregar(inicio, corte);
      inicio = corte;
    }
  }
  agregar(inicio, hasta);
  return fragmentos;
}

// Largo de la palabra que empieza en `posicion` (por si la voz no lo informa).
function largoDePalabra(texto, posicion) {
  const palabra = /^\S+/.exec(texto.slice(posicion));
  return palabra ? palabra[0].length : 0;
}

export const hayVoz = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

// Voces disponibles, las de español primero.
export function listarVoces() {
  if (!hayVoz()) return [];
  const voces = window.speechSynthesis.getVoices();
  const esEspanol = (v) => v.lang.toLowerCase().startsWith('es');
  return [...voces.filter(esEspanol), ...voces.filter((v) => !esEspanol(v))];
}

export function alCambiarVoces(funcion) {
  if (hayVoz()) window.speechSynthesis.addEventListener('voiceschanged', funcion);
}

// Elige la voz guardada; si no está, una en español (mejor de Latinoamérica).
function elegirVoz(uriGuardada) {
  const voces = listarVoces();
  return (
    voces.find((v) => v.voiceURI === uriGuardada) ||
    voces.find((v) => /^es-(AR|419|MX|US|CL|CO|UY)/i.test(v.lang)) ||
    voces.find((v) => v.lang.toLowerCase().startsWith('es')) ||
    voces[0] ||
    null
  );
}

export function probarVoz(uriVoz, velocidad) {
  if (!hayVoz()) return;
  window.speechSynthesis.cancel();
  const prueba = new SpeechSynthesisUtterance('Hola, así suena esta voz.');
  const voz = elegirVoz(uriVoz);
  if (voz) {
    prueba.voice = voz;
    prueba.lang = voz.lang;
  }
  prueba.rate = velocidad;
  window.speechSynthesis.speak(prueba);
}

// Crea el lector. `opciones`:
//   obtenerTramos(): async iterable de { pagina, texto, desde, hasta } a leer, en orden.
//   preferencias(): { voz, velocidad }
//   alFragmento(pagina, inicio, fin) / alPalabra(pagina, inicio, fin): qué se está leyendo.
//   alCambiarEstado(estado): 'leyendo' | 'pausado' | 'detenido'.
//   alError(mensaje)
export function crearLector(opciones) {
  let estado = 'detenido';
  let sesion = 0; // cada lectura nueva invalida la anterior
  let actual = null; // referencia a la frase en curso (si no, Chrome a veces la descarta y no avisa el final)

  function cambiarEstado(nuevo) {
    estado = nuevo;
    opciones.alCambiarEstado(nuevo);
  }

  function decir(pagina, fragmento) {
    return new Promise((resolve, reject) => {
      const { voz: uriVoz, velocidad } = opciones.preferencias();
      const frase = new SpeechSynthesisUtterance(fragmento.texto);
      const voz = elegirVoz(uriVoz);
      if (voz) {
        frase.voice = voz;
        frase.lang = voz.lang;
      } else {
        frase.lang = 'es';
      }
      frase.rate = velocidad;
      frase.onboundary = (evento) => {
        if (evento.name !== 'word') return;
        const largo = evento.charLength || largoDePalabra(fragmento.texto, evento.charIndex);
        const inicio = fragmento.inicio + evento.charIndex;
        opciones.alPalabra(pagina, inicio, inicio + largo);
      };
      frase.onend = () => resolve();
      frase.onerror = (evento) => {
        // "interrupted"/"canceled" son normales al detener o saltar.
        if (evento.error === 'interrupted' || evento.error === 'canceled') resolve();
        else reject(new Error(evento.error));
      };
      actual = frase;
      window.speechSynthesis.speak(frase);
    });
  }

  async function leer() {
    if (!hayVoz()) {
      opciones.alError('Esta versión de VS Code no permite leer en voz alta.');
      return;
    }
    if (listarVoces().length === 0) {
      opciones.alError('No hay voces instaladas. En Windows se agregan en Configuración → Hora e idioma → Voz.');
      return;
    }
    detener();
    const miSesion = ++sesion;
    cambiarEstado('leyendo');
    try {
      for await (const tramo of opciones.obtenerTramos()) {
        for (const fragmento of dividirEnFragmentos(tramo.texto, tramo.desde, tramo.hasta)) {
          if (miSesion !== sesion) return;
          opciones.alFragmento(tramo.pagina, fragmento.inicio, fragmento.fin);
          await decir(tramo.pagina, fragmento);
        }
      }
    } catch (error) {
      if (miSesion === sesion) opciones.alError(`No se pudo leer en voz alta: ${error.message}`);
    }
    if (miSesion === sesion) terminar();
  }

  function terminar() {
    actual = null;
    opciones.alFragmento(null);
    opciones.alPalabra(null);
    cambiarEstado('detenido');
  }

  function detener() {
    if (estado === 'detenido') return;
    sesion++;
    window.speechSynthesis.cancel();
    terminar();
  }

  function pausarOSeguir() {
    if (estado === 'leyendo') {
      window.speechSynthesis.pause();
      cambiarEstado('pausado');
    } else if (estado === 'pausado') {
      window.speechSynthesis.resume();
      cambiarEstado('leyendo');
    }
  }

  return { leer, detener, pausarOSeguir, estado: () => estado };
}
