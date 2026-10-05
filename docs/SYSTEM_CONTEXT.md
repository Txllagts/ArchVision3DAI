# Contexto del Sistema — ArchVision 3D AI

> Documento de contexto técnico generado para consumo por otra IA asistente.
> Raíz del repositorio: `C:\Users\SnAyD\ArchVision3DAI`
> Rama analizada: `Backend-Ia` (HEAD `45beb28`), árbol limpio.
> Fecha de análisis: 2026-10-02.

**Resumen en una línea:** monorepo TypeScript/Next.js completo y funcional (fases 1–7) con un contrato de pipeline de IA (Fase 8) **diseñado en documentación y anticipado en tipos/Prisma, pero sin una sola línea de implementación** (no existe código Python, ni cola, ni worker, ni InstantMesh/CUDA).

---

## 1. Arquitectura General y Stack Tecnológico

### 1.1 Topología actual

```
┌─────────────────────────────────────────────────────────────┐
│  apps/web  —  Next.js 15 (App Router)                       │
│  Frontend (React 19) + Backend (Route Handlers /api/*)      │
│  en UN SOLO proceso de Node.                                │
└──────────────┬──────────────────────────┬───────────────────┘
               │ Prisma 6 (ORM)           │ fetch / SDK
        ┌──────▼──────┐            ┌──────▼──────────────┐
        │ SQLite (dev)│            │ Anthropic (Claude)  │
        │ Postgres(prod)          │ Wompi (sandbox/prod) │
        └─────────────┘            └─────────────────────┘

  ┌──────────────────────────┐   ┌────────────────────────────┐
  │ docker-compose (opcional)│   │ apps/ai-service (FastAPI)  │
  │ postgres16, redis7,      │   │ >>> NO EXISTE AÚN <<<      │
  │ minio(S3), web           │   │ Cola BullMQ/Worker: NO     │
  └──────────────────────────┘   └────────────────────────────┘
```

No hay microservicio separado hoy: **frontend y backend son la misma aplicación Next.js**. La separación en servicios es diseño futuro.

### 1.2 Stack por capa

| Capa | Tecnología | Versión / notas |
|---|---|---|
| Lenguaje | TypeScript | `^5.7.3`, `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride` (`tsconfig.base.json`) |
| Gestor de paquetes | pnpm workspace | `packageManager: pnpm@11.18.0`; `apps/*` + `packages/*` (`pnpm-workspace.yaml`). ⚠️ CI usa pnpm 9 y README dice "pnpm 9+" (desalineado) |
| Runtime | Node | `>=20.11.0` (probado con 24; CI usa 22) |
| **Frontend** | Next.js 15 App Router + React 19 | `next ^15.1.6` (resuelto 15.5.23), `react ^19` |
| Estilos | Tailwind CSS 4 | v4 con `@tailwindcss/postcss` |
| Estado (cliente) | Zustand 5 | **un único store** de editor en `apps/web/src/lib/editor/store.ts` |
| **3D** | Three.js 0.172 + React Three Fiber 9 + Drei 10 | editor 2D en SVG puro |
| Validación | Zod 3 | frontera cliente/servidor, `^3.24.1` |
| **Backend principal** | Next.js Route Handlers (`src/app/api/**/route.ts`) | 19 archivos de ruta, 28 handlers; sin framework Express/Fastify |
| Base de datos | Prisma 6 + SQLite (dev) / PostgreSQL (prod) | esquema portable: sin enums nativos, sin arrays, sin `Json`, sin binarios |
| Auth | Sesión opaca propia (no NextAuth) | cookie `av_session`, token 32 bytes, solo SHA-256 en BD, bcrypt coste 12 |
| Pagos | Wompi + proveedor "manual" (simulado) | ciclo de suscripción implementado en la app |
| Asistente IA | `@anthropic-ai/sdk ^0.68.0` | opcional; degrada a motor local de reglas |
| Visión (planos) | `@archvision/vision` (TS puro) | Otsu + Hough, corre **en el navegador** |
| Tests | Vitest | ~150 tests en `packages/` (12 archivos) |
| Lint/format | `next lint` | `eslint.ignoreDuringBuilds: true` (no bloquea build) |
| CI | GitHub Actions `ci.yml` | `install → db:generate → typecheck → test → build` |
| Contenedores | Docker multi-etapa (raíz) + docker-compose | `node:22-alpine`; compose: postgres, redis, minio, web |

### 1.3 Microservicio de IA (FastAPI/Python)

**No existe.** Verificado:

- `**/*.py` en todo el repo → **0 archivos Python**.
- `apps/` contiene **solo `web`**. No hay `apps/ai-service/`, `pyproject.toml`, `requirements.txt` ni Dockerfile Python.
- Lo único que existe es **preparación huérfana**: `.gitignore` sección `# Python (ai-service)` (`__pycache__/`, `*.pyc`, `.venv/`), `.dockerignore` con `__pycache__`/`.venv`, y variables `.env`: `AI_SERVICE_URL=http://localhost:8000`, `AI_SERVICE_TOKEN=""`, `AI_MODE=mock`, `REDIS_URL` (comentada).
- Contratos ya escritos para consumir ese servicio: `packages/types/src/ai.ts` (`AIJob`, `AIJobStatus`, `Detection`, `ImageAnalysisResult`, `AI_JOB_STAGES`) y modelos Prisma `AIAnalysis` / `ExportJob`.
- Diseño completo del servicio en `docs/AI_PIPELINE.md` (estructura de carpetas, 6 endpoints, 6 etapas, cola BullMQ).

