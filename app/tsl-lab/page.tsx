"use client";

// TEMPORARY TSL bisection lab — delete after P1 debug.
// /tsl-lab?stage=N builds the post chain up to stage N:
// 1=pass 2=+GTAO 3=+SSR 4=+bloom 5=+DOF 6=+tonemap 7=+grade 8=+vignette+film 9=+SMAA+sRGB

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import * as THREE from "three/webgpu";
import {
  pass,
  mrt,
  output,
  normalView,
  roughness,
  metalness,
  positionWorld,
  normalWorld,
  cameraPosition,
  texture,
  uniform,
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  mix,
  smoothstep,
  clamp,
  dot,
  normalize,
  luminance,
  uv,
  sRGBTransferOETF,
  toneMapping,
  triplanarTexture,
  normalMap,
  convertToTexture,
} from "three/tsl";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { ssr } from "three/addons/tsl/display/SSRNode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { dof } from "three/addons/tsl/display/DepthOfFieldNode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import { film } from "three/addons/tsl/display/FilmNode.js";

const rnmBlend = Fn(([a, b]: [any, any]) => {
  const t = a.mul(2).sub(1).add(vec3(0, 0, 1));
  const u = b.mul(2).sub(1).mul(vec3(-1, -1, 1));
  return t.mul(dot(t, u).div(t.z.add(0.0001))).sub(u);
});

const gradeFn = Fn(([c]: [any]) => {
  const lum = luminance(c);
  const sat = mix(vec3(lum), c, float(1.07));
  const con = sat.sub(0.18).mul(1.05).add(0.18);
  const t = smoothstep(0.05, 0.75, lum);
  const tint = mix(vec3(0.97, 0.99, 1.05), vec3(1.04, 1.01, 0.96), t);
  return clamp(con.mul(tint), 0.0, 1.0);
});

const vignetteFn = Fn(([c]: [any]) => {
  const d = uv().sub(vec2(0.5, 0.5)).length();
  const v = smoothstep(0.32, 0.86, d).oneMinus().mul(0.42).add(0.58);
  return c.mul(v);
});

const tri = (tex: THREE.Texture, tileMeters: number) =>
  triplanarTexture(
    texture(tex),
    texture(tex),
    texture(tex),
    float(1 / tileMeters),
    positionWorld,
    normalWorld
  );

