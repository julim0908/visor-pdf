// Textos del visor en el idioma de VS Code (lo decide la extensión: ver src/idioma.js).
// El texto en español es la clave; si no hay traducción se muestra tal cual.
// "{0}", "{1}"… se reemplazan por los valores que se pasan (los que no reciben
// valor quedan tal cual, para armar textos con elementos adentro).
const datos =
  typeof document !== 'undefined' && document.getElementById('config-datos')
    ? JSON.parse(document.getElementById('config-datos').textContent)
    : {};
const textos = datos.textos || {};

export const idioma = datos.idioma || 'es';

export function t(texto, ...valores) {
  const traducido = textos[texto] ?? texto;
  return traducido.replace(/\{(\d+)\}/g, (marca, i) => (Number(i) < valores.length ? String(valores[Number(i)]) : marca));
}