**InstantMesh / CUDA / PyTorch: cero menciones en todo el repositorio** (ni en `.md`, ni `.ts`, ni `.yml`, ni `.env`). Lo más cercano: `docs/AI_PIPELINE.md` describe un pipeline SfM/MVS genérico, y `docs/DEPLOYMENT.md` prevé "Servicio real con GPU" en producción.

---

## 2. Estructura de Carpetas

```
ArchVision3DAI/
├── package.json                 # scripts raíz: dev, build, typecheck, test, db:*, setup
├── pnpm-workspace.yaml          # apps/* + packages/*
├── tsconfig.base.json           # strict ES2022, moduleResolution Bundler
├── Dockerfile                   # multi-etapa: base → deps → builder → runner (puerto 3000)
├── docker-compose.yml           # postgres:16, redis:7 (sin consumidor), minio, web
├── .env / .env.example          # idénticos byte a byte → NO hay secretos reales en disco
├── .github/workflows/ci.yml     # verify: install → db:generate → typecheck → test → build
│
├── apps/
│   └── web/                     # Next.js 15: UI + API REST (13.743 líneas en src/)
│       └── src/
│           ├── app/                       # 2.322 l.  Rutas Next (App Router)
│           │   ├── page.tsx               # landing comercial (pública)
│           │   ├── (auth)/                # login, register (sin guarda; redirectIfAuthenticated)
│           │   ├── (app)/                 # dashboard, projects, settings, trash
│           │   │   └── layout.tsx         # requirePageUser() → guarda de TODO el grupo
│           │   ├── (editor)/              # pantalla completa; layout con requirePageUser()
│           │   │   └── projects/[id]/editor/page.tsx
│           │   └── api/                   # 19 route.ts, 28 handlers
│           │       ├── auth/              # login, register, logout, me
│           │       ├── projects/          # CRUD, restore, duplicate, scene, versions, assistant, files/*
│           │       ├── billing/           # checkout, subscription, webhook/[provider], renewals
│           │       └── health/            # SELECT 1 → 200/503
│           ├── components/                # 7.645 l.
│           │   ├── editor/                # 4.185 l. (55% de components): viewport-3d (1.303),
│           │   │                          # viewport-2d (1.026), inspector, scene-objects,
│           │   │                          # plan-import-panel, assistant-panel, materials-panel...
│           │   ├── billing/               # billing-manager, plan-cards, simulation-actions
│           │   ├── projects/, layout/, auth/, ui/, brand/
│           └── lib/                       # 3.776 l. lógica de servidor y hooks
│               ├── editor/                # store Zustand (509 l.), use-assistant, use-autosave,
│               │                          # use-shortcuts, underlay
│               ├── projects/              # service.ts (377), scene-service.ts (222),
│               │                          # file-service.ts (239) ⚠️ importa @/lib/storage INEXISTENTE
│               ├── billing/               # service.ts (537), providers/{manual,wompi,index,types}
│               ├── assistant/             # service.ts (145), claude.ts (136: SDK Anthropic)
│               ├── auth/                  # session.ts (cookie opaca), password.ts (bcrypt), guards.ts
│               ├── api/                   # response.ts ({data}/{error}), rate-limit.ts (en memoria)
│               └── env.ts                 # schema Zod de variables de entorno
│
├── packages/                    # exportan TS crudo ("main": "./src/index.ts"), sin build
│   ├── config/        (330 l.)  # marca, límites por plan, precios COP, política de uploads
│   ├── types/        (1.006 l.) # entidades arquitectónicas, SceneDocument, 21 comandos, contratos AI
│   ├── validation/    (893 l.)  # esquemas Zod: escena, comandos, auth, proyecto, billing
│   ├── shared/      (3.476 l.)  # núcleo del dominio: unidades, geometría 2D, command-reducer (665 l.),
│   │                             # rooms (grafo planar), catálogos, demo-house, metrics, migraciones
│   ├── vision/       (1.182 l.) # detección de muros: Otsu + Hough + trazado (TS puro, con tests)
│   ├── assistant/    (2.639 l.) # digest, 13 reglas de revisión, intents, builders, knowledge,
│   │                             # tutorial, planner local, prompt+tools para LLM (sin red)
│   ├── billing/       (943 l.)  # lógica pura: periods (UTC), entitlements (7 días gracia),
│   │                             # state machine, reference; signatures.ts (HMAC Wompi)
│   ├── geometry/     (1.153 l.) # BufferGeometry de Three: paredes con vanos (Shape+holes+Extrude),
│   │                             # losas, cubiertas, escaleras, columnas, cache (600 entradas)
│   ├── three-engine/ (1.445 l.) # MaterialLibrary PBR, 16 patrones procedurales (512px, DataTexture),
│   │                             # snapping (endpoint→midpoint→wall→axis→grid), vistas, entorno solar
│   └── database/     (1.277 l.) # schema.prisma (337 l., 16 modelos), seed.ts, scene-storage.ts
│
├── docs/
│   ├── ARCHITECTURE.md    # principios, diagrama de componentes, 21 decisiones registradas
│   ├── API.md             # contrato REST completo (éxito {data} / error {error{code,...}})
│   ├── DATABASE.md        # modelo de datos e índices
│   ├── EDITOR.md          # ciclo de comandos, rendimiento, estados "Implementado/Pendiente"
│   ├── PLAN_IMPORT.md     # pipeline de importación de planos (fase 5)
│   ├── ASSISTANT.md       # asistente, revisión, tutorial (fase 6)
│   ├── BILLING.md         # planes, suscripciones, cobros (fase 7)
│   ├── AI_PIPELINE.md     # DISEÑO del servicio Python + colas (no implementado)
│   ├── DEPLOYMENT.md      # entornos, variables, cron de renovaciones
│   ├── SELECTION_AND_TRANSFORMS.md
│   └── SYSTEM_CONTEXT.md  # este documento
└── packages/database/prisma/
    ├── schema.prisma      # 16 modelos
    ├── migrations/        # 0_init + 20260813153636_billing
    ├── seed.ts            # demo@archvision.app / arquitectura2026, 3 proyectos
    └── dev.db             # SQLite (gitignored)
```

