import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import {
    VRMHumanBoneName,
    VRMLoaderPlugin,
    VRMUtils,
    type VRM,
} from "@pixiv/three-vrm";

const X_AXIS = new THREE.Vector3(1, 0, 0);
const NO_RAYCAST: THREE.Object3D["raycast"] = () => { };

const MIXAMO_VRM_RIG_MAP: Record<string, VRMHumanBoneName> = {
    mixamorigHips: VRMHumanBoneName.Hips,
    mixamorigSpine: VRMHumanBoneName.Spine,
    mixamorigSpine1: VRMHumanBoneName.Chest,
    mixamorigSpine2: VRMHumanBoneName.UpperChest,
    mixamorigNeck: VRMHumanBoneName.Neck,
    mixamorigHead: VRMHumanBoneName.Head,
    mixamorigLeftShoulder: VRMHumanBoneName.LeftShoulder,
    mixamorigLeftArm: VRMHumanBoneName.LeftUpperArm,
    mixamorigLeftForeArm: VRMHumanBoneName.LeftLowerArm,
    mixamorigLeftHand: VRMHumanBoneName.LeftHand,
    mixamorigLeftHandThumb1: VRMHumanBoneName.LeftThumbMetacarpal,
    mixamorigLeftHandThumb2: VRMHumanBoneName.LeftThumbProximal,
    mixamorigLeftHandThumb3: VRMHumanBoneName.LeftThumbDistal,
    mixamorigLeftHandIndex1: VRMHumanBoneName.LeftIndexProximal,
    mixamorigLeftHandIndex2: VRMHumanBoneName.LeftIndexIntermediate,
    mixamorigLeftHandIndex3: VRMHumanBoneName.LeftIndexDistal,
    mixamorigLeftHandMiddle1: VRMHumanBoneName.LeftMiddleProximal,
    mixamorigLeftHandMiddle2: VRMHumanBoneName.LeftMiddleIntermediate,
    mixamorigLeftHandMiddle3: VRMHumanBoneName.LeftMiddleDistal,
    mixamorigLeftHandRing1: VRMHumanBoneName.LeftRingProximal,
    mixamorigLeftHandRing2: VRMHumanBoneName.LeftRingIntermediate,
    mixamorigLeftHandRing3: VRMHumanBoneName.LeftRingDistal,
    mixamorigLeftHandPinky1: VRMHumanBoneName.LeftLittleProximal,
    mixamorigLeftHandPinky2: VRMHumanBoneName.LeftLittleIntermediate,
    mixamorigLeftHandPinky3: VRMHumanBoneName.LeftLittleDistal,
    mixamorigRightShoulder: VRMHumanBoneName.RightShoulder,
    mixamorigRightArm: VRMHumanBoneName.RightUpperArm,
    mixamorigRightForeArm: VRMHumanBoneName.RightLowerArm,
    mixamorigRightHand: VRMHumanBoneName.RightHand,
    mixamorigLeftUpLeg: VRMHumanBoneName.LeftUpperLeg,
    mixamorigLeftLeg: VRMHumanBoneName.LeftLowerLeg,
    mixamorigLeftFoot: VRMHumanBoneName.LeftFoot,
    mixamorigLeftToeBase: VRMHumanBoneName.LeftToes,
    mixamorigRightUpLeg: VRMHumanBoneName.RightUpperLeg,
    mixamorigRightLeg: VRMHumanBoneName.RightLowerLeg,
    mixamorigRightFoot: VRMHumanBoneName.RightFoot,
    mixamorigRightToeBase: VRMHumanBoneName.RightToes,
};

function normalizeMixamoBoneName(rawName: string): string {
    const cleaned = rawName.replace(/^mixamorig\d*:?/i, "mixamorig");
    if (cleaned.startsWith("mixamorig")) return cleaned;
    return `mixamorig${cleaned}`;
}

async function checkFileExists(path: string): Promise<boolean> {
    try {
        const res = await fetch(path, { method: "HEAD" });
        if (!res.ok) return false;
        const ct = res.headers.get("content-type") || "";
        return !ct.includes("text/html");
    } catch {
        return false;
    }
}

