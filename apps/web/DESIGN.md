---
name: ArchVision 3D AI
description: Plataforma para convertir fotos, planos y croquis en modelos 3D editables de viviendas.
colors:
  # Paleta base (definida por el usuario)
  abyss-navy: "#041840"
  deep-navy: "#052159"
  survey-sky: "#2EA7F2"
  glacier-cyan: "#44C1F2"
  drafting-mist: "#E9EFF2"
  # Derivados tema oscuro (landing + dashboard oscuro + editor)
  dark-surface-2: "#0A2A6B"
  dark-surface-3: "#0E347C"
  dark-line: "#16397A"
  dark-line-strong: "#24509A"
  dark-ink-muted: "#A9BCD6"
  dark-ink-subtle: "#7189AD"
  dark-accent-soft: "#0B3A6E"
  # Derivados tema claro (dashboard claro)
  paper-white: "#FFFFFF"
  light-surface-2: "#DDE6EC"
  light-surface-3: "#CFDBE4"
  light-line: "#C8D5DF"
  light-line-strong: "#A3B6C6"
  light-ink-muted: "#36507A"
  light-ink-subtle: "#62789A"
  sky-ink: "#0B6DB3"
  light-accent-soft: "#D5ECFB"
  # Estados
  warn: "#F5A524"
  danger: "#F2545B"
  ok: "#3DD68C"
  warn-light: "#B45309"
  danger-light: "#C62828"
  ok-light: "#15803D"
typography:
  display:
    fontFamily: "'Barlow Semi Condensed', 'Barlow', system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 6vw, 5rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "'Barlow Semi Condensed', 'Barlow', system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 3vw, 2.5rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.005em"
  title:
    fontFamily: "'Barlow', system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "'Barlow', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: "'Barlow', system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Barlow Semi Condensed', 'Barlow', system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
  mono:
    fontFamily: "'JetBrains Mono', 'Cascadia Mono', ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  panel: "12px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
  "16": "64px"
  "24": "96px"
components:
  button-primary:
    backgroundColor: "{colors.survey-sky}"
    textColor: "{colors.abyss-navy}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.glacier-cyan}"
    textColor: "{colors.abyss-navy}"
  button-secondary-dark:
    backgroundColor: "{colors.dark-surface-2}"
    textColor: "{colors.drafting-mist}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
    height: "40px"
  button-secondary-light:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.abyss-navy}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
    height: "40px"
  button-ghost:
    textColor: "{colors.survey-sky}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  input-dark:
    backgroundColor: "{colors.abyss-navy}"
    textColor: "{colors.drafting-mist}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "40px"
  input-light:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.abyss-navy}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "40px"
  card-dark:
    backgroundColor: "{colors.deep-navy}"
    textColor: "{colors.drafting-mist}"
    rounded: "{rounded.panel}"
    padding: "24px"
  card-light:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.abyss-navy}"
    rounded: "{rounded.panel}"
    padding: "24px"
  chip-active:
    backgroundColor: "{colors.dark-accent-soft}"
    textColor: "{colors.glacier-cyan}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  sidebar-item-active:
    backgroundColor: "{colors.dark-accent-soft}"
    textColor: "{colors.drafting-mist}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
---

# Design System: ArchVision 3D AI

## Overview

**Creative North Star: "El Plano Azul Vivo"**

ArchVision se viste como un plano técnico que cobra vida: el azul profundo del papel cianotipo, la luz azul cielo del láser de medición y el gris niebla de la mesa de dibujo. La interfaz se siente como software CAD moderno, preciso y confiable, nunca como una startup genérica de IA. La IA propone, el usuario manda; el sistema visual lo refleja con superficies sobrias, medidas exactas y un único acento luminoso que señala lo accionable.

La **landing** vive siempre en el tema oscuro navy: fondo Abyss Navy, retícula de plano sutil, titulares grandes en Barlow Semi Condensed y el azul Survey Sky reservado para la llamada principal y los detalles que "miden". El **dashboard** respeta la preferencia del usuario: tema oscuro navy (recomendado, coherente con el editor) o tema claro sobre Drafting Mist, con exactamente la misma estructura, tokens semánticos y jerarquía. El **editor** sigue siempre en oscuro.

La densidad es media en la landing (aire generoso, secciones de 96px) y compacta en el dashboard (filas de 40px, paneles de 12px de radio, bordes de 1px). Rechazamos los degradados morado-rosa, el glassmorphism decorativo sin función y los fondos negros puros.

**Key Characteristics:**
- Paleta monocromática de azules con un solo acento luminoso (Survey Sky).
- Barlow en toda la interfaz: Semi Condensed para titulares y etiquetas, Barlow para texto.
- Retícula técnica (blueprint grid) como textura de marca.
- Bordes de 1px y profundidad por capas tonales, no por sombras pesadas.
- Cifras y medidas en monoespaciada con números tabulares.

