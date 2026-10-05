# 🏗️ ArchVision 3D AI

> Plataforma web para crear modelos 3D de viviendas y edificaciones a partir de fotografías, planos arquitectónicos, croquis y medidas del usuario.

**Principio de diseño:** la inteligencia artificial construye el modelo inicial, pero el usuario mantiene el control completo sobre la geometría final.

```
Imagen / Plano  →  Análisis IA  →  Modelo inicial  →  Corrección humana
                                                    →  Modelo paramétrico  →  Render / Exportación
```

> 💡 El nombre comercial vive en `packages/config/src/brand.ts` (o en la variable `NEXT_PUBLIC_APP_NAME`). Cambiarlo ahí renombra toda la aplicación.

---

## Estado actual

| Fase | Contenido | Estado |
| --- | --- | --- |
| 1 | Monorepo, base de datos, autenticación, dashboard, proyectos, escena persistida | **Completa** |
| 2 | Editor 3D (Three.js + React Three Fiber), paredes, vanos, cubiertas, escaleras, undo/redo, autoguardado | **Completa** |
| 3 | Editor 2D sincronizado, snapping, detección de habitaciones, medición | **Completa** |
| 4 | Biblioteca de materiales PBR con texturas procedurales y arrastrar/soltar | **Completa** |
| 5 | Importación de planos: subida, calibración, calcado y detección automática de muros | **Completa** |
| 6 | Asistente: propone cambios, revisa el modelo y guía paso a paso | **Completa** |
| 7 | Suscripciones de pago con Wompi: planes, cobros, renovación y límites | **Completa** |
| 8 | Servicio Python: TripoSR, InstantMesh opcional y extrusión determinista de planos | Parcial |
| 9 | Exportaciones GLB/GLTF/OBJ/STL/PNG | Pendiente |
| 10 | Render, HDRI, simulación solar | Pendiente |
| 11 | Colaboración, workspaces compartidos, enlaces | Pendiente |

Los módulos aún no disponibles aparecen en la interfaz marcados con la fase en
la que llegan, nunca como enlaces muertos.

### Qué puedes hacer hoy

1. Crear una cuenta y un proyecto, o cargar la casa demo de dos plantas.
2. Abrir el editor y trabajar en vista 2D, 3D o dividida.
3. Dibujar paredes encadenadas con snapping a vértices, puntos medios, ejes y
   cuadrícula.
4. Colocar puertas y ventanas haciendo clic sobre una pared: el hueco se abre
   en la geometría al instante.
5. Añadir columnas, escaleras paramétricas, cubiertas (plana, una pendiente,
   dos aguas, cuatro aguas) y mobiliario del catálogo.
6. Ver las habitaciones detectadas automáticamente con su área y perímetro.
7. Editar medidas exactas en el inspector, arrastrar nodos de pared, deshacer/rehacer y medir distancias.
8. Aplicar materiales con textura (ladrillo, madera, cerámica, teja, mármol, piedra, metal): arrastra una muestra sobre el modelo o carga el pincel con `G` y haz clic.
9. Importar un plano (PNG, JPG, WebP), fijar su escala con una medida conocida y detectar los muros automáticamente.
10. Pedirle cambios al asistente con `A`: crea habitaciones, coloca vanos, aplica materiales o levanta cubiertas. Nada se aplica sin aprobación y cada propuesta se deshace con `Ctrl+Z`.
11. Revisar el modelo: habitaciones sin acceso, vanos fuera del muro, muros duplicados, poca luz natural, escaleras incómodas.
12. Seguir el **tutorial integrado**, cuyos pasos se marcan solos a medida que trabajas.
13. Contratar un plan de pago (Pro o Studio, mensual o anual) desde **Configuración → Facturación**.
14. Todo se **autoguarda**; `Ctrl+K` abre la paleta de comandos.

### Pipeline de reconstrucción 3D

El panel de proyecto permite elegir el motor de reconstrucción de objetos. Los
dos motores pasan por validación y almacenamiento común; la reconstrucción
automática es un modelo inicial que debe revisarse, no una geometría dimensional
garantizada.

#### Motor estándar — TripoSR

Reconstruye un objeto desde una imagen. El microservicio aplica eliminación de
fondo RMBG, extrae la malla y realiza el siguiente posprocesamiento:

1. **Alineación PCA:** orienta y centra la malla para el visor. Es una heurística
   geométrica; no determina de forma universal la semántica de “frente”, “arriba”
   ni una escala física.
2. **Poisson y limpieza:** reconstruye una superficie, limpia caras degeneradas
   y prueba reparar huecos pequeños. Solo acepta reparaciones cuya área añadida
   no exceda el 2 % del área superficial.
3. **Fallback seguro:** si Poisson no produce un sólido válido, conserva la malla
   original únicamente si ya está cerrada y tiene volumen positivo. Las
   geometrías abiertas o topológicamente inválidas se rechazan.
4. **Transferencia de color:** transfiere los colores RGBA a los vértices nuevos
   mediante el vecino más cercano calculado con `scipy.spatial.cKDTree`.

#### Motor opcional de alta calidad — InstantMesh

InstantMesh ejecuta difusión para generar vistas múltiples y reconstruir una
malla desde ellas; puede aportar geometría adicional en zonas no visibles en la
imagen original, pero no garantiza recuperar el reverso real ni detalles que el
modelo no haya inferido. Se ejecuta mediante una instalación y un entorno Python
separados del servicio TripoSR, porque sus dependencias de PyTorch/CUDA pueden
ser distintas. Las inferencias se serializan y el servicio libera
temporalmente los recursos de GPU de TripoSR/RMBG durante la ejecución HQ.

InstantMesh solo aparece seleccionable cuando el backend confirma que está
inicializado. Si sus dependencias, configuración o archivos no están presentes,
la interfaz deshabilita Alta calidad y el proxy rechaza solicitudes HQ antes de
invocar ese motor.

#### Backend y almacenamiento

El microservicio FastAPI expone estos endpoints protegidos por
`X-AI-Service-Key`:

| Método y ruta | Función |
| --- | --- |
| `POST /api/v1/image-to-3d/generate` | Generación estándar con TripoSR |
| `POST /api/v1/image-to-3d/generate-hq` | Generación opcional con InstantMesh |
| `GET /api/v1/capabilities` | Informa si InstantMesh está inicializado |
| `POST /api/v1/floorplan/analyze` | Analiza y extruye geometría de planos |

Antes de subir un modelo, se comprueba que el GLB tenga cabecera y geometría
válidas, una malla watertight/manifold, volumen positivo, colores RGBA por
vértice y tamaño inferior a 50 MiB. Los archivos se guardan en el bucket privado
`models-3d` de Supabase Storage; el servicio utiliza una clave `service-role`
solo en backend y entrega URLs firmadas. Los fallos detallados quedan en los
logs de Uvicorn; las respuestas al cliente incluyen una causa técnica saneada,
sin revelar secretos.

#### Interfaz y proxy

El componente
[`image-to-3d-generator.tsx`](apps/web/src/components/projects/image-to-3d-generator.tsx)
consulta la capacidad autenticada del servicio y deshabilita Alta calidad · Pro
si InstantMesh no está listo. El proxy protegido de Next.js valida usuario,
proyecto y archivo, selecciona explícitamente el endpoint estándar o HQ, aplica
timeout y límites de frecuencia, y registra el resultado en `AIAnalysis` y
`ExportJob`.

**Importación de planos:** el flujo independiente acepta PDF, DWG, DXF e
imágenes y extruye muros determinísticamente; no envía los planos a TripoSR ni a
InstantMesh. Las aberturas se crean únicamente desde entidades en capas CAD
reconocidas (`DOOR`/`PUERTA`, `WINDOW`/`VENTANA`). En planos rasterizados no se
infieren huecos y sus muros se extruyen continuos. DXF requiere unidades
declaradas en `$INSUNITS`; la escala raster es aproximada (100 píxeles por
metro), así que los resultados requieren calibración y revisión antes de usarse
como medición de construcción. El servicio guarda el JSON y el GLB en
`models-3d/floorplans/`.

### Configuración local del microservicio de IA

