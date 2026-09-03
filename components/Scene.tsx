"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Stars, Sparkles } from "@react-three/drei";
import { useRef } from "react";
import * as THREE from "three";

function Globe() {
  const group = useRef<THREE.Group>(null);
  const ring1 = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (group.current) {
      group.current.rotation.y += delta * 0.1;
      group.current.position.y = Math.sin(t * 0.4) * 0.15;
    }
    if (ring1.current) ring1.current.rotation.z += delta * 0.15;
    if (ring2.current) ring2.current.rotation.z -= delta * 0.1;
  });

  return (
    <group ref={group}>
      {/* inner wireframe planet */}
      <mesh>
        <icosahedronGeometry args={[2, 3]} />
        <meshBasicMaterial color="#6cffc2" wireframe transparent opacity={0.13} />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[2, 1]} />
        <meshBasicMaterial color="#8aa2ff" wireframe transparent opacity={0.07} />
      </mesh>
      {/* glowing core */}
      <mesh>
        <sphereGeometry args={[1.55, 32, 32]} />
        <meshBasicMaterial color="#0b1f18" transparent opacity={0.9} />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.58, 32, 32]} />
        <meshBasicMaterial color="#6cffc2" wireframe transparent opacity={0.06} />
      </mesh>
      {/* orbit rings */}
      <group rotation={[Math.PI / 2.4, 0.3, 0]}>
        <mesh ref={ring1}>
          <torusGeometry args={[3.2, 0.012, 8, 160]} />
          <meshBasicMaterial color="#6cffc2" transparent opacity={0.55} />
        </mesh>
        <mesh ref={ring2}>
          <torusGeometry args={[3.8, 0.006, 8, 160]} />
          <meshBasicMaterial color="#a78bfa" transparent opacity={0.3} />
        </mesh>
        {/* satellites */}
        <mesh position={[3.2, 0, 0]}>
          <sphereGeometry args={[0.07, 16, 16]} />
          <meshBasicMaterial color="#6cffc2" />
        </mesh>
        <mesh position={[-3.8, 0, 0]}>
          <sphereGeometry args={[0.05, 16, 16]} />
          <meshBasicMaterial color="#a78bfa" />
        </mesh>
      </group>
    </group>
  );
}

export default function Scene() {
  return (
    <Canvas
      camera={{ position: [0, 0.4, 7.5], fov: 48 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ background: "transparent" }}
    >
      <Stars radius={70} depth={40} count={2200} factor={3.2} saturation={0} fade speed={0.5} />
      <Sparkles count={110} scale={13} size={2} speed={0.3} color="#6cffc2" opacity={0.5} />
      <Globe />
    </Canvas>
  );
}
