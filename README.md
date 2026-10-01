# 🏗️ ArchVision 3D AI

> Plataforma web para crear modelos 3D de viviendas y edificaciones a partir de fotografías, planos arquitectónicos, croquis y medidas del usuario.

**Principio de diseño:** la inteligencia artificial construye el modelo inicial, pero el usuario mantiene el control completo sobre la geometría final.

```
Imagen / Plano  →  Análisis IA  →  Modelo inicial  →  Corrección humana
                                                    →  Modelo paramétrico  →  Render / Exportación
```

> 💡 El nombre comercial vive en `packages/config/src/brand.ts` (o en la variable `NEXT_PUBLIC_APP_NAME`). Cambiarlo ahí renombra toda la aplicación.

---

## 📍 Estado del proyecto

| # | Módulo | Estado |
|---|--------|--------|
| 1 | Monorepo, base de datos, autenticación, dashboard, proyectos, escena persistida | ✅ Completa |
| 2 | Editor 3D (Three.js + React Three Fiber), paredes, vanos, cubiertas, escaleras, undo/redo, autoguardado | ✅ Completa |
| 3 | Editor 2D sincronizado, snapping, detección de habitaciones, medición | ✅ Completa |
| 4 | Biblioteca de materiales PBR con texturas procedurales y arrastrar/soltar | ✅ Completa |
| 5 | Importación de planos: subida, calibración, calcado y detección automática de muros | ✅ Completa |
| 6 | Asistente IA: propone cambios, revisa el modelo y guía paso a paso | ✅ Completa |
| 7 | Suscripciones de pago con Wompi: planes, cobros, renovación y límites | ✅ Completa |
| 8 | Servicio Python de visión y reconstrucción desde fotografías | 🔜 Pendiente |
| 9 | Exportaciones GLB / GLTF / OBJ / STL / PNG | 🔜 Pendiente |
| 10 | Render, HDRI, simulación solar | 🔜 Pendiente |
| 11 | Colaboración, workspaces compartidos, enlaces | 🔜 Pendiente |

> Los módulos pendientes aparecen en la interfaz marcados con la fase en la que llegan, nunca como enlaces muertos.

### ✨ Qué puedes hacer hoy

1. Crear una cuenta y un proyecto, o cargar la **casa demo de dos plantas**.
2. Abrir el editor y trabajar en vista **2D**, **3D** o **dividida**.
3. Dibujar paredes encadenadas con snapping a vértices, puntos medios, ejes y cuadrícula.
4. Colocar puertas y ventanas haciendo clic sobre una pared: el hueco se abre en la geometría al instante.
5. Añadir columnas, escaleras paramétricas, cubiertas (plana, una pendiente, dos aguas, cuatro aguas) y mobiliario del catálogo.
6. Ver las habitaciones detectadas automáticamente con su área y perímetro.
7. Editar medidas exactas en el inspector, arrastrar nodos de pared, deshacer/rehacer y medir distancias.
8. Aplicar materiales con textura (ladrillo, madera, cerámica, teja, mármol, piedra, metal): arrastra una muestra sobre el modelo o carga el pincel con `G` y haz clic.
9. Importar un plano (PNG, JPG, WebP), fijar su escala con una medida conocida y detectar los muros automáticamente.
10. Pedirle cambios al asistente con `A`: crea habitaciones, coloca vanos, aplica materiales o levanta cubiertas. Nada se aplica sin aprobación y cada propuesta se deshace con `Ctrl+Z`.
11. Revisar el modelo: habitaciones sin acceso, vanos fuera del muro, muros duplicados, poca luz natural, escaleras incómodas.
12. Seguir el **tutorial integrado**, cuyos pasos se marcan solos a medida que trabajas.
13. Contratar un plan de pago (Pro o Studio, mensual o anual) desde **Configuración → Facturación**.
14. Todo se **autoguarda**; `Ctrl+K` abre la paleta de comandos.

---

## 🧰 Requisitos previos