**Grafo de dependencias internas** (`workspace:*`):

```
config ──────────────► billing
types  ─► validation, shared, vision, assistant, geometry, database
shared ─► assistant, geometry, three-engine, database
geometry ─► three-engine
```

`apps/web` consume los 10 paquetes. Solo `billing` expone subpath adicional: `./signatures` (usa `node:crypto`, no puede ir al navegador).

---

## 3. Flujos de Datos Principales (Pipelines)

### 3.1 Autenticación y autorización

1. `POST /api/auth/login` → rate-limit 10/10 min por IP → `fakeVerify()` si el correo no existe (anti-enumeración) → bcrypt compare (coste 12) → crea fila `Session` con `tokenHash = SHA-256(token)` → cookie `av_session` (httpOnly, sameSite=lax, secure en prod, TTL `SESSION_TTL_DAYS`=30).
2. En cada request, `getSessionUser()` lee la cookie, busca el hash en BD, borra la fila si caducó.
3. **No hay `middleware.ts`.** La guarda es por layout/ruta:
   - Server Components → `requirePageUser()` en `app/(app)/layout.tsx`, `app/(editor)/layout.tsx` y en cada página.
   - API → `requireApiUser()` en 27 de 28 handlers (la exceción es `GET /api/health`).
4. Autorización por pertenencia: `Workspace.members.some(m => m.userId === user.id)`; inexistente y ajeno devuelven el mismo 404.
5. Auditoría: `AuditEvent` en login y registro. `purgeExpiredSessions()` existe pero **nadie lo invoca** (se prevé como cron externo).

### 3.2 Ciclo de edición del modelo 3D (el pipeline central)

```
Interacción (viewport 2D/3D o atajo)
  → dispatch(SceneCommand)            # única puerta de mutación (store.ts)
  → sceneCommandSchema (Zod)          # validación en cliente
  → applyCommand() reducer puro       # packages/shared/command-reducer.ts (21 casos)
       · crea/actualiza entidades paramétricas
       · historial de instantáneas (máx. 80) para undo/redo
       · recalcula habitaciones SOLO en comandos estructurales
  → SceneDocument (fuente de verdad, metros y radianes, schema v1.2)
  → geometría Three.js DERIVADA y desechable
       packages/geometry (BufferGeometry) + three-engine (materiales/snapping)
  → autoguardado: debounce 1.200 ms → PUT /api/projects/:id/scene
       body ≤12 MB, expectedRevision → 409 si conflicto (optimistic locking)
```

- **Regla de arquitectura**: nunca se persiste un `Mesh`; en BD solo va `Scene.dataJson` (JSON serializado).
- Vista 2D = SVG; vista 3D = R3F; ambos visores se ocultan por CSS para no destruir el contexto WebGL.
- Carga: `GET .../scene` → `migrateScene()` en memoria → validación Zod → sincronización de catálogo de materiales. Si la fila no existe, se crea al vuelo.

### 3.3 Envío de imágenes / archivos

**Endpoint único de subida:** `POST /api/projects/:id/files` (multipart).

```
1. requireApiUser()                      → 401 si no hay sesión
2. rate-limit upload:{userId}            → 30/min
3. content-length > 60 MB                → 413 (tope duro servidor)
4. request.formData(): file, kind, role
     kind ∈ floorplan | photo | texture | model | render
     role ≤40 chars (front/back/roof/... desde config/uploads.ts)
5. saveProjectFile() (lib/projects/file-service.ts):
     a. archivo vacío                        → FileValidationError
     b. byteLength > planLimits(plan).maxUploadBytes → QuotaExceededError (402)
     c. suma total vs maxStorageBytes del plan        → QuotaExceededError
     d. sniff(data) por MAGIC BYTES: el tipo real manda
        sobre el declarado; discrepancia → rechazo
     e. MIME aceptado según kind (floorplan: png/jpeg/webp/pdf;
        photo: jpeg/png/webp; model: no admite nada)
     f. crear fila ProjectFile (storageKey:"") → storage().put(key, data)
        → actualizar storageKey + checksum(sha256); si falla, borrar la fila
```

**Almacenamiento:** `STORAGE_DRIVER = local | s3` (default `local`), `STORAGE_LOCAL_DIR=./storage`. ⚠️ **El módulo `@/lib/storage` y `@/lib/storage/sniff` NO existen en la rama actual** (`file-service.ts:4-5` los importa y no resuelve → el typecheck de `apps/web` falla con error TS2307). Esos archivos existen en las ramas `Develop`/`main` (commits `29bb443`, `0d25dc2`) pero no son ancestrales de `Backend-Ia`. No hay implementación S3 real en ninguna rama (solo filesystem local con guard antipath-traversal).

**Descarga:** `GET .../files/:fileId/content` → bytes autenticados con `Cache-Control: private`, `nosniff`, revalidando sesión y pertenencia en cada petición. **No hay URLs firmadas ni carpetas públicas.**

**Límites por plan** (`packages/config/src/limits.ts`):

| Plan | Proyectos | Almacenamiento | Subida máx. | IA/mes | Renders/mes | Versiones | Miembros |
|---|---:|---:|---:|---:|---:|---:|---:|
| free | 3 | 500 MB | 15 MB | 5 | 10 | 5 | 1 |
| pro | 50 | 20 GB | 50 MB | 100 | 300 | 50 | 3 |
| studio | 300 | 200 GB | 200 MB | 1.000 | 3.000 | 200 | 15 |
| enterprise | ∞ | ∞ | 1 GB | ∞ | ∞ | ∞ | ∞ |

