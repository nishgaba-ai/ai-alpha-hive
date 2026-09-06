"use client";

// The 3D floor: agents as obsidian spheres with status rings on a dark plane,
// hand-offs as light particles. Same event stream as the graph — nothing
// animates that did not happen. Lazy-loaded behind a poster by the page.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text, Float } from "@react-three/drei";
import * as THREE from "three";
import { displayName, sentence, type Graph } from "../../lib/hive";

const COLORS: Record<string, string> = { running: "#7fe0a3", parked: "#f2b84b", failed: "#ef6f5f", idle: "#b8b4cc", suspended: "#3a3630" };

function Agent({ position, name, status, title, focused }: { position: [number, number, number]; name: string; status: string; title: string; focused: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  const color = COLORS[status] ?? COLORS.idle;
  useFrame((s) => {
    if (!ring.current) return;
    const m = ring.current.material as THREE.MeshStandardMaterial;
    if (status === "running") m.emissiveIntensity = 1.2 + Math.sin(s.clock.elapsedTime * 2.6) * 0.6;
    else m.emissiveIntensity = status === "parked" ? 1.4 : 0.35;
  });
  return (
    <group position={position}>
      <Float speed={status === "running" ? 2 : 0.6} rotationIntensity={0} floatIntensity={status === "running" ? 0.5 : 0.15}>
        <mesh castShadow>
          <sphereGeometry args={[0.42, 48, 48]} />
          <meshPhysicalMaterial color="#ffffff" roughness={0.25} metalness={0.05} clearcoat={1} clearcoatRoughness={0.1} />
        </mesh>
        <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
          <torusGeometry args={[0.58, 0.05, 16, 64]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} toneMapped={false} />
        </mesh>
      </Float>
      {status === "parked" ? (
        <mesh position={[0, 0.95, 0]}>
          <sphereGeometry args={[0.07, 16, 16]} />
          <meshStandardMaterial color="#6c5ce7" emissive="#6c5ce7" emissiveIntensity={3} toneMapped={false} />
        </mesh>
      ) : null}
      <Text position={[0, -0.85, 0]} fontSize={0.2} color={focused ? "#191633" : "#4a4666"} anchorX="center" anchorY="top">
        {name}
      </Text>
      <Text position={[0, -1.1, 0]} fontSize={0.12} color="#7d7896" anchorX="center" anchorY="top">
        {title}
      </Text>
    </group>
  );
}

function Particle({ from, to, t0 }: { from: [number, number, number]; to: [number, number, number]; t0: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (!ref.current) return;
    const t = Math.min(1, (s.clock.elapsedTime - t0) / 0.9);
    ref.current.position.set(from[0] + (to[0] - from[0]) * t, 0.6 + Math.sin(t * Math.PI) * 0.8, from[2] + (to[2] - from[2]) * t);
    ref.current.visible = t < 1;
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.06, 12, 12]} />
      <meshStandardMaterial color="#ff7eb3" emissive="#ff7eb3" emissiveIntensity={4} toneMapped={false} />
    </mesh>
  );
}