## Colors

Una familia de azules que va del navy casi negro a la niebla clara, con dos azules luminosos como única fuente de energía.

### Primary
- **Survey Sky** (survey-sky): el color de acción. Botón primario, enlaces en tema oscuro, anillo de foco, selección activa, línea de progreso, cotas y medidas destacadas. En tema claro se usa como relleno de botones (siempre con texto Abyss Navy), nunca como color de texto.
- **Sky Ink** (sky-ink): versión profunda de Survey Sky, solo para texto/enlaces/iconos de acento sobre fondos claros, donde Survey Sky no alcanza contraste AA.

### Secondary
- **Glacier Cyan** (glacier-cyan): estado hover del primario, resaltados de datos (gráficas, badges "IA", indicadores en vivo), y el brillo de la retícula en el hero. Nunca compite con Survey Sky en el mismo control.

### Neutral
- **Abyss Navy** (abyss-navy): lienzo del tema oscuro (fondo de landing, dashboard oscuro y editor). En tema claro es el color de texto principal y el texto sobre botones azules.
- **Deep Navy** (deep-navy): superficie elevada en oscuro: tarjetas, sidebar, header, modales.
- **Dark Surface 2 / 3** (dark-surface-2, dark-surface-3): capas superiores en oscuro (hover de fila, inputs anidados, popovers).
- **Dark Line / Line Strong** (dark-line, dark-line-strong): bordes de 1px y divisores en oscuro; la versión fuerte para bordes de inputs y separadores principales.
- **Dark Ink Muted / Subtle** (dark-ink-muted, dark-ink-subtle): texto secundario y terciario sobre navy.
- **Drafting Mist** (drafting-mist): lienzo del tema claro y color de texto principal sobre navy.
- **Paper White** (paper-white): superficie de tarjetas y paneles en tema claro.
- **Light Surface 2 / 3, Light Line / Line Strong, Light Ink Muted / Subtle**: equivalentes del tema claro.
- **Accent Soft** (dark-accent-soft, light-accent-soft): fondo de ítem activo en sidebar, chips seleccionados y celdas resaltadas.

### Estados
- **Warn / Danger / Ok** (warn, danger, ok) en tema oscuro y sus variantes `-light` en tema claro. Solo para estados del sistema (límite del plan, error de validación, guardado). Nunca decorativos.

### Mapeo a tokens semánticos (globals.css)

| Token CSS | Tema oscuro (`.dark`, landing, editor) | Tema claro (`:root`) |
|---|---|---|
| `--canvas` | abyss-navy | drafting-mist |
| `--surface` | deep-navy | paper-white |
| `--surface-2` | dark-surface-2 | light-surface-2 |
| `--surface-3` | dark-surface-3 | light-surface-3 |
| `--line` | dark-line | light-line |
| `--line-strong` | dark-line-strong | light-line-strong |
| `--ink` | drafting-mist | abyss-navy |
| `--ink-muted` | dark-ink-muted | light-ink-muted |
| `--ink-subtle` | dark-ink-subtle | light-ink-subtle |
| `--accent` | survey-sky | sky-ink (texto) / survey-sky (rellenos) |
| `--accent-fill` | survey-sky | survey-sky |
| `--accent-hover` | glacier-cyan | glacier-cyan |
| `--accent-soft` | dark-accent-soft | light-accent-soft |
| `--accent-ink` | abyss-navy | abyss-navy |
| `--warn` / `--danger` / `--ok` | warn / danger / ok | warn-light / danger-light / ok-light |

Los componentes consumen solo los tokens semánticos; nunca hex directos.

### Named Rules
**The One Light Rule.** Survey Sky ocupa como máximo ~10% de cualquier pantalla. Hay un solo botón primario por vista; su escasez es lo que lo hace visible.

**The Navy-Not-Black Rule.** Ningún fondo es #000 ni gris neutro. El oscuro más profundo es Abyss Navy; el texto más oscuro en tema claro también es Abyss Navy.

**The Sky-Is-Not-Text Rule.** En tema claro, Survey Sky y Glacier Cyan nunca se usan como color de texto sobre blanco o Drafting Mist (contraste insuficiente). Para texto de acento se usa Sky Ink.

## Typography

**Display Font:** Barlow Semi Condensed (con Barlow, system-ui)
**Body Font:** Barlow (con system-ui)
**Label/Mono Font:** Barlow Semi Condensed para etiquetas; JetBrains Mono para medidas, coordenadas y cifras técnicas.

**Character:** Barlow nace de la señalética de carreteras de California: geométrica, legible y ligeramente industrial. En su corte Semi Condensed y pesos 600–700 da titulares compactos con aire de rotulación técnica de plano; en Barlow 400–500 el texto corrido es limpio y amable.

