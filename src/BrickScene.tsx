import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RotateCcw, Rotate3D, Grid2X2, Focus, AlertCircle } from 'lucide-react';
import { catalogForDesign, footprint, normalizeDesign, partHeight, type Design } from '../shared/model';
import { createInstancedBrickModel, STUD_UNITS_PER_PLATE } from '../shared/brick-geometry';
import { placementOffset, type Placement } from '../shared/assembly';
import { frameDistance } from './scene-framing';

export function BrickScene({ design, visibleIds, highlightIds, activeId, replayKey, placement }: { design: Design; visibleIds?: string[]; highlightIds?: string[]; activeId?: string; replayKey?: number; placement?: Placement }) {
  const host = useRef<HTMLDivElement>(null);
  const actions = useRef<{ reset(): void; front(): void; top(): void; rotate(value: boolean): void } | null>(null);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState(false);
  const visibility = useRef({ visibleIds, highlightIds, activeId, placement });
  visibility.current = { visibleIds, highlightIds, activeId, placement };
  const placementAnimation = useRef({ id: activeId, start: 0 });
  useEffect(() => { placementAnimation.current = { id: activeId, start: performance.now() }; }, [activeId, replayKey, design]);

  useEffect(() => {
    const container = host.current!;
    const canonical = normalizeDesign(design);
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { setError(true); return; }
    setError(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', `Interactive 3D model of ${design.title}. Drag to rotate, scroll to zoom.`);
    const scene = new THREE.Scene();
    const initialSize = container.getBoundingClientRect();
    const camera = new THREE.PerspectiveCamera(35, Math.max(initialSize.width, 1) / Math.max(initialSize.height, 1), 0.1, 400);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minPolarAngle = 0.02;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = 8;
    controls.autoRotateSpeed = 1.3;
    const catalog = catalogForDesign(canonical);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, height = 0, liftHeight = 0;
    for (const brick of canonical.bricks) {
      const size = footprint(brick, catalog), plates = partHeight(brick, catalog);
      minX = Math.min(minX, brick.x); maxX = Math.max(maxX, brick.x + size.width);
      minY = Math.min(minY, brick.y); maxY = Math.max(maxY, brick.y + size.depth);
      height = Math.max(height, (brick.z + plates) * STUD_UNITS_PER_PLATE);
      liftHeight = Math.max(liftHeight, (plates + 2) * STUD_UNITS_PER_PLATE);
    }
    const width = maxX - minX, depth = maxY - minY;
    const pedestalRadius = Math.max(Math.max(width, depth) * 0.58 + 2, Math.hypot(width, depth) / 2 + 0.8);
    const points = [-width / 2, width / 2].flatMap(x => [-depth / 2, depth / 2].flatMap(z =>
      [0, height + 0.2 + liftHeight].map(y => new THREE.Vector3(x, y, z))));
    for (let index = 0; index < 24; index++) {
      const angle = index * Math.PI / 12;
      points.push(new THREE.Vector3((pedestalRadius + 0.3) * Math.cos(angle), -0.54, (pedestalRadius + 0.3) * Math.sin(angle)));
    }
    const diagonal = Math.hypot(width, depth, height + liftHeight);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xa0bbae, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 3.4);
    const sunDirection = new THREE.Vector3(-15, 30, 20).normalize();
    sun.target.position.set(0, height / 2, 0);
    sun.position.copy(sun.target.position).addScaledVector(sunDirection, Math.max(Math.hypot(15, 30, 20), diagonal * 1.8));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);
    // Include where the model's shadow reaches the floor, so tall builds do
    // not lose shadows beyond the old fixed light frustum.
    const shadowPoints = points.flatMap(point => [point, point.clone().addScaledVector(sunDirection, -(point.y + 0.54) / sunDirection.y)]);
    sun.shadow.camera.position.copy(sun.position);
    sun.shadow.camera.lookAt(sun.target.position);
    sun.shadow.camera.updateMatrixWorld();
    const shadowBounds = new THREE.Box3().setFromPoints(shadowPoints.map(point => point.clone().applyMatrix4(sun.shadow.camera.matrixWorldInverse)));
    const shadowMargin = Math.max(2, diagonal * 0.03);
    sun.shadow.camera.left = shadowBounds.min.x - shadowMargin; sun.shadow.camera.right = shadowBounds.max.x + shadowMargin;
    sun.shadow.camera.bottom = shadowBounds.min.y - shadowMargin; sun.shadow.camera.top = shadowBounds.max.y + shadowMargin;
    sun.shadow.camera.near = Math.max(0.1, -shadowBounds.max.z - shadowMargin);
    sun.shadow.camera.far = -shadowBounds.min.z + shadowMargin;
    sun.shadow.camera.updateProjectionMatrix();
    const fill = new THREE.DirectionalLight(0xb9e2ff, 1.1);
    fill.target.position.set(0, height / 2, 0);
    fill.position.set(15, 10, -10).multiplyScalar(Math.max(1, diagonal / 32)).add(fill.target.position);
    scene.add(fill, fill.target);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(pedestalRadius, pedestalRadius, 0.45, 96), new THREE.MeshStandardMaterial({ color: 0xf5faf4, roughness: 0.65 }));
    pedestal.position.y = -0.3; pedestal.receiveShadow = true; scene.add(pedestal);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(pedestalRadius + 0.28, 0.015, 8, 120), new THREE.MeshBasicMaterial({ color: 0xa9c8ba }));
    ring.rotation.x = Math.PI / 2; ring.position.y = -0.53; scene.add(ring);
    const floorSize = Math.max(200, 2 * (pedestalRadius + (height + liftHeight) * Math.hypot(sunDirection.x, sunDirection.z) / sunDirection.y + 8));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorSize, floorSize), new THREE.ShadowMaterial({ opacity: 0.1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.54; floor.receiveShadow = true; scene.add(floor);
    const instances = createInstancedBrickModel(canonical);
    scene.add(instances.model);
    const distance = Math.max(height * 2.6, width * 2.7, depth * 2.7, 28);
    const updateRange = (fittedDistance: number) => {
      controls.maxDistance = Math.max(95, fittedDistance * 3, diagonal * 5);
      camera.far = Math.max(400, controls.maxDistance + floorSize + height);
      camera.updateProjectionMatrix();
    };
    const frame = (direction: THREE.Vector3, up: THREE.Vector3, target: THREE.Vector3, minimum: number) => {
      camera.up.copy(up); controls.target.copy(target);
      const fittedDistance = frameDistance(points, target, direction, up, camera.fov, camera.aspect, minimum);
      updateRange(fittedDistance);
      camera.position.copy(target).addScaledVector(direction.normalize(), fittedDistance);
      controls.update();
    };
    const reset = () => {
      const direction = new THREE.Vector3(distance * 0.46, height * 0.03 + distance * 0.36, distance * 0.85);
      frame(direction, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, height * 0.47, 0), direction.length());
    };
    reset();
    actions.current = {
      reset,
      front: () => frame(new THREE.Vector3(0, Math.cos(controls.maxPolarAngle), Math.sin(controls.maxPolarAngle)), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, height * 0.47, 0), distance),
      top: () => frame(new THREE.Vector3(0, Math.cos(controls.minPolarAngle), Math.sin(controls.minPolarAngle)), new THREE.Vector3(0, 0, -1), new THREE.Vector3(), Math.max(height + 20, width * 2.7, depth * 2.7, 28)),
      rotate: value => { controls.autoRotate = value; },
    };
    setRotating(false);
    let dirty = true;
    controls.addEventListener('change', () => { dirty = true; });
    const observer = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      const direction = camera.position.clone().sub(controls.target);
      const fittedDistance = frameDistance(points, controls.target, direction, camera.up, camera.fov, camera.aspect, direction.length());
      updateRange(fittedDistance);
      camera.position.copy(controls.target).addScaledVector(direction.normalize(), fittedDistance);
      controls.update(); dirty = true;
    });
    observer.observe(container);
    let animationFrame = 0;
    let lastVisibility: typeof visibility.current | undefined;
    let previousOffset = '';
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const { visibleIds, highlightIds, activeId, placement } = visibility.current;
      if (lastVisibility !== visibility.current) {
        instances.update(visibleIds, highlightIds, activeId);
        lastVisibility = visibility.current;
        previousOffset = '';
        renderer.shadowMap.needsUpdate = true;
        dirty = true;
      }
      const elapsed = Math.min(1, (performance.now() - placementAnimation.current.start) / (placement?.approach === 'above' ? 700 : 1400));
      const offset = activeId && placement && !reducedMotion.matches && placementAnimation.current.id === activeId
        ? placementOffset(placement, elapsed) : { x: 0, y: 0, z: 0 };
      const offsetKey = `${offset.x},${offset.y},${offset.z}`;
      if (offsetKey !== previousOffset) {
        instances.setOffset(offset.x, offset.z * STUD_UNITS_PER_PLATE, offset.y);
        previousOffset = offsetKey;
        renderer.shadowMap.needsUpdate = true;
        dirty = true;
      }
      if (controls.update()) dirty = true;
      if (dirty) { renderer.render(scene, camera); dirty = false; }
    };
    animate();
    return () => { cancelAnimationFrame(animationFrame); observer.disconnect(); controls.dispose(); instances.dispose(); scene.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(material => material.dispose()); } }); renderer.dispose(); renderer.domElement.remove(); actions.current = null; };
  }, [design]);

  return <div className="scene-wrap">
    <div ref={host} className="scene-canvas" />
    {error && <div className="scene-error"><AlertCircle /><p>Your browser couldn’t start 3D. The parts list and PDF are still available.</p></div>}
    <div className="scene-guide"><span className="tiny-dot" /> DRAG TO EXPLORE <span className="guide-separator">/</span> SCROLL TO ZOOM</div>
    <div className="scene-tools">
      <button title="Reset camera" aria-label="Reset camera" onClick={() => actions.current?.reset()}><Focus size={17} /></button>
      <button title="Top view: +X right, +Y down" aria-label="View from above" onClick={() => { actions.current?.top(); actions.current?.rotate(false); setRotating(false); }}><Grid2X2 size={17} /></button>
      <span />
      <button title="Auto rotate" aria-label="Auto rotate" aria-pressed={rotating} className={rotating ? 'active' : ''} onClick={() => { actions.current?.rotate(!rotating); setRotating(!rotating); }}><Rotate3D size={18} /></button>
      <button title="Return to front" aria-label="Return to front" onClick={() => { actions.current?.front(); actions.current?.rotate(false); setRotating(false); }}><RotateCcw size={16} /></button>
    </div>
  </div>;
}
