# Pruebas manuales de exportación

Checklist manual para validar los exportadores del editor (`export-modal.tsx` → `src/lib/3d/exporters/`). Las pruebas automatizadas (scene-prep, DXF) cubren la lógica; esta lista valida la cadena real: navegador → archivo → herramienta externa.

## Preparación

- [ ] `pnpm dev`, entrar con `demo@archvision.app` / `arquitectura2026`.
- [ ] Abrir el proyecto demo (casa de dos plantas con mobiliario y habitaciones).
- [ ] Verificar en 3D que hay mobiliario y habitaciones con nombre (`Baño`, etc.).

## UI del modal

- [ ] El botón **Exportar** (barra superior) abre el modal.
- [ ] `Ctrl+E` abre el modal (y no roba el atajo mientras está abierto).
- [ ] La paleta de comandos (`Ctrl+K`) muestra la entrada de exportación.
- [ ] El modal atrapa el foco (Tab gira dentro), `Escape` lo cierra sin cerrar nada más y el clic fuera también.
- [ ] Elegir formato **OBJ** habilita materiales; **STL** los deshabilita y muestra la nota de que STL ignora colores/texturas.
- [ ] Durante la exportación el botón muestra spinner y queda deshabilitado; después aparece el estado de éxito con nombre y tamaño, o error con mensaje legible.
- [ ] El archivo descargado se llama `<proyecto>-<formato>-<fecha>.<ext>` (slug sin espacios raros).

## GLB (Blender)

- [ ] Exportar GLB con materiales y con mobiliario.
- [ ] En Blender 4.x: `File > Import > glTF 2.0` → la casa se ve completa, materiales PBR con sus texturas.
- [ ] La escala es 1:1 en metros (`N` panel: la casa mide ~10 m de ancho).
- [ ] No aparecen luces extra, plano de trabajo, rejilla ni contornos de selección (solo el modelo).
- [ ] Con **mobiliario** desmarcado, el GLB no contiene muebles.
- [ ] Con **materiales** desmarcado, todo sale en un gris neutro.

## OBJ + MTL + texturas (ZIP)

- [ ] Exportar OBJ: se descarga un `.zip`.
- [ ] El ZIP contiene `modelo.obj`, `modelo.mtl` y `textures/` con los PNG de las texturas.
- [ ] El `.obj` empieza con `mtllib modelo.mtl` y las caras usan `usemtl <nombre>`.
- [ ] En Blender: `File > Import > Wavefront (.obj)` → geometría y texturas correctas.
- [ ] Los materiales se nombran con slugs ASCII (`ladrillo-rojo`), sin espacios ni tildes.

## STL (slicer)

- [ ] Exportar STL con mobiliario desmarcado (solo arquitectura).
- [ ] En Cura / PrusaSlicer / Bambu Studio: el archivo binario abre sin error.
- [ ] La pieza mide lo esperado (los exportadores escriben **milímetros**: 10 m → 10 000 unidades); si el slicer muestra 10×10 mm, revisar la interpretación de unidades del slicer.
- [ ] Nota visible en la UI: STL es solo geometría (sin colores/texturas).

## DXF (AutoCAD / LibreCAD)

- [ ] Exportar DXF en metros y luego en centímetros.
- [ ] El archivo abre en AutoCAD (o LibreCAD) sin avisos de versión: es R2000 (`AC1015`).
- [ ] Existen exactamente 4 capas propias con estos colores:
  - [ ] `CAPA_MUROS` — blanco (índice 7)
  - [ ] `CAPA_PUERTAS_VENTANAS` — rojo (1)
  - [ ] `CAPA_COTAS` — verde (3)
  - [ ] `CAPA_TEXTOS` — azul (5)
- [ ] Cada muro visible es un `LWPOLYLINE` **cerrado** (contorno del espesor, no una línea de eje).
- [ ] Las puertas muestran el barrido (`ARC`) y las ventanas el marco rectangular.
- [ ] Hay una cota por muro: línea, ticks a 45° y el valor rotado alineado con el muro.
- [ ] Cada habitación muestra nombre y área en el centro (`Baño`, `4.00 m²`).
- [ ] **Acentos**: `ñ` y `²` se ven correctos (codepage ANSI_1252); no hay caracteres `Â` ni `Ã`.
- [ ] `$INSUNITS` declara la unidad elegida (metros = 6, centímetros = 5, milímetros = 4) y las coordenadas coinciden (un muro de 3,75 m aparece como `3.75` en m y `375` en cm).
- [ ] Los muros de plantas ocultas (planta alta oculta) no aparecen.

## PNG (captura del visor)

- [ ] Con el visor 3D en una vista interesante, exportar **PNG (captura del visor)**.
- [ ] El archivo `.png` se descarga con el nombre del proyecto y refleja exactamente lo que se veía (mismo ángulo, mismas sombras).
- [ ] Las casillas de mobiliario/materiales y el selector de unidades quedan deshabilitados con su explicación.
- [ ] Ocultar una pieza en el outliner y exportar de nuevo: la captura respeta la visibilidad.
- [ ] Cambiar de vista 2D y volver a exportar: la captura usa la cámara actual del visor 3D (no la vista 2D).

## Casos límite

- [ ] Exportar en una escena casi vacía (sin muros): el modal informa el error sin crashear.
- [ ] Cambiar de unidad a milímetros y exportar DXF: coordenadas grandes pero correctas.
- [ ] Repetir varias exportaciones seguidas: no crece el uso de memoria (las object URLs se revocan a los 10 s).
- [ ] Exportar con el visor 3D en uso: la exportación no congela la UI más de unos instantes (cedo el hilo antes de serializar).
