# ArchVision AI Service

FastAPI para generación 3D con TripoSR/InstantMesh y vectorización de planos con YOLOv11-seg.
La RTX 2000 Ada de 6 GB requiere NVIDIA CUDA y NVIDIA Container Toolkit si se
ejecuta dentro de Docker. Se recomienda Python 3.11.

## Preparación

1. Instala PyTorch CUDA desde `requirements.txt` y clona el repositorio oficial:
   `git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR.git vendor/TripoSR`.
2. Compila `torchmcubes` con el mismo toolkit CUDA usado por PyTorch.
3. El modelo RMBG-1.4 ONNX vive en `models/rmbg-1.4.onnx`. Al arrancar, el
   servicio valida la cabecera del archivo: si falta o no es un ONNX (por
   ejemplo un `.pth` renombrado, que provocaba `InvalidProtobuf` en ONNX
   Runtime) lo pone en cuarentena como `*.invalid-checkpoint` y descarga el
   oficial `onnx/model.onnx` de
   [BRIA RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4) con
   `huggingface-hub`. Ajusta con `REMBG_MODEL_REPO`,
   `REMBG_MODEL_REPO_FILE` (p. ej. `onnx/model_fp16.onnx`) y
   `REMBG_AUTO_DOWNLOAD=0` para desactivar la descarga automatica. Si
   ONNX Runtime aun asi rechaza el archivo (p. ej. corrupto a mitad de
   stream), se reinstala el oficial y se reintenta una vez antes de
   degradar. Si la descarga falla, el servicio arranca igualmente sin la sesion RMBG y los
   endpoints de imagen responden 503 con el motivo. La licencia permite uso
   no comercial; para uso comercial se requiere un acuerdo de BRIA. No se
   versionan los pesos.
4. Define `SUPABASE_URL` y la clave `SUPABASE_SERVICE_ROLE_KEY` completa en
   `apps/ai-service/.env`. Al iniciar, el servicio crea el bucket
   privado `models-3d` si aun no existe y falla con un error claro si encuentra
   uno publico. La clave service-role solo va en el entorno del servidor; no la
   uses en variables `NEXT_PUBLIC_*`. Al ser una clave de servidor, omite las
   politicas RLS de Storage; no es necesario crear politicas para este flujo.
5. `AI_SERVICE_API_KEY` en `apps/ai-service/.env` debe coincidir con
   `AI_SERVICE_TOKEN` en el `.env` raiz para proteger el endpoint. El valor de
   ejemplo `tu_token_seguro_aqui` es solo para pruebas locales; genera un
   secreto aleatorio antes de exponer el servicio. Opcionalmente ajusta
   `TRIPOSR_REPO_DIR`, `REMBG_MODEL_PATH` y
   `ODA_FILE_CONVERTER`. FastAPI lee primero el `.env` raiz y luego el `.env`
   local del servicio (que prevalece si repite una variable); variables
   exportadas en el entorno tienen prioridad sobre ambos archivos.