Único subidor real hoy: `plan-import-panel.tsx` (kind=`floorplan`). El formulario de proyecto con `creationMethod: "photos"` muestra "Fase 7" y no sube nada.

### 3.4 Verificación de planes y créditos de usuario

1. El **plan efectivo se deriva SIEMPRE de la fila `Subscription`**, no de `User.plan` (`syncUserPlan()` en `lib/billing/service.ts`).
2. `entitlementOf(subscription, now)` (`packages/billing/src/entitlements.ts`) → `Entitlement{plan, limits, paid, graceDaysLeft, reason}` con motivos (`sin-suscripcion`, `activa`, `impago-en-gracia` con **`GRACE_DAYS = 7`**, `gracia-agotada`, `cancelada`, `periodo-vencido`).
3. Se recalcula **en el punto con consecuencia** (no hay middleware): crear proyecto (`QuotaExceededError` → HTTP **402 `QUOTA_EXCEEDED`**), subir archivo, crear versión.
4. Los límites viven en `packages/config/src/limits.ts` (precio e importe **nunca viajan desde el navegador**: `checkoutRequestSchema` solo admite plan + intervalo).
5. Estados: `incomplete → active → past_due → canceled` (+`trialing`); la baja conserva servicio hasta fin de periodo; periodos en UTC anclados al día de contratación.
6. Webhook: `POST /api/billing/webhook/[provider]` lee el **cuerpo crudo** antes de interpretar (firma sobre bytes), idempotencia por `@@unique([provider, externalId])` en `BillingEvent`, responde 200 también en repetidos.
7. Renovaciones: `POST /api/billing/renewals` protegido con `Authorization: Bearer $BILLING_CRON_SECRET` (`timingSafeEqual`), pensado para cron diario externo (`15 3 * * * curl ...`).
8. **Créditos de IA (`aiAnalysesPerMonth`)**: están declarados en los límites y existe el campo `AIAnalysis.credits`, pero **ningún código los consume ni descuenta** — no hay aún ningún endpoint que cree análisis.

### 3.5 Sistema de colas (estado: SOLO DISEÑO)

**No hay ninguna cola implementada.** Hechos verificados:

- `bullmq`, `ioredis`, `redis` **no aparecen en `pnpm-lock.yaml` ni en ningún `package.json`**.
- **0 llamadas a `enqueue`/worker** en el código. No existe ninguna ruta `/api/jobs/*` ni `/api/projects/:id/analyze`.
- Los modelos Prisma `AIAnalysis` y `ExportJob` tienen `status` por defecto `"queued"` e índice `AIAnalysis(projectId, status)`, pero **0 escrituras en el código** (tablas huérfanas, listas para usar).
- `docker-compose.yml` levanta `redis:7-alpine` y `web` declara `depends_on: redis (service_healthy)` **sin que nada lo consuma**.
- El rate-limiter actual es **en memoria** (`Map` en `lib/api/rate-limit.ts`, `MAX_TRACKED_KEYS=10.000` con `buckets.clear()` global); comentario explícito: *"en producción multi-instancia se sustituye por Redis manteniendo esta misma firma"*.

**Diseño previsto** (`docs/AI_PIPELINE.md` y `docs/ARCHITECTURE.md`):

```
Subida de fotos → Crear job (AIAnalysis) → Cola (Redis + BullMQ)
  → Worker (Node) → apps/ai-service (FastAPI)
      etapas: normalizing → detecting → segmenting → depth → geometry → materials → done
  → guardar progreso en AIAnalysis (progress/stage/resultJson)
  → progreso por WebSocket o sondeo
  → visor de detecciones en el editor (revisión humana)
  → confirmación del usuario → SceneDocument (entidades paramétricas)
```

### 3.6 Comunicación con el entorno 3D / pipeline de IA real

**Regla transversal:** la IA **propone**, el usuario **dispone**. Toda salida de IA se convierte en `SceneCommand` validado por Zod; nunca se persiste una malla cruda. Cada entidad admite `source: "user"|"ai"|"import"` y `confidence` (0–1; UI prevista: verde ≥0.8, ámbar ≥0.5, rojo <0.5).

**Pipeline 1 — Detección de muros en planos (IMPLEMENTADO, en el navegador):**

```
ImageData (subida) → toGrayscale → downscale(maxSide=1200)
  → otsuThreshold → binarize → removeSmallComponents
  → Hough (acumula TODA la tinta, no solo bordes) → dominantAngle
  → extractLines(±k·90°) → traceSegments(banda 6px) → snapToAxes
  → mergeSegments → alignWalls (cierra esquinas)
  → px→m (pixelsPerMeter calibrado por el usuario con una cota)
  → DetectionReport{walls[{start,end,thickness,confidence}], ...}
  → UI acepta/rechaza → emite CREATE_WALL con origin:"import"
```

Parámetros: `minWallLength` 0.5 m, `maxWallThickness` 0.6 m, tolerancia de eje 6°, `weldDistance` 0.25 m, umbral de confianza 0.6. Precisión ~1% de la longitud del muro. **No** reconoce puertas/ventanas ni lee cotas (eso está reservado al servicio Python futuro). **0 llamadas HTTP de visión.**

**Pipeline 2 — Asistente conversacional (IMPLEMENTADO):**

