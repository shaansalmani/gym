import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/shaders/FXAAShader.js';
import { BokehPass } from 'https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/postprocessing/BokehPass.js';

const canvas = document.querySelector('#webgl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
renderer.useLegacyLights = false;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#fbf7f2');

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0.9, 3.2);

const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const envMap = pmrem.fromScene(room, 0.04).texture;
scene.environment = envMap;
pmrem.dispose();

const ambient = new THREE.AmbientLight(0xffffff, 0.18);
scene.add(ambient);
const key = new THREE.DirectionalLight(0xffffff, 1.2);
key.position.set(2.8, 5.2, 1.8); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -6; key.shadow.camera.right = 6; key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.45); fill.position.set(-3, -1, -2); scene.add(fill);
const rim = new THREE.PointLight(0xffffff, 0.18, 10); rim.position.set(-2, 2, -2); scene.add(rim);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -1.2; ground.receiveShadow = true; scene.add(ground);

const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = 512; shadowCanvas.height = 512;
const sctx = shadowCanvas.getContext('2d');
const sgr = sctx.createRadialGradient(256, 160, 20, 256, 160, 256);
sgr.addColorStop(0, 'rgba(0,0,0,0.6)'); sgr.addColorStop(0.6, 'rgba(0,0,0,0.12)'); sgr.addColorStop(1, 'rgba(0,0,0,0)');
sctx.fillStyle = sgr; sctx.fillRect(0, 0, 512, 512);
const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
const shadowSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: shadowTexture, transparent: true, opacity: 0.6 }));
shadowSprite.scale.set(2.1, 2.1, 1); shadowSprite.position.set(0, -0.79, 0); scene.add(shadowSprite);

// Configurable presentation constants
const MODEL_INITIAL_Y = 0.1; // center the model vertically in the view
const SCROLL_END_Y = -0.35; // reduced travel so model stays in front
const FLOAT_AMPLITUDE = 0.025; // subtle floating
const POSITION_LERP = 0.06; // lower = slower, smoother follow of scroll
const SETTLE_SCALE = 0.94;
const SETTLE_DURATION = 0.45;
// Post-processing: FXAA only (disable bloom / DOF for crisp, non-washed visuals)
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const fxaaPass = new ShaderPass(FXAAShader);
fxaaPass.material.uniforms['resolution'].value.set(1 / window.innerWidth, 1 / window.innerHeight);
composer.addPass(fxaaPass);

// Intro animation helper: scale from larger -> final size
function playIntroScale(target){
  if(!target) return;
  const LOAD_SCALE = 1.35;
  const LOAD_Y_OFFSET = 0.7;
  // initial state for load: slightly above and larger
  target.scale.set(LOAD_SCALE, LOAD_SCALE, LOAD_SCALE);
  target.position.y = MODEL_INITIAL_Y + LOAD_Y_OFFSET;
  if(window.gsap){
    window.gsap.to(target.scale, { x:1, y:1, z:1, duration: 1.05, ease: 'expo.out' });
    // position will be smoothed by the animation loop lerp, so only scale tween here
  }
}

let model = null;
const loader = new GLTFLoader();
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
let isDragging = false;
let dragPlane = new THREE.Plane();
let dragOffset = new THREE.Vector3();
let dragObjects = [];

function createFallbackModel(){
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, metalness: 1.0, roughness: 0.18 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.9, roughness: 0.35 });
  const barGeo = new THREE.CylinderGeometry(0.035,0.035,1.6,32); barGeo.rotateZ(Math.PI/2);
  const bar = new THREE.Mesh(barGeo, dark); bar.castShadow = true; group.add(bar);
  function plate(r, t){ const g = new THREE.CylinderGeometry(r,r,t,48); g.rotateZ(Math.PI/2); return g; }
  [[0.78,0.2],[0.95,0.1]].forEach(([offset,th])=>{ [-1,1].forEach(side=>{ const p = new THREE.Mesh(plate(0.36, th), metal); p.position.x = side*offset; p.castShadow = true; group.add(p); const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,0.06,24), dark); collar.rotation.z = Math.PI/2; collar.position.x = side*(offset+0.12); collar.castShadow = true; group.add(collar); }); });
  const capGeo = new THREE.CylinderGeometry(0.08,0.08,0.06,32); capGeo.rotateZ(Math.PI/2);
  const left = new THREE.Mesh(capGeo, metal); left.position.x = -1.05; left.castShadow = true; group.add(left);
  const right = left.clone(); right.position.x = 1.05; group.add(right);
  // start slightly above and larger for intro animation
  group.position.y = MODEL_INITIAL_Y; group.scale.set(1.35,1.35,1.35);
  scene.add(group); model = group;
  // prepare drag objects and play intro scale animation
  updateDragObjects();
  playIntroScale(model);
}

