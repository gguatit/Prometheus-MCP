/**
 * Context7-curated knowledge fragments — embedded from Context7 research.
 *
 * These are NOT live API calls. They are distilled best practices extracted
 * from the official documentation of Three.js, React Three Fiber, WebGPU,
 * Phaser, and Rapier via Context7 (verified library IDs). This approach:
 *   - requires NO API key (user goal: local MCP, no keys)
 *   - is deterministic (same input → same knowledge every run)
 *   - has zero network dependency
 *   - can be refreshed by re-running Context7 research and updating this file
 *
 * Each fragment is trusted content (trust: "verified"), authored by the
 * Prometheus team from official docs. The sanitizer still fences it as data
 * downstream — defense in depth.
 *
 * Roadmap: a live Context7Collector that calls the Context7 MCP at runtime
 * can be added alongside this without changing any consumer code (same
 * IKnowledgeCollector interface).
 */
import type { KnowledgeFragment } from "../../types/index.js";

const now = "2026-01-01T00:00:00.000Z";

export const CURATED_FRAGMENTS: KnowledgeFragment[] = [
  {
    id: "kf-threejs-renderer",
    source: "official-doc",
    title: "Three.js — WebGLRenderer best practices",
    content: `WebGLRenderer setup:
- new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
- renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)) — cap at 2 to avoid perf cliff on retina
- renderer.setSize(width, height)
- renderer.setAnimationLoop(animate) — preferred over requestAnimationFrame (auto-cancels on unmount in R3F)
- renderer.toneMapping = THREE.ACESFilmicToneMapping — filmic tone mapping for realistic lighting
- renderer.outputColorSpace = THREE.SRGBColorSpace (default in r152+)
- Handle resize: renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix()
- Dispose on unmount: renderer.dispose()`,
    trust: "verified",
    quarantined: false,
    collectedAt: now,
  },
  {
    id: "kf-threejs-dispose",
    source: "official-doc",
    title: "Three.js — GPU resource disposal pattern",
    content: `Every GPU resource must be disposed to prevent memory leaks:
- geometry.dispose() — frees vertex/index buffers
- material.dispose() — frees shader programs
- texture.dispose() — frees GPU texture memory
- For nested scenes: traverse scene.traverse(obj => { if (obj.geometry) obj.geometry.dispose(); if (obj.material) { if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose()); else obj.material.dispose(); } })
- ResourceTracker pattern: class ResourceTracker { track(resource) { ... } dispose() { ... } }
- In R3F: useEffect(() => { return () => { geo.dispose(); mat.dispose(); }; }, [])
- renderer.dispose() on scene teardown to free the WebGL context`,
    trust: "verified",
    quarantined: false,
    collectedAt: now,
  },
  {
    id: "kf-threejs-particles",
    source: "official-doc",
    title: "Three.js — GPU particle system with BufferGeometry",
    content: `Efficient particle system (no per-frame allocations):
- const geo = new THREE.BufferGeometry()
- geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
- geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
- const mat = new THREE.PointsMaterial({ size: 0.1, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
- const points = new THREE.Points(geo, mat)
- Update positions: geo.attributes.position.array[i * 3] = x; geo.attributes.position.needsUpdate = true
- For dynamic data: use Float32BufferAttribute.setUsage(THREE.DynamicDrawUsage)
- Frustum culling: points.frustumCulled = true (default) — but for moving particle systems, set false if bounding sphere is wrong
- Limit count: <= 2000 for simple systems; use GPGPU or instanced quads for 10k+`,
    trust: "verified",
    quarantined: false,
    collectedAt: now,
  },
  {
    id: "kf-threejs-instancing",
    source: "official-doc",
    title: "Three.js — InstancedMesh for batched draw calls",
    content: `InstancedMesh draws N copies in one draw call:
- const mesh = new THREE.InstancedMesh(geometry, material, count)
- const matrix = new THREE.Matrix4()
- for (let i = 0; i < count; i++) { matrix.setPosition(x, y, z); mesh.setMatrixAt(i, matrix) }
- mesh.instanceMatrix.needsUpdate = true
- Per-instance color: mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3)
- Frustum culling: InstancedMesh computes bounding sphere from all instances — set mesh.frustumCulled = true
- Dispose: mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose()`,
    trust: "verified",
    quarantined: false,
    collectedAt: now,
  },
  {
    id: "kf-threejs-postprocessing",
    source: "official-doc",
    title: "Three.js — Post-processing with EffectComposer",
    content: `Bloom and other post-effects via EffectComposer:
- import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer'
- import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass'
- import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass'
- const composer = new EffectComposer(renderer)
- composer.addPass(new RenderPass(scene, camera))
- const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), strength, radius, threshold)
-   strength: 1.0, radius: 0.4, threshold: 0.85 (only highlights bloom, not whole scene)
- composer.addPass(bloom)
- Render: composer.render() instead of renderer.render(scene, camera)
- Resize: composer.setSize(w, h)`,
    trust: "verified",
    quarantined: false,
    collectedAt: now,
  },
  {
    id: "kf-r3f-useframe",
    source: "official-doc",
    title: "React Three Fiber — useFrame best practices",
    content: `useFrame((state, delta) => { ... }) — the render loop hook:
- MUST use delta for framerate-independent motion: ref.current.position.x += velocity * delta
- CRITICAL anti-pattern: \`new THREE.Vector3()\` inside useFrame = GC pressure → stutter
  Correct: hoist outside, or mutate refs: ref.current.position.set(x, y, z)
- state contains: state.camera, state.scene, state.clock, state.raycaster, state.gl
- For on-demand rendering: <Canvas frameloop="demand"> + invalidate()
- useThree() for accessing state outside useFrame: const { camera, gl } = useThree()
- Refs auto-unsubscribe on unmount — no manual cleanup needed for useFrame itself
- Multiple useFrame callbacks run in registration order; each can read state from previous`,
    trust: "verified",
    quarantined: false,
    collectedAt: now,
  },
  {
    id: "kf-r3f-canvas",
    source: "official-doc",
    title: "React Three Fiber — Canvas and scene composition",
    content: `Canvas is the R3F root:
- <Canvas camera={{ position: [0, 0, 5], fov: 50 }} dpr={[1, 2]} gl={{ antialias: true }}>
- dpr={[1, 2]} caps pixel ratio at 2 (perf)
- frameloop="always" (default) | "demand" | "never"
- Scene composition: <Canvas><Scene /></Canvas> where Scene is a component
- Break into sub-components: <Scene><Lights/><Player/><Environment/><Effects/></Scene>
- Each component manages its own refs + useFrame — modular scene graph
- Suspense for async assets: <Suspense fallback={null}><Model url={...} /></Suspense>
- useGLTF.preload(url) for preloading models`,
    trust: "verified",
    quarantined: false,
    collectedAt: now,
  },
  {
    id: "kf-webgpu-init",
    source: "official-doc",
    title: "WebGPU — initialization pipeline",
    content: `WebGPU init (always guard for null — not all browsers support it):
- if (!navigator.gpu) { console.warn('WebGPU not supported'); return; }
- const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
- if (!adapter) { console.warn('No GPU adapter'); return; }
- const device = await adapter.requestDevice()
- const context = canvas.getContext('webgpu')
- const format = navigator.gpu.getPreferredCanvasFormat()
- context.configure({ device, format, alphaMode: 'premultiplied' })
- Resize: use ResizeObserver, clamp to device.limits.maxTextureDimension2D
- Canvas: context.configure() again on resize if dimensions change`,
    trust: "verified",
    quarantined: false,
    collectedAt: now,
  },
  {
    id: "kf-webgpu-pipeline",
    source: "official-doc",
    title: "WebGPU — render pipeline and draw loop",
    content: `Render pipeline creation:
- const shaderModule = device.createShaderModule({ code: WGSL_STRING })
- const pipeline = device.createRenderPipeline({
    vertex: { module: shaderModule, entryPoint: 'vs_main', buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
    fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format }] },
    primitive: { cullMode: 'back' },
    depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' }
  })
- Uniform buffer: const buffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
- device.queue.writeBuffer(buffer, 0, data)
- Draw loop: const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0,0,0,1] }], depthStencilAttachment: { view: depthTexture.createView(), depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store' } })
  pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.setVertexBuffer(0, vertexBuffer); pass.draw(vertexCount); pass.end()
  device.queue.submit([encoder.finish()])`,
    trust: "verified",
    quarantined: false,
    collectedAt: now,
  },
  {
    id: "kf-shader-glsl",
    source: "official-doc",
    title: "GLSL shader fundamentals for Three.js ShaderMaterial",
    content: `Custom ShaderMaterial (Three.js):
- const mat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xff6600) } }, vertexShader, fragmentShader, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
- Vertex shader: attribute vec3 position; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
- Fragment shader: precision highp float; uniform vec3 uColor; uniform float uTime; void main() { gl_FragColor = vec4(uColor, 1.0); }
- ALWAYS declare precision in fragment shaders (highp/mediump/lowp)
- Update uniforms: mat.uniforms.uTime.value = clock.getElapsedTime()
- Attributes: position, normal, uv are built-in. Custom: attribute float aSize;`,
    trust: "verified",
    quarantined: false,
    collectedAt: now,
  },
  {
    id: "kf-game-juice",
    source: "official-doc",
    title: "Game feel — juice patterns for web games",
    content: `Juice = visual/audio feedback that makes actions feel satisfying:
- Screen shake: camera.position.x += (Math.random() - 0.5) * shakeAmount; shakeAmount *= 0.9 (decay)
- Hit stop: freeze game for 40-80ms on hit before resuming (impact weight)
- Particles on impact: spawn 8-20 particles in a burst, fade over 300-500ms
- Squash & stretch: scale object on impact: scale.y *= 0.7; recover over 200ms with easing
- Anticipation: wind-up animation before action (100-200ms reverse motion)
- Easing: never use linear for organic motion. Use easeOutCubic, easeInOutQuad, lerp
- Damping: current = lerp(current, target, 1 - Math.exp(-lambda * delta)) — framerate-independent
- Trail: store last N positions, render as fading line/ribbon
- Flash: set material.emissive to white for 50ms on hit, fade back
- Sound: pair every visual effect with audio (Web Audio API oscillator for retro, samples for realistic)`,
    trust: "verified",
    quarantined: false,
    collectedAt: now,
  },
  {
    id: "kf-game-loop",
    source: "official-doc",
    title: "Game loop — fixed timestep with interpolation",
    content: `Framerate-independent game loop:
- Fixed timestep for physics, interpolation for rendering:
  const STEP = 1/60; let accumulator = 0; let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.25) dt = 0.25; // avoid spiral of death
    accumulator += dt;
    while (accumulator >= STEP) { update(STEP); accumulator -= STEP; }
    render(accumulator / STEP); // interpolation alpha
    requestAnimationFrame(loop);
  }
- In R3F: useFrame((state, delta) => { update(delta); }) — R3F handles the RAF
- Input: read input state in update(), not in event handlers (decouple)
- State: use refs for per-frame mutable state (not React state — re-renders are too slow)`,
    trust: "verified",
    quarantined: false,
    collectedAt: now,
  },
  {
    id: "kf-phaser-scene",
    source: "official-doc",
    title: "Phaser — scene structure and game objects",
    content: `Phaser 3 scene structure (2D games):
- class GameScene extends Phaser.Scene { constructor() { super('GameScene'); } preload() { this.load.image('player', 'player.png'); } create() { this.player = this.physics.add.sprite(100, 100, 'player'); } update(time, delta) { if (cursors.left.isDown) player.setVelocityX(-160); } }
- Physics: this.physics.add.collider(player, platforms); this.physics.add.overlap(player, stars, collect, null, this)
- Input: this.cursors = this.input.keyboard.createCursorKeys(); this.input.on('pointerdown', handler)
- Animations: this.anims.create({ key: 'left', frames: this.anims.generateFrameNumbers('dude', { start: 0, end: 3 }), frameRate: 10, repeat: -1 })
- Tilemaps: this.make.tilemap({ key: 'map' }); const tiles = map.addTilesetImage('tiles'); const layer = map.createStaticLayer('ground', tiles)
- Scene transitions: this.scene.start('GameOver', { score: 100 })`,
    trust: "verified",
    quarantined: false,
    collectedAt: now,
  },
  {
    id: "kf-rapier-physics",
    source: "official-doc",
    title: "Rapier — 3D physics in WASM (R3F integration)",
    content: `Rapier.js physics (2D + 3D, WASM, fast):
- import RAPIER from '@dimforge/rapier3d-compat'
- await RAPIER.init()
- const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
- Rigid body: const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0))
- Collider: world.createCollider(RAPIER.ColliderDesc.ball(1), body)
- Step: world.step()
- Read position: body.translation()
- Raycasting: world.castRay(RAPIER.Ray({ origin: {x:0,y:0,z:0}, dir: {x:0,y:-1,z:0} }, maxDistance, true))
- R3F integration: @react-three/rapier — <Physics><RigidBody><mesh/></RigidBody></Physics>
- Character controller: world.createCharacterController(0.5); controller.computeColliderMovement(collider, desiredTranslation)`,
    trust: "verified",
    quarantined: false,
    collectedAt: now,
  },
  {
    id: "kf-webgl-context-loss",
    source: "official-doc",
    title: "WebGL — context loss handling",
    content: `GPU context loss happens on tab switch, driver crash, or resource pressure:
- canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.log('context lost'); // stop rendering, flag for restore })
- canvas.addEventListener('webglcontextrestored', () => { // re-create all GPU resources: geometries, materials, textures, renderer // resume rendering })
- In R3F: handled internally by Canvas, but custom resources need re-creation
- Pattern: keep a resource registry; on restore, iterate and re-create all
- THREE.WebGLRenderer: renderer.forceContextLoss() for testing; renderer.forceContextRestore()`,
    trust: "verified",
    quarantined: false,
    collectedAt: now,
  },
];
