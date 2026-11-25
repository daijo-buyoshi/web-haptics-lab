import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import AUTO_MODEL_PATHS from "virtual:public-models";
import {
  GOAL_MAT_URL,
  type ActiveTrialSnapshot,
  type BuildDraftConfig,
  type ConsoleSyncState,
  type ExperimentChannelMessage,
  type ExperimentConfig,
  type PlacedProp,
  type PropCatalogItem,
  type TelemetryData,
  type TrialRecord,
} from "./types";
import {
  EXPERIMENT_CHANNEL_NAME,
  loadSavedTrialLogs,
  saveTrialLogs,
} from "./experimentChannel";
import { ControlWindow } from "./ControlWindow";
import { TutorialModal } from "./TutorialModal";
import { Scene } from "./Scene";

const MONO_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

const STORAGE_KEY = "web-haptics-lab.placed-props.v4";
const TUTORIAL_SKIP_KEY = "web-haptics-lab.tutorial-skip.v1";
const AUTO_CONSOLE_KEY = "web-haptics-lab.auto-console.v1";
const LIGHTWEIGHT_MODE_KEY = "web-haptics-lab.lightweight-mode.v1";

const GOAL_MAT_CATALOG_ITEM: PropCatalogItem = {
  id: "special_goal_mat",
  name: "【実験用】ゴールエリア (光るマット)",
  url: GOAL_MAT_URL,
  defaultSize: 0.52,
  defaultMode: "static",
  defaultMassKg: 1.0,
  restitution: 0.1,
};

const PROP_JAPANESE_NAMES: Record<string, string> = {
  prop1: "コンピュータデスク",
  prop2: "ダイニングテーブル",
  prop3: "ノグチ・コーヒーテーブル",
  prop4: "ゲーミングチェア",
  prop5: "ダイニングチェア",
  prop6: "パソコンモニター",
  prop7: "デスクトップPC本体",
  prop8: "キーボード",
  prop9: "パソコンマウス",
  prop10: "キッチン",
  prop11: "冷蔵庫",
  prop12: "ベッド",
  prop13: "モダンソファ",
  prop14: "テレビ",
  prop15: "コーヒーカップ",
  prop16: "ベッドサイドランプ",
  prop17: "ダブルワッパーセット",
  prop18: "モンステラの観葉植物",
  prop19: "プレシジョンベース",
  prop20: "マーシャル・ギターアンプ",
  table: "木製テーブル",
  item1: "硬式野球ボール",
  item2: "小型LPGガスボンベ",
};