```
POST /api/projects/:id/assistant (rate-limit 20/min, body ≤256 KB)
  → cliente: planLocally()  [reglas puras de packages/assistant sobre la escena en memoria]
      · solo si local.fallback === true fuerza guardado y llama al servidor
  → servidor: planLocally() de nuevo
      · si turn.fallback && isModelConfigured()
            → askModel()  (lib/assistant/claude.ts, SDK Anthropic)
                · ASSISTANT_PROVIDER = local | claude (default local; sin API key degrada a local)
                · ASSISTANT_MODEL (default "claude-opus-5"), max_tokens 2048, historia ≤12 msgs
                · 11 tools con strict:true (crear_habitacion, crear_vano, aplicar_material, ...)
                · executeTool() corre en CÓDIGO, no en el modelo → el LLM elige operación+medidas,
                  builders.ts pone identificadores y coordenadas
      · si el proveedor falla → se queda la respuesta del motor local
  → validateActions() [Zod]: un comando inválido descarta la acción ENTERA (rejected)
  → frontend: dispatchBatch() → UN solo Ctrl+Z para toda la propuesta
```

El paquete `packages/assistant` **no contiene ninguna llamada de red** (puro); la única llamada a un LLM del sistema está en `apps/web/src/lib/assistant/claude.ts`.

**Pipeline 3 — Reconstrucción desde fotografías (DISEÑADO, NO IMPLEMENTADO):** ver §3.5 y `docs/AI_PIPELINE.md`. Etapas diseñadas: normalización → detección de elementos → segmentación semántica → profundidad monocular → geometría (planos dominantes, líneas de fuga) → SfM/MVS/nube de puntos/malla → **"paso crítico y no negociable": convertir la malla en `Wall`/`Window`/`Door`/`Slab`/`Roof` editables**. Escala absoluta requiere ≥1 medida real (calibración), con estimación de precisión Alta/Media/Baja.

### 3.7 Contrato REST

- Base `/api`; éxito `{ "data": ... }`; error `{ "error": { code, message, details? } }` vía `withErrorHandling()`.
- Códigos: `BAD_REQUEST` 400, `UNAUTHORIZED` 401, `QUOTA_EXCEEDED` **402**, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `PAYLOAD_TOO_LARGE` 413, `RATE_LIMITED` 429, `INTERNAL` 500.
- 19 archivos `route.ts`: `auth/*` (4), `projects/*` (10: CRUD, restore, duplicate, scene GET/PUT, versions GET/POST, assistant GET/POST, files GET/POST, files/[id] DELETE, files/[id]/content GET), `billing/*` (4), `health` (1).
- **Endpoints previstos sin implementar:** `POST /api/projects/:id/analyze`, `GET /api/jobs/:id` (Fase 8), `POST .../export` (Fase 9), `POST .../share` (Fase 11), WebSocket de progreso.

---

## 4. Modelos de Datos / Entidades

### 4.1 Prisma (`packages/database/prisma/schema.prisma`) — 16 modelos

SQLite en dev / PostgreSQL en prod. **Sin enums nativos** (campos `String` validados por Zod), **sin arrays ni `Json`** (JSON en `String`), **sin binarios** (solo `storageKey`). UUID v4 en todo.

| Modelo | Campos clave | Relaciones |
|---|---|---|
| **User** | `email @unique`, `passwordHash`, `role` (USER/PROFESSIONAL/ADMIN), `plan` ("free" default), `emailVerifiedAt?`, `preferences` (JSON string) | 1:N sessions, projects, versions, auditEvents, payments; 1:1 subscription; N:1 workspaces (owner) |
| **Session** | `tokenHash @unique` (solo SHA-256; el plano va en la cookie), `expiresAt`, `userAgent?`, `ipAddress?` | N:1 User (Cascade) |
| **PasswordResetToken** | `tokenHash @unique`, `expiresAt`, `usedAt?` | N:1 User |
| **Workspace** | `name`, `slug @unique`, `usedBytes` (denormalizado para cuotas) | 1:N members, projects |
| **WorkspaceMember** | `role` (OWNER/ADMIN/EDITOR/VIEWER), `@@unique([workspaceId, userId])` | N:1 Workspace, N:1 User |
| **Project** | `name`, `type` (house/apartment/...), `units`, `creationMethod` (photos/floorplan/draw/empty), `status` (draft/processing/ready/error), `progress`, `floorsCount`, `floorHeight` (2.6), `sizeBytes`, **`deletedAt?`** (papelera) | N:1 Workspace+User; 1:1 scene; 1:N files, versions, analyses, exports, shares |
| **Scene** | `projectId @unique`, `schemaVersion` ("1.0" default; tipo real "1.2"), **`dataJson String`** (SceneDocument serializado), **`revision Int`** (optimistic locking) | N:1 Project |
| **ProjectFile** | `kind` (photo/floorplan/texture/model/render/export), `role?`, `originalName`, `mimeType`, `sizeBytes`, **`storageKey`**, `width?/height?`, `checksum?` | N:1 Project; 1:N analyses |
| **ProjectVersion** | `label`, `dataJson` (snapshot completo), `createdById?` | N:1 Project, N:1 User (SetNull) |
| **AIAnalysis** | `fileId?`, `kind` (analyze-image/analyze-floorplan/estimate-depth/reconstruct), **`status` default "queued"**, `progress`, `stage`, `resultJson?`, `error?`, `credits Int`, `startedAt?/finishedAt?` | N:1 Project, N:1 ProjectFile — **índice `(projectId, status)`, sin escrituras en código** |
| **ExportJob** | `format` (glb/gltf/obj/stl/json/png/jpg/pdf), `status` default "queued", `storageKey?`, `sizeBytes`, `error?` | N:1 Project — **sin escrituras en código** |
| **ShareLink** | `token @unique`, `visibility`, `passwordHash?`, `expiresAt?`, `revokedAt?` | N:1 Project |
| **AuditEvent** | `action`, `targetType?/targetId?`, `metaJson "{}"`, `ipAddress?` | N:1 User (SetNull) |
| **Subscription** | `userId @unique`, `plan` (pro/studio/enterprise), `status` (incomplete/trialing/active/past_due/canceled), `provider` (manual/wompi), `providerSubscriptionId?`, `interval` (month/year), `amountCents`, `currentPeriodStart/End`, `cancelAtPeriodEnd`, `cardBrand?/cardLast4?` | N:1 User (Cascade); 1:N payments |
| **Payment** | `providerPaymentId? @unique`, **`reference @unique`**, `status` (pending/approved/declined/voided/error/refunded), `amountCents`, `currency` ("COP"), `paidAt?` | N:1 User, N:1 Subscription (SetNull) |
| **BillingEvent** | `externalId`, `type`, `payloadJson`, `processedAt?`, **`@@unique([provider, externalId])`** (idempotencia) | sin FK |

