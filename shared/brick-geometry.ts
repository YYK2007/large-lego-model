import * as THREE from 'three';
import { COLORS, footprint, type Design } from './model.js';

// Viewer units: one stud is 8 mm, one full brick layer is 1.2 units (9.6 mm).
export const METERS_PER_STUD = 0.008;

export function createBrickModel(design: Design): THREE.Group {
  const minX = Math.min(...design.bricks.map(brick => brick.x));
  const maxX = Math.max(...design.bricks.map(brick => brick.x + footprint(brick).width));
  const minY = Math.min(...design.bricks.map(brick => brick.y));
  const maxY = Math.max(...design.bricks.map(brick => brick.y + footprint(brick).depth));
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
  const model = new THREE.Group();
  model.name = 'BrickModel';
  const studGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.22, 20);
  design.bricks.forEach((brick, index) => {
    const group = new THREE.Group();
    group.name = `Brick_${index}`;
    group.userData.brickId = brick.id;
    const { width, depth } = footprint(brick);
    const material = new THREE.MeshStandardMaterial({ color: COLORS[brick.colorId].hex, roughness: 0.27, metalness: 0.03 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(width - 0.04, 1.17, depth - 0.04), material);
    body.name = `Body_${index}`;
    body.position.set(brick.x + width / 2 - centerX, brick.z * 1.2 + 0.59, brick.y + depth / 2 - centerY);
    body.castShadow = true; body.receiveShadow = true; group.add(body);
    for (let x = 0; x < width; x++) for (let y = 0; y < depth; y++) {
      const stud = new THREE.Mesh(studGeometry, material);
      stud.name = `Stud_${index}_${x}_${y}`;
      stud.position.set(brick.x + x + 0.5 - centerX, brick.z * 1.2 + 1.28, brick.y + y + 0.5 - centerY);
      stud.castShadow = true; stud.receiveShadow = true; group.add(stud);
    }
    model.add(group);
  });
  return model;
}