loader.load('dumbbell.glb', gltf => {
  const raw = gltf.scene;
  // create a pivot so we can center the geometry and rotate around scene origin
  const pivot = new THREE.Group();
  pivot.name = 'modelPivot';
  pivot.add(raw);

  // Make sure meshes cast/receive shadows and tune materials for better contrast
  raw.traverse(n => {
    if (n.isMesh) {
      n.castShadow = true; n.receiveShadow = true;
      if (n.material) {
        n.material.envMapIntensity = 1.0;
        n.material.metalness = Math.max(n.material.metalness ?? 0.6, 0.6);
        n.material.roughness = Math.min(n.material.roughness ?? 0.28, 0.65);
        n.material.needsUpdate = true;
      }
    }
  });

  // scale to fit, then center the raw model inside the pivot
  const box = new THREE.Box3().setFromObject(raw);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = 1.4 / maxDim;
  raw.scale.setScalar(scale);

  box.setFromObject(raw);
  const center = box.getCenter(new THREE.Vector3());
  // shift raw so its center is at pivot origin
  raw.position.sub(center);

  // place the pivot at the desired scene height (keeps rotation around origin)
  pivot.position.set(0, MODEL_INITIAL_Y, 0);
  scene.add(pivot);

  // expose pivot as the model that animations will touch
  model = pivot;
  // prepare drag objects and intro state
  updateDragObjects();
  model.scale.set(1.35,1.35,1.35);
  model.position.y = MODEL_INITIAL_Y + 0.7;
  playIntroScale(model);
  initScrollAnimations();
}, undefined, err => { console.warn('GLB load error', err); createFallbackModel(); initScrollAnimations(); });

const gsap = window.gsap; const ScrollTrigger = window.ScrollTrigger; gsap.registerPlugin(ScrollTrigger);
const lenis = new Lenis({ duration: 0.8, smooth: true });

ScrollTrigger.scrollerProxy(document.documentElement, {
  scrollTop(value){ return arguments.length ? lenis.scrollTo(value) : window.scrollY; },
  getBoundingClientRect(){ return { top:0,left:0,width:innerWidth,height:innerHeight }; },
  pinType: document.documentElement.style.transform ? 'transform' : 'fixed'
});
lenis.on('scroll', ScrollTrigger.update);

let scrollProxy = { y: MODEL_INITIAL_Y };
function initScrollAnimations(){
  gsap.utils.toArray('.reveal').forEach(el => {
    gsap.fromTo(el, { y: 40, autoAlpha: 0 }, { y:0, autoAlpha:1, duration:1.05, ease:'power3.out', scrollTrigger:{ trigger: el, start:'top 85%' } });
  });
  gsap.from('.gallery-card', { y: 80, autoAlpha:0, stagger:0.12, duration:1, ease:'power3.out', scrollTrigger:{ trigger: '.gallery-grid', start: 'top 85%' } });
  gsap.utils.toArray('.card').forEach((c,i)=>{ gsap.from(c, { y: 60, autoAlpha:0, delay:i*0.06, duration:0.9, ease:'power3.out', scrollTrigger:{ trigger: c, start:'top 85%' } }); });
  gsap.to(scrollProxy, {
    y: SCROLL_END_Y,
    ease: 'none',
    scrollTrigger: {
      trigger: '.page-content',
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.6,
      onLeave: () => {
        if (model) gsap.to(model.scale, { x: SETTLE_SCALE, y: SETTLE_SCALE, z: SETTLE_SCALE, duration: SETTLE_DURATION, ease: 'power3.out' });
      },
      onEnterBack: () => {
        if (model) gsap.to(model.scale, { x: 1, y: 1, z: 1, duration: 0.45, ease: 'power3.out' });
      }
    }
  });
  ScrollTrigger.refresh();
}

let pointerX = 0, pointerY = 0;
function updateDragObjects(){
  dragObjects = [];
  if(!model) return;
  model.traverse(n => { if(n.isMesh) dragObjects.push(n); });
}

document.addEventListener('pointermove', e => {
  pointerX = (e.clientX / innerWidth) * 2 - 1; pointerY = (e.clientY / innerHeight) * 2 - 1;
  // update normalized device coords for raycasting
  pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;

  // handle active dragging
  if (isDragging && model) {
    raycaster.setFromCamera(pointerNDC, camera);
    const intersectPoint = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragPlane, intersectPoint)) {
      const newPos = intersectPoint.clone().add(dragOffset);
      model.position.copy(newPos);
    }
    document.body.style.cursor = 'grabbing';
    return;
  }

  // hover detection to show grab cursor
  if (dragObjects.length) {
    raycaster.setFromCamera(pointerNDC, camera);
    const hits = raycaster.intersectObjects(dragObjects, true);
    if (hits.length) document.body.style.cursor = 'grab';
    else document.body.style.cursor = '';
  }
});

