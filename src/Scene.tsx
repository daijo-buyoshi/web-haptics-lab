import {
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment, useGLTF, useTexture } from "@react-three/drei";
import {
  CuboidCollider,
  Physics,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import {
  Bloom,
  EffectComposer,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import {
  GOAL_MAT_URL,
  type ActiveTrialSnapshot,
  type BodyDict,
  type BuildDraftConfig,
  type DualRumblePad,
  type ExperimentConfig,
  type ObstacleBox,
  type PlacedProp,
  type TelemetryData,
  type TrialPhase,
  type TrialRecord,
} from "./types";
import { FallbackBlockHand, VrmFullBodyAvatar } from "./VrmAvatar";

type SceneProps = {
  hasCustomHdri: boolean;
  placedProps: PlacedProp[];
  buildMode: boolean;
  buildDraft: BuildDraftConfig;
  dropSeed: number;
  propRespawnSeeds: Record<string, number>;
  deliveredPropUid: string | null;
  showBackground: boolean;
  experimentConfig: ExperimentConfig;
  thirdPerson: boolean;
  lightweightMode: boolean;
  tutorialOpen: boolean;
  nextTrialNumber: number;
  awaitingRating: boolean;
  abortTrialSignal: number;
  onPlaceProp: (pos: [number, number, number]) => void;
  onPickUpProp: (uid: string) => void;
  onRemoveProp: (uid: string) => void;
  onRotateDraft: (deltaRad: number) => void;
  onScaleDraft: (deltaSize: number) => void;
  onToggleIllusion: () => void;
  onToggleThirdPerson: () => void;
  onToggleBuildMode: () => void;
  onResetDrop: () => void;
  onTrialDelivered: (record: TrialRecord) => void;
  onTrialIncomplete: (record: TrialRecord) => void;
  onActiveTrialSnapshot: (snapshot: ActiveTrialSnapshot) => void;
  onTelemetry: (data: TelemetryData) => void;
};

// 部屋の寸法（10m x 10m x 高さ3.6m）
const ROOM_HALF = 5.0;
const ROOM_HEIGHT = 3.6;

const PHYSICS_GRAVITY: [number, number, number] = [0, -9.81, 0];
const DIR_LIGHT_POS: [number, number, number] = [2.8, 6.2, 2.4];
const POINT_LIGHT_POS: [number, number, number] = [0, ROOM_HEIGHT - 0.3, 0];
const SHADOW_MAP_SIZE: [number, number] = [2048, 2048];
const FLOOR_NORMAL_SCALE = new THREE.Vector2(0.85, 0.85);
const WALL_NORMAL_SCALE = new THREE.Vector2(0.8, 0.8);
const CEILING_NORMAL_SCALE = new THREE.Vector2(0.75, 0.75);
const BASEBOARD_NORMAL_SCALE = new THREE.Vector2(0.75, 0.75);
const NO_RAYCAST: THREE.Object3D["raycast"] = () => { };

const PLAYER_RADIUS = 0.22;
const WRIST_TO_PALM_OFFSET = 0.115;
const TWO_HAND_MASS_KG = 5.0;

async function fileExists(path: string): Promise<boolean> {
  try {
    const res = await fetch(path, { method: "HEAD" });
    if (!res.ok) return false;
    const ct = res.headers.get("content-type") || "";
    return !ct.includes("text/html");
  } catch {
    return false;
  }
}

function safeRequestPointerLock(dom: HTMLElement) {
  try {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const result = dom.requestPointerLock?.() as unknown as Promise<void> | undefined;
    result?.catch?.(() => { });
  } catch {
    // ignore
  }
}

function useNormalizedGltf(
  url: string,
  targetSize: number,
  ghost = false,
  maxAllowedHeight = ROOM_HEIGHT - 0.02
) {
  const { scene } = useGLTF(url);

  return useMemo(() => {
    const cloned = scene.clone(true);

    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z);
    let scale = maxDim > 0 ? targetSize / maxDim : 1;

    if (size.y > 0 && maxAllowedHeight > 0.08) {
      const maxScaleByHeight = maxAllowedHeight / size.y;
      if (scale > maxScaleByHeight) {
        scale = maxScaleByHeight;
      }
    }

    cloned.scale.setScalar(scale);
    cloned.position.set(
      -center.x * scale,
      -box.min.y * scale,
      -center.z * scale
    );

    cloned.traverse((obj) => {
      obj.raycast = NO_RAYCAST;

      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.castShadow = !ghost;
        mesh.receiveShadow = !ghost;

        if (ghost) {
          mesh.material = new THREE.MeshStandardMaterial({
            color: "#38bdf8",
            transparent: true,
            opacity: 0.48,
            depthWrite: false,
          });
        }
      }
    });

    // マウスやキーボードなど薄い小物も実寸に近いコライダーサイズを保つ
    const sx = Math.max(0.025, size.x * scale);
    const sy = Math.max(0.02, size.y * scale);
    const sz = Math.max(0.025, size.z * scale);

    return {
      normalized: cloned,
      boxSize: [sx, sy, sz] as [number, number, number],
    };
  }, [scene, targetSize, ghost, maxAllowedHeight]);
}

const SceneLightingAndEnv = memo(function SceneLightingAndEnv({
  hasCustomHdri,
  showBackground,
  lightweightMode,
}: {
  hasCustomHdri: boolean;
  showBackground: boolean;
  lightweightMode: boolean;
}) {
  const { gl } = useThree();

  useEffect(() => {
    gl.shadowMap.enabled = !lightweightMode;
    gl.shadowMap.needsUpdate = true;
  }, [gl, lightweightMode]);

  return (
    <>
      <Suspense fallback={null}>
        {hasCustomHdri ? (
          <Environment
            files="/hdri/room.hdr"
            background={showBackground}
            environmentIntensity={0.62}
          />
        ) : (
          <Environment
            preset="studio"
            background={showBackground}
            environmentIntensity={0.58}
          />
        )}
      </Suspense>

      <directionalLight
        position={DIR_LIGHT_POS}
        intensity={2.1}
        color="#fff8ee"
        castShadow={!lightweightMode}
        shadow-mapSize={SHADOW_MAP_SIZE}
        shadow-bias={-0.0002}
        shadow-normalBias={0.035}
        shadow-radius={3.5}
        shadow-camera-near={0.5}
        shadow-camera-far={18}
        shadow-camera-left={-4.5}
        shadow-camera-right={4.5}
        shadow-camera-top={4.5}
        shadow-camera-bottom={-4.5}
      />

      <pointLight
        position={POINT_LIGHT_POS}
        intensity={7.5}
        distance={16}
        decay={1.6}
        color="#fff6e8"
      />
      <hemisphereLight
        color="#f1f5f9"
        groundColor="#5c4a3a"
        intensity={0.45}
      />
    </>
  );
});

const ScenePostProcessing = memo(function ScenePostProcessing() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur luminanceThreshold={1.15} intensity={0.22} />
      <Vignette eskil={false} offset={0.22} darkness={0.32} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
});

