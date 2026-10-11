import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { catalogForDesign, footprint, normalizeDesign, partHeight, partTopStuds, type Brick, type Design, type CatalogContext } from './model.js';
import { partSurfaces, meshSurfaces } from './part-surfaces.js';
import { canOmitOrdinaryStuds, ordinaryStudCovers } from './covered-studs.js';

// One stud is 8 mm; the canonical vertical unit is one 3.2 mm plate.
export const METERS_PER_STUD = 0.008;
export const STUD_UNITS_PER_PLATE = 0.4;

function bodyGeometry(brick: Brick, catalog: CatalogContext, mesh?: ReturnType<typeof partSurfaces>): THREE.BufferGeometry {
  const { width, depth } = footprint(brick, catalog);
  const height = partHeight(brick, catalog);
  // Retain the small display seams used by the original brick renderer. These
  // cosmetic insets never alter canonical connection sites or part dimensions.
  const imported = !!catalog.parts[brick.partId].geometry;
  const scaleX = imported ? 1 : (width - 0.04) / width, scaleY = imported ? 1 : (depth - 0.04) / depth;
  const scaleZ = imported ? STUD_UNITS_PER_PLATE : (height * STUD_UNITS_PER_PLATE - 0.03) / height;
  const surfaces = mesh ?? partSurfaces(brick, catalog);
  const vertices = surfaces.vertices.map(([x, y, z]) => new THREE.Vector3(
    (x - brick.x - width / 2) * scaleX,
    (z - brick.z - height / 2) * scaleZ,
    (y - brick.y - depth / 2) * scaleY,
  ));
  const positions: number[] = [], normals: number[] = [];
  const curved = ['round-brick', 'round-plate', 'cone'].includes(catalog.parts[brick.partId].kind);
  for (const face of surfaces.faces) {
    const [nx, ny, nz] = face.normal;
    const outward = new THREE.Vector3(nx / scaleX, nz / scaleZ, ny / scaleY).normalize();
    for (let i = 1; i < face.indices.length - 1; i++) {
      const a = vertices[face.indices[0]], b = vertices[face.indices[i]], c = vertices[face.indices[i + 1]];
      // Swapping canonical Y/Z changes handedness. Use the declared outward
      // normal to keep both web backface culling and USDZ winding correct.
      const normal = b.clone().sub(a).cross(c.clone().sub(a));
      const triangle = normal.dot(outward) < 0 ? [a, c, b] : [a, b, c];
      triangle.forEach(point => {
        positions.push(point.x, point.y, point.z);
        let normal = outward;
        if (curved && Math.hypot(outward.x, outward.z) > 1e-8) {
          // Smooth only around a radial surface, retaining the sharp shoulder,
          // rim and groove boundaries between profile rings.
          const sign = point.x * outward.x + point.z * outward.z < 0 ? -1 : 1;
          normal = new THREE.Vector3(point.x, 0, point.z).normalize().multiplyScalar(sign * Math.hypot(outward.x, outward.z));
          normal.y = outward.y; normal.normalize();
        }
        normals.push(normal.x, normal.y, normal.z);
      });
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

function modelCenter(bricks: Brick[], catalog: CatalogContext) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const brick of bricks) {
    const { width, depth } = footprint(brick, catalog);
    minX = Math.min(minX, brick.x); minY = Math.min(minY, brick.y);
    maxX = Math.max(maxX, brick.x + width); maxY = Math.max(maxY, brick.y + depth);
  }
  return { centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}

export function createBrickModel(design: Design): THREE.Group {
  design = normalizeDesign(design);
  const catalog = catalogForDesign(design);
  const { centerX, centerY } = modelCenter(design.bricks, catalog);
  const model = new THREE.Group();
  model.name = 'BrickModel';
  const studGeometries = new Map<string, THREE.BufferGeometry>();
  const studGeometry = (hollow: boolean) => {
    const key = hollow ? 'hollow' : 'solid';
    if (!studGeometries.has(key)) studGeometries.set(key, hollow
      ? new THREE.LatheGeometry([new THREE.Vector2(0.3, -0.11), new THREE.Vector2(0.3, 0.11), new THREE.Vector2(0.2, 0.11), new THREE.Vector2(0.2, -0.11)], 32)
      : new THREE.CylinderGeometry(0.3, 0.3, 0.22, 20));
    return studGeometries.get(key)!;
  };
  const bodies = new Map<string, THREE.BufferGeometry>();
  const materials = new Map<number, THREE.MeshStandardMaterial>();
  design.bricks.forEach((brick, index) => {
    const group = new THREE.Group();
    group.name = `Brick_${index}`;
    group.userData.brickId = brick.id;
    group.userData.heightPlates = partHeight(brick, catalog);
    const { width, depth } = footprint(brick, catalog);
    const shape = `${brick.partId}:${brick.rotation}`;
    if (!bodies.has(shape)) bodies.set(shape, bodyGeometry(brick, catalog));
    if (!materials.has(brick.colorId)) materials.set(brick.colorId, new THREE.MeshStandardMaterial({ color: catalog.colors[brick.colorId].hex, roughness: 0.27, metalness: 0.03 }));
    const material = materials.get(brick.colorId)!;
    const body = new THREE.Mesh(bodies.get(shape)!, material);
    body.name = `Body_${index}`;
    body.position.set(brick.x + width / 2 - centerX, (brick.z + partHeight(brick, catalog) / 2) * STUD_UNITS_PER_PLATE - (catalog.parts[brick.partId].geometry ? 0 : 0.01), brick.y + depth / 2 - centerY);
    body.castShadow = true; body.receiveShadow = true; group.add(body);
    const imported = catalog.parts[brick.partId].geometry;
    if (imported) {
      imported.studs.forEach((source, studIndex) => {
        const stud = new THREE.Mesh(bodyGeometry(brick, catalog, meshSurfaces(brick, source.mesh, catalog)), material);
        stud.name = `Stud_${index}_${studIndex}`; stud.position.copy(body.position);
        stud.castShadow = true; stud.receiveShadow = true; group.add(stud);
      });
    }
    for (const point of imported ? [] : partTopStuds(brick, catalog)) {
      const stud = new THREE.Mesh(studGeometry(catalog.parts[brick.partId].topStudStyle === 'hollow'), material);
      stud.name = `Stud_${index}_${Math.floor(point.x - brick.x)}_${Math.floor(point.y - brick.y)}`;
      stud.position.set(point.x - centerX, point.z * STUD_UNITS_PER_PLATE + 0.08, point.y - centerY);
      stud.castShadow = true; stud.receiveShadow = true; group.add(stud);
    }
    model.add(group);
  });
  return model;
}

/** The browser batches identical pieces; native exports retain named real meshes. */
export function createInstancedBrickModel(input: Design, opaqueContext = false, options: { omitCoveredStuds?: boolean } = {}) {
  const design = normalizeDesign(input);
  const catalog = catalogForDesign(design);
  const { centerX, centerY } = modelCenter(design.bricks, catalog);
  const model = new THREE.Group();
  model.name = 'InstancedBrickModel';
  const shapes = new Map<string, { geometry: THREE.BufferGeometry; edges: THREE.EdgesGeometry }>();
  type Batch = { solid: THREE.InstancedMesh; faded: THREE.InstancedMesh };
  const batches = new Map<string, Batch>();
  const studBatches = new Map<number, Batch>();
  const covers = options.omitCoveredStuds ? ordinaryStudCovers(design, catalog) : new Map<string, string[]>();
  let studGeometry: THREE.BufferGeometry | undefined;
  const counts = new Map<string, number>();
  const studCounts = new Map<number, number>();
  const key = (brick: Brick) => `${brick.partId}:${brick.rotation}:${brick.colorId}`;
  for (const brick of design.bricks) {
    counts.set(key(brick), (counts.get(key(brick)) ?? 0) + 1);
    if (options.omitCoveredStuds && canOmitOrdinaryStuds(brick, catalog)) {
      studCounts.set(brick.colorId, (studCounts.get(brick.colorId) ?? 0) + partTopStuds(brick, catalog).length);
    }
  }
  const makeBatch = (geometry: THREE.BufferGeometry, colorId: number, count: number): Batch => {
    const material = new THREE.MeshStandardMaterial({ color: catalog.colors[colorId].hex, roughness: 0.27, metalness: 0.03 });
    const fadedMaterial = material.clone();
    if (opaqueContext) fadedMaterial.color.lerp(new THREE.Color('#eaf0ed'), 0.65);
    else { fadedMaterial.transparent = true; fadedMaterial.opacity = 0.3; fadedMaterial.depthWrite = false; }
    const solid = new THREE.InstancedMesh(geometry, material, count);
    const faded = new THREE.InstancedMesh(geometry, fadedMaterial, count);
    for (const mesh of [solid, faded]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true; mesh.receiveShadow = true;
      // Placement animation can move an instance beyond its batch bounds.
      mesh.frustumCulled = false; model.add(mesh);
    }
    return { solid, faded };
  };
  const pieces = design.bricks.map((brick, brickIndex) => {
    const splitStuds = !!options.omitCoveredStuds && canOmitOrdinaryStuds(brick, catalog);
    const shapeKey = `${brick.partId}:${brick.rotation}${splitStuds ? ':body' : ''}`;
    if (!shapes.has(shapeKey)) {
      // Reuse the exporter's exact body and stud geometry, including its seams.
      const source = createBrickModel({ ...design, bricks: [{ ...brick, x: 0, y: 0, z: 0 }] });
      const meshes = source.children[0].children as THREE.Mesh[];
      if (splitStuds && !studGeometry) studGeometry = meshes[1].geometry.clone();
      const parts = (splitStuds ? meshes.slice(0, 1) : meshes).map(mesh => {
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        geometry.deleteAttribute('uv');
        return geometry.translate(mesh.position.x, mesh.position.y, mesh.position.z);
      });
      const edges = new THREE.EdgesGeometry(parts[0], ['round-brick', 'round-plate', 'cone'].includes(catalog.parts[brick.partId].kind) ? 15 : 1);
      const geometry = mergeGeometries(parts)!;
      shapes.set(shapeKey, { geometry, edges });
      parts.forEach(part => part.dispose());
      new Set(meshes.map(mesh => mesh.geometry)).forEach(geometry => geometry.dispose());
      new Set(meshes.map(mesh => mesh.material as THREE.Material)).forEach(material => material.dispose());
    }
    const shape = shapes.get(shapeKey)!;
    const batchKey = key(brick);
    if (!batches.has(batchKey)) batches.set(batchKey, makeBatch(shape.geometry, brick.colorId, counts.get(batchKey)!));
    if (splitStuds && !studBatches.has(brick.colorId)) {
      const batch = makeBatch(studGeometry!, brick.colorId, studCounts.get(brick.colorId)!);
      studBatches.set(brick.colorId, batch); batches.set(`stud:${brick.colorId}`, batch);
    }
    const { width, depth } = footprint(brick, catalog);
    const studs = splitStuds ? partTopStuds(brick, catalog).map(site => ({
      position: new THREE.Vector3(site.x - centerX, site.z * STUD_UNITS_PER_PLATE + 0.08, site.y - centerY),
      covers: covers.get(`Stud_${brickIndex}_${Math.floor(site.x - brick.x)}_${Math.floor(site.y - brick.y)}`) ?? [],
      mesh: null as THREE.InstancedMesh | null, index: 0,
    })) : [];
    return { brick, shape, studs, batch: batches.get(batchKey)!, position: new THREE.Vector3(brick.x + width / 2 - centerX, brick.z * STUD_UNITS_PER_PLATE, brick.y + depth / 2 - centerY), mesh: null as THREE.InstancedMesh | null, index: 0 };
  });
  const edgeGeometry = new THREE.BufferGeometry();
  const outlines = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: 0x142a26, transparent: true, opacity: 0.13 }));
  const selected = new THREE.LineSegments(shapes.values().next().value!.edges, new THREE.LineBasicMaterial({ color: 0x006dff }));
  model.add(outlines, selected);
  let active: typeof pieces[number] | undefined;
  let visible: Set<string> | null = null, highlighted: Set<string> | null = null;
  let activeSettled = true;
  const activeOffset = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const updateStuds = () => {
    if (!options.omitCoveredStuds) return;
    for (const batch of studBatches.values()) { batch.solid.count = 0; batch.faded.count = 0; }
    const coverIsSettled = (id: string) => (!visible || visible.has(id))
      && (opaqueContext || !highlighted || highlighted.has(id)) && (activeSettled || id !== active?.brick.id);
    for (const piece of pieces) for (const stud of piece.studs) {
      stud.mesh = null;
      if (!piece.mesh || ((activeSettled || piece !== active) && stud.covers.some(coverIsSettled))) continue;
      const batch = studBatches.get(piece.brick.colorId)!;
      const mesh = highlighted && !highlighted.has(piece.brick.id) ? batch.faded : batch.solid;
      stud.index = mesh.count++; stud.mesh = mesh;
      const offset = piece === active ? activeOffset : null;
      mesh.setMatrixAt(stud.index, matrix.makeTranslation(stud.position.x + (offset?.x ?? 0), stud.position.y + (offset?.y ?? 0), stud.position.z + (offset?.z ?? 0)));
    }
    for (const batch of studBatches.values()) for (const mesh of [batch.solid, batch.faded]) {
      mesh.visible = mesh.count > 0; mesh.instanceMatrix.needsUpdate = true;
    }
  };
  const update = (visibleIds?: string[], highlightIds?: string[], activeId?: string) => {
    visible = visibleIds ? new Set(visibleIds) : null;
    highlighted = highlightIds ? new Set(highlightIds) : null;
    const positions: number[] = [];
    for (const batch of batches.values()) { batch.solid.count = 0; batch.faded.count = 0; }
    active = undefined;
    activeOffset.set(0, 0, 0); activeSettled = !activeId;
    for (const piece of pieces) {
      piece.mesh = null;
      if (visible && !visible.has(piece.brick.id)) continue;
      const mesh = highlighted && !highlighted.has(piece.brick.id) ? piece.batch.faded : piece.batch.solid;
      const index = mesh.count++;
      mesh.setMatrixAt(index, matrix.makeTranslation(piece.position.x, piece.position.y, piece.position.z));
      piece.mesh = mesh; piece.index = index;
      if (piece.brick.id === activeId) { active = piece; continue; }
      const edges = piece.shape.edges.getAttribute('position');
      for (let i = 0; i < edges.count; i++) positions.push(edges.getX(i) + piece.position.x, edges.getY(i) + piece.position.y, edges.getZ(i) + piece.position.z);
    }
    updateStuds();
    for (const batch of batches.values()) for (const mesh of [batch.solid, batch.faded]) {
      mesh.visible = mesh.count > 0; mesh.instanceMatrix.needsUpdate = true;
    }
    edgeGeometry.dispose();
    edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    edgeGeometry.computeBoundingSphere();
    selected.visible = !!active;
    if (active) { selected.geometry = active.shape.edges; selected.position.copy(active.position); }
  };
  const setOffset = (x: number, y: number, z: number) => {
    if (!active?.mesh) return;
    activeOffset.set(x, y, z);
    const settled = x === 0 && y === 0 && z === 0;
    if (settled !== activeSettled) { activeSettled = settled; updateStuds(); }
    active.mesh.setMatrixAt(active.index, matrix.makeTranslation(active.position.x + x, active.position.y + y, active.position.z + z));
    active.mesh.instanceMatrix.needsUpdate = true;
    for (const stud of active.studs) if (stud.mesh) {
      stud.mesh.setMatrixAt(stud.index, matrix.makeTranslation(stud.position.x + x, stud.position.y + y, stud.position.z + z));
      stud.mesh.instanceMatrix.needsUpdate = true;
    }
    selected.position.set(active.position.x + x, active.position.y + y, active.position.z + z);
  };
  const setLift = (lift: number) => setOffset(0, lift, 0);
  update();
  const dispose = () => {
    for (const shape of shapes.values()) { shape.geometry.dispose(); shape.edges.dispose(); }
    studGeometry?.dispose();
    for (const batch of batches.values()) for (const mesh of [batch.solid, batch.faded]) {
      mesh.dispose(); (mesh.material as THREE.Material).dispose();
    }
    edgeGeometry.dispose(); outlines.material.dispose(); selected.material.dispose();
  };
  return { model, update, setLift, setOffset, dispose };
}