export default function TSLLab() {
  const mountRef = useRef<HTMLDivElement>(null);
  const params = useSearchParams();
  const stage = Number(params.get("stage") ?? "9");
  const materialStage = params.get("mat") ?? "full"; // full | plain
  const [msg, setMsg] = useState("running…");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGPURenderer | null = null;
    let cancelled = false;

    (async () => {
      (THREE as any).Node.captureStackTrace = true;
      renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL: false } as any);
      await renderer.init();
      if (cancelled) return;
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x101014);
      const camera = new THREE.PerspectiveCamera(
        60,
        mount.clientWidth / mount.clientHeight,
        0.1,
        100
      );
      camera.position.set(0, 1.5, 4);

      scene.add(new THREE.DirectionalLight(0xffffff, 2.5));
      const sun = scene.children[0] as THREE.DirectionalLight;
      sun.position.set(3, 5, 2);

      // ground plane with the real regolith material stack
      // (flat-normal-map fallback: 128,128,255 — grey here would tilt normals)
      const fallbackData = new Uint8Array([128, 128, 255, 255]);
      const fallbackTex = new THREE.DataTexture(fallbackData, 1, 1);
      fallbackTex.needsUpdate = true;
      const macroData = new Uint8Array(256 * 4).fill(128);
      const macroTex = new THREE.DataTexture(macroData, 16, 16);
      macroTex.needsUpdate = true;

      let groundMat: THREE.Material = new THREE.MeshStandardNodeMaterial();
      if (materialStage === "full") {
        const mat = new THREE.MeshPhysicalNodeMaterial();
        mat.metalness = 0;
        const nearAlb = tri(fallbackTex, 2.6);
        const midAlb = tri(fallbackTex, 26);
        const camDist = positionWorld.sub(cameraPosition).length();
        const alb = mix(nearAlb, midAlb, smoothstep(24.0, 80.0, camDist));
        const grey = luminance(alb.rgb);
        let col = mix(vec3(grey), alb.rgb, float(0.3)) as any;
        col = col.mul(vec3(0.94, 0.93, 0.91));
        const macro = texture(macroTex, positionWorld.xz.mul(1 / 420)).r;
        const macro2 = texture(macroTex, positionWorld.xz.mul(1 / 55)).g;
        col = col.mul(mix(0.72, 1.1, macro)).mul(mix(0.86, 1.1, macro2));
        mat.colorNode = col;
        const n1 = texture(fallbackTex, uv().mul(160.0)).rgb;
        const n2 = texture(fallbackTex, uv().mul(1400.0)).rgb;
        const blended = normalize(rnmBlend(n1, n2)).mul(0.5).add(0.5);
        mat.normalNode = normalMap(blended, vec2(1.0, 1.0));
        const rgh = texture(fallbackTex, uv().mul(160.0)).r;
        mat.roughnessNode = mix(0.84, 0.97, rgh) as any;
        mat.sheen = 0.05;
        groundMat = mat;
      }
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), groundMat);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardNodeMaterial({ color: 0x8aa2ff, roughness: 0.4, metalness: 0.5 })
      );
      cube.position.y = 0.5;
      scene.add(cube);

      // ── post chain, cut at `stage` ──
      const exposure = uniform(1.1);
      const post = new THREE.RenderPipeline(renderer);
      post.outputColorTransform = false;

      const scenePass = pass(scene, camera);
      scenePass.setMRT(mrt({ output, normal: normalView, roughness, metalness }));
      const sceneColor = scenePass.getTextureNode("output");
      const sceneDepth = scenePass.getTextureNode("depth");
      const sceneNormal = scenePass.getTextureNode("normal");
      const sceneViewZ = scenePass.getViewZNode();

      let node: any = sceneColor;

      if (stage >= 2) {
        const aoPass = ao(sceneDepth, sceneNormal, camera);
        aoPass.resolutionScale = 0.5;
        node = sceneColor.mul(vec4(vec3(aoPass.getTextureNode().r), 1.0));
      }
      if (stage >= 3) {
        const ssrMode = params.get("ssr") ?? "a";
        if (ssrMode === "a") {
          // SSRNode DISCARDS non-metal/background pixels → it's an ADDITIVE overlay
          const ssrOverlay = ssr(convertToTexture(node), sceneDepth, sceneNormal as any, {
            camera,
            metalnessNode: scenePass.getTextureNode("metalness") as any,
            roughnessNode: scenePass.getTextureNode("roughness") as any,
            reflectNonMetals: false,
          });
          node = node.add(ssrOverlay);
        } else if (ssrMode === "b") {
          // bare: raw pass color, camera only
          node = ssr(sceneColor, sceneDepth, sceneNormal as any, { camera } as any);
        } else if (ssrMode === "c") {
          // raw pass color, no explicit camera (infer from pass)
          node = ssr(sceneColor, sceneDepth, sceneNormal as any);
        } else if (ssrMode === "d") {
          // converted color + camera, NO MRT metal/rough nodes
          node = ssr(convertToTexture(node), sceneDepth, sceneNormal as any, { camera } as any);
        } else if (ssrMode === "e") {
          // MRT nodes, but no convertToTexture... via raw color + camera
          node = ssr(sceneColor, sceneDepth, sceneNormal as any, {
            camera,
            metalnessNode: scenePass.getTextureNode("metalness") as any,
            roughnessNode: scenePass.getTextureNode("roughness") as any,
          } as any);
        }
      }
      if (stage >= 4) node = node.add(bloom(node, 0.5, 0.4, 0.87));
      if (stage >= 5) node = dof(node, sceneViewZ, 9, 26, 1.3);
      if (stage >= 6) node = toneMapping(THREE.ACESFilmicToneMapping, exposure, node);
      if (stage >= 7) node = gradeFn(node);
      if (stage >= 8) node = film(vec4(vignetteFn(node).rgb, 1.0), float(0.085));
      if (stage >= 9) node = sRGBTransferOETF(smaa(node) as any) as any;

      post.outputNode = (stage >= 9 ? node : vec4(node)) as any;

      let frames = 0;
      renderer.setAnimationLoop(() => {
        cube.rotation.y += 0.01;
        post.render();
        if (++frames === 30) setMsg(`stage=${stage} mat=${materialStage} — 30 frames OK`);
      });
    })().catch((e) => setMsg(`FAIL: ${e}`));

    return () => {
      cancelled = true;
      if (renderer) {
        renderer.setAnimationLoop(null);
        renderer.dispose();
        renderer.domElement.remove();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, materialStage]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000" }}>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          color: "#6cffc2",
          font: "14px monospace",
          zIndex: 10,
        }}
      >
        TSL lab — {msg}
      </div>
    </div>
  );
}
