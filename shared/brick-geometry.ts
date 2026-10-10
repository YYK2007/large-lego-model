import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS, PARTS, footprint, normalizeDesign, partHeight, partTopStuds, type Brick, type Design } from './model.js';
import { partSurfaces } from './part-surfaces.js';

// One stud is 8 mm; the canonical vertical unit is one 3.2 mm plate.
export const METERS_PER_STUD = 0.008;
export const STUD_UNITS_PER_PLATE = 0.4;

function bodyGeometry(brick: Brick): THREE.BufferGeometry {
  const { width, depth } = footprint(brick);
  const height = partHeight(brick);
  // Retain the small display seams used by the original brick renderer. These
  // cosmetic insets never alter canonical connection sites or part dimensions.
  const scaleX = (width - 0.04) / width, scaleY = (depth - 0.04) / depth;
  const scaleZ = (height * STUD_UNITS_PER_PLATE - 0.03) / height;
  const surfaces = partSurfaces(brick);
  const vertices = surfaces.vertices.map(([x, y, z]) => new THREE.Vector3(
    (x - brick.x - width / 2) * scaleX,
    (z - brick.z - height / 2) * scaleZ,
    (y - brick.y - depth / 2) * scaleY,
  ));
  const positions: number[] = [], normals: number[] = [];
  const curved = ['round-brick', 'round-plate', 'cone'].includes(PARTS[brick.partId].kind);
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

function modelCenter(bricks: Brick[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const brick of bricks) {
    const { width, depth } = footprint(brick);
    minX = Math.min(minX, brick.x); minY = Math.min(minY, brick.y);
    maxX = Math.max(maxX, brick.x + width); maxY = Math.max(maxY, brick.y + depth);
  }
  return { centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}

export function createBrickModel(design: Design): THREE.Group {
  design = normalizeDesign(design);
  const { centerX, centerY } = modelCenter(design.bricks);
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
    group.userData.heightPlates = partHeight(brick);
    const { width, depth } = footprint(brick);
    const shape = `${brick.partId}:${brick.rotation}`;
    if (!bodies.has(shape)) bodies.set(shape, bodyGeometry(brick));
    if (!materials.has(brick.colorId)) materials.set(brick.colorId, new THREE.MeshStandardMaterial({ color: COLORS[brick.colorId].hex, roughness: 0.27, metalness: 0.03 }));
    const material = materials.get(brick.colorId)!;
    const body = new THREE.Mesh(bodies.get(shape)!, material);
    body.name = `Body_${index}`;
    body.position.set(brick.x + width / 2 - centerX, (brick.z + partHeight(brick) / 2) * STUD_UNITS_PER_PLATE - 0.01, brick.y + depth / 2 - centerY);
    body.castShadow = true; body.receiveShadow = true; group.add(body);
    for (const point of partTopStuds(brick)) {
      const stud = new THREE.Mesh(studGeometry(PARTS[brick.partId].topStudStyle === 'hollow'), material);
      stud.name = `Stud_${index}_${Math.floor(point.x - brick.x)}_${Math.floor(point.y - brick.y)}`;
      stud.position.set(point.x - centerX, point.z * STUD_UNITS_PER_PLATE + 0.08, point.y - centerY);
      stud.castShadow = true; stud.receiveShadow = true; group.add(stud);
    }
    model.add(group);
  });
  return model;
}