function retargetMixamoClip(
    asset: THREE.Group,
    vrm: VRM,
    clipName: string
): THREE.AnimationClip | null {
    const clip =
        THREE.AnimationClip.findByName(asset.animations, "mixamo.com") ||
        asset.animations[0];
    if (!clip) return null;

    asset.updateMatrixWorld(true);
    vrm.scene.updateMatrixWorld(true);

    const tracks: THREE.KeyframeTrack[] = [];
    const restRotationInverse = new THREE.Quaternion();
    const parentRestWorldRotation = new THREE.Quaternion();
    const _quatA = new THREE.Quaternion();
    const _vec3 = new THREE.Vector3();

    const vrmHipsNode = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    const vrmHipsY = vrmHipsNode
        ? vrmHipsNode.getWorldPosition(_vec3).y
        : 0.92;
    const vrmRootY = vrm.scene.getWorldPosition(new THREE.Vector3()).y;
    const vrmHipsHeight = Math.max(0.4, Math.abs(vrmHipsY - vrmRootY));

    let motionHipsNode: THREE.Object3D | null = null;
    asset.traverse((obj) => {
        if (!motionHipsNode && normalizeMixamoBoneName(obj.name) === "mixamorigHips") {
            motionHipsNode = obj;
        }
    });

    const fallbackMotionHipsY =
        motionHipsNode &&
            Math.abs((motionHipsNode as THREE.Object3D).position.y) > 0.001
            ? Math.abs((motionHipsNode as THREE.Object3D).position.y)
            : 100;

    const isVrm0 = vrm.meta?.metaVersion === "0";

    clip.tracks.forEach((track) => {
        const lastDot = track.name.lastIndexOf(".");
        if (lastDot < 0) return;

        const mixamoRigName = track.name.slice(0, lastDot);
        const propertyName = track.name.slice(lastDot + 1);
        const normalizedName = normalizeMixamoBoneName(mixamoRigName);

        const vrmBoneName = MIXAMO_VRM_RIG_MAP[normalizedName];
        if (!vrmBoneName) return;

        const vrmNode = vrm.humanoid.getNormalizedBoneNode(vrmBoneName);
        const motionRigNode = asset.getObjectByName(mixamoRigName);
        if (!vrmNode || !motionRigNode || !motionRigNode.parent) return;

        if (track instanceof THREE.QuaternionKeyframeTrack) {
            motionRigNode.getWorldQuaternion(restRotationInverse).invert();
            motionRigNode.parent.getWorldQuaternion(parentRestWorldRotation);

            const flatQuaternion = new Float32Array(track.values.length);
            for (let i = 0; i < track.values.length; i += 4) {
                _quatA.fromArray(track.values, i);
                _quatA
                    .premultiply(parentRestWorldRotation)
                    .multiply(restRotationInverse);
                _quatA.toArray(flatQuaternion, i);
            }

            const converted = Array.from(flatQuaternion).map((v, idx) =>
                isVrm0 && idx % 2 === 0 ? -v : v
            );

            tracks.push(
                new THREE.QuaternionKeyframeTrack(
                    `${vrmNode.name}.${propertyName}`,
                    Array.from(track.times),
                    converted
                )
            );
        } else if (
            track instanceof THREE.VectorKeyframeTrack &&
            vrmBoneName === VRMHumanBoneName.Hips
        ) {
            const baseX = track.values[0] || 0;
            const firstY =
                Math.abs(track.values[1] || 0) > 0.001
                    ? Math.abs(track.values[1])
                    : fallbackMotionHipsY;
            const hipsPositionScale = vrmHipsHeight / firstY;

            const convertedPos = Array.from(track.values).map((v, idx) => {
                const axis = idx % 3;
                let val = v;
                if (axis === 0) {
                    val = v - baseX;
                } else if (axis === 2) {
                    val = 0;
                }
                if (isVrm0 && axis !== 1) {
                    val = -val;
                }
                return val * hipsPositionScale;
            });

            tracks.push(
                new THREE.VectorKeyframeTrack(
                    `${vrmNode.name}.${propertyName}`,
                    Array.from(track.times),
                    convertedPos
                )
            );
        }
    });

    if (tracks.length === 0) return null;
    return new THREE.AnimationClip(clipName, clip.duration, tracks);
}

export type AvatarRigProps = {
    url: string;
    playerPosRef: React.MutableRefObject<THREE.Vector3>;
    yawRef: React.MutableRefObject<number>;
    pitchRef: React.MutableRefObject<number>;
    wristTargetWorldRef: React.MutableRefObject<THREE.Vector3>;
    leftWristTargetWorldRef: React.MutableRefObject<THREE.Vector3>;
    isArmRaisedRef: React.MutableRefObject<boolean>;
    isTwoHandedRef: React.MutableRefObject<boolean>;
    isGrabbingRef: React.MutableRefObject<boolean>;
    crouchAmountRef: React.MutableRefObject<number>;
    walkPhaseRef: React.MutableRefObject<number>;
    walkSpeedRef: React.MutableRefObject<number>;
    forwardDirRef: React.MutableRefObject<number>;
    thirdPerson: boolean;
    onEyeHeightMeasured: (eyeHeight: number) => void;
    onMotionClipsStatus: (status: { idle: boolean; walk: boolean }) => void;
};

