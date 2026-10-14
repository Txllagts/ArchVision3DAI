# GLB Import Support Implementation Plan

## Overview
Enable users to upload `.glb` files directly in the plan import panel and render them in the 3D viewport using Three.js GLTFLoader, bypassing the 2D vectorization pipeline.

## Affected Files

### 1. `packages/config/src/uploads.ts` ✓ (Already configured)
- `ACCEPTED_MODEL_MIME` includes `model/gltf-binary`
- `ACCEPTED_MODEL_EXTENSIONS` includes `.glb`

### 2. `apps/web/src/lib/storage/sniff.ts` (Needs update)
**Current**: Only detects PNG, JPEG, WebP, PDF
**Required**: Add GLB/GLTF detection
- GLB header: `glTF` at offset 4 (uint32 magic number 0x46546C67)
- GLTF JSON: starts with `{` and contains "asset" with "version": "2.0"

### 3. `apps/web/src/lib/projects/file-service.ts` (Needs update)
**Current**: `ACCEPTED_BY_KIND.model = []` (empty)
**Required**: Add `model/gltf-binary` and `model/gltf+json` to model kind

### 4. `apps/web/src/components/editor/plan-import-panel.tsx` (Major update)
**Current**: Only accepts images/PDF for floorplan kind
**Required**:
- Add `model/gltf-binary` to file input `accept` attribute
- Update help text: "PNG, JPG, WebP, PDF o GLB"
- Add logic branch in `upload()` to detect `.glb` files
- For GLB: skip underlay creation, store as `kind: "model"`, load directly into 3D viewer
- Add new state for tracking imported 3D models

### 5. `apps/web/src/lib/editor/store.ts` (Needs update)
**Current**: No support for imported 3D models in scene
**Required**:
- Add `importedModels` array to SceneDocument or editor state
- Each model: `{ id, fileId, url, position, rotation, scale, visible }`
- Add actions: `addImportedModel`, `removeImportedModel`, `updateImportedModel`

### 6. `apps/web/src/components/editor/viewport-3d.tsx` (Needs update)
**Current**: Renders only parametric entities
**Required**:
- Add `ImportedModelObject` component using `useGLTF` (like `FurnitureModel`)
- Render imported models in `SceneContent`
- Support selection, hover, transform for imported models

### 6b. `apps/web/src/components/editor/scene-objects.tsx` (Needs update)
- Add `ImportedModelObject` component following `FurnitureModel` pattern
- Handle centering, scaling, ground alignment

### 7. `packages/types/src/entities.ts` (Needs update)
**Required**: Add `ImportedModel` entity type
```typescript
export interface ImportedModel {
  id: EntityId;
  floorId: EntityId;
  name: string;
  fileId: EntityId;  // Reference to ProjectFile
  url: string;       // Download URL
  position: Vector3;
  rotation: Euler3;
  scale: Vector3;
  visible: boolean;
  locked: boolean;
}
```
- Add "imported-model" to `SCENE_OBJECT_TYPES`

### 8. `packages/types/src/scene.ts` (Needs update)
- Add `importedModels: ImportedModel[]` to `SceneDocument`

### 9. `packages/types/src/commands.ts` (Needs update)
- Add commands: `CREATE_IMPORTED_MODEL`, `UPDATE_IMPORTED_MODEL`, `DELETE_IMPORTED_MODEL`

### 10. `packages/shared/src/geometry/` (May need update)
- Add geometry key for imported models if needed for caching

## Implementation Flow

### Phase 1: Backend File Support
1. Update `sniff.ts` to detect GLB/GLTF
2. Update `file-service.ts` ACCEPTED_BY_KIND for model kind
3. Test file upload API accepts GLB as kind="model"

### Phase 2: Frontend Upload UI
1. Update `plan-import-panel.tsx` file input accept types
2. Update help text
3. Add GLB detection in upload handler
4. For GLB: upload with kind="model", skip underlay, trigger 3D model load

### Phase 3: 3D Model Integration
1. Add ImportedModel entity to types
2. Add commands for CRUD operations
3. Update SceneDocument
4. Add ImportedModelObject component
5. Integrate into viewport-3d.tsx SceneContent
6. Add to editor store with actions

### Phase 4: Model Loading & Display
- Use `@react-three/drei/useGLTF` for loading (same as model-preview.tsx)
- Auto-center and ground model (like FurnitureModel)
- Apply user-adjustable scale/position/rotation
- Support selection, transform gizmo

## Edge Cases & Validation
- GLB files can be large (up to 50MB per config) - ensure upload handles this
- Invalid GLB files - sniff.ts should reject non-GLB files
- Model scale: GLB units are meters, same as scene - but may need normalization
- Multiple imported models per project
- Persistence: model references saved in SceneDocument, file stored in ProjectFile

## Testing Checklist
- [ ] Upload .glb file via plan import panel
- [ ] File appears in project files list with kind="model"
- [ ] Model renders in 3D viewport centered at origin
- [ ] Model can be selected, moved, rotated, scaled
- [ ] Model persists across editor reloads
- [ ] Multiple models can be imported
- [ ] Non-GLB files rejected with clear error
- [ ] Large GLB files handled correctly

## Out of Scope
- GLTF (.gltf) format (can be added later)
- Drag-and-drop directly onto 3D viewport (separate feature)
- Model format conversion (OBJ, STL, FBX)
- Material editing for imported models
- Animation support in GLB