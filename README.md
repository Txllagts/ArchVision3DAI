# ArchVision 3D AI

Plataforma web para crear modelos 3D de viviendas y edificaciones a partir de
fotografías, planos arquitectónicos, croquis y medidas del usuario.

El principio del producto: **la inteligencia artificial ayuda a construir el
modelo, pero el usuario mantiene el control completo sobre la geometría final**.

```
Imagen / Plano → Análisis IA → Modelo inicial → Corrección humana
              → Modelo paramétrico → Render / Exportación
```

> El nombre comercial vive en `packages/config/src/brand.ts` (o en la variable
> `NEXT_PUBLIC_APP_NAME`). Cambiarlo ahí renombra toda la aplicación.

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
7. Editar medidas exactas en el inspector, arrastrar nodos de pared, deshacer
   y rehacer, y medir distancias.
8. Aplicar materiales con textura (ladrillo, madera, ceramica, teja, marmol,
   piedra, metal): arrastra una muestra sobre el modelo o carga el pincel con
   `G` y haz clic. Puedes duplicar un material del catalogo y editar el tuyo.
9. Importar un plano (PNG, JPG, WebP), fijar su escala con una medida conocida,
   calcarlo por debajo del dibujo y detectar los muros automáticamente para
   revisarlos y aceptarlos.
10. Pedirle cambios al asistente con `A`: crea habitaciones, coloca vanos,
    aplica materiales o levanta cubiertas. Nada se aplica sin que lo apruebes y
    cada propuesta se deshace de un solo `Ctrl+Z`.
11. Revisar el modelo: habitaciones sin acceso, vanos fuera del muro, muros
    duplicados, poca luz natural, escaleras incómodas.
12. Seguir el tutorial integrado, cuyos pasos se marcan solos a medida que
    trabajas.
13. Contratar un plan de pago (Pro o Studio, mensual o anual), cancelarlo o
    reanudarlo desde Configuración → Facturación. Sin credenciales de pasarela
    funciona una simulación que recorre el mismo camino.
14. Todo se autoguarda; `Ctrl+K` abre la paleta de comandos.

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

## Requisitos

- Node.js 20.11 o superior (probado con Node 24).
- pnpm 9 o superior.
- Base de datos: SQLite en desarrollo (incluida, sin instalación) o PostgreSQL
  en staging/producción.

---

## Puesta en marcha

```bash
# 1. Dependencias
pnpm install

# 2. Variables de entorno
cp .env.example .env
# Genera un secreto y pégalo en AUTH_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Cliente de Prisma y esquema de base de datos
pnpm db:generate
pnpm --filter @archvision/database exec prisma migrate deploy

# 4. Datos de ejemplo (casa demo de dos plantas)
pnpm db:seed

# 5. Servidor de desarrollo
pnpm dev
```

Aplicación en <http://localhost:3000>.

**Cuenta de demostración:** `demo@archvision.app` / `arquitectura2026`

### Notas de base de datos

- `prisma migrate dev` es interactivo; en scripts o terminales sin TTY usa
  `prisma migrate deploy` (aplica el historial existente) o `prisma db push`
  (sincroniza el esquema sin generar migración).
- El historial de migraciones vive en `packages/database/prisma/migrations`.
  Nunca se modifica la base de datos de producción a mano.
- Para pasar a PostgreSQL: cambia `provider` en `schema.prisma`, ajusta
  `DATABASE_URL`, borra el historial y genera una migración nueva. El esquema
  evita a propósito tipos exclusivos de un motor.

---

## Comandos

| Comando | Descripción |
| --- | --- |
| `pnpm dev` | Servidor de desarrollo de la aplicación web |
| `pnpm build` | Compilación de producción |
| `pnpm start` | Servidor de producción |
| `pnpm typecheck` | TypeScript estricto en todos los paquetes |
| `pnpm test` | Pruebas unitarias (Vitest) |
| `pnpm db:generate` | Genera el cliente de Prisma |
| `pnpm db:seed` | Carga datos de ejemplo |
| `pnpm db:studio` | Explorador visual de la base de datos |

---

## Estructura

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

## Documentación

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — arquitectura general y decisiones.
- [`docs/DATABASE.md`](docs/DATABASE.md) — modelo de datos.
- [`docs/API.md`](docs/API.md) — API REST.
- [`docs/EDITOR.md`](docs/EDITOR.md) — motor 3D, estado del editor y comandos.
- [`docs/PLAN_IMPORT.md`](docs/PLAN_IMPORT.md) — importación de planos y detección de muros.
- [`docs/ASSISTANT.md`](docs/ASSISTANT.md) — asistente, revisión del modelo y tutorial.
- [`docs/BILLING.md`](docs/BILLING.md) — planes, suscripciones y cobros.
- [`docs/AI_PIPELINE.md`](docs/AI_PIPELINE.md) — servicio de visión por computador.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — entornos y despliegue.

---

## Aviso

Los modelos generados automáticamente a partir de fotografías pueden contener
errores dimensionales. Verifique las medidas importantes antes de usarlas para
construcción, presupuesto o trámites.