Carga con `next/font/google`: `Barlow` (400, 500, 600, 700) y `Barlow_Semi_Condensed` (500, 600, 700), expuestas como `--font-sans-stack` y `--font-display-stack`.

### Hierarchy
- **Display** (700, clamp(2.75rem → 5rem), 1.0): solo titular del hero de la landing y cifras-héroe. Máximo 2 líneas.
- **Headline** (600, clamp(1.75rem → 2.5rem), 1.1): títulos de sección en landing y título de página en dashboard ("Proyectos", "Facturación").
- **Title** (Barlow 600, 1.125rem, 1.3): títulos de tarjeta, encabezados de panel, texto de botones.
- **Body** (400, 1rem, 1.6): texto corrido de landing, máximo 65ch por línea.
- **Body Small** (400, 0.875rem, 1.5): texto por defecto del dashboard, tablas, descripciones de formularios.
- **Label** (Semi Condensed 600, 0.75rem, tracking 0.08em, MAYÚSCULAS): eyebrows de sección, encabezados de tabla, chips, metadatos.
- **Mono** (JetBrains Mono 500, 0.8125rem, `font-variant-numeric: tabular-nums`): áreas (m²), cotas, dimensiones, precios en tablas.

### Named Rules
**The Condensed-For-Headlines Rule.** Semi Condensed solo en display, headline y label. Párrafos y controles de formulario siempre en Barlow normal.

**The Measured Numbers Rule.** Toda cifra técnica (medida, área, coordenada) va en mono con números tabulares, para que las columnas se alineen como en un plano.

## Layout

- **Contenedor landing:** máx. 1200px, padding lateral 24px (móvil) / 32px (≥768px). Ritmo vertical entre secciones de 96px (64px en móvil).
- **Retícula landing:** 12 columnas, gutter 24px. El hero asimétrico: texto en 6–7 columnas, visual del modelo 3D en las restantes, sangrando hacia el borde.
- **Dashboard:** sidebar fija de 248px (colapsable a 64px solo iconos), header de 56px, contenido con padding de 24–32px y máx. 1280px. Rejilla de tarjetas de proyecto `repeat(auto-fill, minmax(280px, 1fr))` con gap de 16px.
- **Densidad del dashboard:** filas de tabla e ítems de sidebar de 40px; inputs y botones de 40px (36px en barras de herramientas).
- **Escala de espaciado:** múltiplos de 4px (4, 8, 12, 16, 24, 32, 48, 64, 96).
- **Breakpoints:** 640px (sm), 768px (md), 1024px (lg; aparece sidebar fija), 1280px (xl).
- **Móvil:** la sidebar se convierte en drawer desde la izquierda sobre Abyss Navy; las tablas pasan a lista de tarjetas.

## Elevation & Depth

