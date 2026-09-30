// Textos en el idioma de VS Code: español si VS Code está en español y, si no,
// inglés. El texto en español es a la vez la clave: l10n/en.json dice cómo se
// dice cada uno en inglés. "{0}", "{1}"… se reemplazan por los valores que se pasan.
const vscode = require('vscode');
const INGLES = require('../l10n/en.json');

const idiomaActual = () => (/^es(-|$)/i.test(vscode.env.language || 'es') ? 'es' : 'en');

function completar(texto, valores) {
  return texto.replace(/\{(\d+)\}/g, (marca, i) => (Number(i) < valores.length ? String(valores[Number(i)]) : marca));
}

function t(texto, ...valores) {
  const traducido = idiomaActual() === 'en' ? INGLES[texto] ?? texto : texto;
  return completar(traducido, valores);
}

// Lo que necesita el visor para traducir sus propios textos.
const textosParaElVisor = () => ({ idioma: idiomaActual(), textos: idiomaActual() === 'en' ? INGLES : {} });

module.exports = { t, idiomaActual, textosParaElVisor };
