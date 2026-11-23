import type { RapierRigidBody } from "@react-three/rapier";

export const GOAL_MAT_URL = "__goal_mat__";

export type PropCatalogItem = {
    id: string;
    name: string;
    url: string;
    defaultSize: number;
    defaultMode: "static" | "dynamic";
    defaultMassKg: number;
    restitution: number;
};

export type PlacedProp = {
    uid: string;
    catalogId: string;
    name: string;
    url: string;
    position: [number, number, number];
    rotationY: number;
    targetSize: number;
    mode: "static" | "dynamic";
    massKg: number;
    restitution: number;
};

export type BuildDraftConfig = {
    catalogItem: PropCatalogItem | null;
    mode: "static" | "dynamic";
    massKg: number;
    targetSize: number;
    rotationY: number;
    snapGrid: boolean;
    movingUid: string | null;
};

export type ExperimentConfig = {
    illusionEnabled: boolean;
    cdRatioMode: "auto" | "manual";
    manualCdRatio: number;
    vibrationScale: number;
};

export type TrialPhase = "idle" | "carrying" | "dropped" | "awaiting_rating";

export type TrialRecord = {
    trialNumber: number;
    status: "completed" | "incomplete";
    objectUid?: string;
    startTimeIso: string;
    endTimeIso: string;
    startUnixMs: number;
    endUnixMs: number;
    objectName: string;
    massKg: number;
    illusionEnabled: boolean;
    cdRatioSetting: number;
    vibrationSetting: number;
    liftDurationSec: number;
    carriedDistanceM: number;
    avgSpeedMs: number;
    maxSpeedMs: number;
    dropCount: number;
    avgLagM: number;
    maxLagM: number;
    discomfortScore: number | null;
    perceivedWeightScore: number | null;
};

export type ActiveTrialSnapshot = {
    trialNumber: number;
    phase: TrialPhase;
    objectName: string | null;
    massKg: number;
    elapsedSec: number;
    dropCount: number;
    currentLagM: number;
    currentCdRatio: number;
    currentVibration: number;
    carriedDistanceM: number;
    inGoalZone: boolean;
    hasGoalMat: boolean;
};

export type ConsoleSyncState = {
    config: ExperimentConfig;
    activeTrial: ActiveTrialSnapshot;
    pendingTrial: TrialRecord | null;
    logs: TrialRecord[];
    gamepadConnected: boolean;
    gamepadName: string;
    updatedAt: number;
};

export type ExperimentChannelMessage =
    | { type: "REQUEST_SYNC" }
    | { type: "STATE_SYNC"; payload: ConsoleSyncState }
    | { type: "UPDATE_CONFIG"; payload: Partial<ExperimentConfig> }
    | {
        type: "SUBMIT_RATING";
        payload: {
            trialNumber: number;
            discomfortScore: number;
            perceivedWeightScore: number;
        };
    }
    | { type: "ABORT_TRIAL" }
    | { type: "CLEAR_LOGS" }
    | { type: "RESET_DROP" };

export type TelemetryData = {
    gamepadConnected: boolean;
    gamepadName: string;
    hoverLabel: string | null;
    grabbedLabel: string | null;
    grabbedMassKg: number;
    currentCdRatio: number;
    vibrationLevel: number;
    currentLagM: number;
    hasAvatar: boolean;
    idleLoaded: boolean;
    walkLoaded: boolean;
    hoveredPlacedName: string | null;
    pointerLocked: boolean;
    shiftSnapping: boolean;
    isCrouching: boolean;
    isTwoHanded: boolean;
    trialPhase: TrialPhase;
    inGoalZone: boolean;
};

export type BodyDict = Record<string, RapierRigidBody | null>;

export type ObstacleBox = {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
};

export type DualRumblePad = Gamepad & {
    vibrationActuator?: {
        playEffect: (
            type: string,
            params: {
                duration: number;
                strongMagnitude: number;
                weakMagnitude: number;
            }
        ) => Promise<void>;
    };
};