```powershell
cd apps/ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:TRIPOSR_REPO_DIR = "vendor/TripoSR"
$env:REMBG_MODEL_PATH = "models/rmbg-1.4.onnx"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Confirma que el startup completo terminó antes de generar:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

Enviar `multipart/form-data` con el campo `file` a
`POST /api/v1/image-to-3d/generate` y la cabecera `X-AI-Service-Key`.
El log de inicio indica si `SUPABASE_URL` y
`SUPABASE_SERVICE_ROLE_KEY` están configuradas sin imprimir sus valores. Ante
un fallo de Storage, Uvicorn registra bucket, ruta, tipo de contenido, estado
HTTP/código de Supabase y traceback; la clave y los headers de autorización no
se registran. Las subidas de GLB usan `model/gltf-binary` y las de geometría
JSON `application/json`, sin activar `upsert`.

Antes de subir el GLB de objetos, `geometry_utils.canonicalize_glb` alinea por
PCA el eje de menor extensión a +Y (arriba en glTF/Three.js), el eje horizontal
más largo a X y el horizontal restante a Z. Centra el cuadro XZ y coloca el
punto más bajo en Y=0 para que los muebles planos queden apoyados en el visor.
La transformación solo rota y traslada la malla: no cambia escala y por ello
no promete dimensiones físicas en metros. Es una heurística para objetos
planos. Compara el área de superficie próxima a ambos extremos del eje Y y
aplica una rotación de 180° cuando el extremo inferior supera al superior por
más del 10%; este estimador ayuda a corregir muebles volteados con una parte
superior más voluminosa. No equivale a clasificación semántica, no puede
distinguir cabecero de pies en una cama simétrica ni corregir deformaciones de
perspectiva ya presentes en la reconstrucción.

Después de orientar el GLB, `mesh_completion.complete_mesh` limpia la malla,
calcula normales y aplica reconstrucción de superficie Poisson de Open3D
(`depth=8`) sobre muestras de su superficie. Antes y después de Poisson intenta
reparar huecos pequeños con `trimesh` solo si el área añadida no supera el 2 %
del área superficial de la malla. Si Poisson sigue abierto, usa la malla de
entrada limpia/reparada únicamente cuando esta ya es watertight y tiene volumen
positivo. La validación de sólido y volumen sigue siendo obligatoria antes de
subir; geometrías con aberturas grandes o topología inválida se rechazan.
También se rechazan GLB vacíos o de más de 50 MiB. Poisson puede cerrar una
envolvente a partir de las superficies observadas, pero no conoce la geometría
trasera real ni garantiza inferir respaldos o largueros estructuralmente
correctos que no aparecen en la entrada. Para eso se necesita una plantilla o
un modelo con prior de categoría y dimensiones; la reconstrucción de Poisson
no recupera por sí sola información visual que nunca fue observada.

Los colores RGBA por vértice se transfieren desde el vértice más cercano de la
malla original usando `scipy.spatial.cKDTree`. Esto conserva color de vértice
con asignación por vecino más cercano, pero no preserva texturas UV que no
estén representadas en esos colores.

## Análisis de planos 2D

`POST /api/v1/floorplan/analyze` acepta PDF, DWG, DXF, PNG, WebP, JPG y JPEG
(máximo 20 MB), también mediante `multipart/form-data` con el campo `file` y
la cabecera `X-AI-Service-Key`. DXF entrega líneas y polilíneas del espacio
modelo con nombres de capa, unidades `$INSUNITS`, límites y candidatos a muro
según nombres de capa como `WALL`, `MURO`, `PARED` o `PARTITION`. Las capas
`DOOR`/`PUERTA` y `WINDOW`/`VENTANA` entregan marcadores de abertura CAD.
DWG requiere
`ODA_FILE_CONVERTER`; el resultado de la conversión se analiza como DXF.

PDF analiza su primera página y las entradas raster se limitan a 2048 píxeles
por lado y 4 megapíxeles. OpenCV cierra pequeños cortes, separa trazos
horizontales/verticales y filtra contornos por área, grosor, longitud y
relación de aspecto. `approxPolyDP` simplifica los contornos y sus cajas
delimitadoras producen segmentos `wall_candidate` alineados estrictamente a
los ejes en coordenadas de píxel con origen superior izquierdo. Se procesan
todos los segmentos que pasan el filtro, aunque estén desconectados de otros
muros; no hay poda por componente conectado ni por anidamiento de contornos,
para evitar eliminar habitaciones o secciones completas. El filtro por área
pequeña y orientación es geométrico, no semántico: mobiliario grande con
trazos similares a muros puede requerir revisión manual.
El microservicio extruye segmentos de
muro con altura de 2.6 m y espesor de 0.15 m. Solo utiliza aberturas explícitas
en las capas CAD nombradas; no infiere puertas o ventanas en planos raster,
por lo que esos muros permanecen continuos. Las puertas conservan un dintel
desde 2.1 m; las ventanas dejan antepecho de 0.9 m y dintel desde 2.1 m.

DXF debe declarar unidades con `$INSUNITS`; los valores unitless se rechazan
para no inventar una escala física. Raster usa 100 px/m como escala inicial
aproximada, que debe calibrarse antes de confiar en dimensiones. La geometría
no es BIM confirmado ni una escena paramétrica: revísala antes de utilizarla.

El endpoint guarda el JSON procesado y el GLB extruido en el bucket privado
`models-3d/floorplans/`, y devuelve ambos artefactos con URLs firmadas
temporales. La ruta autenticada de Next.js
`POST /api/projects/{id}/ai/floorplan` valida el acceso al proyecto y registra
metadatos del análisis y ambos artefactos en `AIAnalysis` y `ExportJob`; la
URL firmada del GLB se utiliza en el visor. El servicio limita el análisis
simultáneo a dos trabajos y acota cantidad de entidades/vértices.
Los errores de formato o planos vacíos responden 422; fallos de Storage se
registran con los detalles técnicos y responden 502.
Storage se inicializa independientemente de TripoSR, de modo que el análisis
2D pueda seguir disponible si la GPU o la carga del modelo 3D falla.

Pruebas locales del parser (desde `apps/ai-service`):

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

El modelo se carga al iniciar. La inferencia 3D usa `torch.autocast` con
`torch.float16`, chunk y resolución reducidos, un slot concurrente y
`torch.cuda.empty_cache()` al terminar. TripoSR declara alrededor de 6 GB para
su configuración por defecto; el tiempo inferior a 5 s no se garantiza en una
RTX de 6 GB y debe medirse con el modelo ya caliente y entradas representativas.

## Motor de alta calidad: InstantMesh

La interfaz ofrece los modos **Estándar (TripoSR)** y **Alta calidad (InstantMesh)**.
El modo estándar llama a `POST /api/v1/image-to-3d/generate`; el modo HQ usa
`POST /api/v1/image-to-3d/generate-hq`. El endpoint protegido
`GET /api/v1/capabilities` informa si InstantMesh quedó inicializado; la
aplicación web usa esa señal para habilitar o deshabilitar el selector HQ y
también bloquea en el proxy las peticiones HQ cuando el motor no está disponible.
El endpoint HQ responde 503 hasta configurar una instalación aparte del
repositorio y del entorno Python oficial de [TencentARC/InstantMesh](https://github.com/TencentARC/InstantMesh).
No instales sus dependencias dentro de `apps/ai-service/.venv`: InstantMesh
necesita un stack de PyTorch/CUDA diferente al del servicio TripoSR.

Clona InstantMesh en `C:\Users\SnAyD\ArchVision3DAI\vendor\InstantMesh`,
instala allí sus requisitos en un Python compatible con la GPU/CUDA del equipo
y descarga sus checkpoints según las instrucciones upstream. El `.env` local
de `apps/ai-service` ya apunta a ese checkout y a su entorno virtual separado:

```dotenv
INSTANTMESH_REPO_DIR=C:\Users\SnAyD\ArchVision3DAI\vendor\InstantMesh
INSTANTMESH_PYTHON=C:\Users\SnAyD\ArchVision3DAI\vendor\InstantMesh\.venv\Scripts\python.exe
INSTANTMESH_CONFIG=configs/instant-mesh-large.yaml
INSTANTMESH_TIMEOUT_SECONDS=900
```

El servicio lee automáticamente estas claves de ese `.env`; después de clonar
el repositorio, crear el entorno e instalar pesos, reinicia FastAPI para que
inicialice el endpoint HQ. Si las rutas no existen o falta `run.py`/la
configuración, el motor seguirá deshabilitado y el endpoint responderá 503.

El adaptador llama al CLI oficial con seis vistas y transforma el OBJ coloreado
que este produce a GLB. Después aplica la canonización PCA/Y-up, el completado
Poisson existente y valida la cabecera/estructura GLB, el volumen positivo,
la condición watertight, los colores RGBA por vértice y el límite de 50 MiB
antes de subir a `models-3d`. Las inferencias están serializadas y el modelo
TripoSR se mueve temporalmente a CPU mientras corre el proceso InstantMesh para
reducir la contención de VRAM. La RTX 4050 de 6 GB puede no tener memoria
suficiente para la combinación de InstantMesh, RMBG y el procesamiento; hay que
probar el checkpoint upstream en el equipo objetivo. Los logs del microservicio
registran el traceback y stdout/stderr de InstantMesh; los errores HTTP incluyen
una causa técnica saneada sin exponer claves.

Para visión 2D, configura `YOLO_SEGMENTATION_WEIGHTS` con un modelo de
segmentación entrenado para clases como `wall` y `room`. `Vision2DPipeline`
convierte los polígonos de sus máscaras a puntos `[x, y]` de píxel mediante
`cv2.findContours` y `cv2.approxPolyDP`. El modelo YOLO es opcional y se carga
solo al construir ese pipeline; `yolo_device=cpu` evita competir por VRAM con
TripoSR. SAM2 puede conectarse en el mismo punto como proveedor de máscaras
promptables, manteniendo el vectorizador OpenCV.