Índices: `Project(workspaceId, updatedAt)`, `Project(deletedAt)`, `Session(userId)`, `Session(expiresAt)`, `ProjectFile(projectId, kind)`, `AIAnalysis(projectId, status)`.

**Semilla:** usuario `demo@archvision.app` / `arquitectura2026` (plan `pro`, PROFESSIONAL), workspace "Estudio Restrepo Arquitectura", 3 proyectos ("Casa Los Robles" con escena demo de 2 plantas + 1 versión, "Apartamento Cabecera 1203" processing, "Local comercial Cra 33" draft).

### 4.2 Entidades de escena (`packages/types`) — fuente de verdad del 3D

`SceneDocument` (schema **v1.2**, historial 1.0→1.1→1.2):

```
SceneDocument {
  version: "1.2", displayUnit, activeFloorId,
  floors[], walls[], doors[], windows[], openings[], columns[],
  stairs[], roofs[], slabs[], rooms[], furniture[], materials[],
  lights[], cameras[],
  environment: { sky, northAngleDeg, latitude?, longitude?, sunDate?, sunTime?, groundColor, showGrid },
  underlay?: { fileId, pixelsPerMeter, offset, rotationDeg, opacity, visible, width, height, floorId? }
}
```

| Entidad | Atributos clave |
|---|---|
| `SceneObject` (base) | `id, type, name, floorId, position, rotation, visible, locked, source?, confidence?` |
| `Floor` | `level` (-1 sótano, 0 baja), `elevation`, `height` |
| `Wall` | `start/end: Vector2` (eje en XZ), `height`, `thickness`, `baseOffset`, `materialInteriorId?`, `materialExteriorId?` |
| `Door` | `wallId`, `kind` (single/double/sliding/glass/pivot/arch), `offset` (desde `wall.start`), `width/height`, `openingDirection` |
| `WindowEntity` | `kind` (single/double/sliding/panoramic/arch/custom), `offset`, `sillHeight`, `frameThickness` |
| `Opening` | vano sin carpintería: `offset, width, height, sillHeight` |
| `Column` | `position: Vector2`, `shape` (rect/circle), `width/depth/height` |
| `Stair` | `kind` (straight/l/u/spiral), `totalRise, width, steps, tread, riser, hasLanding, hasRailing` |
| `Roof` | `kind` (flat/shed/gable/hip/mansard/custom), `outline: Vector2[]`, `slopeDeg`, `overhang`, `thickness` |
| `Slab` | `outline: Vector2[]`, `thickness` |
| `Room` | `polygon`, `wallIds[]`, `area`, `perimeter`, `floorMaterialId?` |
| `MaterialDefinition` | 11 categorías, `baseColor/roughness/metalness/opacity`, `texture?: TexturePattern` (16 patrones procedurales), `tiling?`, `builtin?` |
| `FurnitureInstance` | `catalogId`, transform, `materialOverrides?` |

**Unidades:** todo valor persistido en **metros y radianes** (`packages/shared/units.ts`).

**Comandos (21 tipos, `packages/types/src/commands.ts`):** `CREATE_WALL, UPDATE_WALL, CREATE_DOOR, CREATE_WINDOW, UPDATE_OPENING, CREATE_FLOOR, CREATE_ROOF, UPDATE_ROOF, CREATE_COLUMN, CREATE_STAIR, ADD_FURNITURE, ASSIGN_MATERIAL, CREATE_MATERIAL, UPDATE_MATERIAL, DELETE_MATERIAL, SET_UNDERLAY, TRANSFORM_OBJECTS, DELETE_OBJECTS, SET_VISIBILITY, SET_LOCK, RENAME_OBJECT`. `CommandBase = { id?, origin?: "user"|"ai"|"import"|"system" }`.

**Contratos IA (`packages/types/src/ai.ts`):** `AI_JOB_STAGES` = uploading→normalizing→detecting→segmenting→depth→geometry→materials→done; `AIJobStatus = queued|running|succeeded|failed|canceled`; `DETECTION_CLASSES` (12: wall, window, door, roof, balcony, column, stair, floor, ceiling, furniture, sky, vegetation); `Detection{class, box 0..1, confidence, polygon?, reviewed?}`; `CONFIDENCE_THRESHOLDS = {high:0.8, medium:0.5}`; `AccuracyEstimate{level: high|medium|low}`.

**Límites de escena (Zod, `packages/validation/src/scene.ts`):** maxFloors 30, maxWalls 5000, maxOpenings 5000, maxFurniture 5000, maxMaterials 500, maxPolygonPoints 512, maxCoordinate 5000, maxDimension 500.

### 4.3 Estados de negocio