Profundidad por **capas tonales** con bordes de 1px: cada nivel sube un paso de superficie (canvas → surface → surface-2 → surface-3). Las sombras son mínimas y solo aparecen en elementos flotantes (menús, popovers, modales) o como respuesta a estado.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 12px 32px -8px rgb(4 24 64 / 0.45)`): menús desplegables, popovers, paleta de comandos.
- **Modal** (`box-shadow: 0 24px 64px -12px rgb(4 24 64 / 0.6)`): diálogos.
- **Sky Glow** (`box-shadow: 0 0 0 1px rgb(46 167 242 / 0.4), 0 8px 24px -6px rgb(46 167 242 / 0.35)`): hover del botón primario en la landing y tarjeta de plan destacado.
- **Light Lift** (`box-shadow: 0 1px 2px rgb(4 24 64 / 0.06), 0 4px 12px -4px rgb(4 24 64 / 0.08)`): hover de tarjetas en tema claro.

### Named Rules
**The Flat-By-Default Rule.** Las superficies están planas en reposo. Las sombras aparecen solo al flotar o al responder a hover/foco.

**The Blueprint Texture Rule.** La retícula técnica (24px fina, 96px mayor, líneas al 45–60% de `--line`) es la única textura de fondo permitida. En el hero puede desvanecerse con una máscara radial y un halo sutil de Glacier Cyan al 8–12%.

## Shapes

Esquinas suavemente redondeadas y precisas, nunca "burbuja": 6px en inputs y chips cuadrados, 8px en botones, 12px en tarjetas y paneles, pill (999px) solo para chips de estado y avatares. Bordes de 1px en todo contenedor. Los iconos son de trazo (1.5px, estilo Lucide) a 16/20px. Detalles de plano permitidos: marcas de cota, esquinas de registro (pequeñas escuadras de 8px en las esquinas del visual del hero) y líneas de medida punteadas en Survey Sky.

## Components

### Buttons
Precisos y seguros; se sienten como una herramienta, no como un juguete.
- **Shape:** esquinas suaves (8px), altura 40px (36px en toolbars), texto Barlow 600 a 0.9375rem.
- **Primary:** relleno Survey Sky, texto Abyss Navy. Uno por vista.
- **Hover / Focus:** hover a Glacier Cyan con transición de 150ms `cubic-bezier(0.2, 0, 0, 1)`; en la landing añade Sky Glow. Foco: anillo 2px Survey Sky con offset 2px. Active: `translateY(1px)`.
- **Secondary:** superficie (`--surface-2`) con borde 1px `--line-strong` y texto `--ink`; hover sube a `--surface-3`.
- **Ghost:** sin fondo, texto `--accent`; hover con fondo `--accent-soft`.
- **Destructive:** texto/borde `--danger`, relleno solo en confirmación final.

### Chips
- **Style:** pill, Label en mayúsculas, fondo `--accent-soft`, texto Glacier Cyan (oscuro) o Sky Ink (claro).
- **State:** inactivos con borde 1px `--line` y texto `--ink-muted`. Chips de fase pendiente ("Fase 9") en `--surface-3` con texto `--ink-subtle`.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** `--surface` (Deep Navy / Paper White).
- **Shadow Strategy:** plana; hover de tarjeta de proyecto sube el borde a `--line-strong` y, en claro, aplica Light Lift.
- **Border:** 1px `--line`.
- **Internal Padding:** 24px (16px en tarjetas compactas del dashboard).
- **Tarjeta de proyecto:** miniatura 16:10 sobre `--surface-2` con retícula, título en Title, metadatos en Label y área en Mono.

### Inputs / Fields
- **Style:** 40px de alto, radio 6px, fondo `--canvas` (oscuro) o Paper White (claro), borde 1px `--line-strong`, texto Body Small.
- **Focus:** borde Survey Sky + anillo exterior de 3px Survey Sky al 25%.
- **Error / Disabled:** borde y mensaje en `--danger`; deshabilitado con opacidad 0.5 y cursor `not-allowed`.
- **Labels:** encima del campo, Barlow 500 a 0.875rem en `--ink-muted`.

### Navigation
- **Landing header:** 64px, fondo Abyss Navy al 80% con `backdrop-filter: blur(12px)` y borde inferior 1px `--line` al hacer scroll. Enlaces Barlow 500 en Dark Ink Muted, hover a Drafting Mist; CTA primaria a la derecha.
- **Sidebar del dashboard:** fondo `--surface`, borde derecho 1px. Ítems de 40px, icono 20px + Barlow 500. Activo: fondo `--accent-soft`, texto `--ink` y barra indicadora izquierda de 2px Survey Sky. Hover: `--surface-2`. Encabezados de grupo en Label.
- **Móvil:** menú hamburguesa que abre drawer navy a pantalla completa en la landing; drawer lateral en el dashboard.

### Hero de plano (Signature Component)
El hero de la landing: fondo Abyss Navy con retícula técnica enmascarada, halo radial Glacier Cyan muy tenue, eyebrow en Label Survey Sky, titular Display en Drafting Mist (una palabra clave puede ir en Survey Sky), y a la derecha el render del modelo 3D con esquinas de registro y una línea de cota animada en Survey Sky que "mide" el edificio al cargar (600ms, una sola vez, respetando `prefers-reduced-motion`).

## Do's and Don'ts

### Do:
- **Do** usar Abyss Navy como fondo de toda la landing y del dashboard oscuro; Drafting Mist como fondo del dashboard claro.
- **Do** reservar Survey Sky para la acción principal, el foco y las medidas destacadas (The One Light Rule).
- **Do** usar Sky Ink para cualquier texto de acento en tema claro.
- **Do** consumir solo tokens semánticos (`--canvas`, `--surface`, `--ink`, `--accent`…) para que ambos temas funcionen sin código duplicado.
- **Do** escribir titulares en Barlow Semi Condensed 600–700 y cifras técnicas en mono tabular.
- **Do** mantener bordes de 1px y profundidad por capas tonales.
- **Do** respetar `prefers-reduced-motion` en toda animación; transiciones de UI entre 150–250ms.

### Don't:
- **Don't** usar negro puro, grises neutros sin tinte azul ni fondos blancos puros como lienzo (el lienzo claro es Drafting Mist).
- **Don't** poner texto Survey Sky o Glacier Cyan sobre fondos claros.
- **Don't** introducir colores fuera de la paleta (morados, verdes de marca, degradados arcoíris); los colores de estado son solo para estados.
- **Don't** mezclar Survey Sky y Glacier Cyan como rellenos contiguos en un mismo control.
- **Don't** usar Barlow Semi Condensed en párrafos ni en campos de formulario.
- **Don't** usar sombras grandes en tarjetas en reposo ni glassmorphism decorativo fuera del header.
