# API REST

Base: `/api`. Todas las respuestas son JSON.

```jsonc
// Éxito
{ "data": { } }

// Error
{ "error": { "code": "BAD_REQUEST", "message": "Datos invalidos", "details": [] } }
```

| Código | HTTP | Significado |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | Validación fallida |
| `UNAUTHORIZED` | 401 | Sin sesión |
| `QUOTA_EXCEEDED` | 402 | Límite del plan alcanzado |
| `FORBIDDEN` | 403 | Sin permiso sobre el recurso |
| `NOT_FOUND` | 404 | No existe o no pertenece al usuario |
| `CONFLICT` | 409 | Revisión de escena desactualizada, correo duplicado |
| `PAYLOAD_TOO_LARGE` | 413 | Cuerpo por encima del límite |
| `RATE_LIMITED` | 429 | Demasiadas peticiones |
| `INTERNAL` | 500 | Error no previsto (detalle solo en logs del servidor) |

La autenticación usa la cookie de sesión `av_session` (httpOnly). Los recursos
inexistentes y los ajenos devuelven ambos 404: no se revela su existencia.

---

## Autenticación

### `POST /api/auth/register`
```json
{ "name": "Ana Restrepo", "email": "ana@estudio.com", "password": "arquitectura2026" }
```
`201` crea la cuenta, su workspace personal e inicia sesión.
Límite: 5 intentos cada 15 minutos por IP.

### `POST /api/auth/login`
```json
{ "email": "demo@archvision.app", "password": "arquitectura2026" }
```
`200` establece la cookie de sesión. Límite: 10 intentos cada 10 minutos por IP.

### `POST /api/auth/logout`
Idempotente. Elimina la sesión del servidor y la cookie.

### `GET /api/auth/me`
Usuario de la sesión actual, o `401`.

---

## Proyectos

### `GET /api/projects`
Parámetros: `search`, `status`, `cursor`, `limit` (1–50, por defecto 20),
`includeDeleted`.

```json
{ "data": { "items": [ { "id": "…", "name": "Casa Los Robles", "…": "…" } ], "nextCursor": null } }
```

### `POST /api/projects`
```json
{
  "name": "Casa Los Robles",
  "description": "Vivienda unifamiliar de dos plantas",
  "type": "house",
  "units": "m",
  "creationMethod": "draw",
  "location": "Bucaramanga, Colombia",
  "floorsCount": 2,
  "areaEstimate": 160,
  "floorHeight": 2.7
}
```
`201`. Crea el proyecto **y su escena inicial**. `402` si el plan no admite más
proyectos activos.

### `GET /api/projects/:id`
### `PATCH /api/projects/:id`
Campos admitidos: `name`, `description`, `type`, `units`, `location`, `status`,
`thumbnailUrl`.

### `DELETE /api/projects/:id`
Envía a la papelera. Con `?permanent=true` borra de forma definitiva el
proyecto y todo lo asociado.

### `POST /api/projects/:id/restore`
### `POST /api/projects/:id/duplicate`

---

## Escena

### `GET /api/projects/:id/scene`
```json
{ "data": { "scene": { "version": "1.0", "floors": [], "walls": [] }, "revision": 7 } }
```

### `PUT /api/projects/:id/scene`
```json
{ "scene": { "version": "1.0", "…": "…" }, "expectedRevision": 7 }
```

Validación en dos pasos: esquema Zod completo e integridad referencial (los
vanos apuntan a paredes existentes, cada objeto a un nivel existente, los
materiales referenciados existen). Si `expectedRevision` no coincide con la
revisión almacenada se devuelve `409` con la revisión actual; el cliente
consulta la escena con `GET`, adopta el token si el cambio era suyo (guardado
con respuesta perdida), fusiona los cambios ajenos no solapados y, si solapan,
muestra un diálogo de resolución sin sobrescribir nada en silencio.

Límite de cuerpo: 12 MB.

---

## Versiones

### `GET /api/projects/:id/versions`
### `POST /api/projects/:id/versions`
```json
{ "label": "Version cliente" }
```
Al alcanzar el máximo del plan se elimina la versión más antigua.

---

## Archivos

Los bytes nunca se guardan en la base de datos: van al almacenamiento de
objetos y en la fila queda la referencia, el tamaño y el hash SHA-256. No hay
carpeta pública; cada descarga vuelve a comprobar sesión y pertenencia.

### `GET /api/projects/:id/files?kind=floorplan`
Devuelve `{ files: [...] }`. Cada archivo trae una `url` autenticada, nunca la
clave del almacenamiento.

### `POST /api/projects/:id/files`
`multipart/form-data` con `file`, `kind` (`floorplan` | `photo` | `texture` |
`model` | `render`), `role` opcional y `clientKey` opcional (clave de
idempotencia del cliente). `201` con el archivo creado y, cuando existe escena,
la `revision` vigente para que el editor actualice su token de guardado. Un
reintento con la misma `clientKey` devuelve el archivo ya creado en lugar de
duplicarlo (ventana de 10 minutos).

