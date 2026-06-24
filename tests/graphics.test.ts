import { describe, it, expect } from "vitest";
import { collectEvidence } from "../src/critic/evidence.js";
import { runRules } from "../src/critic/rules.js";
import { score } from "../src/critic/scoring.js";
import { CriticEngine } from "../src/critic/engine.js";
import type { Artifact, Pattern } from "../src/types/index.js";
import { defaultConfig } from "../src/infrastructure/config.js";

function art(kind: Artifact["kind"], content: string): Artifact {
  return { id: "test-1", kind, label: "test", content, createdAt: new Date().toISOString(), version: 0 };
}

// A well-written R3F fireball component with most best practices
const GOOD_R3F = `import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export function Fireball() {
  const coreRef = useRef<THREE.Mesh>(null!);
  const pointsRef = useRef<THREE.Points>(null!);

  const particleCount = 500;
  const positions = useMemo(() => new Float32Array(particleCount * 3), []);
  const velocities = useMemo(() => new Float32Array(particleCount * 3), []);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);

  const material = useMemo(() => new THREE.PointsMaterial({
    size: 0.1, color: 0xff6600, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }), []);

  useEffect(() => {
    return () => { geometry.dispose(); material.dispose(); };
  }, [geometry, material]);

  useFrame((state, delta) => {
    if (coreRef.current) {
      coreRef.current.position.x += delta * 2;
    }
    const arr = (pointsRef.current?.geometry.attributes.position as THREE.BufferAttribute)?.array as Float32Array;
    if (arr) {
      for (let i = 0; i < particleCount; i++) {
        arr[i * 3] += velocities[i * 3] * delta;
        arr[i * 3 + 1] += velocities[i * 3 + 1] * delta;
      }
      pointsRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <group>
      <mesh ref={coreRef}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshBasicMaterial color={0xffaa33} />
      </mesh>
      <points ref={pointsRef} geometry={geometry} material={material} />
    </group>
  );
}
`;

// A bad R3F component with GC pressure, no dispose, no delta
const BAD_R3F = `import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export function Fireball() {
  const ref = useRef();
  useFrame(() => {
    const pos = new THREE.Vector3(0, 0, 0); // GC pressure!
    ref.current.position.copy(pos);
    ref.current.position.x += 0.1; // frame-dependent!
  });
  return <mesh ref={ref}><sphereGeometry /><meshBasicMaterial /></mesh>;
}
`;

// WebGPU with proper guards
const GOOD_WEBGPU = `async function init(canvas) {
  if (!navigator.gpu) return;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return;
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: "premultiplied" });
  const shader = device.createShaderModule({ code: \`@vertex fn vs() {} @fragment fn fs() {}\` });
  const pipeline = device.createRenderPipeline({ vertex: { module: shader }, fragment: { module: shader, targets: [] } });
  const ro = new ResizeObserver(() => { canvas.width = Math.min(canvas.clientWidth, device.limits.maxTextureDimension2D); });
  ro.observe(canvas);
}
`;