function GoalMatMesh({
  targetSize,
  ghost = false,
  inGoalZoneRef,
  awaitingRatingRef,
  onMeasuredSize,
}: {
  targetSize: number;
  ghost?: boolean;
  inGoalZoneRef?: React.MutableRefObject<boolean>;
  awaitingRatingRef?: React.MutableRefObject<boolean>;
  onMeasuredSize?: (size: [number, number, number]) => void;
}) {
  const radius = Math.max(0.14, targetSize * 0.5);
  const discMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const ringMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const lastStateRef = useRef<string>("");

  const discGeoArgs = useMemo<[number, number, number, number]>(
    () => [radius, radius, 0.006, 36],
    [radius]
  );
  const ringGeoArgs = useMemo<[number, number, number]>(
    () => [radius * 0.86, radius, 40],
    [radius]
  );

  useEffect(() => {
    if (onMeasuredSize) {
      onMeasuredSize([radius * 2, 0.04, radius * 2]);
    }
  }, [radius, onMeasuredSize]);

  // React再描画を起こさず、状態変化時だけマテリアルの色を直接更新
  useFrame(() => {
    if (ghost) return;
    const awaiting = !!awaitingRatingRef?.current;
    const inside = !!inGoalZoneRef?.current;
    const nextState = awaiting ? "await" : inside ? "in" : "idle";
    if (nextState === lastStateRef.current) return;
    lastStateRef.current = nextState;

    const color =
      nextState === "await"
        ? "#f59e0b"
        : nextState === "in"
          ? "#22c55e"
          : "#38bdf8";

    if (discMatRef.current) {
      discMatRef.current.color.set(color);
      discMatRef.current.emissive.set(color);
      discMatRef.current.emissiveIntensity =
        nextState === "await" ? 2.0 : nextState === "in" ? 1.8 : 0.9;
      discMatRef.current.opacity =
        nextState === "await" ? 0.58 : nextState === "in" ? 0.62 : 0.34;
    }

    if (ringMatRef.current) {
      ringMatRef.current.color.set(color);
      ringMatRef.current.emissive.set(color);
      ringMatRef.current.emissiveIntensity =
        nextState === "await" ? 2.6 : nextState === "in" ? 2.4 : 1.4;
      ringMatRef.current.opacity = 0.92;
    }
  });

  return (
    <group>
      <mesh position={[0, 0.004, 0]} raycast={NO_RAYCAST}>
        <cylinderGeometry args={discGeoArgs} />
        <meshStandardMaterial
          ref={discMatRef}
          color="#38bdf8"
          emissive="#38bdf8"
          emissiveIntensity={ghost ? 0.6 : 0.9}
          transparent
          opacity={ghost ? 0.35 : 0.34}
          depthWrite={false}
        />
      </mesh>
      <mesh
        position={[0, 0.008, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        raycast={NO_RAYCAST}
      >
        <ringGeometry args={ringGeoArgs} />
        <meshStandardMaterial
          ref={ringMatRef}
          color="#38bdf8"
          emissive="#38bdf8"
          emissiveIntensity={ghost ? 0.9 : 1.4}
          side={THREE.DoubleSide}
          transparent
          opacity={ghost ? 0.7 : 0.92}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function GroundedGltfGhost({
  url,
  targetSize,
  placeY = 0,
  onMeasuredSize,
}: {
  url: string;
  targetSize: number;
  placeY?: number;
  onMeasuredSize?: (size: [number, number, number]) => void;
}) {
  const maxAllowedHeight = Math.max(0.15, ROOM_HEIGHT - 0.02 - placeY);
  const { normalized, boxSize } = useNormalizedGltf(
    url,
    targetSize,
    true,
    maxAllowedHeight
  );

  useEffect(() => {
    if (onMeasuredSize) {
      onMeasuredSize(boxSize);
    }
  }, [boxSize, onMeasuredSize]);

  return <primitive object={normalized} />;
}

function StaticPropBody({
  prop,
  registerStaticObstacle,
}: {
  prop: PlacedProp;
  registerStaticObstacle: (uid: string, box: ObstacleBox | null) => void;
}) {
  const maxAllowedHeight = Math.max(0.15, ROOM_HEIGHT - 0.02 - prop.position[1]);
  const { normalized, boxSize } = useNormalizedGltf(
    prop.url,
    prop.targetSize,
    false,
    maxAllowedHeight
  );
  const raycastGroupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (!raycastGroupRef.current) return;
    raycastGroupRef.current.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(raycastGroupRef.current);
    if (!box.isEmpty()) {
      registerStaticObstacle(prop.uid, {
        minX: box.min.x,
        maxX: box.max.x,
        minZ: box.min.z,
        maxZ: box.max.z,
      });
    }
    return () => {
      registerStaticObstacle(prop.uid, null);
    };
  }, [
    prop.uid,
    prop.position,
    prop.rotationY,
    prop.targetSize,
    boxSize,
    registerStaticObstacle,
  ]);

  return (
    <group>
      <RigidBody
        key={`static-${prop.uid}-${prop.targetSize}-${prop.position.join(",")}-${prop.rotationY}`}
        type="fixed"
        colliders="trimesh"
        restitution={0.05}
        friction={0.9}
        position={prop.position}
        rotation={[0, prop.rotationY, 0]}
      >
        <primitive object={normalized} />
      </RigidBody>

      <group
        ref={raycastGroupRef}
        position={prop.position}
        rotation={[0, prop.rotationY, 0]}
        userData={{ placedPropUid: prop.uid, placedPropName: prop.name }}
      >
        <mesh position={[0, boxSize[1] / 2, 0]}>
          <boxGeometry args={boxSize} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

function DynamicPropBody({
  prop,
  dropSeed,
  respawnSeed,
  registerBody,
}: {
  prop: PlacedProp;
  dropSeed: number;
  respawnSeed: number;
  registerBody: (id: string, body: RapierRigidBody | null) => void;
}) {
  const posX = prop.position[0];
  const posY = prop.position[1];
  const posZ = prop.position[2];
  const spawnY = posY + 0.002;

  const maxAllowedHeight = Math.max(0.15, ROOM_HEIGHT - 0.04 - posY);
  const { normalized, boxSize } = useNormalizedGltf(
    prop.url,
    prop.targetSize,
    false,
    maxAllowedHeight
  );
  const bodyRef = useRef<RapierRigidBody>(null);

  // マウント・リセット・リスポーン時だけ直接ロックして静止させる（React再描画を起こさない）
  useEffect(() => {
    const body = bodyRef.current;
    registerBody(prop.uid, body);
    if (body) {
      try {
        body.setTranslation({ x: posX, y: spawnY, z: posZ }, false);
        body.setLinvel({ x: 0, y: 0, z: 0 }, false);
        body.setAngvel({ x: 0, y: 0, z: 0 }, false);
        body.setGravityScale(0, false);
        body.lockTranslations(true, false);
        body.lockRotations(true, false);
        body.sleep();
      } catch {
        // ignore
      }
    }
    return () => {
      registerBody(prop.uid, null);
    };
  }, [prop.uid, posX, spawnY, posZ, dropSeed, respawnSeed, registerBody]);

  const pickHitBox: [number, number, number] = [
    Math.max(0.06, boxSize[0]),
    Math.max(0.06, boxSize[1]),
    Math.max(0.06, boxSize[2]),
  ];

  return (
    <RigidBody
      ref={bodyRef}
      key={`dyn-${prop.uid}-${prop.massKg}-${prop.targetSize}-${dropSeed}-${respawnSeed}`}
      type="dynamic"
      colliders={false}
      ccd
      linearDamping={0.6}
      angularDamping={0.9}
      position={[posX, spawnY, posZ]}
      rotation={[0, prop.rotationY, 0]}
    >
      <CuboidCollider
        args={[boxSize[0] / 2, boxSize[1] / 2, boxSize[2] / 2]}
        position={[0, boxSize[1] / 2, 0]}
        restitution={Math.min(prop.restitution, 0.2)}
        friction={0.95}
        mass={Math.max(0.1, prop.massKg)}
      />

      <group userData={{ placedPropUid: prop.uid, placedPropName: prop.name }}>
        <primitive object={normalized} />

        <mesh position={[0, pickHitBox[1] / 2, 0]}>
          <boxGeometry args={pickHitBox} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    </RigidBody>
  );
}

const PlacedPropInstance = memo(function PlacedPropInstance({
  prop,
  dropSeed,
  respawnSeed,
  isBeingMoved,
  isDelivered,
  inGoalZoneRef,
  awaitingRatingRef,
  registerBody,
  registerStaticObstacle,
}: {
  prop: PlacedProp;
  dropSeed: number;
  respawnSeed: number;
  isBeingMoved: boolean;
  isDelivered: boolean;
  inGoalZoneRef: React.MutableRefObject<boolean>;
  awaitingRatingRef: React.MutableRefObject<boolean>;
  registerBody: (id: string, body: RapierRigidBody | null) => void;
  registerStaticObstacle: (uid: string, box: ObstacleBox | null) => void;
}) {
  const isGoalMat = prop.url === GOAL_MAT_URL;

  useEffect(() => {
    if (isBeingMoved || isDelivered) {
      registerBody(prop.uid, null);
      registerStaticObstacle(prop.uid, null);
    }
  }, [isBeingMoved, isDelivered, prop.uid, registerBody, registerStaticObstacle]);

  if (isBeingMoved || isDelivered) return null;

  if (isGoalMat) {
    return (
      <group
        position={prop.position}
        rotation={[0, prop.rotationY, 0]}
        userData={{ placedPropUid: prop.uid, placedPropName: prop.name }}
      >
        <GoalMatMesh
          targetSize={prop.targetSize}
          inGoalZoneRef={inGoalZoneRef}
          awaitingRatingRef={awaitingRatingRef}
        />
        <mesh position={[0, 0.018, 0]}>
          <boxGeometry args={[prop.targetSize, 0.036, prop.targetSize]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    );
  }

  if (prop.mode === "static") {
    return (
      <Suspense fallback={null}>
        <StaticPropBody
          prop={prop}
          registerStaticObstacle={registerStaticObstacle}
        />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={null}>
      <DynamicPropBody
        prop={prop}
        dropSeed={dropSeed}
        respawnSeed={respawnSeed}
        registerBody={registerBody}
      />
    </Suspense>
  );
});

function TexturedFloorMaterial() {
  const { gl } = useThree();
  const textures = useTexture({
    map: "/textures/floor/diff.jpg",
    normalMap: "/textures/floor/nor.jpg",
    roughnessMap: "/textures/floor/rough.jpg",
  });

  useEffect(() => {
    const maxAniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
    const list = [textures.map, textures.normalMap, textures.roughnessMap];
    list.forEach((tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(5, 5);
      tex.anisotropy = maxAniso;
      tex.needsUpdate = true;
    });
    textures.map.colorSpace = THREE.SRGBColorSpace;
  }, [gl, textures]);

  return (
    <meshStandardMaterial
      map={textures.map}
      normalMap={textures.normalMap}
      normalScale={FLOOR_NORMAL_SCALE}
      roughnessMap={textures.roughnessMap}
      roughness={1.0}
      metalness={0.04}
    />
  );
}

function TexturedWallMaterial() {
  const { gl } = useThree();
  const textures = useTexture({
    map: "/textures/wall/diff.jpg",
    normalMap: "/textures/wall/nor.jpg",
    roughnessMap: "/textures/wall/rough.jpg",
  });

  useEffect(() => {
    const maxAniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
    const list = [textures.map, textures.normalMap, textures.roughnessMap];
    list.forEach((tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(5, 1.8);
      tex.anisotropy = maxAniso;
      tex.needsUpdate = true;
    });
    textures.map.colorSpace = THREE.SRGBColorSpace;
  }, [gl, textures]);

  return (
    <meshStandardMaterial
      map={textures.map}
      normalMap={textures.normalMap}
      normalScale={WALL_NORMAL_SCALE}
      roughnessMap={textures.roughnessMap}
      roughness={1.0}
      metalness={0.03}
    />
  );
}

function TexturedCeilingMaterial() {
  const { gl } = useThree();
  const textures = useTexture({
    map: "/textures/ceiling/diff.jpg",
    normalMap: "/textures/ceiling/nor.jpg",
    roughnessMap: "/textures/ceiling/rough.jpg",
  });

  useEffect(() => {
    const maxAniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
    const list = [textures.map, textures.normalMap, textures.roughnessMap];
    list.forEach((tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(5, 5);
      tex.anisotropy = maxAniso;
      tex.needsUpdate = true;
    });
    textures.map.colorSpace = THREE.SRGBColorSpace;
  }, [gl, textures]);

  return (
    <meshStandardMaterial
      map={textures.map}
      normalMap={textures.normalMap}
      normalScale={CEILING_NORMAL_SCALE}
      roughnessMap={textures.roughnessMap}
      roughness={1.0}
      metalness={0.02}
    />
  );
}

function TexturedBaseboardMaterial({ baseDir }: { baseDir: string }) {
  const { gl } = useThree();
  const rawTextures = useTexture({
    map: `${baseDir}/diff.jpg`,
    normalMap: `${baseDir}/nor.jpg`,
    roughnessMap: `${baseDir}/rough.jpg`,
  });

  const clonedTextures = useMemo(() => {
    const map = rawTextures.map.clone();
    const normalMap = rawTextures.normalMap.clone();
    const roughnessMap = rawTextures.roughnessMap.clone();
    const maxAniso = Math.min(8, gl.capabilities.getMaxAnisotropy());

    [map, normalMap, roughnessMap].forEach((tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(12, 0.25);
      tex.anisotropy = maxAniso;
      tex.needsUpdate = true;
    });
    map.colorSpace = THREE.SRGBColorSpace;

    return { map, normalMap, roughnessMap };
  }, [gl, rawTextures]);

  useEffect(() => {
    return () => {
      clonedTextures.map.dispose();
      clonedTextures.normalMap.dispose();
      clonedTextures.roughnessMap.dispose();
    };
  }, [clonedTextures]);

  const tintColor = baseDir === "/textures/floor" ? "#b8a99a" : "#ffffff";

  return (
    <meshStandardMaterial
      color={tintColor}
      map={clonedTextures.map}
      normalMap={clonedTextures.normalMap}
      normalScale={BASEBOARD_NORMAL_SCALE}
      roughnessMap={clonedTextures.roughnessMap}
      roughness={1.0}
      metalness={0.04}
    />
  );
}

const PhysicalRoom = memo(function PhysicalRoom({
  hasFloorTex,
  hasWallTex,
  hasCeilingTex,
}: {
  hasFloorTex: boolean;
  hasWallTex: boolean;
  hasCeilingTex: boolean;
}) {
  const wallThickness = 0.25;
  const roomWidth = ROOM_HALF * 2;

  const wallMaterial = hasWallTex ? (
    <Suspense
      fallback={
        <meshStandardMaterial color="#d8dce3" roughness={0.85} metalness={0.02} />
      }
    >
      <TexturedWallMaterial />
    </Suspense>
  ) : (
    <meshStandardMaterial color="#d8dce3" roughness={0.85} metalness={0.02} />
  );

  const baseboardDir = hasFloorTex ? "/textures/floor" : null;

  const baseboardMaterial = baseboardDir ? (
    <Suspense fallback={<meshStandardMaterial color="#3b2f26" roughness={0.65} />}>
      <TexturedBaseboardMaterial baseDir={baseboardDir} />
    </Suspense>
  ) : (
    <meshStandardMaterial color="#3b2f26" roughness={0.65} />
  );

  return (
    <group>
      <RigidBody type="fixed" colliders="cuboid" friction={0.9}>
        <mesh position={[0, -0.05, 0]} receiveShadow>
          <boxGeometry args={[roomWidth, 0.1, roomWidth]} />
          {hasFloorTex ? (
            <Suspense
              fallback={
                <meshStandardMaterial
                  color="#5c4a3a"
                  roughness={0.68}
                  metalness={0.04}
                />
              }
            >
              <TexturedFloorMaterial />
            </Suspense>
          ) : (
            <meshStandardMaterial
              color="#5c4a3a"
              roughness={0.68}
              metalness={0.04}
            />
          )}
        </mesh>
      </RigidBody>

      <RigidBody type="fixed" colliders="cuboid">
        <mesh
          position={[0, ROOM_HEIGHT + 0.05, 0]}
          receiveShadow
          raycast={NO_RAYCAST}
        >
          <boxGeometry args={[roomWidth, 0.1, roomWidth]} />
          {hasCeilingTex ? (
            <Suspense
              fallback={
                <meshStandardMaterial
                  color="#e5e7eb"
                  roughness={0.9}
                  metalness={0.02}
                />
              }
            >
              <TexturedCeilingMaterial />
            </Suspense>
          ) : (
            <meshStandardMaterial
              color="#e5e7eb"
              roughness={0.9}
              metalness={0.02}
            />
          )}
        </mesh>
      </RigidBody>

      <RigidBody type="fixed" colliders="cuboid" friction={0.8}>
        <mesh
          position={[0, ROOM_HEIGHT / 2, -ROOM_HALF - wallThickness / 2]}
          receiveShadow
        >
          <boxGeometry args={[roomWidth, ROOM_HEIGHT, wallThickness]} />
          {wallMaterial}
        </mesh>
      </RigidBody>

      <RigidBody type="fixed" colliders="cuboid" friction={0.8}>
        <mesh
          position={[0, ROOM_HEIGHT / 2, ROOM_HALF + wallThickness / 2]}
          receiveShadow
        >
          <boxGeometry args={[roomWidth, ROOM_HEIGHT, wallThickness]} />
          {wallMaterial}
        </mesh>
      </RigidBody>

      <RigidBody type="fixed" colliders="cuboid" friction={0.8}>
        <mesh
          position={[-ROOM_HALF - wallThickness / 2, ROOM_HEIGHT / 2, 0]}
          receiveShadow
        >
          <boxGeometry args={[wallThickness, ROOM_HEIGHT, roomWidth]} />
          {wallMaterial}
        </mesh>
      </RigidBody>

      <RigidBody type="fixed" colliders="cuboid" friction={0.8}>
        <mesh
          position={[ROOM_HALF + wallThickness / 2, ROOM_HEIGHT / 2, 0]}
          receiveShadow
        >
          <boxGeometry args={[wallThickness, ROOM_HEIGHT, roomWidth]} />
          {wallMaterial}
        </mesh>
      </RigidBody>

      {[
        { pos: [0, 0.05, -ROOM_HALF + 0.015], args: [roomWidth, 0.1, 0.03] },
        { pos: [0, 0.05, ROOM_HALF - 0.015], args: [roomWidth, 0.1, 0.03] },
        { pos: [-ROOM_HALF + 0.015, 0.05, 0], args: [0.03, 0.1, roomWidth] },
        { pos: [ROOM_HALF - 0.015, 0.05, 0], args: [0.03, 0.1, roomWidth] },
      ].map((b, i) => (
        <mesh
          key={i}
          position={b.pos as [number, number, number]}
          receiveShadow
          raycast={NO_RAYCAST}
        >
          <boxGeometry args={b.args as [number, number, number]} />
          {baseboardMaterial}
        </mesh>
      ))}

      {[-2.2, 2.2].map((x, i) => (
        <mesh key={i} position={[x, ROOM_HEIGHT - 0.03, 0]} raycast={NO_RAYCAST}>
          <cylinderGeometry args={[0.42, 0.46, 0.06, 32]} />
          <meshStandardMaterial
            color="#ffffff"
            emissive="#fff8eb"
            emissiveIntensity={1.4}
            roughness={0.2}
          />
        </mesh>
      ))}
    </group>
  );
});

type GrabbableEntry = {
  id: string;
  name: string;
  label: string;
  massKg: number;
  targetSize: number;
};

type GoalZoneEntry = {
  uid: string;
  position: [number, number, number];
  size: number;
};

type ActiveTrialRuntime = {
  trialNumber: number;
  objectId: string;
  objectName: string;
  massKg: number;
  startTimeIso: string;
  startUnixMs: number;
  illusionEnabled: boolean;
  cdRatioSetting: number;
  vibrationSetting: number;
  dropCount: number;
  carriedDistanceM: number;
  speedSum: number;
  speedSamples: number;
  maxSpeedMs: number;
  lagSumM: number;
  lagSamples: number;
  maxLagM: number;
  lastObjPos: THREE.Vector3;
  phase: "carrying" | "dropped";
};

type RigProps = {
  grabbableItems: GrabbableEntry[];
  goalZones: GoalZoneEntry[];
  bodies: BodyDict;
  staticObstaclesRef: React.MutableRefObject<Record<string, ObstacleBox>>;
  raycastRootRef: React.RefObject<THREE.Group | null>;
  inGoalZoneRef: React.MutableRefObject<boolean>;
  hasAvatar: boolean;
  experimentConfig: ExperimentConfig;
  thirdPerson: boolean;
  tutorialOpen: boolean;
  buildMode: boolean;
  buildDraft: BuildDraftConfig;
  nextTrialNumber: number;
  awaitingRating: boolean;
  abortTrialSignal: number;
  dropSeed: number;
  onPlaceProp: (pos: [number, number, number]) => void;
  onPickUpProp: (uid: string) => void;
  onRemoveProp: (uid: string) => void;
  onRotateDraft: (deltaRad: number) => void;
  onScaleDraft: (deltaSize: number) => void;
  onToggleIllusion: () => void;
  onToggleThirdPerson: () => void;
  onToggleBuildMode: () => void;
  onResetDrop: () => void;
  onTrialDelivered: (record: TrialRecord) => void;
  onTrialIncomplete: (record: TrialRecord) => void;
  onActiveTrialSnapshot: (snapshot: ActiveTrialSnapshot) => void;
  onTelemetry: (data: TelemetryData) => void;
};

const FirstPersonHapticsRig = memo(function FirstPersonHapticsRig({
  grabbableItems,
  goalZones,
  bodies,
  staticObstaclesRef,
  raycastRootRef,
  inGoalZoneRef,
  hasAvatar,
  experimentConfig,
  thirdPerson,
  tutorialOpen,
  buildMode,
  buildDraft,
  nextTrialNumber,
  awaitingRating,
  abortTrialSignal,
  dropSeed,
  onPlaceProp,
  onPickUpProp,
  onRemoveProp,
  onRotateDraft,
  onScaleDraft,
  onToggleIllusion,
  onToggleThirdPerson,
  onToggleBuildMode,
  onResetDrop,
  onTrialDelivered,
  onTrialIncomplete,
  onActiveTrialSnapshot,
  onTelemetry,
}: RigProps) {
  const { camera, gl } = useThree();
  const [isGrabbingVisual, setIsGrabbingVisual] = useState(false);
  const [isArmRaisedVisual, setIsArmRaisedVisual] = useState(false);
  const [ghostPlaceY, setGhostPlaceY] = useState(0);

  const standEyeHeightRef = useRef(1.48);
  const crouchAmountRef = useRef(0);
  const padCrouchToggledRef = useRef(false);
  const playerPos = useRef(new THREE.Vector3(0, 1.48, 1.35));
  const yaw = useRef(0);
  const pitch = useRef(-0.26);

  const inputPalmLocal = useRef(new THREE.Vector3(0.2, -0.14, -0.48));
  const visualPalmLocal = useRef(new THREE.Vector3(0.2, -0.14, -0.48));
  const wristTargetWorldRef = useRef(new THREE.Vector3(0.2, 1.33, 0.98));
  const leftWristTargetWorldRef = useRef(new THREE.Vector3(-0.2, 1.33, 0.98));
  const isArmRaisedRef = useRef(false);
  const isTwoHandedRef = useRef(false);
  const isGrabbingRef = useRef(false);
  const grabElapsedRef = useRef(0);
  const tremorClockRef = useRef(0);
  const turnSpeedScaleRef = useRef(1.0);
  const walkPhaseRef = useRef(0);
  const walkSpeedRef = useRef(0);
  const forwardDirRef = useRef(0);
  const motionStatusRef = useRef({ idle: false, walk: false });

  const fallbackHandRef = useRef<THREE.Group>(null);

  const buildGhostRef = useRef<THREE.Group>(null);
  const ghostBoxSizeRef = useRef<[number, number, number]>([0.5, 0.5, 0.5]);
  const prevGhostYRef = useRef(0);
  const validPlacePosRef = useRef<[number, number, number] | null>(null);
  const hoveredPropUidRef = useRef<string | null>(null);
  const hoveredPropNameRef = useRef<string | null>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const screenCenter = useMemo(() => new THREE.Vector2(0, 0), []);

  const grabbedIdRef = useRef("");
  const prevGrabVisualRef = useRef(false);
  const prevArmRaisedVisualRef = useRef(false);
  const prevVisualWorldPos = useRef(new THREE.Vector3());
  const prevPadButtons = useRef<boolean[]>([]);
  const vibTimer = useRef(0);
  const hudTimer = useRef(0);

  const activeTrialRef = useRef<ActiveTrialRuntime | null>(null);
  const awaitingRatingRef = useRef(awaitingRating);
  awaitingRatingRef.current = awaitingRating;
  const nextTrialNumberRef = useRef(nextTrialNumber);
  nextTrialNumberRef.current = nextTrialNumber;
  const experimentConfigRef = useRef(experimentConfig);
  experimentConfigRef.current = experimentConfig;
  const goalZonesRef = useRef(goalZones);
  goalZonesRef.current = goalZones;
  const tutorialOpenRef = useRef(tutorialOpen);
  tutorialOpenRef.current = tutorialOpen;

  const keys = useMemo((): Record<string, boolean> => ({}), []);
  const pointerLockedRef = useRef(false);
  const mouseGrabbing = useRef(false);

  const buildModeRef = useRef(buildMode);
  buildModeRef.current = buildMode;
  const buildDraftRef = useRef(buildDraft);
  buildDraftRef.current = buildDraft;
  const onPlacePropRef = useRef(onPlaceProp);
  onPlacePropRef.current = onPlaceProp;
  const onPickUpPropRef = useRef(onPickUpProp);
  onPickUpPropRef.current = onPickUpProp;
  const onRemovePropRef = useRef(onRemoveProp);
  onRemovePropRef.current = onRemoveProp;
  const onRotateDraftRef = useRef(onRotateDraft);
  onRotateDraftRef.current = onRotateDraft;
  const onScaleDraftRef = useRef(onScaleDraft);
  onScaleDraftRef.current = onScaleDraft;
  const onTrialDeliveredRef = useRef(onTrialDelivered);
  onTrialDeliveredRef.current = onTrialDelivered;
  const onTrialIncompleteRef = useRef(onTrialIncomplete);
  onTrialIncompleteRef.current = onTrialIncomplete;

  const safeReleaseBody = useCallback(
    (id: string) => {
      if (!id) return;
      const body = bodies[id];
      if (!body) return;
      try {
        body.lockTranslations(false, true);
        body.lockRotations(false, true);
        body.setGravityScale(1, true);
        const lv = body.linvel();
        const speed = Math.hypot(lv.x, lv.y, lv.z);
        const maxReleaseSpeed = 2.0;
        if (speed > maxReleaseSpeed) {
          const s = maxReleaseSpeed / speed;
          body.setLinvel({ x: lv.x * s, y: lv.y * s, z: lv.z * s }, true);
        }
        const av = body.angvel();
        body.setAngvel({ x: av.x * 0.2, y: av.y * 0.2, z: av.z * 0.2 }, true);
      } catch {
        // ignore if body was already unmounted
      }
    },
    [bodies]
  );

  useEffect(() => {
    if (tutorialOpen && document.pointerLockElement === gl.domElement) {
      document.exitPointerLock();
    }
  }, [tutorialOpen, gl.domElement]);

  const finalizeTrialRecord = useCallback(
    (trial: ActiveTrialRuntime, status: "completed" | "incomplete"): TrialRecord => {
      const endUnixMs = Date.now();
      const endTimeIso = new Date(endUnixMs).toISOString();
      const liftDurationSec = Math.max(0.01, (endUnixMs - trial.startUnixMs) / 1000);
      const avgSpeedMs =
        trial.speedSamples > 0
          ? trial.speedSum / trial.speedSamples
          : trial.carriedDistanceM / liftDurationSec;
      const avgLagM =
        trial.lagSamples > 0 ? trial.lagSumM / trial.lagSamples : 0;

      return {
        trialNumber: trial.trialNumber,
        status,
        objectUid: trial.objectId,
        startTimeIso: trial.startTimeIso,
        endTimeIso,
        startUnixMs: trial.startUnixMs,
        endUnixMs,
        objectName: trial.objectName,
        massKg: trial.massKg,
        illusionEnabled: trial.illusionEnabled,
        cdRatioSetting: trial.cdRatioSetting,
        vibrationSetting: trial.vibrationSetting,
        liftDurationSec,
        carriedDistanceM: trial.carriedDistanceM,
        avgSpeedMs,
        maxSpeedMs: trial.maxSpeedMs,
        dropCount: trial.dropCount,
        avgLagM,
        maxLagM: trial.maxLagM,
        discomfortScore: null,
        perceivedWeightScore: null,
      };
    },
    []
  );

  useEffect(() => {
    if (abortTrialSignal === 0) return;
    const trial = activeTrialRef.current;
    if (grabbedIdRef.current) {
      safeReleaseBody(grabbedIdRef.current);
      grabbedIdRef.current = "";
    }
    if (trial) {
      const record = finalizeTrialRecord(trial, "incomplete");
      activeTrialRef.current = null;
      onTrialIncompleteRef.current(record);
    }
  }, [abortTrialSignal, finalizeTrialRecord, safeReleaseBody]);

  useEffect(() => {
    if (dropSeed <= 1) return;
    const trial = activeTrialRef.current;
    if (grabbedIdRef.current) {
      safeReleaseBody(grabbedIdRef.current);
      grabbedIdRef.current = "";
    }
    if (trial) {
      const record = finalizeTrialRecord(trial, "incomplete");
      activeTrialRef.current = null;
      onTrialIncompleteRef.current(record);
    }
  }, [dropSeed, finalizeTrialRecord, safeReleaseBody]);

  const handleEyeHeightMeasured = useCallback((eyeHeight: number) => {
    standEyeHeightRef.current = eyeHeight;
    playerPos.current.y = eyeHeight - crouchAmountRef.current * 0.44;
  }, []);

  const handleMotionClipsStatus = useCallback(
    (status: { idle: boolean; walk: boolean }) => {
      motionStatusRef.current = status;
    },
    []
  );

  const handleGhostMeasuredSize = useCallback(
    (size: [number, number, number]) => {
      ghostBoxSizeRef.current = size;
    },
    []
  );

  useEffect(() => {
    const dom = gl.domElement;

    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === dom;
      pointerLockedRef.current = locked;
      if (!locked) {
        mouseGrabbing.current = false;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (tutorialOpenRef.current) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "TEXTAREA") return;
      if (tag === "INPUT") {
        const inputType = (target as HTMLInputElement).type;
        if (inputType === "text" || inputType === "number") return;
      }

      const code = e.code;
      if (code === "Space") {
        e.preventDefault();
      }
      keys[code] = true;

      if (code === "Tab") {
        e.preventDefault();
        if (document.pointerLockElement === dom) {
          document.exitPointerLock();
        } else {
          safeRequestPointerLock(dom);
        }
        return;
      }

      if (code === "KeyB") {
        e.preventDefault();
        const nextBuild = !buildModeRef.current;
        if (nextBuild) {
          if (document.pointerLockElement === dom) {
            document.exitPointerLock();
          }
        } else {
          safeRequestPointerLock(dom);
        }
        onToggleBuildMode();
        return;
      }

      if (code === "KeyT") onToggleIllusion();
      if (code === "KeyV") onToggleThirdPerson();
      if (code === "KeyX") onResetDrop();

      if (buildModeRef.current) {
        const shiftHeld = !!keys["ShiftLeft"] || !!keys["ShiftRight"];
        const rotStep = shiftHeld ? Math.PI / 4 : Math.PI / 18;
        if (code === "KeyQ") onRotateDraftRef.current(rotStep);
        if (code === "KeyE") onRotateDraftRef.current(-rotStep);
        if (code === "KeyG") {
          if (hoveredPropUidRef.current) {
            onPickUpPropRef.current(hoveredPropUidRef.current);
          }
        }
        if (code === "Enter") {
          if (validPlacePosRef.current) {
            onPlacePropRef.current(validPlacePosRef.current);
          }
        }
        if (code === "KeyC" || code === "Delete" || code === "Backspace") {
          if (hoveredPropUidRef.current) {
            onRemovePropRef.current(hoveredPropUidRef.current);
          }
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keys[e.code] = false;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (tutorialOpenRef.current) return;
      if (e.target !== dom) return;

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      if (document.pointerLockElement !== dom) {
        if (e.button === 0) {
          safeRequestPointerLock(dom);
        }
        return;
      }

      if (buildModeRef.current) {
        if (e.button === 0) {
          if (validPlacePosRef.current) {
            onPlacePropRef.current(validPlacePosRef.current);
          }
        } else if (e.button === 1) {
          e.preventDefault();
          if (hoveredPropUidRef.current) {
            onPickUpPropRef.current(hoveredPropUidRef.current);
          }
        }
      } else {
        if (e.button === 0) {
          mouseGrabbing.current = true;
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) mouseGrabbing.current = false;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (tutorialOpenRef.current) return;
      if (document.pointerLockElement !== dom) return;

      if (buildModeRef.current && keys["KeyR"]) {
        const curSize = buildDraftRef.current.targetSize;
        const speedFactor = Math.max(0.004, curSize * 0.003);
        const deltaScale = -e.movementY * speedFactor;
        if (deltaScale !== 0) {
          onScaleDraftRef.current(deltaScale);
        }
        return;
      }

      const sens = 0.0024 * turnSpeedScaleRef.current;
      yaw.current -= e.movementX * sens;
      pitch.current = THREE.MathUtils.clamp(
        pitch.current - e.movementY * sens,
        -1.35,
        1.0
      );
    };

    const onWheel = (e: WheelEvent) => {
      if (tutorialOpenRef.current) return;
      if (document.pointerLockElement !== dom && e.target !== dom) return;
      if (buildModeRef.current) {
        if (keys["KeyR"]) {
          const curSize = buildDraftRef.current.targetSize;
          const step = Math.max(0.05, Math.round(curSize * 0.06 * 100) / 100);
          onScaleDraftRef.current(e.deltaY > 0 ? -step : step);
        } else {
          const shiftHeld = !!keys["ShiftLeft"] || !!keys["ShiftRight"];
          const step = shiftHeld ? Math.PI / 4 : Math.PI / 18;
          onRotateDraftRef.current(e.deltaY > 0 ? -step : step);
        }
      } else {
        inputPalmLocal.current.y = THREE.MathUtils.clamp(
          inputPalmLocal.current.y - e.deltaY * 0.0004,
          -0.44,
          0.26
        );
      }
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    document.addEventListener("pointerlockchange", onPointerLockChange);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    dom.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    dom.addEventListener("wheel", onWheel, { passive: true });
    dom.addEventListener("contextmenu", onContextMenu);

    return () => {
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      dom.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      dom.removeEventListener("wheel", onWheel);
      dom.removeEventListener("contextmenu", onContextMenu);
    };
  }, [
    gl.domElement,
    keys,
    onResetDrop,
    onToggleBuildMode,
    onToggleIllusion,
    onToggleThirdPerson,
  ]);

  const isInsideAnyGoalZone = useCallback((objPos: THREE.Vector3): boolean => {
    for (const gz of goalZonesRef.current) {
      const horizDist = Math.hypot(
        objPos.x - gz.position[0],
        objPos.z - gz.position[2]
      );
      const radius = gz.size * 0.6 + 0.14;
      const dy = objPos.y - gz.position[1];
      if (horizDist <= radius && dy >= -0.2 && dy <= 1.85) {
        return true;
      }
    }
    return false;
  }, []);

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const cfg = experimentConfigRef.current;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads.find((p) => p && p.connected) || null;

    const deadzone = (v: number) => (Math.abs(v) < 0.14 ? 0 : v);
    let lx = 0;
    let ly = 0;
    let rx = 0;
    let ry = 0;
    let r2Grab = false;
    let padCrouchHold = false;
    let dpadUp = false;
    let dpadDown = false;

    if (pad && !tutorialOpenRef.current) {
      lx = deadzone(pad.axes[0] || 0);
      ly = deadzone(pad.axes[1] || 0);
      rx = deadzone(pad.axes[2] || 0);
      ry = deadzone(pad.axes[3] || 0);

      r2Grab = (pad.buttons[7]?.value || 0) > 0.35 || !!pad.buttons[0]?.pressed;
      padCrouchHold =
        (pad.buttons[6]?.value || 0) > 0.35 || !!pad.buttons[4]?.pressed;
      dpadUp = !!pad.buttons[12]?.pressed;
      dpadDown = !!pad.buttons[13]?.pressed;

      const prev = prevPadButtons.current;
      if (pad.buttons[10]?.pressed && !prev[10]) {
        padCrouchToggledRef.current = !padCrouchToggledRef.current;
      }
      if (pad.buttons[2]?.pressed && !prev[2]) onResetDrop();
      if (pad.buttons[3]?.pressed && !prev[3]) onToggleIllusion();
      if (pad.buttons[1]?.pressed && !prev[1]) onToggleThirdPerson();
      prevPadButtons.current = pad.buttons.map((b) => !!b.pressed);
    }

    const currentGrabbed =
      grabbableItems.find((m) => m.id === grabbedIdRef.current) || null;
    let carryHeaviness = 0;
    let cdRatio = 1.0;

    if (currentGrabbed && cfg.illusionEnabled) {
      const massFactor = THREE.MathUtils.clamp(currentGrabbed.massKg / 12.0, 0, 1);
      cdRatio =
        cfg.cdRatioMode === "manual"
          ? THREE.MathUtils.clamp(cfg.manualCdRatio, 0.12, 1.0)
          : THREE.MathUtils.lerp(1.0, 0.24, Math.pow(massFactor, 0.85));
      carryHeaviness = THREE.MathUtils.clamp((1.0 - cdRatio) / 0.76, 0, 1);
    }

    turnSpeedScaleRef.current = THREE.MathUtils.lerp(1.0, 0.68, carryHeaviness);

    yaw.current -= rx * 1.9 * turnSpeedScaleRef.current * dt;
    pitch.current = THREE.MathUtils.clamp(
      pitch.current - ry * 1.5 * turnSpeedScaleRef.current * dt,
      -1.35,
      1.0
    );

    const wantCrouch =
      !tutorialOpenRef.current &&
      (!!keys["Space"] || padCrouchHold || padCrouchToggledRef.current);

    crouchAmountRef.current = THREE.MathUtils.lerp(
      crouchAmountRef.current,
      wantCrouch ? 1.0 : 0.0,
      1 - Math.exp(-12 * dt)
    );
    playerPos.current.y =
      standEyeHeightRef.current - crouchAmountRef.current * 0.44;

    const forwardFlat = new THREE.Vector3(
      -Math.sin(yaw.current),
      0,
      -Math.cos(yaw.current)
    );
    const rightFlat = new THREE.Vector3(
      Math.cos(yaw.current),
      0,
      -Math.sin(yaw.current)
    );

    let moveForward = 0;
    let moveRight = 0;
    if (!tutorialOpenRef.current) {
      if (keys["KeyW"] || keys["ArrowUp"]) moveForward += 1;
      if (keys["KeyS"] || keys["ArrowDown"]) moveForward -= 1;
      if (keys["KeyD"] || keys["ArrowRight"]) moveRight += 1;
      if (keys["KeyA"] || keys["ArrowLeft"]) moveRight -= 1;

      moveForward -= ly;
      moveRight += lx;
    }

    forwardDirRef.current = moveForward;

    const baseMoveSpeed = THREE.MathUtils.lerp(1.75, 0.95, crouchAmountRef.current);
    const moveSpeed =
      baseMoveSpeed * THREE.MathUtils.lerp(1.0, 0.58, carryHeaviness);

    const prevX = playerPos.current.x;
    const prevZ = playerPos.current.z;

    const nextX = THREE.MathUtils.clamp(
      playerPos.current.x +
      (forwardFlat.x * moveForward + rightFlat.x * moveRight) * moveSpeed * dt,
      -ROOM_HALF + 0.45,
      ROOM_HALF - 0.45
    );
    const nextZ = THREE.MathUtils.clamp(
      playerPos.current.z +
      (forwardFlat.z * moveForward + rightFlat.z * moveRight) * moveSpeed * dt,
      -ROOM_HALF + 0.45,
      ROOM_HALF - 0.45
    );

    const isBlocked = (x: number, z: number) => {
      const obstacles = staticObstaclesRef.current;
      for (const uid in obstacles) {
        const b = obstacles[uid];
        if (
          x > b.minX - PLAYER_RADIUS &&
          x < b.maxX + PLAYER_RADIUS &&
          z > b.minZ - PLAYER_RADIUS &&
          z < b.maxZ + PLAYER_RADIUS
        ) {
          return true;
        }
      }
      return false;
    };

    if (!isBlocked(nextX, playerPos.current.z)) {
      playerPos.current.x = nextX;
    }
    if (!isBlocked(playerPos.current.x, nextZ)) {
      playerPos.current.z = nextZ;
    }

    const movedDist = Math.hypot(
      playerPos.current.x - prevX,
      playerPos.current.z - prevZ
    );
    const actualSpeed = movedDist / Math.max(dt, 0.001);
    walkSpeedRef.current = THREE.MathUtils.lerp(
      walkSpeedRef.current,
      actualSpeed,
      1 - Math.exp(-12 * dt)
    );
    if (actualSpeed > 0.05) {
      walkPhaseRef.current += dt * 8.5;
    }

    const headEuler = new THREE.Euler(pitch.current, yaw.current, 0, "YXZ");
    const headQuat = new THREE.Quaternion().setFromEuler(headEuler);

    const armPitch = THREE.MathUtils.clamp(pitch.current * 0.45, -0.55, 0.45);
    const armQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(armPitch, yaw.current, 0, "YXZ")
    );

    if (thirdPerson) {
      const camOffset = new THREE.Vector3(0.45, 0.2, 1.65).applyQuaternion(
        headQuat
      );
      camera.position.copy(playerPos.current).add(camOffset);
      camera.position.x = THREE.MathUtils.clamp(
        camera.position.x,
        -ROOM_HALF + 0.25,
        ROOM_HALF - 0.25
      );
      camera.position.z = THREE.MathUtils.clamp(
        camera.position.z,
        -ROOM_HALF + 0.25,
        ROOM_HALF - 0.25
      );
      camera.position.y = THREE.MathUtils.clamp(
        camera.position.y,
        0.35,
        ROOM_HEIGHT - 0.25
      );
    } else {
      camera.position.copy(playerPos.current);
    }
    camera.quaternion.copy(headQuat);

    const shiftHeld = !!keys["ShiftLeft"] || !!keys["ShiftRight"];

    // DIY配置モード
    if (buildMode && !tutorialOpenRef.current && raycastRootRef.current) {
      raycaster.setFromCamera(screenCenter, camera);
      raycaster.far = 7.5;
      const hits = raycaster.intersectObjects(
        raycastRootRef.current.children,
        true
      );

      let foundHit: THREE.Intersection | null = null;
      let foundPlacedUid: string | null = null;
      let foundPlacedName: string | null = null;

      for (const hit of hits) {
        if (hit.distance < 0.35) continue;
        let curr: THREE.Object3D | null = hit.object;
        while (curr) {
          if (curr.userData?.placedPropUid) {
            foundPlacedUid = curr.userData.placedPropUid;
            foundPlacedName = curr.userData.placedPropName || "配置済みアイテム";
            break;
          }
          curr = curr.parent;
        }
        foundHit = hit;
        break;
      }

      hoveredPropUidRef.current = foundPlacedUid;
      hoveredPropNameRef.current = foundPlacedName;

      if (foundHit && buildDraft.catalogItem) {
        let px = foundHit.point.x;
        let pz = foundHit.point.z;
        const py = Math.max(0, foundHit.point.y);

        if (Math.abs(py - prevGhostYRef.current) > 0.02) {
          prevGhostYRef.current = py;
          setGhostPlaceY(py);
        }

        const activeSnap = shiftHeld || buildDraft.snapGrid;
        if (activeSnap) {
          px = Math.round(px / 0.1) * 0.1;
          pz = Math.round(pz / 0.1) * 0.1;
        }

        const [bw, , bd] = ghostBoxSizeRef.current;
        const cosR = Math.abs(Math.cos(buildDraft.rotationY));
        const sinR = Math.abs(Math.sin(buildDraft.rotationY));
        const halfExtentX = (bw * cosR + bd * sinR) * 0.5;
        const halfExtentZ = (bw * sinR + bd * cosR) * 0.5;
        const wallMargin = 0.015;

        const minX = -ROOM_HALF + halfExtentX + wallMargin;
        const maxX = ROOM_HALF - halfExtentX - wallMargin;
        const minZ = -ROOM_HALF + halfExtentZ + wallMargin;
        const maxZ = ROOM_HALF - halfExtentZ - wallMargin;

        px = minX <= maxX ? THREE.MathUtils.clamp(px, minX, maxX) : 0;
        pz = minZ <= maxZ ? THREE.MathUtils.clamp(pz, minZ, maxZ) : 0;

        validPlacePosRef.current = [px, py, pz];
        if (buildGhostRef.current) {
          buildGhostRef.current.visible = true;
          buildGhostRef.current.position.set(px, py, pz);
          buildGhostRef.current.rotation.set(0, buildDraft.rotationY, 0);
        }
      } else {
        validPlacePosRef.current = null;
        if (buildGhostRef.current) {
          buildGhostRef.current.visible = false;
        }
      }
    } else {
      validPlacePosRef.current = null;
      hoveredPropUidRef.current = null;
      hoveredPropNameRef.current = null;
      if (buildGhostRef.current) {
        buildGhostRef.current.visible = false;
      }
    }

    if (!buildMode && !tutorialOpenRef.current) {
      if (keys["KeyR"] || dpadUp) {
        inputPalmLocal.current.y = Math.min(
          0.26,
          inputPalmLocal.current.y + 0.7 * dt
        );
      }
      if (keys["KeyF"] || dpadDown) {
        inputPalmLocal.current.y = Math.max(
          -0.44,
          inputPalmLocal.current.y - 0.7 * dt
        );
      }
    }

    const probePalmWorld = inputPalmLocal.current
      .clone()
      .applyQuaternion(headQuat)
      .add(playerPos.current);

    let nearestEntry: GrabbableEntry | null = null;
    let nearestDist = 0.65 + crouchAmountRef.current * 0.24;

    for (const item of grabbableItems) {
      const body = bodies[item.id];
      if (!body) continue;
      const t = body.translation();
      const centerPos = new THREE.Vector3(t.x, t.y + item.targetSize * 0.35, t.z);
      const palmDist = probePalmWorld.distanceTo(centerPos);
      if (palmDist < nearestDist) {
        nearestDist = palmDist;
        nearestEntry = item;
      }
    }

    const wantGrab =
      !buildMode &&
      !tutorialOpenRef.current &&
      (r2Grab || mouseGrabbing.current || !!keys["KeyE"]);

    isArmRaisedRef.current = wantGrab;
    if (!hasAvatar && wantGrab !== prevArmRaisedVisualRef.current) {
      prevArmRaisedVisualRef.current = wantGrab;
      setIsArmRaisedVisual(wantGrab);
    }

    const prevGrabbedId = grabbedIdRef.current;

    if (wantGrab && !grabbedIdRef.current && nearestEntry) {
      grabbedIdRef.current = nearestEntry.id;
      grabElapsedRef.current = 0;

      const body = bodies[nearestEntry.id];
      if (body) {
        // React再描画を起こさず直接ロック解除して物理演算を有効化
        body.lockTranslations(false, true);
        body.lockRotations(false, true);
        body.setGravityScale(0, true);
        body.wakeUp();

        // 掴んだ瞬間に物体が手元へ瞬間移動しないよう、手の開始位置を物体の現在位置に合わせる
        const t = body.translation();
        const willTwoHand = nearestEntry.massKg >= TWO_HAND_MASS_KG;
        const holdForwardOffset = willTwoHand
          ? Math.min(nearestEntry.targetSize * 0.26, 0.13)
          : Math.min(nearestEntry.targetSize * 0.22, 0.085);
        const objBottomOffset = nearestEntry.targetSize * 0.28;

        const invArmQuat = armQuat.clone().invert();
        const startLocal = new THREE.Vector3(t.x, t.y + objBottomOffset, t.z)
          .sub(playerPos.current)
          .applyQuaternion(invArmQuat);
        startLocal.z += holdForwardOffset;

        visualPalmLocal.current.set(
          THREE.MathUtils.clamp(startLocal.x, -0.5, 0.5),
          THREE.MathUtils.clamp(startLocal.y, -0.75, 0.35),
          THREE.MathUtils.clamp(startLocal.z, -0.95, -0.2)
        );
        prevVisualWorldPos.current
          .copy(visualPalmLocal.current)
          .applyQuaternion(armQuat)
          .add(playerPos.current);
      }

      if (!awaitingRatingRef.current) {
        const pos = body ? body.translation() : { x: 0, y: 0, z: 0 };
        const curObjVec = new THREE.Vector3(pos.x, pos.y, pos.z);

        const existing = activeTrialRef.current;
        if (existing && existing.objectId === nearestEntry.id) {
          existing.phase = "carrying";
          existing.lastObjPos.copy(curObjVec);
        } else {
          if (existing) {
            const incRecord = finalizeTrialRecord(existing, "incomplete");
            activeTrialRef.current = null;
            onTrialIncompleteRef.current(incRecord);
          }

          const massFactor = THREE.MathUtils.clamp(nearestEntry.massKg / 12.0, 0, 1);
          const effectiveCd = cfg.illusionEnabled
            ? cfg.cdRatioMode === "manual"
              ? cfg.manualCdRatio
              : THREE.MathUtils.lerp(1.0, 0.24, Math.pow(massFactor, 0.85))
            : 1.0;

          const nowMs = Date.now();
          activeTrialRef.current = {
            trialNumber: nextTrialNumberRef.current,
            objectId: nearestEntry.id,
            objectName: nearestEntry.name,
            massKg: nearestEntry.massKg,
            startTimeIso: new Date(nowMs).toISOString(),
            startUnixMs: nowMs,
            illusionEnabled: cfg.illusionEnabled,
            cdRatioSetting: effectiveCd,
            vibrationSetting: cfg.illusionEnabled ? cfg.vibrationScale : 0,
            dropCount: 0,
            carriedDistanceM: 0,
            speedSum: 0,
            speedSamples: 0,
            maxSpeedMs: 0,
            lagSumM: 0,
            lagSamples: 0,
            maxLagM: 0,
            lastObjPos: curObjVec,
            phase: "carrying",
          };
        }
      }
    } else if (!wantGrab && grabbedIdRef.current) {
      const releasedId = grabbedIdRef.current;
      safeReleaseBody(releasedId);
      grabbedIdRef.current = "";

      const trial = activeTrialRef.current;
      if (trial && trial.objectId === releasedId) {
        const body = bodies[releasedId];
        const pos = body ? body.translation() : null;
        const objPos = pos ? new THREE.Vector3(pos.x, pos.y, pos.z) : null;

        if (objPos && isInsideAnyGoalZone(objPos)) {
          const completedRecord = finalizeTrialRecord(trial, "completed");
          activeTrialRef.current = null;
          onTrialDeliveredRef.current(completedRecord);
        } else {
          trial.dropCount += 1;
          trial.phase = "dropped";
        }
      }
    }

    if (prevGrabbedId && !grabbableItems.some((g) => g.id === grabbedIdRef.current)) {
      grabbedIdRef.current = "";
    }

    const nowGrabbing = !!grabbedIdRef.current;
    isGrabbingRef.current = nowGrabbing;
    if (!hasAvatar && nowGrabbing !== prevGrabVisualRef.current) {
      prevGrabVisualRef.current = nowGrabbing;
      setIsGrabbingVisual(nowGrabbing);
    }

    const grabbedEntry =
      grabbableItems.find((m) => m.id === grabbedIdRef.current) || null;

    if (grabbedEntry) {
      grabElapsedRef.current += dt;
    } else {
      grabElapsedRef.current = 0;
    }

    const isTwoHanded = !!grabbedEntry && grabbedEntry.massKg >= TWO_HAND_MASS_KG;
    isTwoHandedRef.current = isTwoHanded;

    let heaviness = 0;
    cdRatio = 1.0;

    if (grabbedEntry && cfg.illusionEnabled) {
      const massFactor = THREE.MathUtils.clamp(grabbedEntry.massKg / 12.0, 0, 1);
      cdRatio =
        cfg.cdRatioMode === "manual"
          ? THREE.MathUtils.clamp(cfg.manualCdRatio, 0.12, 1.0)
          : THREE.MathUtils.lerp(1.0, 0.24, Math.pow(massFactor, 0.85));
      heaviness = THREE.MathUtils.clamp((1.0 - cdRatio) / 0.76, 0, 1);
    }

    const targetVisualLocal = inputPalmLocal.current.clone();
    if (isTwoHanded) {
      targetVisualLocal.x = 0.0;
      targetVisualLocal.z = -0.48;
    }

    if (grabbedEntry && cfg.illusionEnabled) {
      const maxLiftY = THREE.MathUtils.lerp(0.24, -0.05, heaviness);
      const clampedY = Math.min(targetVisualLocal.y, maxLiftY);
      const sagOffset = THREE.MathUtils.lerp(0.0, -0.1, heaviness);
      targetVisualLocal.y = THREE.MathUtils.clamp(clampedY + sagOffset, -0.34, 0.24);
    }

    const horizRate =
      grabbedEntry && cfg.illusionEnabled
        ? THREE.MathUtils.lerp(14, 4.2, heaviness)
        : 18;
    const liftingUp = targetVisualLocal.y > visualPalmLocal.current.y;
    const vertRate =
      grabbedEntry && cfg.illusionEnabled
        ? liftingUp
          ? THREE.MathUtils.lerp(14, 2.2, heaviness)
          : THREE.MathUtils.lerp(16, 9.5, heaviness)
        : 18;

    const alphaH = 1 - Math.exp(-horizRate * dt);
    const alphaV = 1 - Math.exp(-vertRate * dt);
    visualPalmLocal.current.x = THREE.MathUtils.lerp(
      visualPalmLocal.current.x,
      targetVisualLocal.x,
      alphaH
    );
    visualPalmLocal.current.z = THREE.MathUtils.lerp(
      visualPalmLocal.current.z,
      targetVisualLocal.z,
      alphaH
    );
    visualPalmLocal.current.y = THREE.MathUtils.lerp(
      visualPalmLocal.current.y,
      targetVisualLocal.y,
      alphaV
    );

    tremorClockRef.current += dt;
    const tremorLocal = new THREE.Vector3();
    if (grabbedEntry && cfg.illusionEnabled && heaviness > 0.35) {
      const strain = (heaviness - 0.35) / 0.65;
      const amp = 0.004 * strain;
      const t = tremorClockRef.current;
      tremorLocal.set(
        Math.sin(t * 29.0) * amp,
        Math.cos(t * 37.0) * amp * 1.2,
        Math.sin(t * 23.0) * amp * 0.5
      );
    }

    const idealTargetLocal = inputPalmLocal.current.clone();
    if (isTwoHanded) {
      idealTargetLocal.x = 0.0;
      idealTargetLocal.z = -0.48;
    }

    const activeQuat = grabbedEntry ? armQuat : headQuat;

    const idealPalmWorld = idealTargetLocal
      .clone()
      .applyQuaternion(activeQuat)
      .add(playerPos.current);
    const visualPalmWithTremor = visualPalmLocal.current.clone().add(tremorLocal);
    const visualPalmWorld = visualPalmWithTremor
      .clone()
      .applyQuaternion(activeQuat)
      .add(playerPos.current);

    const currentLagM = idealPalmWorld.distanceTo(visualPalmWorld);

    if (isTwoHanded && grabbedEntry) {
      const halfGripX = THREE.MathUtils.clamp(
        grabbedEntry.targetSize * 0.36,
        0.11,
        0.24
      );
      const rWristLocal = visualPalmWithTremor.clone();
      rWristLocal.x += halfGripX;
      rWristLocal.z += WRIST_TO_PALM_OFFSET * 0.85;
      const lWristLocal = visualPalmWithTremor.clone();
      lWristLocal.x -= halfGripX;
      lWristLocal.z += WRIST_TO_PALM_OFFSET * 0.85;

      wristTargetWorldRef.current
        .copy(rWristLocal)
        .applyQuaternion(activeQuat)
        .add(playerPos.current);
      leftWristTargetWorldRef.current
        .copy(lWristLocal)
        .applyQuaternion(activeQuat)
        .add(playerPos.current);
    } else {
      const wristLocal = visualPalmWithTremor.clone();
      wristLocal.z += WRIST_TO_PALM_OFFSET;
      wristTargetWorldRef.current
        .copy(wristLocal)
        .applyQuaternion(activeQuat)
        .add(playerPos.current);
    }

    if (fallbackHandRef.current) {
      fallbackHandRef.current.position.copy(visualPalmWorld);
      fallbackHandRef.current.quaternion.copy(activeQuat);
    }

    const handSpeed =
      visualPalmWorld.distanceTo(prevVisualWorldPos.current) /
      Math.max(dt, 0.001);
    prevVisualWorldPos.current.copy(visualPalmWorld);

    let inGoalZoneNow = false;

    if (grabbedEntry) {
      const body = bodies[grabbedEntry.id];
      if (body) {
        const holdForwardOffset = isTwoHanded
          ? Math.min(grabbedEntry.targetSize * 0.26, 0.13)
          : Math.min(grabbedEntry.targetSize * 0.22, 0.085);

        const holdLocal = visualPalmWithTremor.clone();
        holdLocal.z -= holdForwardOffset;
        const holdWorld = holdLocal
          .applyQuaternion(activeQuat)
          .add(playerPos.current);

        const objBottomOffset = grabbedEntry.targetSize * 0.28;
        holdWorld.y = Math.max(0.04, holdWorld.y - objBottomOffset);

        const pos = body.translation();
        const curObjPos = new THREE.Vector3(pos.x, pos.y, pos.z);
        inGoalZoneNow = isInsideAnyGoalZone(curObjPos);

        const diff = new THREE.Vector3(
          holdWorld.x - pos.x,
          holdWorld.y - pos.y,
          holdWorld.z - pos.z
        );

        const rampDuration = cfg.illusionEnabled
          ? THREE.MathUtils.lerp(0.16, 0.42, heaviness)
          : 0.16;
        const ramp = THREE.MathUtils.clamp(
          grabElapsedRef.current / rampDuration,
          0.35,
          1.0
        );
        const stiffness =
          (cfg.illusionEnabled ? THREE.MathUtils.lerp(16, 8.5, heaviness) : 16) *
          ramp;

        let vx = diff.x * stiffness;
        let vy = diff.y * stiffness;
        let vz = diff.z * stiffness;

        if (cfg.illusionEnabled && vy > 0) {
          const maxUpSpeed = THREE.MathUtils.lerp(2.8, 0.85, heaviness);
          vy = Math.min(vy, maxUpSpeed);
        }

        const maxPullSpeed = cfg.illusionEnabled
          ? THREE.MathUtils.lerp(3.2, 1.65, heaviness)
          : 3.2;
        const speedMag = Math.hypot(vx, vy, vz);
        if (speedMag > maxPullSpeed) {
          const s = maxPullSpeed / speedMag;
          vx *= s;
          vy *= s;
          vz *= s;
        }

        body.setLinvel({ x: vx, y: vy, z: vz }, true);
        const av = body.angvel();
        body.setAngvel({ x: av.x * 0.15, y: av.y * 0.15, z: av.z * 0.15 }, true);

        const trial = activeTrialRef.current;
        if (trial && trial.objectId === grabbedEntry.id && trial.phase === "carrying") {
          const stepDist = curObjPos.distanceTo(trial.lastObjPos);
          if (stepDist < 1.5) {
            trial.carriedDistanceM += stepDist;
            const instSpeed = stepDist / Math.max(dt, 0.008);
            if (instSpeed < 12) {
              trial.speedSum += instSpeed;
              trial.speedSamples += 1;
              if (instSpeed > trial.maxSpeedMs) {
                trial.maxSpeedMs = instSpeed;
              }
            }
          }
          trial.lastObjPos.copy(curObjPos);

          trial.lagSumM += currentLagM;
          trial.lagSamples += 1;
          if (currentLagM > trial.maxLagM) {
            trial.maxLagM = currentLagM;
          }
        }
      }
    } else if (!awaitingRatingRef.current) {
      const trial = activeTrialRef.current;
      if (trial && trial.phase === "dropped") {
        const body = bodies[trial.objectId];
        if (body) {
          const pos = body.translation();
          const objPos = new THREE.Vector3(pos.x, pos.y, pos.z);
          if (isInsideAnyGoalZone(objPos)) {
            const completedRecord = finalizeTrialRecord(trial, "completed");
            activeTrialRef.current = null;
            onTrialDeliveredRef.current(completedRecord);
          }
        }
      }
    }

    // ゴールエリア内外の状態をrefへ直接書き込む（React再描画を起こさない）
    inGoalZoneRef.current = inGoalZoneNow;

    let vibLevel = 0;
    if (grabbedEntry && cfg.illusionEnabled) {
      const massNorm = THREE.MathUtils.clamp(grabbedEntry.massKg / 12.0, 0.05, 1.0);
      const liftImpulse = THREE.MathUtils.clamp(handSpeed * 0.85, 0, 0.65);
      const rawVib = massNorm * 0.45 + liftImpulse * massNorm;
      vibLevel = THREE.MathUtils.clamp(rawVib * cfg.vibrationScale, 0, 1.0);
    }

    vibTimer.current += dt;
    if (pad && vibTimer.current >= 0.06) {
      vibTimer.current = 0;
      const rumblePad = pad as DualRumblePad;
      const actuator = rumblePad.vibrationActuator;

      if (actuator && typeof actuator.playEffect === "function" && vibLevel > 0.02) {
        actuator
          .playEffect("dual-rumble", {
            duration: 75,
            strongMagnitude: vibLevel,
            weakMagnitude: vibLevel * 0.5,
          })
          .catch(() => { });
      }
    }

    hudTimer.current += dt;
    if (hudTimer.current >= 0.075) {
      hudTimer.current = 0;

      const trial = activeTrialRef.current;
      const phase: TrialPhase = awaitingRatingRef.current
        ? "awaiting_rating"
        : trial
          ? trial.phase
          : "idle";

      onActiveTrialSnapshot({
        trialNumber: trial ? trial.trialNumber : nextTrialNumberRef.current,
        phase,
        objectName: trial ? trial.objectName : grabbedEntry ? grabbedEntry.name : null,
        massKg: trial ? trial.massKg : grabbedEntry ? grabbedEntry.massKg : 0,
        elapsedSec: trial ? (Date.now() - trial.startUnixMs) / 1000 : 0,
        dropCount: trial ? trial.dropCount : 0,
        currentLagM,
        currentCdRatio: cdRatio,
        currentVibration: vibLevel,
        carriedDistanceM: trial ? trial.carriedDistanceM : 0,
        inGoalZone: inGoalZoneNow,
        hasGoalMat: goalZonesRef.current.length > 0,
      });

      onTelemetry({
        gamepadConnected: !!pad,
        gamepadName: pad ? pad.id.slice(0, 26) : "未接続 (マウス/キーボード)",
        hoverLabel: nearestEntry ? nearestEntry.label : null,
        grabbedLabel: grabbedEntry ? grabbedEntry.label : null,
        grabbedMassKg: grabbedEntry ? grabbedEntry.massKg : 0,
        currentCdRatio: cdRatio,
        vibrationLevel: vibLevel,
        currentLagM,
        hasAvatar,
        idleLoaded: motionStatusRef.current.idle,
        walkLoaded: motionStatusRef.current.walk,
        hoveredPlacedName: hoveredPropNameRef.current,
        pointerLocked: pointerLockedRef.current,
        shiftSnapping: shiftHeld || buildDraftRef.current.snapGrid,
        isCrouching: crouchAmountRef.current > 0.25,
        isTwoHanded,
        trialPhase: phase,
        inGoalZone: inGoalZoneNow,
      });
    }
  });

  const draftItem = buildDraft.catalogItem;

  return (
    <>
      <group ref={buildGhostRef} visible={false}>
        {buildMode && draftItem && (
          draftItem.url === GOAL_MAT_URL ? (
            <GoalMatMesh
              targetSize={buildDraft.targetSize}
              ghost
              onMeasuredSize={handleGhostMeasuredSize}
            />
          ) : (
            <Suspense fallback={null}>
              <GroundedGltfGhost
                url={draftItem.url}
                targetSize={buildDraft.targetSize}
                placeY={ghostPlaceY}
                onMeasuredSize={handleGhostMeasuredSize}
              />
            </Suspense>
          )
        )}
      </group>

      {hasAvatar ? (
        <Suspense fallback={null}>
          <VrmFullBodyAvatar
            url="/models/avatar/avatar.vrm"
            playerPosRef={playerPos}
            yawRef={yaw}
            pitchRef={pitch}
            wristTargetWorldRef={wristTargetWorldRef}
            leftWristTargetWorldRef={leftWristTargetWorldRef}
            isArmRaisedRef={isArmRaisedRef}
            isTwoHandedRef={isTwoHandedRef}
            isGrabbingRef={isGrabbingRef}
            crouchAmountRef={crouchAmountRef}
            walkPhaseRef={walkPhaseRef}
            walkSpeedRef={walkSpeedRef}
            forwardDirRef={forwardDirRef}
            thirdPerson={thirdPerson}
            onEyeHeightMeasured={handleEyeHeightMeasured}
            onMotionClipsStatus={handleMotionClipsStatus}
          />
        </Suspense>
      ) : (
        <group ref={fallbackHandRef}>
          <FallbackBlockHand
            isGrabbing={isGrabbingVisual}
            isRaised={isArmRaisedVisual}
          />
        </group>
      )}
    </>
  );
});

export const Scene = memo(function Scene({
  hasCustomHdri,
  placedProps,
  buildMode,
  buildDraft,
  dropSeed,
  propRespawnSeeds,
  deliveredPropUid,
  showBackground,
  experimentConfig,
  thirdPerson,
  lightweightMode,
  tutorialOpen,
  nextTrialNumber,
  awaitingRating,
  abortTrialSignal,
  onPlaceProp,
  onPickUpProp,
  onRemoveProp,
  onRotateDraft,
  onScaleDraft,
  onToggleIllusion,
  onToggleThirdPerson,
  onToggleBuildMode,
  onResetDrop,
  onTrialDelivered,
  onTrialIncomplete,
  onActiveTrialSnapshot,
  onTelemetry,
}: SceneProps) {
  const [hasAvatar, setHasAvatar] = useState(false);
  const [hasFloorTex, setHasFloorTex] = useState(false);
  const [hasWallTex, setHasWallTex] = useState(false);
  const [hasCeilingTex, setHasCeilingTex] = useState(false);

  const bodies = useMemo((): BodyDict => ({}), []);
  const staticObstaclesRef = useRef<Record<string, ObstacleBox>>({});
  const raycastRootRef = useRef<THREE.Group | null>(null);
  const inGoalZoneRef = useRef(false);
  const awaitingRatingRef = useRef(awaitingRating);
  awaitingRatingRef.current = awaitingRating;

  useEffect(() => {
    Promise.all([
      fileExists("/models/avatar/avatar.vrm"),
      fileExists("/textures/floor/diff.jpg"),
      fileExists("/textures/floor/nor.jpg"),
      fileExists("/textures/floor/rough.jpg"),
      fileExists("/textures/wall/diff.jpg"),
      fileExists("/textures/wall/nor.jpg"),
      fileExists("/textures/wall/rough.jpg"),
      fileExists("/textures/ceiling/diff.jpg"),
      fileExists("/textures/ceiling/nor.jpg"),
      fileExists("/textures/ceiling/rough.jpg"),
    ]).then(
      ([
        avatarOk,
        fDiff,
        fNor,
        fRough,
        wDiff,
        wNor,
        wRough,
        cDiff,
        cNor,
        cRough,
      ]) => {
        setHasAvatar(avatarOk);
        setHasFloorTex(fDiff && fNor && fRough);
        setHasWallTex(wDiff && wNor && wRough);
        setHasCeilingTex(cDiff && cNor && cRough);
      }
    );
  }, []);

  const registerBody = useCallback(
    (id: string, body: RapierRigidBody | null) => {
      bodies[id] = body;
    },
    [bodies]
  );

  const registerStaticObstacle = useCallback(
    (uid: string, box: ObstacleBox | null) => {
      if (box) {
        staticObstaclesRef.current[uid] = box;
      } else {
        delete staticObstaclesRef.current[uid];
      }
    },
    []
  );

  const grabbableItems = useMemo<GrabbableEntry[]>(() => {
    return placedProps
      .filter(
        (p) =>
          p.url !== GOAL_MAT_URL &&
          p.mode === "dynamic" &&
          p.uid !== buildDraft.movingUid &&
          p.uid !== deliveredPropUid
      )
      .map((p) => ({
        id: p.uid,
        name: p.name,
        label: `${p.name} (${p.massKg.toFixed(2)} kg)`,
        massKg: p.massKg,
        targetSize: p.targetSize,
      }));
  }, [placedProps, buildDraft.movingUid, deliveredPropUid]);

  const goalZones = useMemo<GoalZoneEntry[]>(() => {
    return placedProps
      .filter((p) => p.url === GOAL_MAT_URL && p.uid !== buildDraft.movingUid)
      .map((p) => ({
        uid: p.uid,
        position: p.position,
        size: p.targetSize,
      }));
  }, [placedProps, buildDraft.movingUid]);

  return (
    <>
      <SceneLightingAndEnv
        hasCustomHdri={hasCustomHdri}
        showBackground={showBackground}
        lightweightMode={lightweightMode}
      />

      <Physics gravity={PHYSICS_GRAVITY} timeStep={1 / 60}>
        <group ref={raycastRootRef}>
          <PhysicalRoom
            hasFloorTex={hasFloorTex}
            hasWallTex={hasWallTex}
            hasCeilingTex={hasCeilingTex}
          />

          {placedProps.map((prop) => (
            <PlacedPropInstance
              key={prop.uid}
              prop={prop}
              dropSeed={dropSeed}
              respawnSeed={propRespawnSeeds[prop.uid] || 0}
              isBeingMoved={buildMode && buildDraft.movingUid === prop.uid}
              isDelivered={deliveredPropUid === prop.uid}
              inGoalZoneRef={inGoalZoneRef}
              awaitingRatingRef={awaitingRatingRef}
              registerBody={registerBody}
              registerStaticObstacle={registerStaticObstacle}
            />
          ))}
        </group>

        <FirstPersonHapticsRig
          grabbableItems={grabbableItems}
          goalZones={goalZones}
          bodies={bodies}
          staticObstaclesRef={staticObstaclesRef}
          raycastRootRef={raycastRootRef}
          inGoalZoneRef={inGoalZoneRef}
          hasAvatar={hasAvatar}
          experimentConfig={experimentConfig}
          thirdPerson={thirdPerson}
          tutorialOpen={tutorialOpen}
          buildMode={buildMode}
          buildDraft={buildDraft}
          nextTrialNumber={nextTrialNumber}
          awaitingRating={awaitingRating}
          abortTrialSignal={abortTrialSignal}
          dropSeed={dropSeed}
          onPlaceProp={onPlaceProp}
          onPickUpProp={onPickUpProp}
          onRemoveProp={onRemoveProp}
          onRotateDraft={onRotateDraft}
          onScaleDraft={onScaleDraft}
          onToggleIllusion={onToggleIllusion}
          onToggleThirdPerson={onToggleThirdPerson}
          onToggleBuildMode={onToggleBuildMode}
          onResetDrop={onResetDrop}
          onTrialDelivered={onTrialDelivered}
          onTrialIncomplete={onTrialIncomplete}
          onActiveTrialSnapshot={onActiveTrialSnapshot}
          onTelemetry={onTelemetry}
        />
      </Physics>

      {!lightweightMode && <ScenePostProcessing />}
    </>
  );
});