- `Project.status`: `draft | processing | ready | error` (`processing` hoy solo lo pone la semilla; nadie lo cambia en runtime).
- `Subscription.status`: `incomplete | trialing | active | past_due | canceled` — gracia de 7 días en `past_due`.
- `Payment.status`: `pending | approved | declined | voided | error | refunded`.
- `AIJobStatus` / `ExportJob.status`: `queued | running | succeeded | failed | canceled` — definidos, sin máquina de estados implementada.

---

## 5. Estado Actual

### 5.1 Lo que FUNCIONA (verificado en código y documentado como fases 1–7 completas)

| Área | Detalle |
|---|---|
| Monorepo y tooling | pnpm workspace, 10 paquetes TS sin build (`transpilePackages`), typecheck estricto, CI de 4 etapas |
| Base de datos | 16 modelos Prisma, 2 migraciones, seed funcional, SQLite en dev |
| Auth | registro/login/logout/me, sesiones opacas revocables, rate-limit anti fuerza bruta, auditoría, guards por layout y API |
| Proyectos | CRUD con cursor, papelera (`deletedAt`), duplicar, cuotas por plan (402), versiones (crear/listar) |
| Escena persistida | GET/PUT con validación Zod + integridad referencial + `expectedRevision` (409), body 12 MB, autoguardado 1.2 s |
| Editor 3D | paredes con vanos (Shape+holes, sin booleanas), puertas/ventanas, columnas, escaleras paramétricas (recta/L/U/espiral), cubiertas (plana/1/2/4 aguas), losas, mobiliario (27 piezas), undo/redo (80 snapshots), selección múltiple, mover/rotar, outliner, command palette (Ctrl+K) |
| Editor 2D | SVG, snapping en 5 niveles (endpoint→midpoint→wall→axis→grid), medición, detección de habitaciones por grafo planar, inspector de medidas |
| Materiales | 30 materiales builtin, 16 patrones procedurales (albedo+normal+rugosidad a 512px, `DataTexture` sin DOM), drag&drop y pincel, UV en metros (`applyBoxUv`), caché de geometría (600) y de materiales |
| Importación de planos (Fase 5) | subida, calibración con cota, underlay, **detección real de muros en navegador** (Otsu+Hough, con tests), propuesta aceptable/rechazable |
| Asistente (Fase 6) | motor local de reglas (intents + builders + 13 reglas de revisión + tutorial por estado + base de conocimiento), fallback opcional a Claude con 11 tools estrictas, validación Zod de toda acción, 20 req/min |
| Facturación (Fase 7) | planes y precios COP, checkout, webhook idempotente con firma cruda, renovaciones con secreto cron, estados y gracia de 7 días, proveedor Wompi real (`sandbox`/`production`) y proveedor "manual" simulado |
| Tests | ~150 pruebas Vitest en `packages/` (billing, assistant, shared, validation, vision, geometry, three-engine) |

### 5.2 Lo que está ROTO o a medias (bloqueantes o deuda activa)

| # | Hallazgo | Severidad | Evidencia |
|---|---|---|---|
| 1 | **`@/lib/storage` y `@/lib/storage/sniff` no existen en la rama `Backend-Ia`** → `file-service.ts` no compila (TS2307) y los 4 endpoints de `/files` no pueden ejecutarse. Los archivos existen en `Develop`/`main` (commits `29bb443`, `0d25dc2`) pero no son ancestrales de esta rama. | **Crítica** | `apps/web/src/lib/projects/file-service.ts:4-5`; confirmado con `Test-Path` → `False`; `tsconfig.tsbuildinfo` contiene el error 2307 |
| 2 | **Sin cola, sin worker, sin servicio Python.** 0 archivos `.py`, 0 dependencias Redis/BullMQ, 0 rutas `/api/jobs/*` ni `/analyze`. `docker-compose` levanta Redis para nada. | Diseño no implementado | glob `**/*.py` vacío; `pnpm-lock.yaml` sin `bullmq`/`ioredis` |
| 3 | **`AI_MODE` y `AI_SERVICE_URL` son hooks muertos**: declarados en `env.ts:19-20` y en `.env`, **no se leen en ningún otro punto del código**. No existe nada que "simular" todavía. | Media | `apps/web/src/lib/env.ts:19-20` |
| 4 | **`AIAnalysis` y `ExportJob` son tablas huérfanas**: ningún código las escribe ni las lee. `Project.status="processing"` solo existe en la semilla. | Media | grep 0 coincidencias en `apps/web` |
| 5 | **`REDIS_URL` y `AI_SERVICE_TOKEN` no están en el schema Zod de `env.ts`** pese a figurar en `.env`/compose. | Baja | `env.ts` vs `.env.example:64,70` |
| 6 | **Rate-limiter en memoria** con `buckets.clear()` global a 10k claves: se anula solo en multi-instancia o bajo ataque. Previsto sustituirlo por Redis conservando la firma. | Media | `lib/api/rate-limit.ts:35` |
| 7 | **Sin `middleware.ts`**: toda la guarda depende de layouts/rutas individuales (frágil ante una ruta nueva olvidada). | Baja | no existe `middleware.ts`; `middleware-manifest.json` vacío |
| 8 | **`restoreVersion()` sin ruta API ni UI**; `purgeExpiredSessions()` sin invocar; verificación de correo "pendiente hasta Fase 10". | Baja | `scene-service.ts:204`, `session.ts:110`, `register/route.ts:39-41` |
| 9 | **Numeración de fases inconsistente entre documentos**: README pone el servicio Python en Fase 8; `ARCHITECTURE.md`/`DEPLOYMENT.md` dicen Fase 6; `AI_PIPELINE.md` dice "fases 6 y 7"; `.env.example` etiqueta `AI_SERVICE_URL` como "(Fase 7)" y `REDIS_URL` como "(Fase 6)"; la UI (`sidebar.tsx`) llama "Fase 8" a Exportaciones (README las pone en 9). | Media (confusión para IA/contribuidores) | cruzado entre README/docs/UI |
| 10 | **CI desalineado**: `ci.yml` instala pnpm 9, `package.json` exige `pnpm@11.18.0`. Además `pnpm build` ejecuta el typecheck de `apps/web` que hoy falla por el punto 1. | Alta | `ci.yml:10`, `package.json:4` |
| 11 | **Dockerfile incompleto**: la capa `deps` solo copia `package.json` de `config, types, shared, validation, database` — faltan `geometry, three-engine, vision, assistant, billing`. Y `DEPLOYMENT.md` ubica el Dockerfile en `apps/web` cuando está en la raíz. | Alta para despliegue | `Dockerfile:14-19` |

