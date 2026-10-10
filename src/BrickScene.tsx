import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RotateCcw, Rotate3D, Grid2X2, Focus, AlertCircle } from 'lucide-react';
import { footprint, normalizeDesign, partHeight, type Design } from '../shared/model';
import { createInstancedBrickModel, STUD_UNITS_PER_PLATE } from '../shared/brick-geometry';

export function BrickScene({ design, visibleIds, highlightIds, activeId, replayKey }: { design: Design; visibleIds?: string[]; highlightIds?: string[]; activeId?: string; replayKey?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const actions = useRef<{ reset(): void; front(): void; top(): void; rotate(value: boolean): void } | null>(null);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState(false);
  const visibility = useRef({ visibleIds, highlightIds, activeId });
  visibility.current = { visibleIds, highlightIds, activeId };
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
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 400);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minPolarAngle = 0.02;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = 8;
    controls.maxDistance = 95;
    controls.autoRotateSpeed = 1.3;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xa0bbae, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 3.4);
    sun.position.set(-15, 30, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -25; sun.shadow.camera.right = 25;
    sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -25;
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xb9e2ff, 1.1);
    fill.position.set(15, 10, -10); scene.add(fill);
    const minX = Math.min(...canonical.bricks.map(b => b.x));
    const maxX = Math.max(...canonical.bricks.map(b => b.x + footprint(b).width));
    const minY = Math.min(...canonical.bricks.map(b => b.y));
    const maxY = Math.max(...canonical.bricks.map(b => b.y + footprint(b).depth));
    const height = Math.max(...canonical.bricks.map(b => b.z + partHeight(b))) * STUD_UNITS_PER_PLATE;
    const width = maxX - minX, depth = maxY - minY;
    const pedestalRadius = Math.max(width, depth) * 0.58 + 2;
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(pedestalRadius, pedestalRadius, 0.45, 96), new THREE.MeshStandardMaterial({ color: 0xf5faf4, roughness: 0.65 }));
    pedestal.position.y = -0.3; pedestal.receiveShadow = true; scene.add(pedestal);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(pedestalRadius + 0.28, 0.015, 8, 120), new THREE.MeshBasicMaterial({ color: 0xa9c8ba }));
    ring.rotation.x = Math.PI / 2; ring.position.y = -0.53; scene.add(ring);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.54; floor.receiveShadow = true; scene.add(floor);
    const instances = createInstancedBrickModel(canonical);
    scene.add(instances.model);
    const distance = Math.max(height * 2.6, width * 2.7, depth * 2.7, 28);
    const reset = () => { camera.up.set(0, 1, 0); camera.position.set(distance * 0.46, height / 2 + distance * 0.36, distance * 0.85); controls.target.set(0, height * 0.47, 0); controls.update(); };
    reset();
    actions.current = {
      reset,
      front: () => { camera.up.set(0, 1, 0); camera.position.set(0, height * 0.47 + 0.1, distance); controls.target.set(0, height * 0.47, 0); controls.update(); },
      top: () => { camera.up.set(0, 0, -1); camera.position.set(0, Math.max(height + 20, distance), 0.001); controls.target.set(0, 0, 0); controls.update(); },
      rotate: value => { controls.autoRotate = value; },
    };
    setRotating(false);
    let dirty = true;
    controls.addEventListener('change', () => { dirty = true; });
    const observer = new ResizeObserver(() => { const { width, height } = container.getBoundingClientRect(); renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); dirty = true; });
    observer.observe(container);
    let frame = 0;
    let lastVisibility: typeof visibility.current | undefined;
    let previousLift = -1;
    const heights = new Map(canonical.bricks.map(brick => [brick.id, partHeight(brick)]));
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const { visibleIds, highlightIds, activeId } = visibility.current;
      if (lastVisibility !== visibility.current) {
        instances.update(visibleIds, highlightIds, activeId);
        lastVisibility = visibility.current;
        previousLift = -1;
        renderer.shadowMap.needsUpdate = true;
        dirty = true;
      }
      const elapsed = Math.min(1, (performance.now() - placementAnimation.current.start) / 550);
      // A display cue only: this does not simulate or certify an insertion path.
      const lift = activeId && !reducedMotion.matches && placementAnimation.current.id === activeId
        ? ((heights.get(activeId) ?? 0) + 2) * STUD_UNITS_PER_PLATE * (1 - elapsed) ** 3 : 0;
      if (lift !== previousLift) {
        instances.setLift(lift);
        previousLift = lift;
        renderer.shadowMap.needsUpdate = true;
        dirty = true;
      }
      if (controls.update()) dirty = true;
      if (dirty) { renderer.render(scene, camera); dirty = false; }
    };
    animate();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); instances.dispose(); scene.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(material => material.dispose()); } }); renderer.dispose(); renderer.domElement.remove(); actions.current = null; };
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
