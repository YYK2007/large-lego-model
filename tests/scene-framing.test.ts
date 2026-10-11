import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { frameDistance } from '../src/scene-framing';

test('landscape and portrait cameras contain tall, wide and small models from every preset', () => {
  for (const [width, depth, height] of [[96, 96, 154], [12, 12, 154], [96, 24, 8], [8, 6, 10]]) {
    const radius = Math.hypot(width, depth) / 2 + 3;
    const points = [-width / 2, width / 2].flatMap(x => [-depth / 2, depth / 2].flatMap(z =>
      [0, height + 3].map(y => new Vector3(x, y, z))));
    for (let index = 0; index < 24; index++) points.push(new Vector3(radius * Math.cos(index * Math.PI / 12), -0.54, radius * Math.sin(index * Math.PI / 12)));
    const center = new Vector3(0, height * 0.47, 0);
    const presets = [
      { direction: new Vector3(0.46, 0.36, 0.85), up: new Vector3(0, 1, 0), target: center },
      { direction: new Vector3(0, Math.sin(0.04), Math.cos(0.04)), up: new Vector3(0, 1, 0), target: center },
      { direction: new Vector3(0, Math.cos(0.02), Math.sin(0.02)), up: new Vector3(0, 0, -1), target: new Vector3() },
    ];
    for (const aspect of [2, 1, 0.5, 0.3]) for (const { direction, up, target } of presets) {
      const distance = frameDistance(points, target, direction, up, 35, aspect, 28);
      const camera = new PerspectiveCamera(35, aspect, 0.1, distance * 4 + height);
      const controls = new OrbitControls(camera, null);
      camera.up.copy(up);
      camera.position.copy(target).addScaledVector(direction.clone().normalize(), distance);
      camera.lookAt(target); camera.updateMatrixWorld();
      for (const point of points) {
        const projected = point.clone().project(camera);
        assert.ok(Math.abs(projected.x) <= 1 / 1.12 + 1e-8 && Math.abs(projected.y) <= 1 / 1.12 + 1e-8,
          `${width}×${depth}×${height}, aspect ${aspect} clips ${point.toArray()} at ${projected.toArray()}`);
        assert.ok(projected.z > -1 && projected.z < 1, 'Model must remain between camera near/far planes');
      }
      // OrbitControls applies polar and distance limits after a preset. Verify
      // those real controls cannot pull the fitted camera back inside a build.
      controls.target.copy(target);
      controls.minPolarAngle = 0.02; controls.maxPolarAngle = Math.PI / 2 - 0.04;
      controls.minDistance = 8; controls.maxDistance = Math.max(95, distance * 3);
      controls.update(); camera.updateMatrixWorld();
      for (const point of points) {
        const projected = point.clone().project(camera);
        assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && projected.z > -1 && projected.z < 1,
          `Orbit constraints clip ${width}×${depth}×${height} at aspect ${aspect}`);
      }
    }
  }
});

test('fitting preserves familiar minimum distance and increases range for a narrow portrait', () => {
  const points = [new Vector3(-2, 0, -2), new Vector3(2, 4, 2)];
  const target = new Vector3(0, 2, 0), direction = new Vector3(0, 0, 1), up = new Vector3(0, 1, 0);
  assert.equal(frameDistance(points, target, direction, up, 35, 1, 28), 28);
  const tall = [new Vector3(-48, 0, -48), new Vector3(48, 154, 48)];
  const landscape = frameDistance(tall, target, direction, up, 35, 2);
  const portrait = frameDistance(tall, target, direction, up, 35, 0.2);
  assert.ok(portrait > landscape && portrait > 95, 'Expanded models must not inherit the old 95-unit orbit limit');
});