/** The browser batches identical pieces; native exports retain named real meshes. */
export function createInstancedBrickModel(input: Design) {
  const design = normalizeDesign(input);
  const { centerX, centerY } = modelCenter(design.bricks);
  const model = new THREE.Group();
  model.name = 'InstancedBrickModel';
  const shapes = new Map<string, { geometry: THREE.BufferGeometry; edges: THREE.EdgesGeometry }>();
  type Batch = { solid: THREE.InstancedMesh; faded: THREE.InstancedMesh };
  const batches = new Map<string, Batch>();
  const counts = new Map<string, number>();
  const key = (brick: Brick) => `${brick.partId}:${brick.rotation}:${brick.colorId}`;
  for (const brick of design.bricks) counts.set(key(brick), (counts.get(key(brick)) ?? 0) + 1);
  const pieces = design.bricks.map(brick => {
    const shapeKey = `${brick.partId}:${brick.rotation}`;
    if (!shapes.has(shapeKey)) {
      // Reuse the exporter's exact body and stud geometry, including its seams.
      const source = createBrickModel({ ...design, bricks: [{ ...brick, x: 0, y: 0, z: 0 }] });
      const meshes = source.children[0].children as THREE.Mesh[];
      const parts = meshes.map(mesh => {
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        geometry.deleteAttribute('uv');
        return geometry.translate(mesh.position.x, mesh.position.y, mesh.position.z);
      });
      const edges = new THREE.EdgesGeometry(parts[0], ['round-brick', 'round-plate', 'cone'].includes(PARTS[brick.partId].kind) ? 15 : 1);
      const geometry = mergeGeometries(parts)!;
      shapes.set(shapeKey, { geometry, edges });
      parts.forEach(part => part.dispose());
      new Set(meshes.map(mesh => mesh.geometry)).forEach(geometry => geometry.dispose());
      new Set(meshes.map(mesh => mesh.material as THREE.Material)).forEach(material => material.dispose());
    }
    const shape = shapes.get(shapeKey)!;
    const batchKey = key(brick);
    if (!batches.has(batchKey)) {
      const material = new THREE.MeshStandardMaterial({ color: COLORS[brick.colorId].hex, roughness: 0.27, metalness: 0.03 });
      const fadedMaterial = material.clone();
      fadedMaterial.transparent = true; fadedMaterial.opacity = 0.3; fadedMaterial.depthWrite = false;
      const solid = new THREE.InstancedMesh(shape.geometry, material, counts.get(batchKey)!);
      const faded = new THREE.InstancedMesh(shape.geometry, fadedMaterial, counts.get(batchKey)!);
      for (const mesh of [solid, faded]) {
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = true; mesh.receiveShadow = true;
        // The whole model is fitted to the camera; placement animation can move
        // an instance beyond a previously computed batch bounding sphere.
        mesh.frustumCulled = false;
        model.add(mesh);
      }
      batches.set(batchKey, { solid, faded });
    }
    const { width, depth } = footprint(brick);
    return { brick, shape, batch: batches.get(batchKey)!, position: new THREE.Vector3(brick.x + width / 2 - centerX, brick.z * STUD_UNITS_PER_PLATE, brick.y + depth / 2 - centerY), mesh: null as THREE.InstancedMesh | null, index: 0 };
  });
  const edgeGeometry = new THREE.BufferGeometry();
  const outlines = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: 0x142a26, transparent: true, opacity: 0.13 }));
  const selected = new THREE.LineSegments(shapes.values().next().value!.edges, new THREE.LineBasicMaterial({ color: 0x006dff }));
  model.add(outlines, selected);
  let active: typeof pieces[number] | undefined;
  const matrix = new THREE.Matrix4();
  const update = (visibleIds?: string[], highlightIds?: string[], activeId?: string) => {
    const visible = visibleIds ? new Set(visibleIds) : null;
    const highlighted = highlightIds ? new Set(highlightIds) : null;
    const positions: number[] = [];
    for (const batch of batches.values()) { batch.solid.count = 0; batch.faded.count = 0; }
    active = undefined;
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
    active.mesh.setMatrixAt(active.index, matrix.makeTranslation(active.position.x + x, active.position.y + y, active.position.z + z));
    active.mesh.instanceMatrix.needsUpdate = true;
    selected.position.set(active.position.x + x, active.position.y + y, active.position.z + z);
  };
  const setLift = (lift: number) => setOffset(0, lift, 0);
  update();
  const dispose = () => {
    for (const shape of shapes.values()) { shape.geometry.dispose(); shape.edges.dispose(); }
    for (const batch of batches.values()) for (const mesh of [batch.solid, batch.faded]) {
      mesh.dispose(); (mesh.material as THREE.Material).dispose();
    }
    edgeGeometry.dispose(); outlines.material.dispose(); selected.material.dispose();
  };
  return { model, update, setLift, setOffset, dispose };
}
