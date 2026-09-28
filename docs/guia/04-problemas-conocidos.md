# 4. Problemas conocidos

Problemas encontrados el 27/09/2026 al instalar la rama `Develop` (`a395906`) desde cero, ejecutar las pruebas y recorrer la aplicación. Cada entrada indica cómo reproducir el problema y una propuesta de solución.

| # | Problema | Gravedad | Área |
|---|----------|----------|------|
| 1 | Las migraciones de Prisma son de SQLite y el esquema es PostgreSQL | Alta | Base de datos |
| 2 | Una prueba de `three-engine` falla y CI queda en rojo | Alta | Pruebas / CI |
| 3 | CI usa `DATABASE_URL` de SQLite | Media | CI |
| 4 | La habitación *Sala* de la casa demo muestra `0.00 m²` | Media | Editor |
| 5 | Los atajos de la barra de herramientas no coinciden con el teclado | Baja | Editor |
| 6 | `EDITOR.md` documenta atajos que no existen | Baja | Documentación |

---

## 1. Migraciones de Prisma en SQLite

**Reproducir:**

```bash
pnpm db:deploy
```

```
Error: P3019
The datasource provider `postgresql` specified in your schema does not match the one
specified in the migration_lock.toml, `sqlite`.
```

**Causa:** el commit `42fc0c9` cambió `schema.prisma` a `provider = "postgresql"`. Las carpetas `prisma/migrations/0_init` y `20260813153636_billing`, y `migration_lock.toml`, siguen siendo de SQLite.

**Solución temporal:** usa `pnpm db:push`.

**Solución definitiva:**

1. Borra `packages/database/prisma/migrations/`.
2. Ejecuta `pnpm db:migrate --name init` contra una base PostgreSQL vacía.
3. Si la base de Supabase ya tiene tablas, márcala como aplicada: `prisma migrate resolve --applied <nombre>`.
4. Haz commit de las migraciones nuevas.

## 2. Prueba fallida en `three-engine`

**Reproducir:**

```bash
pnpm --filter @archvision/three-engine test
```

```
FAIL src/engine.test.ts > encuadres > calcula la caja envolvente de la casa demo
AssertionError: expected 11.2 to be close to 10
```

**Causa:** en `45beb28`, `computeSceneBounds` (`packages/three-engine/src/views.ts`) pasó a usar `getSelectableBounds("roof", …)`. Esa función incluye el **alero** de la cubierta (`overhang`, 0,6 m por lado). La casa mide 10 m, así que el ancho total es 11,2 m. La prueba sigue esperando 10.

Comprobado: la prueba pasa en `0d25dc2`, el commit anterior a ese cambio.

**Solución:** decidir cuál es el comportamiento correcto.

- Si el encuadre debe incluir el alero, que es lo razonable para que la cámara no corte el techo, actualiza la prueba en `engine.test.ts:94-95` a `10 + 2 * overhang`.
- Si no debe incluirlo, `computeSceneBounds` debe restar el alero.

## 3. CI usa una `DATABASE_URL` de SQLite

`.github/workflows/ci.yml` define `DATABASE_URL: "file:./ci.db"`, y el esquema ahora es PostgreSQL.

`prisma generate` no se conecta a la base, así que hoy no falla. Pero la variable está desactualizada, y cualquier paso futuro que use la base (migraciones o pruebas de integración) fallará.

**Solución:** usa una URL PostgreSQL ficticia, por ejemplo `postgresql://ci:ci@localhost:5432/ci`, o un servicio `postgres` en el workflow. Agrega también `DIRECT_URL`, que ahora exige el esquema.

## 4. *Sala* muestra `0.00 m²`

**Reproducir:**

1. Ejecuta `pnpm db:seed`.
2. Abre **Casa Los Robles** en el editor, en vista 2D.

La *Sala* muestra `0.00 m²`. *Cocina* muestra bien sus `20.00 m²`. Se ve en la captura [`img/13-vista-2d.png`](img/13-vista-2d.png).

La casa demo (`packages/shared/src/demo-house.ts`) define la Sala como un rectángulo de 6 × 5 m, así que se esperan **30 m²**. El problema parece estar en la detección de habitaciones, que se recalcula al cargar, o en cómo se asocia el polígono detectado a la habitación con nombre. Hay que revisar `packages/shared/src/rooms.ts`.

## 5. Atajos de la barra que no coinciden con el teclado

`toolbar.tsx` muestra `S` para **Escalera**, pero `use-shortcuts.ts` no tiene `case "s"`. Al pulsar `S` no pasa nada.

**Solución:** añade el `case "s": store.setTool("stair")` o quita el atajo del botón.

## 6. `EDITOR.md` documenta atajos que no existen

La tabla de atajos de [`docs/EDITOR.md`](../EDITOR.md) incluye `W` (mover), `E` (rotar) y `R` (escalar). No están en `use-shortcuts.ts`. Tampoco incluye los atajos nuevos `H`/`Q` (mover vista), `Tab`, `0` ni `Ctrl+A`.

**Solución:** sincronizar la tabla con [la guía de uso §2.16](02-guia-de-uso.md#216-atajos-de-teclado), que sí refleja el código actual.
