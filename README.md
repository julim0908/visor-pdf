# Visor de Prácticos

Un visor de PDF para VS Code pensado para estudiar: abrís los prácticos de la
facultad, los marcás como pendientes, en progreso o hechos, y tomás notas al
lado del PDF.

## Qué hace

- **Visor de PDF**: al hacer doble click en un `.pdf`, se abre con este visor.
  Recuerda el zoom y la última página que viste de cada archivo.
- **Estado del práctico**: botones *Pendiente / En progreso / Hecho* en la barra
  de arriba.
- **Notas**: botón *Notas* para abrir un panel al costado. Se guardan solas
  mientras escribís.
- **Notas ancladas a una página**: cualquier línea que tenga `[pág. 5]` queda
  anclada a esa página. El botón *Anclar a pág. X* agrega la etiqueta con la
  página que estás viendo, y en *Notas por página* hacés click para saltar ahí.
- **Vista "Prácticos"** en la barra de la izquierda: todos los PDFs de la
  carpeta abierta, agrupados por carpeta, con su estado y cuántos llevás hechos.

## Instalación

1. Descargá el archivo `visor-de-practicos-<versión>.vsix`.
2. En VS Code, abrí la vista de extensiones (`Ctrl+Shift+X`).
3. En el menú `…` de arriba, elegí **Install from VSIX…** y seleccioná el archivo.

También desde una terminal:

```
code --install-extension visor-de-practicos-0.1.0.vsix
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
      "actualizado": "2026-09-28T15:24:06.811Z"
    }
  }
}
```

Si ese archivo se rompe (por ejemplo, al editarlo a mano), la extensión avisa y
no lo modifica hasta que lo corrijas, para no perder datos.

## Si preferís otro visor para algún PDF

Click derecho en la pestaña del PDF → **Reopen Editor With…** y elegí otro
editor. Ahí mismo podés cambiar cuál se usa por defecto.

## Licencia

MIT. Incluye [PDF.js](https://github.com/mozilla/pdf.js) (Apache 2.0).