function Scene({ graph, pulses, reduced }: { graph: Graph; pulses: { from: string; to: string; t0: number }[]; reduced: boolean }) {
  const agents = useMemo(() => graph.nodes.filter((n) => n.type === "agent"), [graph]);
  const teams = useMemo(() => (graph.teams.length ? graph.teams : [{ id: "all", lead: "", members: agents.map((a) => String(a.data.role)) }]), [graph, agents]);
  const positions = useMemo(() => {
    const pos = new Map<string, [number, number, number]>();
    const placed = new Set<string>();
    teams.forEach((team, ti) => {
      const members = agents.filter((a) => team.members.includes(String(a.data.role)) && !placed.has(a.id));
      const cx = (ti - (teams.length - 1) / 2) * 4.2;
      members.forEach((a, i) => {
        const ang = (i / Math.max(1, members.length)) * Math.PI * 2;
        const r = members.length > 1 ? 1.1 : 0;
        pos.set(a.id, [cx + Math.cos(ang) * r, 0, Math.sin(ang) * r]);
        placed.add(a.id);
      });
    });
    agents.filter((a) => !placed.has(a.id)).forEach((a, i) => pos.set(a.id, [i * 1.6 - 2, 0, 3]));
    pos.set("board", [0, 0, -4.2]);
    return pos;
  }, [agents, teams]);

  return (
    <>
      <color attach="background" args={["#f6f5fb"]} />
      <fog attach="fog" args={["#f6f5fb", 11, 24]} />
      <ambientLight intensity={0.9} />
      <hemisphereLight args={["#191633", "#f6f5fb", 0.6]} />
      <directionalLight position={[4, 8, 3]} intensity={2.2} castShadow color="#ffffff" />
      <pointLight position={[0, 3, -4]} intensity={6} color="#6c5ce7" distance={12} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#ecebf6" roughness={0.95} />
      </mesh>
      <gridHelper args={[40, 40, "#d9d6ee", "#e6e4f3"]} position={[0, -0.49, 0]} />
      <group position={[0, 0, -4.2]}>
        <mesh>
          <cylinderGeometry args={[0.7, 0.7, 0.18, 48]} />
          <meshStandardMaterial color="#6c5ce7" emissive="#4b3fd1" emissiveIntensity={0.6} metalness={0.6} roughness={0.3} />
        </mesh>
        <Text position={[0, -0.75, 0]} fontSize={0.2} color="#191633" anchorX="center" anchorY="top">Board</Text>
      </group>
      {teams.map((t, ti) => (
        <Text key={t.id} position={[(ti - (teams.length - 1) / 2) * 4.2, -0.45, 2.1]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.22} color="#b8b4cc" anchorX="center">
          {sentence(t.id)}
        </Text>
      ))}
      {agents.map((a) => (
        <Agent key={a.id} position={positions.get(a.id)!} name={displayName(String(a.data.name), String(a.data.title), String(a.data.role))} title={String(a.data.title)} status={String(a.data.status)} focused={false} />
      ))}
      {!reduced && pulses.map((p, i) => (positions.get(p.from) && positions.get(p.to) ? <Particle key={i} from={positions.get(p.from)!} to={positions.get(p.to)!} t0={p.t0} /> : null))}
      <OrbitControls enableDamping dampingFactor={0.08} autoRotate={!reduced} autoRotateSpeed={0.35} minDistance={4} maxDistance={14} maxPolarAngle={Math.PI / 2.1} target={[0, 0, -0.5]} />
    </>
  );
}

export function Floor({ slug, initial, height = 460 }: { slug: string; initial: Graph; height?: number | string }) {
  const [graph, setGraph] = useState(initial);
  const [pulses, setPulses] = useState<{ from: string; to: string; t0: number }[]>([]);
  const [reduced, setReduced] = useState(false);
  const clock = useRef(0);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const start = performance.now();
    const es = new EventSource(`/api/hive/companies/${slug}/events/stream?since=999999999`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data) as { type: string; agent_id: string | null; payload: Record<string, unknown> };
        if (/^(run\.|task\.|approval\.|agent\.)/.test(ev.type)) {
          clearTimeout(timer);
          timer = setTimeout(async () => {
            const r = await fetch(`/api/hive/companies/${slug}/graph`, { cache: "no-store" });
            if (r.ok) setGraph(await r.json());
          }, 250);
        }
        if ((ev.type === "run.started" || ev.type === "approval.requested" || ev.type === "message.sent") && ev.agent_id) {
          clock.current = (performance.now() - start) / 1000;
          const from = ev.type === "run.started" ? "board" : ev.agent_id;
          const to = ev.type === "run.started" ? ev.agent_id : "board";
          setPulses((p) => [...p.slice(-8), { from, to, t0: clock.current }]);
        }
      } catch {
        /* ignore */
      }
    };
    return () => {
      es.close();
      clearTimeout(timer);
    };
  }, [slug]);

  return (
    <div className="card overflow-hidden" style={{ height }} aria-hidden>
      <Canvas shadows camera={{ position: [5.5, 4.5, 7], fov: 40 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "high-performance" }}>
        <Suspense fallback={null}>
          <Scene graph={graph} pulses={pulses} reduced={reduced} />
        </Suspense>
      </Canvas>
    </div>
  );
}