export function VrmFullBodyAvatar({
    url,
    playerPosRef,
    yawRef,
    pitchRef,
    wristTargetWorldRef,
    leftWristTargetWorldRef,
    isArmRaisedRef,
    isTwoHandedRef,
    isGrabbingRef,
    crouchAmountRef,
    walkPhaseRef,
    walkSpeedRef,
    forwardDirRef,
    thirdPerson,
    onEyeHeightMeasured,
    onMotionClipsStatus,
}: AvatarRigProps) {
    const { camera } = useThree();
    const rootRef = useRef<THREE.Group>(null);
    const rightArmIkBlendRef = useRef(0);
    const leftArmIkBlendRef = useRef(0);
    const grabLerpRef = useRef(0);
    const idleTimeRef = useRef(0);
    const walkWeightRef = useRef(0);

    const mixerRef = useRef<THREE.AnimationMixer | null>(null);
    const idleActionRef = useRef<THREE.AnimationAction | null>(null);
    const walkActionRef = useRef<THREE.AnimationAction | null>(null);

    const gltf = useLoader(GLTFLoader, url, (loader) => {
        loader.register((parser) => new VRMLoaderPlugin(parser));
    });

    const vrm = gltf.userData.vrm as VRM | undefined;
    const isVrm0 = vrm?.meta?.metaVersion === "0";

    const armMetrics = useMemo(() => {
        if (!vrm) {
            return {
                rUpper: 0.26,
                rLower: 0.24,
                lUpper: 0.26,
                lLower: 0.24,
                eyeHeight: 1.48,
                restHipsY: 0.92,
            };
        }

        if (!vrm.scene.userData.__vrmSetupDone) {
            vrm.scene.userData.__vrmSetupDone = true;

            VRMUtils.rotateVRM0(vrm);

            vrm.scene.traverse((obj) => {
                obj.raycast = NO_RAYCAST;
                if ((obj as THREE.Mesh).isMesh) {
                    obj.castShadow = true;
                    obj.receiveShadow = true;
                    obj.frustumCulled = false;
                }
            });

            if (vrm.firstPerson) {
                vrm.firstPerson.setup();
            }
        }

        vrm.scene.updateMatrixWorld(true);

        const measureArm = (
            uName: VRMHumanBoneName,
            lName: VRMHumanBoneName,
            hName: VRMHumanBoneName
        ) => {
            const u = vrm.humanoid.getNormalizedBoneNode(uName);
            const l = vrm.humanoid.getNormalizedBoneNode(lName);
            const h = vrm.humanoid.getNormalizedBoneNode(hName);
            let upper = 0.26;
            let lower = 0.24;
            if (u && l && h) {
                const p1 = new THREE.Vector3();
                const p2 = new THREE.Vector3();
                const p3 = new THREE.Vector3();
                u.getWorldPosition(p1);
                l.getWorldPosition(p2);
                h.getWorldPosition(p3);
                const d1 = p1.distanceTo(p2);
                const d2 = p2.distanceTo(p3);
                if (d1 > 0.05) upper = d1;
                if (d2 > 0.05) lower = d2;
            }
            return { upper, lower };
        };

        const rArm = measureArm(
            VRMHumanBoneName.RightUpperArm,
            VRMHumanBoneName.RightLowerArm,
            VRMHumanBoneName.RightHand
        );
        const lArm = measureArm(
            VRMHumanBoneName.LeftUpperArm,
            VRMHumanBoneName.LeftLowerArm,
            VRMHumanBoneName.LeftHand
        );

        const head = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head);
        const hips = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);

        let eyeHeight = 1.48;
        const restHipsY = hips ? hips.position.y : 0.92;

        if (head) {
            const rootWorld = new THREE.Vector3();
            const headWorld = new THREE.Vector3();
            vrm.scene.getWorldPosition(rootWorld);
            head.getWorldPosition(headWorld);
            const relHeadY = headWorld.y - rootWorld.y;
            if (relHeadY > 0.8) {
                eyeHeight = relHeadY + 0.09;
            }
        }

        return {
            rUpper: rArm.upper,
            rLower: rArm.lower,
            lUpper: lArm.upper,
            lLower: lArm.lower,
            eyeHeight,
            restHipsY,
        };
    }, [vrm]);

    useEffect(() => {
        if (!vrm) return;
        let cancelled = false;

        const mixer = new THREE.AnimationMixer(vrm.scene);
        mixerRef.current = mixer;

        const loader = new FBXLoader();

        async function loadClips() {
            const [idleExists, walkExists] = await Promise.all([
                checkFileExists("/models/animations/idle.fbx"),
                checkFileExists("/models/animations/walk.fbx"),
            ]);

            let idleOk = false;
            let walkOk = false;

            if (idleExists && !cancelled) {
                try {
                    const idleAsset = await loader.loadAsync("/models/animations/idle.fbx");
                    if (!cancelled && vrm) {
                        const idleClip = retargetMixamoClip(idleAsset, vrm, "idle");
                        if (idleClip) {
                            const action = mixer.clipAction(idleClip);
                            action.setLoop(THREE.LoopRepeat, Infinity);
                            action.setEffectiveWeight(1.0);
                            action.play();
                            idleActionRef.current = action;
                            idleOk = true;
                        }
                    }
                } catch {
                    // ignore
                }
            }

            if (walkExists && !cancelled) {
                try {
                    const walkAsset = await loader.loadAsync("/models/animations/walk.fbx");
                    if (!cancelled && vrm) {
                        const walkClip = retargetMixamoClip(walkAsset, vrm, "walk");
                        if (walkClip) {
                            const action = mixer.clipAction(walkClip);
                            action.setLoop(THREE.LoopRepeat, Infinity);
                            action.setEffectiveWeight(0.0);
                            action.play();
                            walkActionRef.current = action;
                            walkOk = true;
                        }
                    }
                } catch {
                    // ignore
                }
            }

            if (!cancelled) {
                onMotionClipsStatus({ idle: idleOk, walk: walkOk });
            }
        }

        loadClips();

        return () => {
            cancelled = true;
            mixer.stopAllAction();
            mixerRef.current = null;
            idleActionRef.current = null;
            walkActionRef.current = null;
        };
    }, [vrm, onMotionClipsStatus]);

    useEffect(() => {
        onEyeHeightMeasured(armMetrics.eyeHeight);
    }, [armMetrics.eyeHeight, onEyeHeightMeasured]);

    useEffect(() => {
        if (thirdPerson) {
            camera.layers.disable(9);
            camera.layers.enable(10);
        } else {
            camera.layers.enable(9);
            camera.layers.disable(10);
        }

        if (vrm) {
            const rawHead = vrm.humanoid.getRawBoneNode(VRMHumanBoneName.Head);
            if (rawHead) {
                rawHead.scale.setScalar(thirdPerson ? 1 : 0.0001);
            }
        }

        return () => {
            camera.layers.disable(9);
            camera.layers.enable(10);
            if (vrm) {
                const rawHead = vrm.humanoid.getRawBoneNode(VRMHumanBoneName.Head);
                if (rawHead) {
                    rawHead.scale.setScalar(1);
                }
            }
        };
    }, [camera, thirdPerson, vrm]);

    const rightHandOffsetQuat = useMemo(() => {
        const xAxis = new THREE.Vector3(0, 0, isVrm0 ? -1 : 1);
        const yAxis = new THREE.Vector3(0.75, 0.66, 0).normalize();
        const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
        yAxis.crossVectors(zAxis, xAxis).normalize();
        const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
        return new THREE.Quaternion().setFromRotationMatrix(m);
    }, [isVrm0]);

    const leftHandOffsetQuat = useMemo(() => {
        const xAxis = new THREE.Vector3(0, 0, isVrm0 ? 1 : -1);
        const yAxis = new THREE.Vector3(-0.75, 0.66, 0).normalize();
        const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
        yAxis.crossVectors(zAxis, xAxis).normalize();
        const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
        return new THREE.Quaternion().setFromRotationMatrix(m);
    }, [isVrm0]);

    const tmpShoulderWorld = useMemo(() => new THREE.Vector3(), []);
    const tmpTargetWorld = useMemo(() => new THREE.Vector3(), []);
    const tmpToTarget = useMemo(() => new THREE.Vector3(), []);
    const tmpPoleWorld = useMemo(() => new THREE.Vector3(), []);
    const tmpParentWorldQuat = useMemo(() => new THREE.Quaternion(), []);
    const tmpInvParentQuat = useMemo(() => new THREE.Quaternion(), []);
    const tmpLocalDir = useMemo(() => new THREE.Vector3(), []);
    const tmpLocalPole = useMemo(() => new THREE.Vector3(), []);
    const tmpPoleProj = useMemo(() => new THREE.Vector3(), []);
    const tmpUpperDir = useMemo(() => new THREE.Vector3(), []);
    const tmpXAxis = useMemo(() => new THREE.Vector3(), []);
    const tmpYAxis = useMemo(() => new THREE.Vector3(), []);
    const tmpZAxis = useMemo(() => new THREE.Vector3(), []);
    const tmpRotMat = useMemo(() => new THREE.Matrix4(), []);
    const tmpLowerWorldQuat = useMemo(() => new THREE.Quaternion(), []);
    const tmpHeadEuler = useMemo(() => new THREE.Euler(0, 0, 0, "YXZ"), []);
    const tmpHeadQuat = useMemo(() => new THREE.Quaternion(), []);
    const tmpHandWorldQuat = useMemo(() => new THREE.Quaternion(), []);
    const tmpAdditiveQuat = useMemo(() => new THREE.Quaternion(), []);

    const baseShoulderQuat = useMemo(() => new THREE.Quaternion(), []);
    const baseUpperQuat = useMemo(() => new THREE.Quaternion(), []);
    const baseLowerQuat = useMemo(() => new THREE.Quaternion(), []);
    const baseHandQuat = useMemo(() => new THREE.Quaternion(), []);
    const ikShoulderQuat = useMemo(() => new THREE.Quaternion(), []);
    const ikUpperQuat = useMemo(() => new THREE.Quaternion(), []);
    const ikLowerQuat = useMemo(() => new THREE.Quaternion(), []);
    const ikHandQuat = useMemo(() => new THREE.Quaternion(), []);
    const tmpFingerEuler = useMemo(() => new THREE.Euler(), []);
    const tmpFingerQuat = useMemo(() => new THREE.Quaternion(), []);

    useFrame((_, rawDelta) => {
        if (!vrm || !rootRef.current) return;
        const dt = Math.min(rawDelta, 0.05);
        const dirSign = isVrm0 ? -1 : 1;
        const crouch = crouchAmountRef.current;

        const backOffset = thirdPerson ? 0 : 0.14 + crouch * 0.18;
        const forwardX = -Math.sin(yawRef.current);
        const forwardZ = -Math.cos(yawRef.current);

        rootRef.current.position.set(
            playerPosRef.current.x - forwardX * backOffset,
            0,
            playerPosRef.current.z - forwardZ * backOffset
        );
        rootRef.current.rotation.set(0, yawRef.current + Math.PI, 0);

        const isMoving = walkSpeedRef.current > 0.08;
        const targetWalkWeight = isMoving ? 1.0 : 0.0;
        walkWeightRef.current = THREE.MathUtils.lerp(
            walkWeightRef.current,
            targetWalkWeight,
            1 - Math.exp(-10 * dt)
        );
        const wWeight = walkWeightRef.current;

        const hips = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
        const spine = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Spine);
        const chest = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Chest);
        const neck = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Neck);
        const lUpperLeg = vrm.humanoid.getNormalizedBoneNode(
            VRMHumanBoneName.LeftUpperLeg
        );
        const rUpperLeg = vrm.humanoid.getNormalizedBoneNode(
            VRMHumanBoneName.RightUpperLeg
        );
        const lLowerLeg = vrm.humanoid.getNormalizedBoneNode(
            VRMHumanBoneName.LeftLowerLeg
        );
        const rLowerLeg = vrm.humanoid.getNormalizedBoneNode(
            VRMHumanBoneName.RightLowerLeg
        );
        const lFoot = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftFoot);
        const rFoot = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightFoot);

        if (chest) chest.quaternion.identity();
        if (neck) neck.quaternion.identity();

        const idleAct = idleActionRef.current;
        const walkAct = walkActionRef.current;

        // 1. Mixamo全身ベースモーション更新
        if (mixerRef.current && (idleAct || walkAct)) {
            if (idleAct && walkAct) {
                idleAct.setEffectiveWeight(1.0 - wWeight);
                walkAct.setEffectiveWeight(wWeight);

                const speedScale = THREE.MathUtils.clamp(
                    walkSpeedRef.current / 1.35,
                    0.55,
                    1.35
                );
                const reverse = forwardDirRef.current < -0.1;
                walkAct.timeScale = reverse ? -speedScale : speedScale;
                if (reverse && walkAct.time <= 0.001) {
                    walkAct.time = walkAct.getClip().duration - 0.01;
                }
            } else if (idleAct) {
                idleAct.setEffectiveWeight(1.0);
            } else if (walkAct) {
                walkAct.setEffectiveWeight(wWeight);
            }

            mixerRef.current.update(dt);
        } else if (hips) {
            hips.position.y = armMetrics.restHipsY;
        }

        if (!walkAct) {
            const speedNorm = THREE.MathUtils.clamp(walkSpeedRef.current / 1.75, 0, 1);
            idleTimeRef.current += dt * 2.2;
            const breath = Math.sin(idleTimeRef.current) * 0.025;
            const swing = Math.sin(walkPhaseRef.current) * 0.4 * speedNorm;
            const kneeBend =
                Math.max(0, Math.sin(walkPhaseRef.current + Math.PI * 0.5)) *
                0.58 *
                speedNorm;
            const kneeBendOpp =
                Math.max(0, Math.sin(walkPhaseRef.current - Math.PI * 0.5)) *
                0.58 *
                speedNorm;

            if (!idleAct) {
                const lUpperArm = vrm.humanoid.getNormalizedBoneNode(
                    VRMHumanBoneName.LeftUpperArm
                );
                const lLowerArm = vrm.humanoid.getNormalizedBoneNode(
                    VRMHumanBoneName.LeftLowerArm
                );
                const rUpperArmFallback = vrm.humanoid.getNormalizedBoneNode(
                    VRMHumanBoneName.RightUpperArm
                );
                if (lUpperArm) {
                    lUpperArm.rotation.set(
                        -swing * 0.65 * dirSign,
                        0,
                        (-1.28 + breath * 0.4) * dirSign
                    );
                }
                if (lLowerArm) {
                    lLowerArm.rotation.set(0, -0.22, 0);
                }
                if (rUpperArmFallback) {
                    rUpperArmFallback.rotation.set(
                        swing * 0.65 * dirSign,
                        0,
                        (1.28 - breath * 0.4) * dirSign
                    );
                }
            }

            if (speedNorm > 0.02) {
                if (lUpperLeg) lUpperLeg.rotation.set(swing * dirSign, 0, 0);
                if (rUpperLeg) rUpperLeg.rotation.set(-swing * dirSign, 0, 0);
                if (lLowerLeg) lLowerLeg.rotation.set(kneeBend * dirSign, 0, 0);
                if (rLowerLeg) rLowerLeg.rotation.set(kneeBendOpp * dirSign, 0, 0);
            } else if (!idleAct) {
                if (lUpperLeg) lUpperLeg.quaternion.identity();
                if (rUpperLeg) rUpperLeg.quaternion.identity();
                if (lLowerLeg) lLowerLeg.quaternion.identity();
                if (rLowerLeg) rLowerLeg.quaternion.identity();
            }
        }

        // 2. しゃがみ姿勢
        if (crouch > 0.001) {
            if (hips) {
                hips.position.y -= crouch * 0.44;
            }
            if (spine) {
                const spineLean = thirdPerson ? 0.24 : 0.04;
                tmpAdditiveQuat.setFromAxisAngle(X_AXIS, spineLean * crouch * dirSign);
                spine.quaternion.multiply(tmpAdditiveQuat);
            }
            if (lUpperLeg) {
                tmpAdditiveQuat.setFromAxisAngle(X_AXIS, -0.95 * crouch * dirSign);
                lUpperLeg.quaternion.multiply(tmpAdditiveQuat);
            }
            if (rUpperLeg) {
                tmpAdditiveQuat.setFromAxisAngle(X_AXIS, -0.95 * crouch * dirSign);
                rUpperLeg.quaternion.multiply(tmpAdditiveQuat);
            }
            if (lLowerLeg) {
                tmpAdditiveQuat.setFromAxisAngle(X_AXIS, 1.66 * crouch * dirSign);
                lLowerLeg.quaternion.multiply(tmpAdditiveQuat);
            }
            if (rLowerLeg) {
                tmpAdditiveQuat.setFromAxisAngle(X_AXIS, 1.66 * crouch * dirSign);
                rLowerLeg.quaternion.multiply(tmpAdditiveQuat);
            }
            if (lFoot) {
                tmpAdditiveQuat.setFromAxisAngle(X_AXIS, -0.7 * crouch * dirSign);
                lFoot.quaternion.multiply(tmpAdditiveQuat);
            }
            if (rFoot) {
                tmpAdditiveQuat.setFromAxisAngle(X_AXIS, -0.7 * crouch * dirSign);
                rFoot.quaternion.multiply(tmpAdditiveQuat);
            }
        }

        // 3. 視線（ピッチ）に応じた胸・首の傾き
        const chestPitchFactor = thirdPerson ? 0.16 : 0.03;
        const chestPitch =
            THREE.MathUtils.clamp(-pitchRef.current * chestPitchFactor, -0.18, 0.22) *
            dirSign;
        const neckPitch =
            THREE.MathUtils.clamp(-pitchRef.current * 0.35, -0.38, 0.38) * dirSign;

        if (chest) {
            tmpAdditiveQuat.setFromAxisAngle(X_AXIS, chestPitch);
            chest.quaternion.multiply(tmpAdditiveQuat);
        }
        if (neck) {
            tmpAdditiveQuat.setFromAxisAngle(X_AXIS, neckPitch);
            neck.quaternion.multiply(tmpAdditiveQuat);
        }

        rootRef.current.updateMatrixWorld(true);

        // 4. 左右の腕IKブレンド更新（右腕：操作時、左腕：5kg以上の両手抱え時）
        const targetRightIk = isArmRaisedRef.current ? 1.0 : 0.0;
        const targetLeftIk =
            isArmRaisedRef.current && isTwoHandedRef.current ? 1.0 : 0.0;

        rightArmIkBlendRef.current = THREE.MathUtils.lerp(
            rightArmIkBlendRef.current,
            targetRightIk,
            1 - Math.exp(-(isArmRaisedRef.current ? 14 : 9) * dt)
        );
        leftArmIkBlendRef.current = THREE.MathUtils.lerp(
            leftArmIkBlendRef.current,
            targetLeftIk,
            1 - Math.exp(-(targetLeftIk > 0.5 ? 12 : 9) * dt)
        );

        const targetGrab = isGrabbingRef.current ? 1 : 0;
        grabLerpRef.current = THREE.MathUtils.lerp(
            grabLerpRef.current,
            targetGrab,
            1 - Math.exp(-16 * dt)
        );
        const g = grabLerpRef.current;

        const solveArmIk = (
            side: "right" | "left",
            ikW: number,
            targetWorld: THREE.Vector3,
            L1: number,
            L2: number
        ) => {
            if (ikW <= 0.002 || !rootRef.current) return;

            const isRight = side === "right";
            const shoulder = vrm.humanoid.getNormalizedBoneNode(
                isRight ? VRMHumanBoneName.RightShoulder : VRMHumanBoneName.LeftShoulder
            );
            const upperArm = vrm.humanoid.getNormalizedBoneNode(
                isRight ? VRMHumanBoneName.RightUpperArm : VRMHumanBoneName.LeftUpperArm
            );
            const lowerArm = vrm.humanoid.getNormalizedBoneNode(
                isRight ? VRMHumanBoneName.RightLowerArm : VRMHumanBoneName.LeftLowerArm
            );
            const hand = vrm.humanoid.getNormalizedBoneNode(
                isRight ? VRMHumanBoneName.RightHand : VRMHumanBoneName.LeftHand
            );

            if (upperArm && lowerArm && hand) {
                if (shoulder) baseShoulderQuat.copy(shoulder.quaternion);
                baseUpperQuat.copy(upperArm.quaternion);
                baseLowerQuat.copy(lowerArm.quaternion);
                baseHandQuat.copy(hand.quaternion);

                if (shoulder) {
                    const relY = targetWorld.y - playerPosRef.current.y;
                    const shoulderLift = THREE.MathUtils.clamp((relY + 0.25) * 0.35, -0.08, 0.16);
                    const sideSign = isRight ? 1 : -1;
                    shoulder.rotation.set(
                        0,
                        0.08 * dirSign * sideSign,
                        shoulderLift * dirSign * sideSign
                    );
                    ikShoulderQuat.copy(shoulder.quaternion);
                    shoulder.quaternion.copy(baseShoulderQuat).slerp(ikShoulderQuat, ikW);
                    shoulder.updateMatrixWorld(true);
                }

                upperArm.getWorldPosition(tmpShoulderWorld);
                tmpTargetWorld.copy(targetWorld);

                tmpToTarget.subVectors(tmpTargetWorld, tmpShoulderWorld);
                const maxReach = (L1 + L2) * 0.985;
                const minReach = Math.abs(L1 - L2) + 0.04;
                const dist = THREE.MathUtils.clamp(tmpToTarget.length(), minReach, maxReach);

                const cosAlpha = THREE.MathUtils.clamp(
                    (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist),
                    -1,
                    1
                );
                const alpha = Math.acos(cosAlpha);

                const cosBeta = THREE.MathUtils.clamp(
                    (L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2),
                    -1,
                    1
                );
                const elbowBend = Math.PI - Math.acos(cosBeta);

                const parentObj = upperArm.parent || rootRef.current;
                parentObj.getWorldQuaternion(tmpParentWorldQuat);
                tmpInvParentQuat.copy(tmpParentWorldQuat).invert();

                tmpLocalDir.copy(tmpToTarget).normalize().applyQuaternion(tmpInvParentQuat);

                tmpPoleWorld
                    .set(isRight ? -0.72 : 0.72, -0.58, -0.18)
                    .applyQuaternion(rootRef.current.quaternion)
                    .normalize();
                tmpLocalPole.copy(tmpPoleWorld).applyQuaternion(tmpInvParentQuat);

                const dotUP = tmpLocalPole.dot(tmpLocalDir);
                tmpPoleProj.copy(tmpLocalPole).addScaledVector(tmpLocalDir, -dotUP);
                if (tmpPoleProj.lengthSq() < 1e-5) {
                    tmpPoleProj.set(0, -1, 0);
                }
                tmpPoleProj.normalize();

                tmpUpperDir
                    .copy(tmpLocalDir)
                    .multiplyScalar(Math.cos(alpha))
                    .addScaledVector(tmpPoleProj, Math.sin(alpha))
                    .normalize();

                if (isRight) {
                    tmpXAxis.copy(tmpUpperDir).multiplyScalar(isVrm0 ? 1 : -1);
                    tmpYAxis.crossVectors(tmpPoleProj, tmpLocalDir).normalize();
                } else {
                    tmpXAxis.copy(tmpUpperDir).multiplyScalar(isVrm0 ? -1 : 1);
                    tmpYAxis.crossVectors(tmpLocalDir, tmpPoleProj).normalize();
                }
                tmpZAxis.crossVectors(tmpXAxis, tmpYAxis).normalize();

                tmpRotMat.makeBasis(tmpXAxis, tmpYAxis, tmpZAxis);
                ikUpperQuat.setFromRotationMatrix(tmpRotMat);
                upperArm.quaternion.copy(baseUpperQuat).slerp(ikUpperQuat, ikW);

                lowerArm.rotation.set(0, isRight ? elbowBend : -elbowBend, 0);
                ikLowerQuat.copy(lowerArm.quaternion);
                lowerArm.quaternion.copy(baseLowerQuat).slerp(ikLowerQuat, ikW);

                upperArm.updateMatrixWorld(true);
                lowerArm.updateMatrixWorld(true);
                lowerArm.getWorldQuaternion(tmpLowerWorldQuat);
                tmpInvParentQuat.copy(tmpLowerWorldQuat).invert();

                tmpHeadEuler.set(pitchRef.current, yawRef.current, 0, "YXZ");
                tmpHeadQuat.setFromEuler(tmpHeadEuler);
                tmpHandWorldQuat
                    .copy(tmpHeadQuat)
                    .multiply(isRight ? rightHandOffsetQuat : leftHandOffsetQuat);
                ikHandQuat.copy(tmpInvParentQuat).multiply(tmpHandWorldQuat);
                hand.quaternion.copy(baseHandQuat).slerp(ikHandQuat, ikW);
            }

            const curlSign = isRight ? dirSign : -dirSign;
            const curlBones: Array<[VRMHumanBoneName, number, number]> = isRight
                ? [
                    [VRMHumanBoneName.RightIndexProximal, 0.2, 0.85],
                    [VRMHumanBoneName.RightIndexIntermediate, 0.25, 0.95],
                    [VRMHumanBoneName.RightIndexDistal, 0.15, 0.65],
                    [VRMHumanBoneName.RightMiddleProximal, 0.26, 0.9],
                    [VRMHumanBoneName.RightMiddleIntermediate, 0.3, 1.0],
                    [VRMHumanBoneName.RightMiddleDistal, 0.18, 0.7],
                    [VRMHumanBoneName.RightRingProximal, 0.32, 0.92],
                    [VRMHumanBoneName.RightRingIntermediate, 0.35, 1.0],
                    [VRMHumanBoneName.RightRingDistal, 0.2, 0.7],
                    [VRMHumanBoneName.RightLittleProximal, 0.38, 0.95],
                    [VRMHumanBoneName.RightLittleIntermediate, 0.4, 1.0],
                    [VRMHumanBoneName.RightLittleDistal, 0.22, 0.7],
                ]
                : [
                    [VRMHumanBoneName.LeftIndexProximal, 0.2, 0.85],
                    [VRMHumanBoneName.LeftIndexIntermediate, 0.25, 0.95],
                    [VRMHumanBoneName.LeftIndexDistal, 0.15, 0.65],
                    [VRMHumanBoneName.LeftMiddleProximal, 0.26, 0.9],
                    [VRMHumanBoneName.LeftMiddleIntermediate, 0.3, 1.0],
                    [VRMHumanBoneName.LeftMiddleDistal, 0.18, 0.7],
                    [VRMHumanBoneName.LeftRingProximal, 0.32, 0.92],
                    [VRMHumanBoneName.LeftRingIntermediate, 0.35, 1.0],
                    [VRMHumanBoneName.LeftRingDistal, 0.2, 0.7],
                    [VRMHumanBoneName.LeftLittleProximal, 0.38, 0.95],
                    [VRMHumanBoneName.LeftLittleIntermediate, 0.4, 1.0],
                    [VRMHumanBoneName.LeftLittleDistal, 0.22, 0.7],
                ];

            for (const [boneName, restAngle, gripAngle] of curlBones) {
                const b = vrm.humanoid.getNormalizedBoneNode(boneName);
                if (b) {
                    const angle = THREE.MathUtils.lerp(restAngle, gripAngle, g);
                    tmpFingerEuler.set(0, 0, angle * curlSign);
                    tmpFingerQuat.setFromEuler(tmpFingerEuler);
                    b.quaternion.slerp(tmpFingerQuat, ikW);
                }
            }

            const thumbProx = vrm.humanoid.getNormalizedBoneNode(
                isRight
                    ? VRMHumanBoneName.RightThumbProximal
                    : VRMHumanBoneName.LeftThumbProximal
            );
            const thumbDist = vrm.humanoid.getNormalizedBoneNode(
                isRight
                    ? VRMHumanBoneName.RightThumbDistal
                    : VRMHumanBoneName.LeftThumbDistal
            );
            if (thumbProx) {
                tmpFingerEuler.set(
                    0,
                    (0.24 + g * 0.5) * curlSign,
                    (0.14 + g * 0.45) * curlSign
                );
                tmpFingerQuat.setFromEuler(tmpFingerEuler);
                thumbProx.quaternion.slerp(tmpFingerQuat, ikW);
            }
            if (thumbDist) {
                tmpFingerEuler.set(0, 0, (0.16 + g * 0.5) * curlSign);
                tmpFingerQuat.setFromEuler(tmpFingerEuler);
                thumbDist.quaternion.slerp(tmpFingerQuat, ikW);
            }
        };

        solveArmIk(
            "right",
            rightArmIkBlendRef.current,
            wristTargetWorldRef.current,
            armMetrics.rUpper,
            armMetrics.rLower
        );
        solveArmIk(
            "left",
            leftArmIkBlendRef.current,
            leftWristTargetWorldRef.current,
            armMetrics.lUpper,
            armMetrics.lLower
        );

        vrm.update(dt);
    });

    if (!vrm) return null;

    return (
        <group ref={rootRef}>
            <primitive object={vrm.scene} />
        </group>
    );
}

export function FallbackBlockHand({
    isGrabbing,
    isRaised,
}: {
    isGrabbing: boolean;
    isRaised: boolean;
}) {
    return (
        <group visible={isRaised} rotation={[isGrabbing ? 0.15 : 0, 0, 0]}>
            <mesh castShadow raycast={NO_RAYCAST}>
                <boxGeometry args={[0.095, 0.038, 0.14]} />
                <meshStandardMaterial
                    color="#e2a887"
                    roughness={0.55}
                    metalness={0.05}
                />
            </mesh>
            <mesh
                position={[0, isGrabbing ? -0.02 : -0.005, -0.085]}
                rotation={[isGrabbing ? -0.45 : 0, 0, 0]}
                castShadow
                raycast={NO_RAYCAST}
            >
                <boxGeometry args={[0.085, 0.03, 0.07]} />
                <meshStandardMaterial
                    color="#d89b78"
                    roughness={0.55}
                    metalness={0.05}
                />
            </mesh>
        </group>
    );
}