### 5.3 Simulaciones / "mocks" existentes (datos falsos de prueba)

| Qué | Cómo funciona | Dónde |
|---|---|---|
| **Pasarela de pagos simulada** | `BILLING_PROVIDER=manual` (default). `isConfigured() = !isProduction()`; crea checkout que redirige a `/settings/billing/simulacion` (404 en producción); firma HMAC-SHA256 con `AUTH_SECRET`; el botón "aprobar" dispara el **webhook real** con evento `manual:<ref>:approved`. Devuelve siempre `cardBrand "VISA"`, `cardLast4 "4222→4242"`. **Es el único flujo "mock" completo y funcional del sistema.** | `lib/billing/providers/manual.ts`, `app/(app)/settings/billing/simulacion/page.tsx` |
| **Respuesta del asistente "local"** | No es un mock: es un motor de reglas determinista (`source:"local"`). Se usa por defecto (`ASSISTANT_PROVIDER=local`) y como fallback si no hay `ANTHROPIC_API_KEY`. | `packages/assistant/src/planner.ts` |
| **`AI_MODE=mock`** | Declarado, **sin implementación**. No existe el cliente del servicio de IA que devuelva respuestas simuladas. | `env.ts:20`, `docker-compose.yml:57`, `docs/AI_PIPELINE.md:5` |
| **Verificación falsa de contraseña** | `fakeVerify()` con `DUMMY_HASH` para igualar tiempos de respuesta y evitar enumeración de correos. | `lib/auth/password.ts:27-31` |
| **Datos de prueba** | Semilla con 3 proyectos (uno con escena demo de 2 plantas) y cuenta demo publicada en la landing en texto plano. | `prisma/seed.ts`, `app/page.tsx:144` |
| **Landing que promete fases no construidas** | CTA de "fotos → modelo 3D" en la landing; en el formulario esos métodos muestran etiqueta "Fase 7/5" y no hacen nada. Sidebar muestra rutas `/library/*`, `/files`, `/exports`, `/history` deshabilitadas (sin enlaces muertos, correctamente). | `app/page.tsx`, `new-project-form.tsx:54,61`, `sidebar.tsx:84-96` |

### 5.4 Deuda técnica relevante para escalar

1. **No hay cliente API centralizado**: 19 `fetch()` sueltos repartidos en componentes.
2. **Sin autenticación en middleware** (ver 5.2.7) y sin protección CSRF más allá de `sameSite=lax`.
3. **`build` de producción depende del typecheck roto** (punto 5.2.1): hasta que no se resuelva `@/lib/storage`, `pnpm build` y CI fallan.
4. **Números de fase incoherentes** entre README, docs y UI (5.2.9): cualquier IA que lea la documentación sin cruzarla confundirá qué está implementado.
5. **Contratos "preparados" sin consumidor**: `packages/types/src/ai.ts`, `AIAnalysis`, `ExportJob`, campos `source`/`confidence` en entidades, `AI_JOB_STAGES`, `PHOTO_ROLES` (roles front/back/left/right/roof ya definidos), `ACCEPTED_MODEL_EXTENSIONS` (.glb/.gltf/.obj/.stl/.fbx) — todo listo para la Fase 8/9.
6. **Cobros "créditos IA" definidos en `config/limits.ts` pero sin motor de consumo** (nadie descuenta `aiAnalysesPerMonth`).
7. **PDF se sube y almacena pero no se rasteriza** (reservado al servicio Python).
8. **Cubiertas `mansard` y `custom` aproximadas a dos aguas** (`geometry/src/roof.ts:14-17`).

### 5.5 Puntos de entrada recomendados para otra IA

| Si hay que... | Empezar por |
|---|---|
| Entender el dominio | `packages/types/src/entities.ts` + `scene.ts` + `commands.ts` |
| Entender la mutación de la escena | `packages/shared/src/command-reducer.ts` → `apps/web/src/lib/editor/store.ts` |
| Entender una ruta API | `apps/web/src/app/api/**/route.ts` + `src/lib/api/response.ts` (contrato) |
| Añadir un endpoint de IA | leer `docs/AI_PIPELINE.md` (diseño) + `packages/types/src/ai.ts` (contratos) + `AIAnalysis` en `schema.prisma`; hoy no hay cliente HTTP, cola ni worker que reutilizar |
| Cambiar límites/precios | `packages/config/src/limits.ts` + `pricing.ts` |
| Tocar facturación | `packages/billing/src/*` (lógica pura con tests) → `apps/web/src/lib/billing/service.ts` (I/O) |
| Trabajar en visión | `packages/vision/src/plan.ts` (interfaz `DetectedWall[]` que el futuro modelo entrenado debe consumir) |
| Ver qué está roto ahora | `apps/web/src/lib/projects/file-service.ts` (imports inexistentes) y rama `Backend-Ia` vs `Develop` |