function getPropFolderKey(url: string): string | null {
  const m = url.match(/\/models\/(?:props\/)?([^/]+)\//i);
  return m ? m[1].toLowerCase() : null;
}

function normalizePropName(url: string, fallback: string): string {
  if (url === GOAL_MAT_URL) return GOAL_MAT_CATALOG_ITEM.name;
  const key = getPropFolderKey(url);
  if (key && PROP_JAPANESE_NAMES[key]) {
    return PROP_JAPANESE_NAMES[key];
  }
  return fallback;
}

function stripWeightForSubject(label: string): string {
  return label
    .replace(/\s*\(\d+(?:\.\d+)?\s*kg\)\s*$/i, "")
    .replace(/\s*\((?:prop\d+|item\d+|table)\)\s*$/i, "")
    .trim();
}

async function checkPublicFileExists(path: string): Promise<boolean> {
  try {
    const res = await fetch(path, { method: "HEAD" });
    if (!res.ok) return false;
    const contentType = res.headers.get("content-type") || "";
    return !contentType.includes("text/html");
  } catch {
    return false;
  }
}

async function detectFriendlyName(
  url: string,
  folderName: string,
  fileName: string
): Promise<string> {
  const mapped = PROP_JAPANESE_NAMES[folderName.toLowerCase()];
  if (mapped) return mapped;

  const baseFile = fileName.replace(/\.(gltf|glb)$/i, "");
  if (baseFile.toLowerCase() !== "model" && baseFile.toLowerCase() !== "scene") {
    return `${baseFile} (${folderName})`;
  }

  if (url.toLowerCase().endsWith(".gltf")) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        const binUri: string | undefined = json?.buffers?.[0]?.uri;
        if (binUri && !binUri.startsWith("data:")) {
          const cleanBin = binUri.split("/").pop()?.replace(/\.bin$/i, "");
          if (
            cleanBin &&
            cleanBin.toLowerCase() !== "model" &&
            cleanBin.toLowerCase() !== "scene"
          ) {
            return `${cleanBin} (${folderName})`;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return folderName;
}

function buildInitialLayout(items: PropCatalogItem[]): PlacedProp[] {
  const initial: PlacedProp[] = [];

  const table = items.find((i) => i.url.includes("/models/table/"));
  if (table) {
    initial.push({
      uid: "init_table",
      catalogId: table.id,
      name: table.name,
      url: table.url,
      position: [0, 0, 0],
      rotationY: 0,
      targetSize: 1.55,
      mode: "static",
      massKg: 25.0,
      restitution: 0.1,
    });
  }

  initial.push({
    uid: "init_goal_mat",
    catalogId: GOAL_MAT_CATALOG_ITEM.id,
    name: GOAL_MAT_CATALOG_ITEM.name,
    url: GOAL_MAT_URL,
    position: [-0.46, 0.88, -0.14],
    rotationY: 0,
    targetSize: 0.46,
    mode: "static",
    massKg: 1.0,
    restitution: 0.1,
  });

  const ball = items.find((i) => i.url.includes("/models/item1/"));
  if (ball) {
    initial.push({
      uid: "init_item1",
      catalogId: ball.id,
      name: ball.name,
      url: ball.url,
      position: [0.06, 0.89, 0.14],
      rotationY: 0.5,
      targetSize: 0.16,
      mode: "dynamic",
      massKg: 0.15,
      restitution: 0.35,
    });
  }

  const tank = items.find((i) => i.url.includes("/models/item2/"));
  if (tank) {
    initial.push({
      uid: "init_item2",
      catalogId: tank.id,
      name: tank.name,
      url: tank.url,
      position: [0.42, 0.89, 0.08],
      rotationY: -0.4,
      targetSize: 0.46,
      mode: "dynamic",
      massKg: 12.0,
      restitution: 0.1,
    });
  }

  return initial;
}

async function loadDefaultRoomLayout(
  items: PropCatalogItem[]
): Promise<PlacedProp[]> {
  try {
    const res = await fetch("/room-layout.json", { cache: "no-cache" });
    if (res.ok) {
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) {
        const parsed = await res.json();
        if (Array.isArray(parsed) && parsed.length > 0) {
          return (parsed as PlacedProp[]).map((p) => ({
            ...p,
            name: normalizePropName(p.url, p.name),
          }));
        }
      }
    }
  } catch {
    // fallback to built-in layout
  }
  return buildInitialLayout(items);
}

function lockMainCanvas() {
  const canvas = document.querySelector("canvas");
  if (!canvas) return;
  try {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const result = canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
    result?.catch?.(() => { });
  } catch {
    // ignore
  }
}

type BannerInfo = {
  badge: string;
  accent: boolean;
  title: string;
  sub?: string;
};

function Main3DApp() {
  const [hasCustomHdri, setHasCustomHdri] = useState(false);
  const [catalog, setCatalog] = useState<PropCatalogItem[]>([]);
  const [placedProps, setPlacedProps] = useState<PlacedProp[]>([]);
  const [layoutInitialized, setLayoutInitialized] = useState(false);

  const [dontShowTutorial, setDontShowTutorial] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TUTORIAL_SKIP_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [tutorialOpen, setTutorialOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TUTORIAL_SKIP_KEY) !== "1";
    } catch {
      return true;
    }
  });

  const [autoOpenConsole, setAutoOpenConsole] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_CONSOLE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [autoOpenBlockedHint, setAutoOpenBlockedHint] = useState(false);

  const [lightweightMode, setLightweightMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LIGHTWEIGHT_MODE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const [buildMode, setBuildMode] = useState(false);
  const [minimalHud, setMinimalHud] = useState(false);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string>("");
  const [draftMode, setDraftMode] = useState<"static" | "dynamic">("static");
  const [draftMassKg, setDraftMassKg] = useState<number>(4.0);
  const [draftSize, setDraftSize] = useState<number>(1.0);
  const [draftRotationY, setDraftRotationY] = useState<number>(0);
  const [snapGrid, setSnapGrid] = useState<boolean>(false);
  const [movingUid, setMovingUid] = useState<string | null>(null);

  const [experimentConfig, setExperimentConfig] = useState<ExperimentConfig>({
    illusionEnabled: true,
    cdRatioMode: "auto",
    manualCdRatio: 0.45,
    vibrationScale: 1.0,
  });

  const [trialLogs, setTrialLogs] = useState<TrialRecord[]>(loadSavedTrialLogs);
  const [pendingTrial, setPendingTrial] = useState<TrialRecord | null>(null);
  const [deliveredPropUid, setDeliveredPropUid] = useState<string | null>(null);
  const [propRespawnSeeds, setPropRespawnSeeds] = useState<Record<string, number>>({});
  const [abortTrialSignal, setAbortTrialSignal] = useState(0);
  const [dropSeed, setDropSeed] = useState(1);

  const [showBackground] = useState(true);
  const [thirdPerson, setThirdPerson] = useState(false);

  const [telemetry, setTelemetry] = useState<TelemetryData>({
    gamepadConnected: false,
    gamepadName: "未接続 (マウス/キーボード)",
    hoverLabel: null,
    grabbedLabel: null,
    grabbedMassKg: 0,
    currentCdRatio: 1.0,
    vibrationLevel: 0,
    currentLagM: 0,
    hasAvatar: false,
    idleLoaded: false,
    walkLoaded: false,
    hoveredPlacedName: null,
    pointerLocked: false,
    shiftSnapping: false,
    isCrouching: false,
    isTwoHanded: false,
    trialPhase: "idle",
    inGoalZone: false,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const autoOpenTriedRef = useRef(false);
  const latestSnapshotRef = useRef<ActiveTrialSnapshot>({
    trialNumber: 1,
    phase: "idle",
    objectName: null,
    massKg: 0,
    elapsedSec: 0,
    dropCount: 0,
    currentLagM: 0,
    currentCdRatio: 1.0,
    currentVibration: 0,
    carriedDistanceM: 0,
    inGoalZone: false,
    hasGoalMat: true,
  });

  const configRef = useRef(experimentConfig);
  configRef.current = experimentConfig;
  const pendingTrialRef = useRef(pendingTrial);
  pendingTrialRef.current = pendingTrial;
  const trialLogsRef = useRef(trialLogs);
  trialLogsRef.current = trialLogs;
  const telemetryRef = useRef(telemetry);
  telemetryRef.current = telemetry;

  const nextTrialNumber = useMemo(() => {
    const maxLog = trialLogs.reduce((m, r) => Math.max(m, r.trialNumber), 0);
    return maxLog + 1;
  }, [trialLogs]);

  useEffect(() => {
    saveTrialLogs(trialLogs);
  }, [trialLogs]);

  const handleChangeDontShowTutorial = useCallback((val: boolean) => {
    setDontShowTutorial(val);
    try {
      localStorage.setItem(TUTORIAL_SKIP_KEY, val ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

  const handleToggleAutoOpenConsole = useCallback((val: boolean) => {
    setAutoOpenConsole(val);
    setAutoOpenBlockedHint(false);
    try {
      localStorage.setItem(AUTO_CONSOLE_KEY, val ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

  const broadcastSync = useCallback(() => {
    const ch = channelRef.current;
    if (!ch) return;
    const payload: ConsoleSyncState = {
      config: configRef.current,
      activeTrial: latestSnapshotRef.current,
      pendingTrial: pendingTrialRef.current,
      logs: trialLogsRef.current,
      gamepadConnected: telemetryRef.current.gamepadConnected,
      gamepadName: telemetryRef.current.gamepadName,
      updatedAt: Date.now(),
    };
    ch.postMessage({ type: "STATE_SYNC", payload } satisfies ExperimentChannelMessage);
  }, []);

  const openConsolePopup = useCallback(
    (silent: boolean) => {
      const url = `${window.location.origin}${window.location.pathname}?mode=console`;
      const popup = window.open(
        url,
        "web-haptics-console",
        "popup=yes,width=640,height=860"
      );
      if (!popup) {
        if (silent) {
          setAutoOpenBlockedHint(true);
        } else {
          window.alert(
            "ポップアップがブロックされました。ブラウザのアドレスバー右端から『このサイトのポップアップを常に許可』を選んでからもう一度押してね！"
          );
        }
      } else {
        setAutoOpenBlockedHint(false);
        if (!silent) popup.focus();
        window.setTimeout(() => broadcastSync(), 500);
      }
    },
    [broadcastSync]
  );

  useEffect(() => {
    if (autoOpenConsole && !autoOpenTriedRef.current) {
      autoOpenTriedRef.current = true;
      openConsolePopup(true);
    }
  }, [autoOpenConsole, openConsolePopup]);

  useEffect(() => {
    const channel = new BroadcastChannel(EXPERIMENT_CHANNEL_NAME);
    channelRef.current = channel;

    channel.onmessage = (event: MessageEvent<ExperimentChannelMessage>) => {
      const msg = event.data;
      if (msg.type === "REQUEST_SYNC") {
        broadcastSync();
      } else if (msg.type === "UPDATE_CONFIG") {
        setExperimentConfig((prev) => ({ ...prev, ...msg.payload }));
      } else if (msg.type === "SUBMIT_RATING") {
        const currentPending = pendingTrialRef.current;
        if (
          currentPending &&
          currentPending.trialNumber === msg.payload.trialNumber
        ) {
          const completed: TrialRecord = {
            ...currentPending,
            discomfortScore: msg.payload.discomfortScore,
            perceivedWeightScore: msg.payload.perceivedWeightScore,
          };
          setTrialLogs((prev) => [...prev, completed]);
          setPendingTrial(null);

          const uidToRespawn = currentPending.objectUid;
          setDeliveredPropUid(null);
          if (uidToRespawn) {
            setPropRespawnSeeds((prev) => ({
              ...prev,
              [uidToRespawn]: (prev[uidToRespawn] || 0) + 1,
            }));
          }
        }
      } else if (msg.type === "ABORT_TRIAL") {
        setAbortTrialSignal((n) => n + 1);
      } else if (msg.type === "CLEAR_LOGS") {
        setTrialLogs([]);
        setPendingTrial(null);
        setDeliveredPropUid(null);
      } else if (msg.type === "RESET_DROP") {
        setDeliveredPropUid(null);
        setDropSeed((n) => n + 1);
      }
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [broadcastSync]);

  useEffect(() => {
    broadcastSync();
  }, [experimentConfig, pendingTrial, trialLogs, broadcastSync]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (tutorialOpen) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA") return;
      if (tag === "INPUT") {
        const inputType = (e.target as HTMLInputElement).type;
        if (inputType === "text" || inputType === "number") return;
      }
      if (e.code === "KeyH") {
        setMinimalHud((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tutorialOpen]);

  const handleTrialDelivered = useCallback((record: TrialRecord) => {
    setPendingTrial(record);
    if (record.objectUid) {
      setDeliveredPropUid(record.objectUid);
    }
  }, []);

  const handleTrialIncomplete = useCallback((record: TrialRecord) => {
    setTrialLogs((prev) => [...prev, record]);
  }, []);

  const handleActiveTrialSnapshot = useCallback(
    (snapshot: ActiveTrialSnapshot) => {
      latestSnapshotRef.current = snapshot;
      broadcastSync();
    },
    [broadcastSync]
  );

  useEffect(() => {
    if (!layoutInitialized) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(placedProps));
    } catch {
      // ignore
    }
  }, [placedProps, layoutInitialized]);

  const scanAssets = useCallback(async () => {
    const hdriOk = await checkPublicFileExists("/hdri/room.hdr");
    setHasCustomHdri(hdriOk);

    const rawPaths = [...AUTO_MODEL_PATHS].sort();
    const discovered: PropCatalogItem[] = [];

    for (const rawPath of rawPaths) {
      const url = rawPath.replace(/^\/public/, "");
      if (
        url.includes("/models/avatar/") ||
        url.includes("/models/animations/")
      ) {
        continue;
      }

      const segments = url.split("/");
      const fileName = segments[segments.length - 1] || "model.gltf";
      const folderName = segments[segments.length - 2] || "model";
      const name = await detectFriendlyName(url, folderName, fileName);

      let defaultSize = 1.0;
      let defaultMode: "static" | "dynamic" = "static";
      let defaultMassKg = 5.0;
      let restitution = 0.2;

      if (folderName === "table") {
        defaultSize = 1.55;
        defaultMode = "static";
        defaultMassKg = 25.0;
        restitution = 0.1;
      } else if (folderName === "item1") {
        defaultSize = 0.16;
        defaultMode = "dynamic";
        defaultMassKg = 0.15;
        restitution = 0.35;
      } else if (folderName === "item2") {
        defaultSize = 0.46;
        defaultMode = "dynamic";
        defaultMassKg = 12.0;
        restitution = 0.1;
      } else if (folderName.startsWith("item")) {
        defaultSize = 0.36;
        defaultMode = "dynamic";
        defaultMassKg = 3.5;
      }

      discovered.push({
        id: `auto_${url}`,
        name,
        url,
        defaultSize,
        defaultMode,
        defaultMassKg,
        restitution,
      });
    }

    discovered.sort((a, b) => {
      const aProp = a.url.includes("/props/") ? 0 : 1;
      const bProp = b.url.includes("/props/") ? 0 : 1;
      if (aProp !== bProp) return aProp - bProp;
      const aNum = Number(getPropFolderKey(a.url)?.replace(/^prop/i, "") || 999);
      const bNum = Number(getPropFolderKey(b.url)?.replace(/^prop/i, "") || 999);
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) {
        return aNum - bNum;
      }
      return a.name.localeCompare(b.name, "ja");
    });

    const fullCatalog = [GOAL_MAT_CATALOG_ITEM, ...discovered];
    setCatalog(fullCatalog);

    if (fullCatalog.length > 0) {
      const first = fullCatalog[0];
      setSelectedCatalogId(first.id);
      setDraftMode(first.defaultMode);
      setDraftMassKg(first.defaultMassKg);
      setDraftSize(first.defaultSize);
    }

    try {
      const saved =
        localStorage.getItem(STORAGE_KEY) ||
        localStorage.getItem("web-haptics-lab.placed-props.v3");
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const validUrls = new Set(fullCatalog.map((d) => d.url));
          const migrated = parsed
            .map((p: PlacedProp) => {
              if (validUrls.has(p.url)) {
                return { ...p, name: normalizePropName(p.url, p.name) };
              }
              const fixedUrl = p.url.replace(/\/props(\d+)\//, "/prop$1/");
              if (validUrls.has(fixedUrl)) {
                return {
                  ...p,
                  url: fixedUrl,
                  catalogId: `auto_${fixedUrl}`,
                  name: normalizePropName(fixedUrl, p.name),
                };
              }
              return null;
            })
            .filter((p): p is PlacedProp => p !== null);

          setPlacedProps(migrated);
          setLayoutInitialized(true);
          return;
        }
      }
    } catch {
      // ignore
    }

    const defaultLayout = await loadDefaultRoomLayout(fullCatalog);
    setPlacedProps(defaultLayout);
    setLayoutInitialized(true);
  }, []);

  useEffect(() => {
    scanAssets();
  }, [scanAssets]);

  const selectedCatalogItem = useMemo(
    () =>
      catalog.find((c) => c.id === selectedCatalogId) || catalog[0] || null,
    [catalog, selectedCatalogId]
  );

  const handleSelectCatalog = useCallback(
    (id: string) => {
      setMovingUid(null);
      setSelectedCatalogId(id);
      const found = catalog.find((c) => c.id === id);
      if (found) {
        setDraftMode(found.defaultMode);
        setDraftMassKg(found.defaultMassKg);
        setDraftSize(found.defaultSize);
      }
    },
    [catalog]
  );

  const handlePlaceProp = useCallback(
    (pos: [number, number, number]) => {
      if (movingUid) {
        setPlacedProps((prev) =>
          prev.map((p) =>
            p.uid === movingUid
              ? {
                ...p,
                position: pos,
                rotationY: draftRotationY,
                targetSize: draftSize,
                mode: p.url === GOAL_MAT_URL ? "static" : draftMode,
                massKg: draftMassKg,
              }
              : p
          )
        );
        setMovingUid(null);
        return;
      }

      if (!selectedCatalogItem) return;
      const newProp: PlacedProp = {
        uid: `placed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        catalogId: selectedCatalogItem.id,
        name: normalizePropName(selectedCatalogItem.url, selectedCatalogItem.name),
        url: selectedCatalogItem.url,
        position: pos,
        rotationY: draftRotationY,
        targetSize: draftSize,
        mode: selectedCatalogItem.url === GOAL_MAT_URL ? "static" : draftMode,
        massKg: draftMassKg,
        restitution: selectedCatalogItem.restitution,
      };
      setPlacedProps((prev) => [...prev, newProp]);
    },
    [
      movingUid,
      selectedCatalogItem,
      draftRotationY,
      draftSize,
      draftMode,
      draftMassKg,
    ]
  );

  const handlePickUpProp = useCallback(
    (uid: string) => {
      const target = placedProps.find((p) => p.uid === uid);
      if (!target) return;
      setMovingUid(target.uid);
      setSelectedCatalogId(target.catalogId);
      setDraftMode(target.mode);
      setDraftMassKg(target.massKg);
      setDraftSize(target.targetSize);
      setDraftRotationY(target.rotationY);
    },
    [placedProps]
  );

  const handleCancelMove = useCallback(() => {
    setMovingUid(null);
  }, []);

  const handleRemoveProp = useCallback(
    (uid: string) => {
      if (movingUid === uid) setMovingUid(null);
      if (deliveredPropUid === uid) setDeliveredPropUid(null);
      setPlacedProps((prev) => prev.filter((p) => p.uid !== uid));
    },
    [movingUid, deliveredPropUid]
  );

  const handleUndo = useCallback(() => {
    setMovingUid(null);
    setPlacedProps((prev) => prev.slice(0, -1));
  }, []);

  const handleRestoreInitial = useCallback(async () => {
    setMovingUid(null);
    setDeliveredPropUid(null);
    const defaultLayout = await loadDefaultRoomLayout(catalog);
    setPlacedProps(defaultLayout);
  }, [catalog]);

  const handleClearAll = useCallback(() => {
    setMovingUid(null);
    setDeliveredPropUid(null);
    setPlacedProps([]);
  }, []);

  const handleRotateDraft = useCallback((deltaRad: number) => {
    setDraftRotationY((r) => r + deltaRad);
  }, []);

  const handleScaleDraft = useCallback((deltaSize: number) => {
    setDraftSize((s) =>
      Math.round(THREE.MathUtils.clamp(s + deltaSize, 0.08, 8.5) * 100) / 100
    );
  }, []);

  const handleExportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(placedProps, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "room-layout.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [placedProps]);

  const handleImportJson = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          if (Array.isArray(parsed)) {
            setMovingUid(null);
            setDeliveredPropUid(null);
            setPlacedProps(
              (parsed as PlacedProp[]).map((p) => ({
                ...p,
                name: normalizePropName(p.url, p.name),
              }))
            );
          }
        } catch {
          // ignore
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    []
  );

  const toggleIllusion = useCallback(() => {
    setExperimentConfig((prev) => ({
      ...prev,
      illusionEnabled: !prev.illusionEnabled,
    }));
  }, []);

  const toggleThirdPerson = useCallback(() => {
    setThirdPerson((v) => !v);
  }, []);

  const toggleLightweightMode = useCallback(() => {
    setLightweightMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LIGHTWEIGHT_MODE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const toggleBuildMode = useCallback(() => {
    setMovingUid(null);
    setBuildMode((v) => !v);
  }, []);

  const handleToggleBuildButton = useCallback(() => {
    setMovingUid(null);
    setBuildMode((prev) => {
      const next = !prev;
      if (next) {
        if (document.pointerLockElement) {
          document.exitPointerLock();
        }
      } else {
        lockMainCanvas();
      }
      return next;
    });
  }, []);

  const resetDrop = useCallback(() => {
    setDeliveredPropUid(null);
    setDropSeed((n) => n + 1);
  }, []);

  const buildDraft = useMemo<BuildDraftConfig>(
    () => ({
      catalogItem: selectedCatalogItem,
      mode: draftMode,
      massKg: draftMassKg,
      targetSize: draftSize,
      rotationY: draftRotationY,
      snapGrid,
      movingUid,
    }),
    [
      selectedCatalogItem,
      draftMode,
      draftMassKg,
      draftSize,
      draftRotationY,
      snapGrid,
      movingUid,
    ]
  );

  const crosshairClass = buildMode
    ? "crosshair ready"
    : telemetry.grabbedLabel
      ? "crosshair grabbed"
      : telemetry.hoverLabel
        ? "crosshair ready"
        : "crosshair";

  const missionAnnouncement = useMemo<BannerInfo | null>(() => {
    if (buildMode) return null;

    if (pendingTrial) {
      return {
        badge: "納品完了",
        accent: true,
        title: `「${pendingTrial.objectName}」を運び終えました！ 実験コンソールで評価（1〜5）を確定してください`,
        sub: "評価を確定すると、物体が元の位置へ戻ります",
      };
    }

    if (telemetry.trialPhase === "carrying") {
      const itemName = telemetry.grabbedLabel
        ? stripWeightForSubject(telemetry.grabbedLabel)
        : "物体";

      if (telemetry.inGoalZone) {
        return {
          badge: "ゴール内！",
          accent: true,
          title: "そのまま手を離すと納品完了です",
          sub: `運んでいる物：${itemName}`,
        };
      }

      return {
        badge: telemetry.isTwoHanded ? "両手で運搬中" : "運搬中",
        accent: true,
        title: `「${itemName}」を青く光るゴールマットの上まで運んでください`,
        sub: "左クリック / RT を押し続けたまま移動し、マットが緑に光ったら離します",
      };
    }

    if (telemetry.trialPhase === "dropped") {
      return {
        badge: "落下",
        accent: true,
        title: "途中で落ちました — しゃがんで拾い直してください",
        sub: "Space（または LT / LB）でしゃがみながら近づいて掴めます",
      };
    }

    if (telemetry.hoverLabel) {
      const itemName = stripWeightForSubject(telemetry.hoverLabel);
      return {
        badge: "掴めます",
        accent: true,
        title: `「${itemName}」`,
        sub: "左クリック（または RT）を長押しで持ち上げて、青いゴールマットへ運べます",
      };
    }

    return {
      badge: "ミッション",
      accent: false,
      title: "運べる物を掴んで、青く光るゴールマットへ運んでください",
      sub: "対象：机の上の小物 ／ 床の椅子・観葉植物・ベース・アンプ（大きな家具は固定）",
    };
  }, [
    buildMode,
    pendingTrial,
    telemetry.trialPhase,
    telemetry.inGoalZone,
    telemetry.isTwoHanded,
    telemetry.hoverLabel,
    telemetry.grabbedLabel,
  ]);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <div className={crosshairClass} />

      <TutorialModal
        open={tutorialOpen}
        dontShowAgain={dontShowTutorial}
        onChangeDontShowAgain={handleChangeDontShowTutorial}
        onClose={() => setTutorialOpen(false)}
      />

      {!tutorialOpen && missionAnnouncement && (
        <div
          style={{
            position: "fixed",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 25,
            pointerEvents: "none",
            maxWidth: "min(92vw, 700px)",
            backgroundColor: "#161616",
            border: `1px solid ${missionAnnouncement.accent ? "#f59e0b" : "#2a2a2a"}`,
            borderRadius: 4,
            padding: "8px 14px",
            color: "#e5e5e5",
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              flexWrap: "wrap",
              fontSize: 12.5,
              fontWeight: 700,
              lineHeight: 1.4,
            }}
          >
            <span
              style={{
                padding: "2px 7px",
                borderRadius: 4,
                backgroundColor: missionAnnouncement.accent ? "#f59e0b" : "#262626",
                color: missionAnnouncement.accent ? "#0f0f0f" : "#e5e5e5",
                border: `1px solid ${missionAnnouncement.accent ? "#f59e0b" : "#2a2a2a"}`,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {missionAnnouncement.badge}
            </span>
            <span>{missionAnnouncement.title}</span>
          </div>
          {missionAnnouncement.sub && (
            <div
              style={{
                marginTop: 4,
                fontSize: 11.5,
                color: "#888888",
                lineHeight: 1.35,
              }}
            >
              {missionAnnouncement.sub}
            </div>
          )}
        </div>
      )}

      {!tutorialOpen && (!minimalHud || buildMode || !telemetry.pointerLocked) && (
        <div
          style={{
            position: "fixed",
            top: "54%",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 20,
            pointerEvents: "none",
            backgroundColor: "#161616",
            border: `1px solid ${telemetry.pointerLocked ? "#2a2a2a" : "#f59e0b"}`,
            borderRadius: 4,
            padding: "6px 12px",
            color: "#e5e5e5",
            fontSize: 11.5,
            textAlign: "center",
          }}
        >
          {!telemetry.pointerLocked ? (
            <div style={{ color: "#f59e0b", fontWeight: 600 }}>
              {buildMode
                ? "右パネルでモデル選択後、画面をクリックして配置開始 ／ Bキーで実験へ戻る"
                : "画面をクリックでFPS視点操作開始 ／ BキーでDIY配置（カーソル切替）"}
            </div>
          ) : buildMode ? (
            <>
              {movingUid ? (
                <div style={{ color: "#f59e0b" }}>
                  【移動中】左クリック：設置確定 ／ R＋マウス上下・ホイール：サイズ ／ Q・E：回転 ／ B：実験へ戻る
                </div>
              ) : (
                <div>
                  左クリック：設置 ／ R＋マウス上下・ホイール：サイズ (
                  <span style={{ fontFamily: MONO_FONT }}>{draftSize.toFixed(2)}m</span>
                  ) ／ Q・E：回転 ／ B：実験へ戻る
                  {telemetry.shiftSnapping && (
                    <span style={{ color: "#f59e0b", marginLeft: 6 }}>
                      [吸着ON]
                    </span>
                  )}
                </div>
              )}
              {!movingUid && telemetry.hoveredPlacedName && (
                <div style={{ marginTop: 3, color: "#888888" }}>
                  <span style={{ color: "#f59e0b" }}>
                    G / 中クリック：「{telemetry.hoveredPlacedName}」を移動
                  </span>
                  {" ／ "}
                  <span style={{ color: "#e5e5e5" }}>
                    C キー：削除
                  </span>
                </div>
              )}
            </>
          ) : (
            <div style={{ color: "#888888" }}>
              左クリック / RT：掴む ／ Space / LT・LB・L3：しゃがむ ／ B：DIY配置 ／ H：HUD隠す
            </div>
          )}
        </div>
      )}

      {minimalHud ? (
        <div
          style={{
            position: "fixed",
            top: 12,
            left: 12,
            zIndex: 25,
            display: "flex",
            gap: 6,
          }}
        >
          <button
            className="hud-btn"
            onClick={(e) => {
              e.currentTarget.blur();
              setMinimalHud(false);
            }}
          >
            HUD表示 (H)
          </button>
          <button
            className="hud-btn"
            onClick={(e) => {
              e.currentTarget.blur();
              setTutorialOpen(true);
            }}
          >
            ヘルプ
          </button>
          <button
            className="hud-btn primary"
            onClick={(e) => {
              e.currentTarget.blur();
              openConsolePopup(false);
            }}
          >
            実験コンソール
          </button>
        </div>
      ) : (
        <div className="hud">
          <div className="hud-title">
            <span>Web3D 擬似触覚プロトタイプ</span>
            <span
              className={`badge-pad ${telemetry.gamepadConnected ? "" : "off"}`}
            >
              {telemetry.gamepadConnected ? "PAD接続済" : "KB / MOUSE"}
            </span>
          </div>

          <div className="status-row">
            <span>VRM全身アバター</span>
            <span
              className={
                telemetry.hasAvatar && telemetry.idleLoaded && telemetry.walkLoaded
                  ? "tag-ok"
                  : "tag-warn"
              }
            >
              {telemetry.hasAvatar
                ? `Idle:${telemetry.idleLoaded ? "OK" : "NG"} / Walk:${telemetry.walkLoaded ? "OK" : "NG"}${telemetry.isCrouching ? " [しゃがみ]" : ""}${telemetry.isTwoHanded ? " [両手]" : ""}`
                : "未配置 (仮ブロック手)"}
            </span>
          </div>

          <div className="status-row">
            <span>照準 / 掴み対象</span>
            <span
              className={
                telemetry.grabbedLabel
                  ? "tag-heavy"
                  : telemetry.hoverLabel
                    ? "tag-warn"
                    : ""
              }
            >
              {buildMode
                ? "【DIY配置モード中】"
                : telemetry.grabbedLabel
                  ? `掴み中: ${telemetry.grabbedLabel}`
                  : telemetry.hoverLabel
                    ? `掴める: ${telemetry.hoverLabel}`
                    : "なし（近づいて掴む）"}
            </span>
          </div>

          <div className="status-row">
            <span>視覚C/D比 / 腕lag</span>
            <span
              className={telemetry.currentCdRatio < 0.8 ? "tag-warn" : "tag-ok"}
            >
              {(telemetry.currentCdRatio * 100).toFixed(0)}% ／{" "}
              {(telemetry.currentLagM * 100).toFixed(1)}cm
            </span>
          </div>

          <div className="meter-wrap">
            <div className="meter-label">
              <span>Gamepad 2モーター振動出力</span>
              <span>{(telemetry.vibrationLevel * 100).toFixed(0)} %</span>
            </div>
            <div className="meter-bg">
              <div
                className="meter-fill"
                style={{ width: `${Math.round(telemetry.vibrationLevel * 100)}%` }}
              />
            </div>
          </div>

          <div className="controls-box">
            <div>
              【KB】 WASD：移動 ／ 左クリック：掴む ／ Space：しゃがむ ／ B：DIY配置
            </div>
            <div style={{ marginTop: 4 }}>
              【PAD】 スティック：移動・視点 ／ RT・A：掴む ／ LT・LB・L3：しゃがみ
            </div>
          </div>

          <div className="btn-bar">
            <button
              className="hud-btn primary"
              onClick={(e) => {
                e.currentTarget.blur();
                openConsolePopup(false);
              }}
              style={{ flexBasis: "100%" }}
            >
              別ウィンドウで実験コンソールを開く（条件・評価・CSV）
            </button>

            <label
              style={{
                flexBasis: "100%",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11.5,
                color: "#888888",
                cursor: "pointer",
                padding: "2px 0",
              }}
            >
              <input
                type="checkbox"
                checked={autoOpenConsole}
                onChange={(e) => {
                  handleToggleAutoOpenConsole(e.target.checked);
                  e.currentTarget.blur();
                }}
              />
              起動時にコンソールも自動で開く（要ポップアップ許可）
            </label>

            {autoOpenBlockedHint && (
              <div
                style={{
                  flexBasis: "100%",
                  fontSize: 11,
                  color: "#ef4444",
                  lineHeight: 1.4,
                }}
              >
                ※ 自動起動がブラウザにブロックされました。アドレスバー右端でポップアップを常に許可すると次回から自動で2画面開きます。
              </div>
            )}

            <button
              className="hud-btn"
              onClick={(e) => {
                e.currentTarget.blur();
                setTutorialOpen(true);
              }}
            >
              ヘルプ (操作ガイド)
            </button>
            <button
              className={`hud-btn ${buildMode ? "active" : ""}`}
              onClick={(e) => {
                e.currentTarget.blur();
                handleToggleBuildButton();
              }}
            >
              DIY配置: {buildMode ? "ON (B)" : "OFF (B)"}
            </button>
            <button
              className={`hud-btn ${experimentConfig.illusionEnabled ? "active" : ""}`}
              onClick={(e) => {
                e.currentTarget.blur();
                toggleIllusion();
              }}
            >
              擬似触覚: {experimentConfig.illusionEnabled ? "ON" : "OFF"}
            </button>
            <button
              className="hud-btn"
              onClick={(e) => {
                e.currentTarget.blur();
                toggleThirdPerson();
              }}
            >
              視点: {thirdPerson ? "三人称" : "一人称"}
            </button>
            <button
              className={`hud-btn ${lightweightMode ? "active" : ""}`}
              onClick={(e) => {
                e.currentTarget.blur();
                toggleLightweightMode();
              }}
            >
              軽量モード: {lightweightMode ? "ON" : "OFF"}
            </button>
            <button
              className="hud-btn"
              onClick={(e) => {
                e.currentTarget.blur();
                setMinimalHud(true);
              }}
            >
              HUD隠す (H)
            </button>
            <button
              className="hud-btn"
              onClick={(e) => {
                e.currentTarget.blur();
                resetDrop();
              }}
            >
              落下リセット
            </button>
          </div>
        </div>
      )}

      {buildMode && (
        <div
          style={{
            position: "fixed",
            top: 12,
            right: 12,
            width: 300,
            maxHeight: "calc(100vh - 24px)",
            overflowY: "auto",
            zIndex: 30,
            backgroundColor: "#161616",
            border: "1px solid #2a2a2a",
            borderRadius: 4,
            padding: 12,
            color: "#e5e5e5",
            fontSize: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontWeight: 700,
              fontSize: 12.5,
              marginBottom: 10,
              paddingBottom: 8,
              borderBottom: "1px solid #2a2a2a",
            }}
          >
            <span>DIY 家具・物体レイアウト</span>
            <span
              style={{
                fontSize: 11,
                fontFamily: MONO_FONT,
                fontVariantNumeric: "tabular-nums",
                color: "#888888",
              }}
            >
              検出: {catalog.length}種 ／ 配置: {placedProps.length}個
            </span>
          </div>

          {!telemetry.pointerLocked && (
            <button
              className="hud-btn primary"
              style={{ width: "100%", marginBottom: 10 }}
              onClick={(e) => {
                e.currentTarget.blur();
                lockMainCanvas();
              }}
            >
              配置プレビューへ入る（画面クリックでも可）
            </button>
          )}

          {movingUid && (
            <div
              style={{
                backgroundColor: "#0f0f0f",
                border: "1px solid #f59e0b",
                borderRadius: 4,
                padding: "6px 8px",
                marginBottom: 10,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ color: "#f59e0b", fontWeight: 600 }}>
                家具を移動中...
              </span>
              <button
                className="hud-btn"
                style={{ flex: "0 0 auto", padding: "2px 8px", fontSize: 11 }}
                onClick={(e) => {
                  e.currentTarget.blur();
                  handleCancelMove();
                }}
              >
                キャンセル
              </button>
            </div>
          )}

          <div style={{ marginBottom: 10 }}>
            <div style={{ color: "#888888", marginBottom: 4 }}>
              ① 置くモデルを選ぶ（自動検出）
            </div>
            <select
              value={selectedCatalogItem?.id || ""}
              onChange={(e) => {
                handleSelectCatalog(e.target.value);
                e.currentTarget.blur();
              }}
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: 4,
                backgroundColor: "#0f0f0f",
                color: "#e5e5e5",
                border: "1px solid #2a2a2a",
                fontSize: 12,
              }}
            >
              {catalog.map((item) => {
                const key = getPropFolderKey(item.url);
                const label =
                  item.url === GOAL_MAT_URL || !key
                    ? item.name
                    : `${item.name} (${key})`;
                return (
                  <option key={item.id} value={item.id}>
                    {label}
                  </option>
                );
              })}
            </select>
          </div>

          {selectedCatalogItem?.url !== GOAL_MAT_URL && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: "#888888", marginBottom: 4 }}>
                ② 振る舞いタイプ
              </div>
              <div
                style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}
              >
                <button
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setDraftMode("static");
                  }}
                  style={{
                    padding: "6px 4px",
                    borderRadius: 4,
                    border: `1px solid ${draftMode === "static" ? "#f59e0b" : "#2a2a2a"}`,
                    backgroundColor: "#262626",
                    color: draftMode === "static" ? "#f59e0b" : "#e5e5e5",
                    fontWeight: draftMode === "static" ? 600 : 400,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  固定家具 (土台)
                </button>
                <button
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setDraftMode("dynamic");
                  }}
                  style={{
                    padding: "6px 4px",
                    borderRadius: 4,
                    border: `1px solid ${draftMode === "dynamic" ? "#f59e0b" : "#2a2a2a"}`,
                    backgroundColor: "#262626",
                    color: draftMode === "dynamic" ? "#f59e0b" : "#e5e5e5",
                    fontWeight: draftMode === "dynamic" ? 600 : 400,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  掴める物体 (物理)
                </button>
              </div>
            </div>
          )}

          {selectedCatalogItem?.url !== GOAL_MAT_URL && draftMode === "dynamic" && (
            <div style={{ marginBottom: 10 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: "#888888",
                  marginBottom: 4,
                }}
              >
                <span>③ 擬似重量 (5kg以上で両手抱え)</span>
                <span
                  style={{
                    fontFamily: MONO_FONT,
                    fontVariantNumeric: "tabular-nums",
                    color: "#f59e0b",
                    fontWeight: 600,
                  }}
                >
                  {draftMassKg.toFixed(1)} kg
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={25.0}
                step={0.1}
                value={draftMassKg}
                onChange={(e) => setDraftMassKg(Number(e.target.value))}
                onMouseUp={(e) => e.currentTarget.blur()}
                onKeyUp={(e) => e.currentTarget.blur()}
                style={{ width: "100%" }}
              />
            </div>
          )}

          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                color: "#888888",
                marginBottom: 4,
              }}
            >
              <span>④ サイズ（天井上限まで自動制限）</span>
              <span
                style={{
                  fontFamily: MONO_FONT,
                  fontVariantNumeric: "tabular-nums",
                  color: "#e5e5e5",
                }}
              >
                {draftSize.toFixed(2)} m
              </span>
            </div>
            <input
              type="range"
              min={0.08}
              max={8.5}
              step={0.02}
              value={draftSize}
              onChange={(e) => setDraftSize(Number(e.target.value))}
              onMouseUp={(e) => e.currentTarget.blur()}
              onKeyUp={(e) => e.currentTarget.blur()}
              style={{ width: "100%" }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                color: "#888888",
                marginBottom: 6,
              }}
            >
              <span>
                ⑤ 向き (
                <span style={{ fontFamily: MONO_FONT, color: "#e5e5e5" }}>
                  {Math.round(((draftRotationY * 180) / Math.PI) % 360)}°
                </span>
                )
              </span>
              <label style={{ cursor: "pointer", color: "#e5e5e5" }}>
                <input
                  type="checkbox"
                  checked={snapGrid}
                  onChange={(e) => {
                    setSnapGrid(e.target.checked);
                    e.currentTarget.blur();
                  }}
                  style={{ marginRight: 4 }}
                />
                常時グリッド吸着
              </label>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 6,
              }}
            >
              <button
                className="hud-btn"
                onClick={(e) => {
                  e.currentTarget.blur();
                  handleRotateDraft(Math.PI / 4);
                }}
              >
                左45°
              </button>
              <button
                className="hud-btn"
                onClick={(e) => {
                  e.currentTarget.blur();
                  handleRotateDraft(-Math.PI / 4);
                }}
              >
                右45°
              </button>
              <button
                className="hud-btn"
                onClick={(e) => {
                  e.currentTarget.blur();
                  setDraftRotationY(0);
                }}
              >
                0°戻す
              </button>
            </div>
          </div>

          <div
            style={{
              borderTop: "1px solid #2a2a2a",
              paddingTop: 10,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
            }}
          >
            <button
              className="hud-btn"
              onClick={(e) => {
                e.currentTarget.blur();
                handleUndo();
              }}
              disabled={placedProps.length === 0}
            >
              1つ戻す
            </button>
            <button
              className="hud-btn"
              onClick={(e) => {
                e.currentTarget.blur();
                handleRestoreInitial();
              }}
            >
              初期配置に戻す
            </button>
            <button
              className="hud-btn"
              onClick={(e) => {
                e.currentTarget.blur();
                handleClearAll();
              }}
              disabled={placedProps.length === 0}
            >
              すべて削除
            </button>
            <button
              className="hud-btn"
              onClick={(e) => {
                e.currentTarget.blur();
                handleExportJson();
              }}
            >
              JSON保存
            </button>
            <button
              className="hud-btn"
              onClick={(e) => {
                e.currentTarget.blur();
                fileInputRef.current?.click();
              }}
              style={{ gridColumn: "span 2" }}
            >
              JSON読込
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportJson}
              style={{ display: "none" }}
            />
          </div>

          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: "#888888",
              lineHeight: 1.45,
            }}
          >
            ※ R＋マウス上下・ホイールでサイズ変更、Cキーで削除、Gキーで移動、Bキー1つで実験モードへ戻ります。
          </div>
        </div>
      )}

      <Canvas
        shadows={!lightweightMode}
        dpr={lightweightMode ? 0.85 : [1, 1.5]}
        camera={{ position: [0, 1.48, 1.35], fov: 72, near: 0.1 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
        }}
      >
        <color attach="background" args={["#0f0f0f"]} />
        <Scene
          hasCustomHdri={hasCustomHdri}
          placedProps={placedProps}
          buildMode={buildMode}
          buildDraft={buildDraft}
          dropSeed={dropSeed}
          propRespawnSeeds={propRespawnSeeds}
          deliveredPropUid={deliveredPropUid}
          showBackground={showBackground}
          experimentConfig={experimentConfig}
          thirdPerson={thirdPerson}
          lightweightMode={lightweightMode}
          tutorialOpen={tutorialOpen}
          nextTrialNumber={nextTrialNumber}
          awaitingRating={pendingTrial !== null}
          abortTrialSignal={abortTrialSignal}
          onPlaceProp={handlePlaceProp}
          onPickUpProp={handlePickUpProp}
          onRemoveProp={handleRemoveProp}
          onRotateDraft={handleRotateDraft}
          onScaleDraft={handleScaleDraft}
          onToggleIllusion={toggleIllusion}
          onToggleThirdPerson={toggleThirdPerson}
          onToggleBuildMode={toggleBuildMode}
          onResetDrop={resetDrop}
          onTrialDelivered={handleTrialDelivered}
          onTrialIncomplete={handleTrialIncomplete}
          onActiveTrialSnapshot={handleActiveTrialSnapshot}
          onTelemetry={setTelemetry}
        />
      </Canvas>
    </div>
  );
}

export default function App() {
  const isConsoleWindow = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("mode") === "console";
  }, []);

  if (isConsoleWindow) {
    return <ControlWindow />;
  }

  return <Main3DApp />;
}