El tipo se decide **leyendo la cabecera del archivo**, no el `Content-Type` que
declara el cliente; si no coinciden, se rechaza. Se aceptan PNG, JPEG, WebP y
PDF, y cada `kind` admite solo los suyos. El tamaño se contrasta con
`maxUploadBytes` del plan y el total con `maxStorageBytes`.
Límite: 30 subidas por minuto y usuario.

| Situación | Respuesta |
| --- | --- |
| Cabecera desconocida o contenido que no cuadra con el tipo declarado | `400 BAD_REQUEST` |
| Archivo por encima del límite del plan, o almacenamiento agotado | `402 QUOTA_EXCEEDED` |
| Cuerpo por encima del tope del servidor (60 MB) | `413 PAYLOAD_TOO_LARGE` |

### `GET /api/projects/:id/files/:fileId/content`
Sirve los bytes con `Cache-Control: private` y `X-Content-Type-Options: nosniff`.

### `DELETE /api/projects/:id/files/:fileId`
Borra la fila y después el objeto: si falla el borrado físico queda un huérfano
recuperable, mientras que al revés quedaría una referencia rota.

---

## Operación

### `GET /api/health`
```json
{ "status": "ok", "database": "up", "timestamp": "2026-08-12T20:40:01.012Z" }
```
`503` si la base de datos no responde.

---

## Asistente

El asistente **no escribe en la base de datos**. Devuelve propuestas de
comandos que el editor aplica solo si la persona las acepta, y cada comando
pasa por el mismo esquema Zod que usa el editor antes de salir del servidor.

Solo llegan aquí las peticiones que el motor local del navegador no reconoce:
las órdenes corrientes se resuelven en el cliente, sin viaje al servidor.

### `GET /api/projects/:id/assistant`

Estado inicial del panel: saludo con las cifras reales del proyecto, revisión
del modelo, progreso del tutorial y si el modelo de lenguaje está configurado.

### `POST /api/projects/:id/assistant`

```json
{
  "message": "cierra el pasillo con un muro de 3 metros",
  "history": [{ "id": "m1", "role": "user", "text": "...", "at": 1736790000000 }],
  "selection": ["wall-id"],
  "activeFloorId": "floor-id",
  "tool": "select"
}
```

Respuesta:

```json
{
  "data": {
    "reply": "...",
    "actions": [
      {
        "id": "room-3",
        "title": "Habitacion de 4.00 x 3.00 m",
        "summary": "Cuatro muros cerrados en el nivel activo, 12.00 m2",
        "commands": [{ "type": "CREATE_WALL", "origin": "ai", "...": "..." }],
        "confidence": 0.9
      }
    ],
    "diagnostics": [],
    "followUps": ["Anade una puerta"],
    "source": "local",
    "rejected": 0
  }
}
```

| Campo | Significado |
| --- | --- |
| `actions` | Propuestas agrupadas por intención: una decisión del usuario, varios comandos |
| `rejected` | Propuestas descartadas por no superar la validación |
| `source` | `local` (reglas) o `model` (modelo de lenguaje) |

Límite: 20 peticiones por minuto y usuario. Un turno puede acabar en una
llamada al modelo de lenguaje, así que el límite protege la factura tanto como
el servidor.

---

## Facturacion

Ningun dato de tarjeta pasa por estas rutas. El importe se lee del catalogo en
el servidor: si viniera del cliente, cualquiera contrataria el plan Studio por
mil pesos editando la peticion.

### `POST /api/billing/checkout`

```json
{ "plan": "pro", "interval": "year" }
```

Devuelve `{ "url": "...", "reference": "av-pro-year-new-...", "provider": "wompi" }`.
Crea la suscripcion en estado `incomplete` y un cobro pendiente; **no concede
el plan**. El derecho llega con el evento de la pasarela. Limite: 10 intentos
por minuto y usuario.

### `GET /api/billing/subscription`

Estado, derechos, medio de pago (marca y ultimos cuatro digitos) y los ultimos
24 cobros.

### `DELETE /api/billing/subscription`

Baja. Conserva el servicio hasta el final del periodo pagado.

### `POST /api/billing/subscription`

Deshace una baja pendiente mientras quede periodo.

### `POST /api/billing/webhook/:provider`

Entrada de eventos de la pasarela. Sin sesion: la autenticidad la da la firma,
verificada sobre el cuerpo crudo. Un evento repetido se descarta por clave
unica y se responde 200 para que la pasarela deje de reintentarlo.

### `POST /api/billing/renewals`

```
Authorization: Bearer $BILLING_CRON_SECRET
```

Cobra las suscripciones vencidas. La ejecuta un programador de tareas, no un
usuario. Sin el secreto configurado, la ruta no responde.

---

## Endpoints previstos

| Endpoint | Fase |
| --- | --- |
| `POST /api/projects/:id/analyze` | 8 |
| `GET /api/jobs/:id` | 8 |
| `POST /api/projects/:id/export` | 9 |
| `POST /api/projects/:id/share` | 11 |
| WebSocket de progreso y colaboración | 8 y 11 |
