import type { GenerationRequest, GenerationResponse, Pattern } from "../types/index.js";
import type { IProvider } from "./types.js";
import { CAPS, emptyArtifact, estimateTokens } from "./types.js";

/**
 * StubProvider — deterministic, no network, no API key. Returns pattern-grounded
 * REAL 3D/graphics code (R3F components, Three.js scenes, WebGPU pipelines,
 * Phaser scenes, shaders) so the entire pipeline is exercisable end-to-end
 * offline and in CI. This is REAL logic that consults the pattern to produce
 * coherent, compilable-grade code the Critic can genuinely evaluate.
 *
 * It intentionally produces imperfect output (missing some required elements,
 * missing viewport meta, missing dispose in some paths) so the Critic +
 * Improvement loop has something meaningful to do — proving the director
 * actually works without a frontier model.
 */
export class StubProvider implements IProvider {
  readonly id = "stub" as const;
  readonly capabilities = CAPS.stub;

  constructor(private readonly patterns: Map<string, Pattern> = new Map()) {}

  registerPattern(p: Pattern): void {
    this.patterns.set(p.id, p);
  }

  async generate(req: GenerationRequest): Promise<GenerationResponse> {
    const pattern = req.patternId ? this.patterns.get(req.patternId) : undefined;
    const content = this.synthesize(req, pattern);
    const completionTokens = estimateTokens(content);
    const promptTokens = estimateTokens(`${req.systemPrompt ?? ""}\n${req.userPrompt}`);
    const start = Date.now();
    return {
      artifact: emptyArtifact(req.expectedKind, "stub", 0, content, pattern?.name),
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        costUsd: 0,
        latencyMs: Date.now() - start,
      },
      providerId: "stub",
      model: "stub-v1",
      finishReason: "stop",
    };
  }

  private synthesize(req: GenerationRequest, pattern: Pattern | undefined): string {
    const kind = req.expectedKind;
    const intent = req.userPrompt.split("\n").find((l) => l.trim().length > 0) ?? req.userPrompt;

    if (pattern) {
      // Route to 3D code generator based on pattern domain/category
      const cat = pattern.category;
      if (kind === "jsx" || kind === "tsx") {
        return this.r3fComponent(intent, pattern);
      }
      if (kind === "js" || kind === "ts") {
        if (cat === "webgpu_render_pipeline" || cat === "sci_fi_hud" && intent.toLowerCase().includes("webgpu")) {
          return this.webgpuPipeline(intent, pattern);
        }
        return this.threeJsScene(intent, pattern);
      }
      if (kind === "html") {
        return this.htmlWithWebGL(intent, pattern);
      }
      return this.generic(kind, intent);
    }
    return this.generic(kind, intent);
  }

  // -------------------------------------------------------------------------
  // R3F component generator (jsx/tsx) — for vfx, three-js, r3f, game patterns
  // -------------------------------------------------------------------------

  private r3fComponent(intent: string, p: Pattern): string {
    const reqEls = p.requiredElements.map((e) => e.name);
    // Include most but not all — deliberately imperfect for critic exercise
    const included = reqEls.slice(0, Math.max(1, reqEls.length - 1));
    const cat = p.category;

    if (cat === "fantasy_fireball" || cat === "lightning_spell" || cat === "magic_circle") {
      return this.r3fVfxComponent(intent, p, included);
    }
    if (cat === "cyberpunk_dashboard" || cat === "sci_fi_hud" || cat === "futuristic_control_panel") {
      return this.r3fHudComponent(intent, p, included);
    }
    if (cat === "game_skill_effect") {
      return this.r3fSkillEffect(intent, p, included);
    }
    return this.r3fGenericScene(intent, p, included);
  }

  private r3fVfxComponent(intent: string, p: Pattern, included: string[]): string {
    const hasGlowingCore = included.includes("glowing-core");
    const hasParticleEmitter = included.includes("particle-emitter");
    const hasAdditiveBlending = included.includes("additive-blending");
    const hasMotionTrail = included.includes("motion-trail");
    // Deliberately omit bloom-postprocess so critic finds it missing

    return `import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// ${p.name} :: ${intent.slice(0, 80)}
// Required elements: ${included.join(", ")}

export function FireballEffect({ position = [0, 0, 0] }: { position?: [number, number, number] }) {
  const coreRef = useRef<THREE.Mesh>(null!);
  const pointsRef = useRef<THREE.Points>(null!);

  // Particle system — BufferGeometry with pre-allocated arrays (no per-frame alloc)
  const particleCount = 500;
  const { positions, velocities } = useMemo(() => {
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
      velocities[i * 3] = (Math.random() - 0.5) * 2;
      velocities[i * 3 + 1] = Math.random() * 3;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 2;
    }
    return { positions, velocities };
  }, []);

  const particleGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);

  ${hasGlowingCore ? `
  // glowing-core: emissive sphere mesh
  const coreMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xffaa33),
      transparent: true,
      opacity: 0.9,
      ${hasAdditiveBlending ? "blending: THREE.AdditiveBlending," : ""}
      depthWrite: false,
    });
  }, []);` : ""}

  ${hasAdditiveBlending ? `
  // additive-blending: particle material uses AdditiveBlending for glow accumulation
  const particleMaterial = useMemo(() => {
    return new THREE.PointsMaterial({
      size: 0.15,
      color: new THREE.Color(0xff6600),
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, []);` : `
  const particleMaterial = useMemo(() => {
    return new THREE.PointsMaterial({
      size: 0.15,
      color: 0xff6600,
      transparent: true,
    });
  }, []);`}

  // Animate — use delta for framerate-independent motion
  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime();

    // Animate core
    if (coreRef.current) {
      coreRef.current.position.set(position[0], position[1] + Math.sin(t * 3) * 0.2, position[2]);
      coreRef.current.scale.setScalar(1 + Math.sin(t * 8) * 0.1);
    }

    // Animate particles — mutate existing array, NO new Vector3
    if (pointsRef.current) {
      const posAttr = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      for (let i = 0; i < particleCount; i++) {
        arr[i * 3] += velocities[i * 3] * delta;
        arr[i * 3 + 1] += velocities[i * 3 + 1] * delta;
        arr[i * 3 + 2] += velocities[i * 3 + 2] * delta;
        // Fade and reset
        if (arr[i * 3 + 1] > 5) {
          arr[i * 3] = 0;
          arr[i * 3 + 1] = 0;
          arr[i * 3 + 2] = 0;
        }
      }
      posAttr.needsUpdate = true;
    }
  });

  return (
    <group position={position}>
      ${hasGlowingCore ? `<mesh ref={coreRef}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <primitive object={coreMaterial} />
      </mesh>` : "<!-- glowing-core omitted -->"}

      ${hasParticleEmitter ? `<points ref={pointsRef} geometry={particleGeometry} material={particleMaterial} />` : "<!-- particle-emitter omitted -->"}

      ${hasMotionTrail ? `<motionTrail target={coreRef} />` : "<!-- motion-trail omitted -->"}
    </group>
  );
}
`;
  }

  private r3fHudComponent(intent: string, p: Pattern, included: string[]): string {
    return `import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

// ${p.name} :: ${intent.slice(0, 80)}
// Required elements: ${included.join(", ")}

export function HudOverlay({ health = 100, energy = 100 }: { health?: number; energy?: number }) {
  const groupRef = useRef<THREE.Group>(null!);

  useFrame((state, delta) => {
    if (groupRef.current) {
      // HUD follows camera at fixed offset
      groupRef.current.quaternion.copy(state.camera.quaternion);
    }
  });

  return (
    <group ref={groupRef}>
      <Html position={[0, 2, -3]} center>
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          padding: "12px",
          background: "rgba(0, 20, 40, 0.8)",
          border: "1px solid rgba(0, 255, 200, 0.3)",
          borderRadius: "4px",
          fontFamily: "monospace",
          color: "#00ffcc",
          minWidth: "200px",
        }}>
          ${included.map((el) => `<div data-element="${el}">
            <span style={{ fontSize: "10px", opacity: 0.6 }}>${el.replace(/-/g, " ").toUpperCase()}</span>
            <div style={{ height: "4px", background: "rgba(0,255,200,0.2)", borderRadius: "2px" }}>
              <div style={{ height: "100%", width: "75%", background: "#00ffcc", borderRadius: "2px" }} />
            </div>
          </div>`).join("\n          ")}
        </div>
      </Html>
    </group>
  );
}
`;
  }

  private r3fSkillEffect(intent: string, p: Pattern, included: string[]): string {
    return `import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// ${p.name} :: ${intent.slice(0, 80)}
// Required elements: ${included.join(", ")}

export function SkillEffect({ trigger }: { trigger: boolean }) {
  const ringRef = useRef<THREE.Mesh>(null!);
  const flashRef = useRef<THREE.Mesh>(null!);
  const startTime = useRef(0);

  const ringMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), []);

  useFrame((state, delta) => {
    if (!trigger) return;
    if (startTime.current === 0) startTime.current = state.clock.getElapsedTime();
    const elapsed = state.clock.getElapsedTime() - startTime.current;

    // Expanding ring
    if (ringRef.current) {
      const scale = 1 + elapsed * 5;
      ringRef.current.scale.set(scale, scale, scale);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - elapsed * 2);
    }
  });

  return (
    <group>
      <mesh ref={ringRef}>
        <ringGeometry args={[0.8, 1, 32]} />
        <primitive object={ringMaterial} />
      </mesh>
    </group>
  );
}
`;
  }

  private r3fGenericScene(intent: string, p: Pattern, included: string[]): string {
    return `import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// ${p.name} :: ${intent.slice(0, 80)}
// Required elements: ${included.join(", ")}

export function Scene() {
  const meshRef = useRef<THREE.Mesh>(null!);

  useFrame((state, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.5;
    }
  });

  return (
    <group>
      ${included.map((el) => `<mesh name="${el}" position={[Math.random() * 4 - 2, 0, 0]}>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
        <meshStandardMaterial color={0x44aaff} />
      </mesh>`).join("\n      ")}
    </group>
  );
}
`;
  }

  // -------------------------------------------------------------------------
  // Three.js vanilla scene generator (js/ts)
  // -------------------------------------------------------------------------

  private threeJsScene(intent: string, p: Pattern): string {
    const included = p.requiredElements.map((e) => e.name).slice(0, Math.max(1, p.requiredElements.length - 1));

    return `import * as THREE from "three";

// ${p.name} :: ${intent.slice(0, 80)}
// Required elements: ${included.join(", ")}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

// Lighting
const ambient = new THREE.AmbientLight(0x404040, 1);
scene.add(ambient);
const directional = new THREE.DirectionalLight(0xffffff, 1);
directional.position.set(5, 5, 5);
scene.add(directional);

${included.map((el) => {
  if (el.includes("core") || el.includes("glow")) {
    return `// ${el}: emissive sphere
const ${el.replace(/-/g, "_")}Geo = new THREE.SphereGeometry(0.3, 16, 16);
const ${el.replace(/-/g, "_")}Mat = new THREE.MeshBasicMaterial({ color: 0xffaa33 });
const ${el.replace(/-/g, "_")} = new THREE.Mesh(${el.replace(/-/g, "_")}Geo, ${el.replace(/-/g, "_")}Mat);
scene.add(${el.replace(/-/g, "_")});`;
  }
  if (el.includes("particle") || el.includes("emitter")) {
    return `// ${el}: GPU particle system
const particleCount = 500;
const ${el.replace(/-/g, "_")}Geo = new THREE.BufferGeometry();
const positions = new Float32Array(particleCount * 3);
for (let i = 0; i < particleCount * 3; i++) positions[i] = (Math.random() - 0.5) * 4;
${el.replace(/-/g, "_")}Geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
const ${el.replace(/-/g, "_")}Mat = new THREE.PointsMaterial({ size: 0.1, color: 0xff6600, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const ${el.replace(/-/g, "_")} = new THREE.Points(${el.replace(/-/g, "_")}Geo, ${el.replace(/-/g, "_")}Mat);
scene.add(${el.replace(/-/g, "_")});`;
  }
  return `// ${el}
const ${el.replace(/-/g, "_")} = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x44aaff }));
scene.add(${el.replace(/-/g, "_")});`;
}).join("\n\n")}

// Animation loop with delta time
let lastTime = performance.now();
function animate(now: number) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  scene.rotation.y += dt * 0.5;

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// Resize handling
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
`;
  }

  // -------------------------------------------------------------------------
  // WebGPU pipeline generator (js/ts)
  // -------------------------------------------------------------------------

  private webgpuPipeline(intent: string, p: Pattern): string {
    return `// ${p.name} :: ${intent.slice(0, 80)} (WebGPU)
// Required elements: ${p.requiredElements.map((e) => e.name).join(", ")}

async function initWebGPU(canvas: HTMLCanvasElement) {
  // Guard for WebGPU support
  if (!navigator.gpu) {
    console.warn("WebGPU not supported on this browser");
    return;
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    console.warn("No suitable GPU adapter found");
    return;
  }

  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  if (!context) return;

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied" });

  // Shader module (WGSL)
  const shaderModule = device.createShaderModule({
    code: \`
      @vertex
      fn vs_main(@location(0) pos: vec3<f32>) -> @builtin(position) vec4<f32> {
        return vec4<f32>(pos, 1.0);
      }

      @fragment
      fn fs_main() -> @location(0) vec4<f32> {
        return vec4<f32>(0.8, 0.4, 0.1, 1.0);
      }
    \`,
  });

  // Vertex data
  const vertices = new Float32Array([
    0.0,  0.5, 0.0,
   -0.5, -0.5, 0.0,
    0.5, -0.5, 0.0,
  ]);
  const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertices);

  // Render pipeline
  const pipeline = device.createRenderPipeline({
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main",
      buffers: [{
        arrayStride: 12,
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
      }],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format }],
    },
    primitive: { cullMode: "back" },
  });

  // Render loop
  function render() {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0.1, g: 0.1, b: 0.15, a: 1 },
      }],
    });
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  // Resize handling with ResizeObserver
  const resizeObserver = new ResizeObserver(() => {
    const width = Math.min(canvas.clientWidth, device.limits.maxTextureDimension2D);
    const height = Math.min(canvas.clientHeight, device.limits.maxTextureDimension2D);
    canvas.width = width;
    canvas.height = height;
  });
  resizeObserver.observe(canvas);
}

initWebGPU(document.querySelector("canvas")!);
`;
  }

  // -------------------------------------------------------------------------
  // HTML with WebGL canvas
  // -------------------------------------------------------------------------

  private htmlWithWebGL(intent: string, p: Pattern): string {
    const included = p.requiredElements.map((e) => e.name).slice(0, Math.max(1, p.requiredElements.length - 1));
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${p.name}</title>
  <style>
    body { margin: 0; overflow: hidden; background: #000; }
    canvas { display: block; }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>
  <script type="module">
    // ${p.name} :: ${intent.slice(0, 80)}
    // Elements: ${included.join(", ")}
    const canvas = document.getElementById("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) { alert("WebGL not supported"); }

    // Vertex shader
    const vsSource = \`
      attribute vec3 aPosition;
      void main() { gl_Position = vec4(aPosition, 1.0); }
    \`;
    // Fragment shader
    const fsSource = \`
      precision highp float;
      void main() { gl_FragColor = vec4(0.8, 0.4, 0.1, 1.0); }
    \`;

    function createShader(type, source) {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      return s;
    }

    const vs = createShader(gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    // Triangle
    const vertices = new Float32Array([0, 0.5, -0.5, -0.5, 0.5, -0.5]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    function render() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.1, 0.1, 0.15, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      const loc = gl.getAttribLocation(program, "aPosition");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      requestAnimationFrame(render);
    }
    render();

    window.addEventListener("resize", () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    });
  </script>
</body>
</html>`;
  }

  // -------------------------------------------------------------------------
  // Generic fallback
  // -------------------------------------------------------------------------

  private generic(kind: GenerationRequest["expectedKind"], intent: string): string {
    if (kind === "html") {
      return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${intent.slice(0, 40)}</title></head>
<body><main><h1>${intent.slice(0, 60)}</h1><p>Generated output.</p></main></body>
</html>`;
    }
    return `// ${intent.slice(0, 80)}\nexport function main() { return {}; }`;
  }
}
