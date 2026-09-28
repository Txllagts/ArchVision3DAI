# 3. Guía de desarrollo

Guía para que un miembro nuevo del equipo pueda instalar el proyecto, entender cómo está organizado y hacer su primer cambio.

## Contenido

1. [Stack tecnológico](#31-stack-tecnológico)
2. [Requisitos](#32-requisitos)
3. [Instalación paso a paso](#33-instalación-paso-a-paso)
4. [Base de datos local sin Supabase](#34-base-de-datos-local-sin-supabase)
5. [Estructura del monorepo](#35-estructura-del-monorepo)
6. [Arquitectura del editor](#36-arquitectura-del-editor)
7. [API REST](#37-api-rest)
8. [Flujo de trabajo con Git](#38-flujo-de-trabajo-con-git)
9. [Pruebas, typecheck y CI](#39-pruebas-typecheck-y-ci)
10. [Recetas: cómo extender el editor](#310-recetas-cómo-extender-el-editor)
11. [Convenciones de código](#311-convenciones-de-código)
12. [Solución de problemas](#312-solución-de-problemas)

---

## 3.1 Stack tecnológico

| Capa | Tecnología |
|------|------------|
| Frontend y API | **Next.js 15** (App Router), React 19, TypeScript estricto, Tailwind CSS |
| 3D | **Three.js** con **React Three Fiber** y `@react-three/drei` (`OrbitControls`) |
| Estado del editor | **Zustand** (`apps/web/src/lib/editor/store.ts`) |
| Validación | **Zod**, con esquemas compartidos entre cliente y servidor |
| Base de datos | **PostgreSQL** en **Supabase**, con **Prisma 6** como ORM |
| Pruebas | **Vitest** |
| Monorepo | **pnpm workspaces** |
| Pagos | Wompi (Colombia), con un proveedor `manual` para desarrollo |
| Asistente | Motor local (`ASSISTANT_PROVIDER=local`) u opcionalmente Claude (`ANTHROPIC_API_KEY`) |

## 3.2 Requisitos

- **Node.js ≥ 20.11.** Probado con Node 22 y 24.
- **pnpm 11.** El `package.json` fija `pnpm@11.18.0`. Si no tienes pnpm, usa Corepack, que viene con Node:
  ```bash
  corepack enable      # en Windows puede requerir una terminal como administrador
  corepack pnpm -v     # alternativa sin permisos: anteponer "corepack" a cada comando
  ```
- **Git.**
- **Una base de datos PostgreSQL:** el proyecto de Supabase del equipo o una base local (ver [3.4](#34-base-de-datos-local-sin-supabase)).

## 3.3 Instalación paso a paso

```bash
# 1. Clonar y entrar a la rama de trabajo
git clone https://github.com/Txllagts/ArchVision3DAI.git
cd ArchVision3DAI
git checkout Develop

# 2. Instalar dependencias
pnpm install

# 3. Variables de entorno
cp .env.example .env
# Edita .env: DATABASE_URL, DIRECT_URL y AUTH_SECRET como mínimo

# 4. Generar un AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 5. Cliente de Prisma y esquema
pnpm db:generate
pnpm db:push        # crea las tablas (ver la nota de abajo)
pnpm db:seed        # usuario demo y 3 proyectos de ejemplo

# 6. Servidor de desarrollo
pnpm dev            # http://localhost:3000
```

> ⚠️ **Usa `pnpm db:push`, no `pnpm db:migrate` ni `pnpm db:deploy`.** Las migraciones de `packages/database/prisma/migrations` se generaron para SQLite y fallan contra PostgreSQL con el error `P3019`. Ver [Problemas conocidos](04-problemas-conocidos.md#1-migraciones-de-prisma-en-sqlite).

> ⚠️ `.env` está en `.gitignore`. **Nunca lo subas al repositorio** y no compartas las claves de Supabase por chat.

### Variables de entorno principales

| Variable | Obligatoria | Descripción |
|----------|-------------|-------------|
| `DATABASE_URL` | Sí | Conexión de la aplicación. En Supabase es el Transaction Pooler (puerto 6543, con `?pgbouncer=true`) |
| `DIRECT_URL` | Sí | Conexión directa para Prisma CLI. En Supabase es el Session Pooler (puerto 5432) |
| `AUTH_SECRET` | Sí | Secreto de al menos 32 caracteres para firmar las sesiones |
| `SESSION_TTL_DAYS` | No | Duración de la sesión en días (30 por defecto) |
| `STORAGE_DRIVER` | No | `local` (por defecto, guarda en `./storage`), `s3` o `supabase` |
| `BILLING_PROVIDER` | No | `manual` (desarrollo) o `wompi` |
| `ASSISTANT_PROVIDER` | No | `local` o `claude`. Con `claude` se necesita `ANTHROPIC_API_KEY` |
| `NEXT_PUBLIC_APP_NAME` | No | Nombre comercial que muestra la interfaz |

`apps/web/next.config.ts` carga el `.env` de la **raíz** del monorepo. No crees un `.env` dentro de `apps/web`.

## 3.4 Base de datos local sin Supabase

Para trabajar sin tocar la base compartida del equipo, hay dos opciones.

**Opción A: Docker.** El repositorio incluye `docker-compose.yml` con PostgreSQL 16, Redis y MinIO:

```bash
docker compose up -d postgres
```

```env
DATABASE_URL="postgresql://archvision:archvision@localhost:5432/archvision"
DIRECT_URL="postgresql://archvision:archvision@localhost:5432/archvision"
```

**Opción B: sin Docker.** El paquete npm `embedded-postgres` descarga un PostgreSQL portátil. Úsalo en una carpeta **fuera del repositorio**:

```bash
mkdir ~/pg-local && cd ~/pg-local
npm init -y && npm i embedded-postgres
```

```js
// start.mjs
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";

const pg = new EmbeddedPostgres({
  databaseDir: "./data",
  user: "postgres",
  password: "postgres",
  port: 54329,
  persistent: true,
});
if (!fs.existsSync("./data")) await pg.initialise();
await pg.start();
try { await pg.createDatabase("archvision"); } catch {}
console.log("PostgreSQL listo en el puerto 54329");
```

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:54329/archvision"
DIRECT_URL="postgresql://postgres:postgres@localhost:54329/archvision"
```

Después ejecuta `pnpm db:push` y `pnpm db:seed`. Las capturas de la [Guía de uso](02-guia-de-uso.md) se tomaron con esta opción.

## 3.5 Estructura del monorepo

```
ArchVision3DAI/
├── apps/
│   └── web/                         Next.js: landing, dashboard, API REST y editor
│       └── src/
│           ├── app/
│           │   ├── (auth)/          /login, /register
│           │   ├── (app)/           /dashboard, /projects, /settings, /trash
│           │   ├── (editor)/        /projects/[id]/editor
│           │   └── api/             Rutas REST (ver 3.7)
│           ├── components/
│           │   ├── editor/          Visores 2D/3D, barras, paneles, inspector
│           │   ├── projects/        Tarjetas, formularios, versiones
│           │   ├── billing/         Planes y facturación
│           │   └── ui/              Botones, campos y superficies base
│           └── lib/
│               ├── editor/          store.ts (Zustand), atajos, autoguardado
│               ├── auth/            Sesiones, contraseñas, guards
│               ├── projects/        Servicios de proyecto, escena y archivos
│               ├── storage/         Almacenamiento de archivos y detección de tipo
│               ├── billing/         Proveedores de pago
│               └── assistant/       Conexión del asistente con Claude
└── packages/
    ├── types/          Contratos: entidades, SceneDocument, comandos
    ├── validation/     Esquemas Zod (cliente y servidor)
    ├── shared/         Reducer de comandos, unidades, habitaciones, bounds, casa demo
    ├── geometry/       Geometría pura: paredes con vanos, losas, cubiertas, escaleras
    ├── three-engine/   Materiales PBR, texturas procedurales, snapping, encuadres
    ├── vision/         Detección de muros en planos (Otsu, Hough)
    ├── assistant/      Intenciones, planificador, diagnósticos, tutorial
    ├── billing/        Periodos, derechos por plan, firmas de webhooks
    ├── config/         Marca, límites y precios
    └── database/       Esquema Prisma, cliente y seed
```

**Regla de dependencias:** los paquetes de `packages/` **no importan nada de `apps/web`**. `types` no depende de nadie. `geometry` y `shared` son funciones puras sin React. Solo `apps/web` conoce React y Next.

Los paquetes se publican como TypeScript sin compilar. Next los transpila gracias a `transpilePackages` en `next.config.ts`. **Si creas un paquete nuevo, agrégalo a esa lista.**

## 3.6 Arquitectura del editor

El modelo es un único documento JSON, `SceneDocument` (`packages/types/src/scene.ts`), con listas de `floors`, `walls`, `doors`, `windows`, `rooms`, `roofs`, `slabs`, `stairs`, `columns`, `furniture` y `materials`.

**Toda modificación pasa por un comando.** Ningún componente modifica la escena directamente.

```
Interacción (clic, arrastre, asistente)
   │
   ▼
store.dispatch(command)                 apps/web/src/lib/editor/store.ts
   │  valida con sceneCommandSchema     packages/validation/src/commands.ts
   ▼
applyCommand(scene, command)            packages/shared/src/command-reducer.ts
   │  devuelve la escena nueva y su comando inverso (para deshacer)
   ▼
Visores 2D y 3D se vuelven a renderizar  viewport-2d.tsx / viewport-3d.tsx
   │  las geometrías se memorizan por hash de parámetros (geometryCache)
   ▼
useAutosave → PUT /api/projects/{id}/scene con expectedRevision
```

**Estado de la interfaz frente a estado del modelo:**

| Vive en `SceneDocument` (se guarda) | Vive solo en el store (no se guarda) |
|-------------------------------------|--------------------------------------|
| Entidades, posiciones, materiales, visibilidad y bloqueo | Herramienta activa (`ToolId`), selección, hover, paneles abiertos, modo de vista, cámara |

### Archivos clave del editor

| Archivo | Responsabilidad |
|---------|-----------------|
| `lib/editor/store.ts` | Estado global: escena, historial de deshacer/rehacer, herramienta, selección y paneles |
| `lib/editor/use-shortcuts.ts` | Atajos de teclado |
| `lib/editor/use-autosave.ts` | Guardado con *debounce* y control de revisión |
| `components/editor/editor-shell.tsx` | Composición del editor |
| `components/editor/toolbar.tsx` | Lista `TOOLS` de la barra izquierda |
| `components/editor/viewport-2d.tsx` | Planta en SVG: dibujo, snapping, marquee y pan |
| `components/editor/viewport-3d.tsx` | Canvas R3F: `OrbitControls`, plano de trabajo, arrastre, giro y marquee por frustum |
| `components/editor/scene-objects.tsx` | Una malla por tipo de entidad (`WallObject`, `RoomFloorObject`…) con picking |
| `components/editor/inspector.tsx` | Propiedades y giro por incrementos |
| `components/editor/command-palette.tsx` | Acciones de `Ctrl+K` |
| `components/editor/status-bar.tsx` | `TOOL_HINTS`: la ayuda de cada herramienta |

Más detalle en [`EDITOR.md`](../EDITOR.md) y [`SELECTION_AND_TRANSFORMS.md`](../SELECTION_AND_TRANSFORMS.md).

## 3.7 API REST

Todas las rutas están en `apps/web/src/app/api/`. Las que tocan proyectos exigen sesión (`lib/api/auth-guard.ts`) y validan el cuerpo con Zod.

| Método y ruta | Uso |
|---------------|-----|
| `POST /api/auth/register` · `login` · `logout`, `GET /api/auth/me` | Autenticación con cookie de sesión |
| `GET, POST /api/projects` | Listar y crear proyectos |
| `GET, PATCH, DELETE /api/projects/{id}` | Leer, editar y enviar a la papelera |
| `POST /api/projects/{id}/restore` · `duplicate` | Restaurar y duplicar |
| `GET, PUT /api/projects/{id}/scene` | Leer y guardar el `SceneDocument` (con `expectedRevision`) |
| `GET, POST /api/projects/{id}/versions` | Historial de versiones |
| `GET, POST /api/projects/{id}/files` y `/files/{fileId}` | Archivos del proyecto, como los planos |
| `POST /api/projects/{id}/assistant` | Asistente |
| `/api/billing/checkout` · `subscription` · `renewals` · `webhook/{provider}` | Facturación |
| `GET /api/health` | Comprobación de estado |

Referencia completa: [`API.md`](../API.md).

## 3.8 Flujo de trabajo con Git

### Ramas

```
main  ◄── Pre-release  ◄── Develop  ◄── ramas de trabajo (Backend-Ia, Frontend-y-ui, feature/…)
```

| Rama | Uso |
|------|-----|
| `main` | Estable. Solo recibe merges por *pull request* desde `Pre-release` |
| `Pre-release` | Integración antes de pasar a `main` |
| `Develop` | Rama de desarrollo común |
| `Backend-Ia`, `Frontend-y-ui` | Ramas por área |

### Pasos para hacer un cambio

```bash
git checkout Develop && git pull
git checkout -b feature/mi-cambio
# ... trabajar ...
pnpm typecheck && pnpm test
git add <archivos>
git commit -m "feat(editor): descripción corta en imperativo"
git push -u origin feature/mi-cambio
# Abrir un pull request hacia Develop en GitHub
```

### Mensajes de commit

Usa [Conventional Commits](https://www.conventionalcommits.org/): `tipo(ámbito): descripción`.

| Tipo | Cuándo |
|------|--------|
| `feat` | Funcionalidad nueva |
| `fix` | Corrección de un error |
| `docs` | Solo documentación |
| `refactor` | Cambio interno sin cambiar el comportamiento |
| `test` | Pruebas |
| `chore` / `ci` | Configuración, dependencias, CI |

Ejemplos del repositorio: `fix(storage): handle potential undefined index in readUInt32BE`, `fix(ci): add missing storage modules and fix .gitignore`.

**Recomendación:** un commit por cambio lógico. Por ejemplo, `a395906` mezcla tres cambios (herramienta de vista, suelos y eliminación de la página *Equipo*). Separados, sería más fácil revisarlos y revertirlos.

## 3.9 Pruebas, typecheck y CI

```bash
pnpm typecheck                         # TypeScript estricto en todos los paquetes
pnpm test                              # Vitest en todos los paquetes
pnpm --filter @archvision/shared test  # un solo paquete
pnpm build                             # compilación de producción
```

Estado en `Develop` (`a395906`) el 27/09/2026:

| Paquete | Pruebas |
|---------|---------|
| `billing` | ✅ 35 |
| `validation` | ✅ 10 |
| `vision` | ✅ 10 |
| `shared` | ✅ 40 |
| `assistant` | ✅ 23 |
| `geometry` | ✅ 13 |
| `three-engine` | ❌ 18 de 19. Ver [Problemas conocidos](04-problemas-conocidos.md#2-prueba-fallida-en-three-engine) |
| **typecheck** | ✅ Sin errores |

**CI** (`.github/workflows/ci.yml`) se ejecuta en cada *push* a `main` y en cada *pull request*. Instala dependencias, genera Prisma y ejecuta `typecheck`, `test` y `build`. **Un PR con pruebas en rojo no debe mezclarse.**

Las pruebas viven junto al código (`*.test.ts`) y cubren la lógica pura: el reducer de comandos, la geometría, los bounds, la visión y la facturación. Los componentes React no tienen pruebas automáticas. Si cambias un visor, pruébalo a mano en el navegador.

## 3.10 Recetas: cómo extender el editor

### Añadir una herramienta a la barra

El commit `a395906` sirve de ejemplo: agregó la herramienta `pan`.

1. **`lib/editor/store.ts`:** añade el identificador al tipo `ToolId`.
2. **`components/editor/toolbar.tsx`:** añade una entrada a `TOOLS` con `id`, `label`, `shortcut` y un icono de `lucide-react`.
3. **`lib/editor/use-shortcuts.ts`:** añade un `case` con la tecla dentro del `switch`. Comprueba que la tecla no esté ya ocupada.
4. **`components/editor/command-palette.tsx`:** añade la acción a la paleta.
5. **`components/editor/status-bar.tsx`:** añade la ayuda en `TOOL_HINTS`.
6. **Visores:** en `viewport-2d.tsx` y `viewport-3d.tsx`, maneja `tool === "mi-herramienta"` en `onPointerDown`. En 3D, ajusta también el cursor y los `mouseButtons` de `OrbitControls` si hace falta.

### Añadir un tipo de entidad seleccionable

Sigue los 7 pasos de [`SELECTION_AND_TRANSFORMS.md` → *Agregar una clase seleccionable*](../SELECTION_AND_TRANSFORMS.md#agregar-una-clase-seleccionable). En resumen:

1. Tipo en `packages/types/src/entities.ts`.
2. Esquema en `packages/validation`.
3. Bounds en `packages/shared/src/selectable-bounds.ts`.
4. Comando en `command-reducer.ts`.
5. Geometría en `packages/geometry`.
6. Malla en `scene-objects.tsx`.
7. Pruebas.

### Añadir un comando

1. Tipo en `packages/types/src/commands.ts`.
2. Esquema Zod en `packages/validation/src/commands.ts`.
3. Caso en `applyCommand` (`packages/shared/src/command-reducer.ts`). Debe devolver la escena nueva y el **comando inverso**, que permite deshacer.
4. Prueba en `packages/shared/src/editor.test.ts`.

### Añadir un material al catálogo

Edita `packages/shared/src/material-catalog.ts`. Usa un `pattern` existente de `three-engine/src/patterns.ts` o crea uno nuevo. Los patrones nuevos deben cerrar sin costura; `textures.test.ts` lo comprueba.

### Cambiar el esquema de base de datos

1. Edita `packages/database/prisma/schema.prisma`.
2. Ejecuta `pnpm db:generate` y `pnpm db:push` contra tu base **local**.
3. Coordina con el equipo antes de aplicarlo en Supabase.

## 3.11 Convenciones de código

- **Idioma:** la interfaz, los comentarios y la documentación están en español. Los identificadores de código están en inglés (`createWallGeometry`, `RoomFloorObject`).
- **TypeScript estricto.** No uses `any`. Los contratos compartidos van en `packages/types`.
- **Inmutabilidad:** el reducer nunca muta la escena; siempre devuelve objetos nuevos.
- **Unidades:** todo se expresa en **metros** y **radianes** internamente. La conversión a otras unidades solo ocurre en la interfaz (`packages/shared/src/units.ts`).
- **Coordenadas:** en planta, `Vector2 { x, y }`. En Three.js, la `y` de planta es el eje `z`, y la `y` de Three.js es la altura.
- **Geometría pura:** las funciones de `packages/geometry` no dependen de React ni del store, y sus resultados se memorizan en `geometryCache` con una clave que incluye todos los parámetros.
- **Funcionalidades pendientes:** se muestran deshabilitadas con la fase en la que llegan, nunca como enlaces rotos.

## 3.12 Solución de problemas

| Síntoma | Causa y solución |
|---------|------------------|
| `'pnpm' is not recognized` | pnpm no está instalado. Ejecuta `corepack enable` (como administrador) o usa `npm i -g pnpm@11` |
| `Error: P3019 ... migration_lock.toml, sqlite` | Las migraciones son de SQLite. Usa `pnpm db:push` |
| `P2021 ... table public.User does not exist` al hacer seed | El esquema no está aplicado. Ejecuta `pnpm db:push` antes de `pnpm db:seed` |
| `@prisma/client did not initialize yet` | Ejecuta `pnpm db:generate` |
| El editor abre con la escena vacía o no guarda | Revisa `DATABASE_URL` y la consola del servidor. El guardado usa `expectedRevision`: si otra pestaña guardó antes, recarga la página |
| El visor 3D va lento | La aceleración por hardware está desactivada en el navegador. La barra de estado muestra los FPS |
| Variables de entorno ignoradas | El `.env` debe estar en la raíz del monorepo, no en `apps/web` |