| Herramienta | Versión mínima | Notas |
|-------------|---------------|-------|
| [Node.js](https://nodejs.org/) | 20.11 | Probado con Node 24 |
| [pnpm](https://pnpm.io/) | 9.0 | Gestor de paquetes del monorepo |
| [Git](https://git-scm.com/) | Cualquier versión reciente | Para clonar el repositorio |
| [Supabase](https://supabase.com/) | — | Base de datos PostgreSQL gestionada en la nube |

---

## 🚀 Puesta en marcha

### 1. Clonar el repositorio

```bash
git clone https://github.com/JuanDavid-dev-lang/ArchVision3DAI.git
cd ArchVision3DAI
```

### 2. Instalar dependencias

```bash
pnpm install
```

### 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita el archivo `.env` y completa las siguientes variables clave:

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | URL del Transaction Pooler de Supabase (puerto `6543`) |
| `DIRECT_URL` | URL del Session Pooler de Supabase (puerto `5432`) |
| `AUTH_SECRET` | Secreto aleatorio para firmar sesiones |
| `NEXT_PUBLIC_SUPABASE_URL` | URL pública de tu proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anónima pública de Supabase |

Para generar un `AUTH_SECRET` seguro:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> ⚠️ El archivo `.env` está en `.gitignore`. **Nunca lo subas al repositorio.**

### 4. Generar el cliente de Prisma

```bash
pnpm db:generate
```

> Ejecuta este comando siempre que instales dependencias por primera vez o cuando se actualice el esquema de base de datos.

### 5. Iniciar el servidor de desarrollo

```bash
pnpm dev
```

Abre **<http://localhost:3000>** en tu navegador.

**Cuenta de demostración:** `demo@archvision.app` / `arquitectura2026`

---

## 🗄️ Base de datos (Supabase + Prisma)

La base de datos reside completamente en **Supabase** (PostgreSQL gestionado). No es necesario crear, migrar ni inicializar una base de datos local.

- **`DATABASE_URL`** → apunta al **Transaction Pooler** (puerto `6543`, con `pgbouncer=true`) para consultas en runtime.
- **`DIRECT_URL`** → apunta al **Session Pooler** (puerto `5432`) para operaciones de Prisma CLI que requieren conexión directa.
- Para inspeccionar los datos visualmente: `pnpm db:studio` (abre Prisma Studio en el navegador).

---

## 📋 Referencia de comandos

| Comando | Descripción |
|---------|-------------|
| `pnpm dev` | Servidor de desarrollo de la aplicación web |
| `pnpm build` | Compilación de producción |
| `pnpm start` | Servidor de producción (requiere build previo) |
| `pnpm typecheck` | TypeScript estricto en todos los paquetes |
| `pnpm test` | Pruebas unitarias (Vitest) |
| `pnpm db:generate` | Genera el cliente tipado de Prisma |
| `pnpm db:studio` | Explorador visual de la base de datos (Prisma Studio) |

---

## 📁 Estructura del monorepo

```
ArchVision3DAI/
├── apps/
│   └── web/              # Next.js 15: landing, dashboard, API REST, editor 2D/3D
└── packages/
    ├── config/           # Marca, límites de plan, políticas de archivos
    ├── types/            # Entidades arquitectónicas, SceneDocument, comandos
    ├── validation/       # Esquemas Zod compartidos cliente/servidor
    ├── shared/           # Unidades, geometría 2D, métricas, comandos, habitaciones
    ├── vision/           # Detección de muros en planos: Otsu, Hough, trazado
    ├── assistant/        # Asistente: ficha del proyecto, revisión, tutorial
    ├── billing/          # Suscripciones: periodos, derechos por plan, cobros
    ├── geometry/         # Motor de geometría: paredes, vanos, losas, cubiertas
    ├── three-engine/     # Materiales PBR, snapping, cámara, entorno solar
    └── database/         # Prisma: esquema y cliente conectado a Supabase
```

> Paquetes previstos para fases siguientes: `ui` y la aplicación `ai-service` (FastAPI).

---

## 📚 Documentación

| Documento | Contenido |
|-----------|-----------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Arquitectura general y decisiones de diseño |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Modelo de datos y entidades |
| [`docs/API.md`](docs/API.md) | API REST |
| [`docs/EDITOR.md`](docs/EDITOR.md) | Motor 3D, estado del editor y atajos de teclado |
| [`docs/PLAN_IMPORT.md`](docs/PLAN_IMPORT.md) | Importación de planos y detección de muros |
| [`docs/ASSISTANT.md`](docs/ASSISTANT.md) | Asistente IA, revisión del modelo y tutorial |
| [`docs/BILLING.md`](docs/BILLING.md) | Planes, suscripciones y cobros |
| [`docs/AI_PIPELINE.md`](docs/AI_PIPELINE.md) | Servicio de visión por computador |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Entornos y despliegue |

---

## ⚠️ Aviso

Los modelos generados automáticamente a partir de fotografías pueden contener errores dimensionales. Verifique siempre las medidas importantes antes de usarlas para construcción, presupuesto o trámites.