describe("graphics evidence collection", () => {
  it("detects 3D metrics in R3F code", () => {
    const evidence = collectEvidence(art("jsx", GOOD_R3F));
    expect(evidence.metrics.useFrameCount).toBeGreaterThanOrEqual(1);
    expect(evidence.metrics.disposeCallCount).toBeGreaterThanOrEqual(2);
    expect(evidence.metrics.bufferGeometryCount).toBeGreaterThanOrEqual(1);
    expect(evidence.metrics.additiveBlendingCount).toBeGreaterThanOrEqual(1);
    expect(evidence.metrics.deltaUsageCount).toBeGreaterThanOrEqual(1);
  });

  it("detects GC pressure (new in loop) in bad R3F", () => {
    const evidence = collectEvidence(art("jsx", BAD_R3F));
    expect(evidence.metrics.newInLoopCount).toBeGreaterThanOrEqual(1);
  });

  it("emits graphics signals for 3D code", () => {
    const evidence = collectEvidence(art("jsx", GOOD_R3F));
    const gfxSignals = evidence.signals.filter((s) => s.kind === "graphics");
    expect(gfxSignals.length).toBeGreaterThanOrEqual(8);
    const disposeSignal = evidence.signals.find((s) => s.id === "gfx-dispose");
    expect(disposeSignal).toBeDefined();
    expect(disposeSignal!.value).toBeGreaterThan(0.5);
  });

  it("emits game-feel signals", () => {
    const evidence = collectEvidence(art("jsx", GOOD_R3F));
    const feelSignals = evidence.signals.filter((s) => s.kind === "game-feel");
    expect(feelSignals.length).toBeGreaterThanOrEqual(3);
  });

  it("detects WebGPU init with guards", () => {
    const evidence = collectEvidence(art("js", GOOD_WEBGPU));
    expect(evidence.metrics.webgpuInitCount).toBeGreaterThanOrEqual(2);
    const webgpuSignal = evidence.signals.find((s) => s.id === "gfx-webgpu-init");
    expect(webgpuSignal).toBeDefined();
    expect(webgpuSignal!.value).toBeGreaterThan(0.7);
  });
});

describe("graphics critic rules", () => {
  it("scores good R3F higher than bad R3F on graphics-quality", () => {
    const goodEv = collectEvidence(art("jsx", GOOD_R3F));
    const badEv = collectEvidence(art("jsx", BAD_R3F));
    const goodRules = runRules({ artifact: art("jsx", GOOD_R3F), evidence: goodEv });
    const badRules = runRules({ artifact: art("jsx", BAD_R3F), evidence: badEv });
    const goodScore = score({ ruleResults: goodRules, dimensionWeights: defaultConfig(".").dimensionWeights });
    const badScore = score({ ruleResults: badRules, dimensionWeights: defaultConfig(".").dimensionWeights });
    expect(goodScore.dimensionScores["graphics-quality"]).toBeGreaterThan(badScore.dimensionScores["graphics-quality"]);
    expect(goodScore.dimensionScores["performance"]).toBeGreaterThan(badScore.dimensionScores["performance"]);
  });

  it("flags missing dispose as critical finding", () => {
    const evidence = collectEvidence(art("jsx", BAD_R3F));
    const rules = runRules({ artifact: art("jsx", BAD_R3F), evidence });
    const disposeRule = rules.find((r) => r.ruleId === "gfx-dispose");
    expect(disposeRule).toBeDefined();
    const criticalFinding = disposeRule!.findings.find((f) => f.severity === "critical");
    expect(criticalFinding).toBeDefined();
  });

  it("flags new-in-loop as critical GC finding", () => {
    const evidence = collectEvidence(art("jsx", BAD_R3F));
    const rules = runRules({ artifact: art("jsx", BAD_R3F), evidence });
    const gcRule = rules.find((r) => r.ruleId === "perf-gc-in-loop");
    expect(gcRule).toBeDefined();
    expect(gcRule!.findings.some((f) => f.severity === "critical")).toBe(true);
  });
});

describe("CriticEngine end-to-end on 3D artifact", () => {
  const config = { ...defaultConfig("."), enableLLMReasoning: false };

  it("produces a critique with graphics-quality and game-feel scores", async () => {
    const engine = new CriticEngine(config);
    const critique = await engine.critique(art("jsx", GOOD_R3F), {});
    expect(critique.dimensionScores["graphics-quality"]).toBeGreaterThan(0);
    expect(critique.dimensionScores["game-feel"]).toBeGreaterThanOrEqual(0);
    expect(critique.aggregateScore).toBeGreaterThan(0);
    expect(critique.aggregateScore).toBeLessThanOrEqual(100);
    expect(critique.findings.length).toBeGreaterThan(0);
  });

  it("good R3F scores higher aggregate than bad R3F", async () => {
    const engine = new CriticEngine(config);
    const good = await engine.critique(art("jsx", GOOD_R3F), {});
    const bad = await engine.critique(art("jsx", BAD_R3F), {});
    expect(good.aggregateScore).toBeGreaterThan(bad.aggregateScore);
  });
});
