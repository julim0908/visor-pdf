# Visor PDF

Un visor de PDF para VS Code pensado para estudiar: abrís los prácticos de la
facultad, los marcás como pendientes, en progreso o hechos, y tomás notas al
lado del PDF.

## Qué hace

- **Visor de PDF**: al hacer doble click en un `.pdf`, se abre con este visor.
  Recuerda el zoom y la última página que viste de cada archivo.
- **Índice y links**: si el PDF tiene marcadores, el botón *Índice* los muestra
  a la izquierda para saltar entre secciones. Los links del PDF se pueden
  clickear (los externos se abren en el navegador, con la confirmación de VS
  Code). Después de un salto aparece *← Volver* (también `Alt+←`).
- **Seleccionar y copiar texto** del PDF, como en cualquier lector.
- **Buscar** con `Ctrl+F` (o el campo de la barra): no distingue mayúsculas ni
  tildes, así que "pagina" encuentra "Página". `Enter` va a la siguiente
  coincidencia, `Shift+Enter` a la anterior y `Esc` borra la búsqueda.
  Los PDFs escaneados son imágenes, así que no tienen texto para buscar ni copiar.
- **Resaltador**: seleccioná texto y elegí un color en el menú que aparece (o
  apretá `1`–`4`). Cada color tiene además su propia forma, para distinguirlos
  sin depender del color: amarillo es fondo, verde subrayado, rosa doble
  subrayado y celeste subrayado punteado. Con un click sobre un resaltado le
  cambiás el color o lo quitás (`Supr`). *A notas* copia el texto a tus notas,
  anclado a su página. Todos quedan listados en el panel de notas.
- **Opciones de lectura** (botón **Aa**), pensadas para leer con más comodidad
  (por ejemplo con dislexia, TDAH o cansancio visual). Valen para todos tus PDFs:
  - *Color de papel*: crema, durazno, celeste, verde o gris en lugar de blanco.
    El texto conserva todo su contraste.
  - *Guía de lectura*: una franja que sigue al mouse y oscurece el resto de la
    página para no perder el renglón. Con las flechas `↑` `↓` avanza renglón por
    renglón.
- **Estado del práctico**: botones *Pendiente / En progreso / Hecho* en la barra
  de arriba.
- **Notas**: botón *Notas* para abrir un panel al costado. Se guardan solas
  mientras escribís.
- **Notas ancladas a una página**: cualquier línea que tenga `[pág. 5]` queda
  anclada a esa página. El botón *Anclar a pág. X* agrega la etiqueta con la
  página que estás viendo, y en *Notas por página* hacés click para saltar ahí.
- **Exportar resumen**: al final del panel de notas, guarda un archivo Markdown
  con tus notas y resaltados ordenados por página, para repasar o compartir.
- **Vista "Prácticos"** en la barra de la izquierda: todos los PDFs de la
  carpeta abierta, agrupados por carpeta, con su estado y cuántos llevás hechos.

## Instalación

En VS Code, abrí la vista de extensiones (`Ctrl+Shift+X`), buscá
**Visor PDF** e instalala.

### Desde un archivo .vsix

1. Descargá el archivo `visor-de-practicos-<versión>.vsix`.
2. En VS Code, abrí la vista de extensiones (`Ctrl+Shift+X`).
3. En el menú `…` de arriba, elegí **Install from VSIX…** y seleccioná el archivo.

También desde una terminal:

```
code --install-extension visor-de-practicos-0.3.1.vsix
```

## Dónde se guardan tus datos

El estado y las notas se guardan en un archivo `.practicos.json` dentro de la
misma carpeta que el PDF. Así viajan con tus archivos (Drive, un pendrive, git…)
y nada sale de tu computadora.

```json
{
  "version": 1,
  "practicos": {
    "TP1.pdf": {
      "estado": "hecho",
      "notas": "[pág. 3] revisar el ejercicio 2",
      "resaltados": [
        { "id": "r-…", "pagina": 3, "inicio": 47, "fin": 67, "color": "amarillo", "texto": "resolver la integral", "creado": "…" }
      ],
      "actualizado": "2026-09-28T15:24:06.811Z"
    }
  }
}
```

Si ese archivo se rompe (por ejemplo, al editarlo a mano), la extensión avisa y
no lo modifica hasta que lo corrijas, para no perder datos.

Los resaltados no modifican el PDF. Si el PDF cambia y un texto resaltado ya no
aparece en su página, figura atenuado en la lista para que sepas que se perdió.

Las opciones de lectura (color de papel y guía) se guardan en VS Code, no en
`.practicos.json`, porque son tuyas y no del práctico.

## Si preferís otro visor para algún PDF

Click derecho en la pestaña del PDF → **Reopen Editor With…** y elegí otro
editor. Ahí mismo podés cambiar cuál se usa por defecto.

## Para desarrollar

Hace falta [Node.js](https://nodejs.org) 22 o más nuevo.

```
npm install        # instala pdf.js y la herramienta para empaquetar
npm test           # corre las pruebas automáticas (no abre VS Code)
npm run banco      # abre el visor en el navegador: http://localhost:5757
npm run empaquetar # genera el .vsix para compartir
```

Para probar dentro de VS Code, abrí esta carpeta y apretá `F5`.

- `extension.js`: registra el visor y maneja lo que pide (leer el PDF, guardar datos).
- `src/`: código de la extensión (Node). `almacen.js` es el único que lee y
  escribe `.practicos.json`.
- `media/`: el visor que corre dentro de VS Code (HTML/CSS/JS del navegador).
- `test/`: pruebas automáticas, el `vscode` simulado y el banco de pruebas.

## Licencia

MIT. Incluye [PDF.js](https://github.com/mozilla/pdf.js) (Apache 2.0).