La aplicación web y FastAPI tienen entornos independientes. Inicia la web como
se indica en [Puesta en marcha](#puesta-en-marcha). Para el servicio, instala
Python 3.11, las dependencias de `apps/ai-service/requirements.txt`, CUDA
compatible con la versión de PyTorch declarada y los modelos/checkpoints
necesarios. En PowerShell:

```powershell
cd apps/ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR.git vendor/TripoSR
```

Proporciona el modelo ONNX de RMBG-1.4 en `models/rmbg-1.4.onnx`. Configura en
`apps/ai-service/.env` `AI_SERVICE_API_KEY` con el mismo valor que
`AI_SERVICE_TOKEN` del `.env` de la raíz, y `SUPABASE_URL` junto con
`SUPABASE_SERVICE_ROLE_KEY`. No publiques la clave service-role ni la incluyas
en variables `NEXT_PUBLIC_*`. El servicio crea el bucket privado `models-3d`
si aún no existe y falla claramente si detecta que el bucket es público. Para
variables específicas y detalles CUDA consulta
[`apps/ai-service/README.md`](apps/ai-service/README.md).

Arranca el API local en una segunda terminal:

```powershell
cd apps/ai-service
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

La raíz `.env.example` ya propone `AI_SERVICE_URL=http://127.0.0.1:8000`;
configura `AI_SERVICE_TOKEN` con el mismo secreto del servicio y reinicia la
web si el entorno cambió. Verifica el arranque del API en
`http://127.0.0.1:8000/health`. No subas archivos `.env`, pesos ni modelos al
control de versiones.

#### Habilitar InstantMesh (opcional)

Además de TripoSR, requiere espacio suficiente para el checkout, su entorno
virtual separado, checkpoints descargados y archivos temporales de inferencia.
Clona [TencentARC/InstantMesh](https://github.com/TencentARC/InstantMesh) fuera
de `apps/ai-service/.venv`, instala allí las dependencias indicadas por el
proyecto upstream para una versión compatible de Python/CUDA, y descarga sus
pesos. No combines sus paquetes de PyTorch con los del entorno del servicio
principal. En `apps/ai-service/.env`, define rutas que existan en el equipo:

```dotenv
INSTANTMESH_REPO_DIR=C:\ruta\absoluta\vendor\InstantMesh
INSTANTMESH_PYTHON=C:\ruta\absoluta\vendor\InstantMesh\.venv\Scripts\python.exe
INSTANTMESH_CONFIG=configs/instant-mesh-large.yaml
INSTANTMESH_TIMEOUT_SECONDS=900
```

Reinicia FastAPI y consulta el endpoint protegido
`GET /api/v1/capabilities` con `X-AI-Service-Key`; debe devolver
`instantmesh_available: true`. Si falta el checkout, `run.py`, la configuración
o el intérprete indicado, la capacidad será `false` y el selector HQ permanecerá
deshabilitado. El uso de InstantMesh en una RTX con 6 GB de VRAM debe probarse
con el checkpoint elegido; no se garantiza que cada combinación de resolución
y modelos quepa en esa memoria.

### Pruebas de IA

La suite Python valida geometría y orientación, reparación acotada de mallas,
conservación de colores, conversión OBJ→GLB, endpoints y reporte de capacidades.
Desde `apps/ai-service`:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

El pipeline y sus limitaciones están descritos con más detalle en
[`apps/ai-service/README.md`](apps/ai-service/README.md) y
[`docs/AI_PIPELINE.md`](docs/AI_PIPELINE.md).

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
apps/
  web/            Next.js 15: landing, dashboard, API REST, editor 2D/3D
  ai-service/     FastAPI: TripoSR, InstantMesh opcional y extrusión 2D de planos
packages/
  config/         Marca, límites de plan, políticas de archivos
  types/          Entidades arquitectónicas, SceneDocument, comandos
  validation/     Esquemas Zod compartidos cliente/servidor
  shared/         Unidades, geometría 2D, métricas, comandos, habitaciones, casa demo
  vision/         Detección de muros en planos: umbral de Otsu, Hough, trazado
  assistant/      Asistente: ficha del proyecto, revisión, intenciones, tutorial
  billing/        Suscripciones: periodos, derechos por plan, estados de cobro
  geometry/       Motor de geometría: paredes con vanos, losas, cubiertas, escaleras
  three-engine/   Materiales PBR, snapping, encuadres de cámara, entorno solar
  database/       Prisma: esquema, migraciones, semilla
```

Paquete previsto para fases siguientes: `ui`.

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