// pointer down/up for dragging
document.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  // don't start drag when clicking interactive UI elements
  if (e.target.closest && e.target.closest('a,button,input,textarea,select,label')) return;
  pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  if (dragObjects.length === 0) updateDragObjects();
  const hits = raycaster.intersectObjects(dragObjects, true);
  if (hits.length) {
    e.preventDefault();
    isDragging = true;
    const pt = hits[0].point.clone();
    const camDir = new THREE.Vector3(); camera.getWorldDirection(camDir);
    dragPlane.setFromNormalAndCoplanarPoint(camDir, pt);
    dragOffset.copy(model.position).sub(pt);
    document.body.style.cursor = 'grabbing';
  }
});

document.addEventListener('pointerup', e => {
  if (e.button !== 0) return;
  if (!isDragging) return;
  isDragging = false;
  document.body.style.cursor = '';
  // animate model back to its scroll-driven position
  const finalY = (typeof scrollProxy.y === 'number') ? scrollProxy.y : MODEL_INITIAL_Y;
  if (window.gsap && model) {
    gsap.to(model.position, { x: 0, y: finalY, z: 0, duration: 0.7, ease: 'power3.out' });
  } else if (model) {
    model.position.set(0, finalY, 0);
  }
});

let rotationVelocity = 0;
let rotationTarget = 0;
let lastScrollAt = 0;
// only change rotation when user scrolls; capture a smooth target and lerp toward it
lenis.on('scroll', e => {
  const v = Math.min(6, Math.abs(e.velocity || 0));
  // robust direction detection: prefer delta, then string/number direction
  let dirSign = 0;
  if (typeof e.delta === 'number') dirSign = Math.sign(e.delta);
  else if (typeof e.direction === 'string') dirSign = (e.direction === 'down' || e.direction === 'right') ? 1 : -1;
  else if (typeof e.direction === 'number') dirSign = Math.sign(e.direction);
  // fallback
  if (dirSign === 0) dirSign = (e.velocity && e.velocity !== 0) ? 1 : 0;
  rotationTarget = dirSign * v * 0.04;
  lastScrollAt = performance.now();
});

const clock = new THREE.Clock();
function animate(time){
  lenis.raf(time);
  const dt = clock.getDelta(); const t = clock.elapsedTime;
  // smooth rotation target decay when user stops scrolling
  if (performance.now() - lastScrollAt > 300) rotationTarget = 0;
  // lerp the applied velocity toward the target for smoothness
  rotationVelocity = THREE.MathUtils.lerp(rotationVelocity, rotationTarget, Math.min(1, dt * 8));
  if (model) {
    // rotate only as a result of scroll (no constant base spin) — disable while dragging
    if (!isDragging) model.rotation.y += rotationVelocity * dt * 3.6;
    model.rotation.x = THREE.MathUtils.lerp(model.rotation.x, pointerY * 0.12, 0.06);
    model.rotation.z = THREE.MathUtils.lerp(model.rotation.z, -pointerX * 0.12, 0.06);
    const floatY = Math.sin(t * 0.9) * FLOAT_AMPLITUDE;
    const targetY = (typeof scrollProxy.y === 'number') ? scrollProxy.y : MODEL_INITIAL_Y;
    model.position.y = THREE.MathUtils.lerp(model.position.y, targetY + floatY, POSITION_LERP);
    // clamp so the model doesn't recede past the intended end or float above start
    model.position.y = THREE.MathUtils.clamp(model.position.y, SCROLL_END_Y, MODEL_INITIAL_Y);

    // shadow mapping — keep within reasonable bounds to avoid huge background scaling
    let s = THREE.MathUtils.mapLinear(model.position.y, SCROLL_END_Y * 1.15, MODEL_INITIAL_Y, 1.6, 0.6);
    s = THREE.MathUtils.clamp(s, 0.5, 2.0);
    shadowSprite.scale.set(s, s, 1);
    const so = THREE.MathUtils.mapLinear(model.position.y, SCROLL_END_Y * 1.15, MODEL_INITIAL_Y, 0.82, 0.14);
    shadowSprite.material.opacity = THREE.MathUtils.clamp(so, 0.12, 0.95);
  }
  camera.position.x = THREE.MathUtils.lerp(camera.position.x, pointerX * 0.26, 0.06);
  camera.position.y = THREE.MathUtils.lerp(camera.position.y, 0.9 + pointerY * -0.06, 0.06);
  camera.lookAt(0, 0.1, 0);
  composer.render();
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

window.addEventListener('resize', ()=>{
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  if(typeof composer !== 'undefined'){
    composer.setSize(window.innerWidth, window.innerHeight);
    if(fxaaPass && fxaaPass.material && fxaaPass.material.uniforms && fxaaPass.material.uniforms['resolution']) fxaaPass.material.uniforms['resolution'].value.set(1 / window.innerWidth, 1 / window.innerHeight);
  }
  ScrollTrigger.refresh();
});
