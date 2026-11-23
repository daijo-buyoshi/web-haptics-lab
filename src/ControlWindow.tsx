import { useEffect, useRef, useState } from "react";
import {
    downloadTrialCsv,
    EXPERIMENT_CHANNEL_NAME,
    loadSavedTrialLogs,
} from "./experimentChannel";
import type {
    ConsoleSyncState,
    ExperimentChannelMessage,
    ExperimentConfig,
} from "./types";

const MONO_FONT =
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

const DISCOMFORT_LABELS = [
    "違和感なし",
    "わずかに感じる",
    "どちらでもない",
    "やや違和感",
    "強い違和感",
];

const WEIGHT_LABELS = [
    "とても軽い",
    "やや軽い",
    "普通",
    "やや重い",
    "ずっしり重い",
];

function createDefaultState(): ConsoleSyncState {
    const savedLogs = loadSavedTrialLogs();
    return {
        config: {
            illusionEnabled: true,
            cdRatioMode: "auto",
            manualCdRatio: 0.45,
            vibrationScale: 1.0,
        },
        activeTrial: {
            trialNumber: savedLogs.length + 1,
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
        },
        pendingTrial: null,
        logs: savedLogs,
        gamepadConnected: false,
        gamepadName: "未接続",
        updatedAt: 0,
    };
}

export function ControlWindow() {
    const [syncState, setSyncState] = useState<ConsoleSyncState>(createDefaultState);
    const [connected, setConnected] = useState(false);
    const [discomfort, setDiscomfort] = useState<number | null>(null);
    const [perceivedWeight, setPerceivedWeight] = useState<number | null>(null);

    const channelRef = useRef<BroadcastChannel | null>(null);
    const lastPendingNumRef = useRef<number | null>(null);

    useEffect(() => {
        document.title = "実験コンソール | Web3D擬似触覚";

        const channel = new BroadcastChannel(EXPERIMENT_CHANNEL_NAME);
        channelRef.current = channel;

        channel.onmessage = (event: MessageEvent<ExperimentChannelMessage>) => {
            const msg = event.data;
            if (msg.type === "STATE_SYNC") {
                setSyncState(msg.payload);
                setConnected(true);

                const nextPendingNum = msg.payload.pendingTrial?.trialNumber ?? null;
                if (nextPendingNum !== lastPendingNumRef.current) {
                    lastPendingNumRef.current = nextPendingNum;
                    setDiscomfort(null);
                    setPerceivedWeight(null);
                }
            }
        };

        channel.postMessage({ type: "REQUEST_SYNC" } satisfies ExperimentChannelMessage);

        const pingTimer = window.setInterval(() => {
            channel.postMessage({ type: "REQUEST_SYNC" } satisfies ExperimentChannelMessage);
        }, 3000);

        return () => {
            window.clearInterval(pingTimer);
            channel.close();
            channelRef.current = null;
        };
    }, []);

    const send = (msg: ExperimentChannelMessage) => {
        channelRef.current?.postMessage(msg);
    };

    const updateConfig = (patch: Partial<ExperimentConfig>) => {
        setSyncState((prev) => ({
            ...prev,
            config: { ...prev.config, ...patch },
        }));
        send({ type: "UPDATE_CONFIG", payload: patch });
    };

    const handleSubmitRating = () => {
        if (!syncState.pendingTrial || discomfort === null || perceivedWeight === null) {
            return;
        }
        send({
            type: "SUBMIT_RATING",
            payload: {
                trialNumber: syncState.pendingTrial.trialNumber,
                discomfortScore: discomfort,
                perceivedWeightScore: perceivedWeight,
            },
        });
        setDiscomfort(null);
        setPerceivedWeight(null);
    };

    const { config, activeTrial, pendingTrial, logs } = syncState;

    const phaseLabelMap: Record<string, string> = {
        idle: "待機中（物体を掴むと自動開始）",
        carrying: activeTrial.inGoalZone
            ? "ゴールエリア内（離すと納品完了）"
            : "運搬中（ゴールマットへ移動中）",
        dropped: "途中落下（拾い直すか「未完了で終了」）",
        awaiting_rating: "評価待ち（下の評価を確定すると次へ進みます）",
    };

    const phaseLabel = phaseLabelMap[activeTrial.phase] || phaseLabelMap.idle;
    const isPhaseActive = activeTrial.phase !== "idle";
    const canSubmit = discomfort !== null && perceivedWeight !== null;
    const canAbort =
        activeTrial.phase === "carrying" || activeTrial.phase === "dropped";

    return (
        <div
            style={{
                height: "100vh",
                overflowY: "auto",
                overflowX: "hidden",
                backgroundColor: "#0f0f0f",
                color: "#e5e5e5",
                fontFamily:
                    'system-ui, -apple-system, "Segoe UI", "Hiragino Kaku Gothic ProN", sans-serif',
                fontSize: 12,
                padding: "16px 16px 36px 16px",
                boxSizing: "border-box",
            }}
        >
            {/* ヘッダー */}
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 14,
                    paddingBottom: 10,
                    borderBottom: "1px solid #2a2a2a",
                }}
            >
                <div style={{ fontSize: 14, fontWeight: 700, color: "#e5e5e5" }}>
                    Web3D 擬似触覚 実験コンソール
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span
                        style={{
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontFamily: MONO_FONT,
                            backgroundColor: "#161616",
                            border: `1px solid ${connected ? "#2a2a2a" : "#ef4444"}`,
                            color: connected ? "#e5e5e5" : "#ef4444",
                        }}
                    >
                        {connected ? "3D画面 接続中" : "待機中..."}
                    </span>
                    <span
                        style={{
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontFamily: MONO_FONT,
                            backgroundColor: "#161616",
                            border: `1px solid ${syncState.gamepadConnected ? "#f59e0b" : "#2a2a2a"}`,
                            color: syncState.gamepadConnected ? "#f59e0b" : "#888888",
                        }}
                    >
                        {syncState.gamepadConnected ? "PAD" : "KB/MOUSE"}
                    </span>
                </div>
            </div>

            {/* 1. 現在の試行ステータス（背景色統一・区切り線のみの行表示） */}
            <div
                style={{
                    backgroundColor: "#161616",
                    border: "1px solid #2a2a2a",
                    borderRadius: 4,
                    padding: 12,
                    marginBottom: 12,
                }}
            >
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        paddingBottom: 8,
                        marginBottom: 4,
                        borderBottom: "1px solid #2a2a2a",
                    }}
                >
                    <span
                        style={{
                            fontSize: 12.5,
                            fontWeight: isPhaseActive ? 700 : 400,
                            color: isPhaseActive ? "#e5e5e5" : "#888888",
                        }}
                    >
                        <span style={{ fontFamily: MONO_FONT, color: "#e5e5e5", fontWeight: 700 }}>
                            試行 #{activeTrial.trialNumber}
                        </span>
                        {" — "}
                        {phaseLabel}
                    </span>
                    {!activeTrial.hasGoalMat && (
                        <span style={{ fontSize: 11, color: "#ef4444" }}>
                            ※ゴールマット未配置
                        </span>
                    )}
                </div>

                <div>
                    <div style={metricRowStyle}>
                        <span style={metricLabelStyle}>対象物体</span>
                        <span style={metricValStyle}>
                            {activeTrial.objectName
                                ? `${activeTrial.objectName} (${activeTrial.massKg.toFixed(1)}kg)`
                                : "—"}
                        </span>
                    </div>
                    <div style={metricRowStyle}>
                        <span style={metricLabelStyle}>時間 / 落下</span>
                        <span style={metricValStyle}>
                            {activeTrial.elapsedSec.toFixed(1)}s ／ {activeTrial.dropCount}回
                        </span>
                    </div>
                    <div style={metricRowStyle}>
                        <span style={metricLabelStyle}>腕の遅れ (lag)</span>
                        <span style={metricValStyle}>
                            {(activeTrial.currentLagM * 100).toFixed(1)} cm
                        </span>
                    </div>
                    <div style={{ ...metricRowStyle, borderBottom: "none", paddingBottom: 0 }}>
                        <span style={metricLabelStyle}>実効C/D / 振動</span>
                        <span style={metricValStyle}>
                            {(activeTrial.currentCdRatio * 100).toFixed(0)}% ／{" "}
                            {(activeTrial.currentVibration * 100).toFixed(0)}%
                        </span>
                    </div>
                </div>
            </div>

            {/* 主観評価フォーム（納品完了時のみ表示） */}
            {pendingTrial && (
                <div
                    style={{
                        backgroundColor: "#161616",
                        border: "1px solid #f59e0b",
                        borderRadius: 4,
                        padding: 14,
                        marginBottom: 12,
                    }}
                >
                    <div
                        style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: "#f59e0b",
                            marginBottom: 4,
                        }}
                    >
                        主観評価（試行 #{pendingTrial.trialNumber}：{pendingTrial.objectName}）
                    </div>
                    <div
                        style={{
                            fontSize: 11.5,
                            fontFamily: MONO_FONT,
                            fontVariantNumeric: "tabular-nums",
                            color: "#888888",
                            paddingBottom: 10,
                            marginBottom: 12,
                            borderBottom: "1px solid #2a2a2a",
                        }}
                    >
                        運搬時間 {pendingTrial.liftDurationSec.toFixed(2)}s ／ 平均lag{" "}
                        {(pendingTrial.avgLagM * 100).toFixed(1)}cm
                    </div>

                    <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12, marginBottom: 6, color: "#e5e5e5" }}>
                            Q1. 操作の違和感（1 = なし 〜 5 = 強い違和感）
                        </div>
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(5, 1fr)",
                                gap: 6,
                            }}
                        >
                            {[1, 2, 3, 4, 5].map((score) => (
                                <button
                                    key={score}
                                    onClick={() => setDiscomfort(score)}
                                    style={ratingBtnStyle(discomfort === score)}
                                >
                                    <div style={{ fontSize: 15, fontWeight: 700, fontFamily: MONO_FONT }}>
                                        {score}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 10,
                                            color: discomfort === score ? "#0f0f0f" : "#888888",
                                            marginTop: 2,
                                        }}
                                    >
                                        {DISCOMFORT_LABELS[score - 1]}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12, marginBottom: 6, color: "#e5e5e5" }}>
                            Q2. 重さの実感（1 = とても軽い 〜 5 = ずっしり重い）
                        </div>
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(5, 1fr)",
                                gap: 6,
                            }}
                        >
                            {[1, 2, 3, 4, 5].map((score) => (
                                <button
                                    key={score}
                                    onClick={() => setPerceivedWeight(score)}
                                    style={ratingBtnStyle(perceivedWeight === score)}
                                >
                                    <div style={{ fontSize: 15, fontWeight: 700, fontFamily: MONO_FONT }}>
                                        {score}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 10,
                                            color: perceivedWeight === score ? "#0f0f0f" : "#888888",
                                            marginTop: 2,
                                        }}
                                    >
                                        {WEIGHT_LABELS[score - 1]}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <button
                        onClick={handleSubmitRating}
                        disabled={!canSubmit}
                        style={{
                            width: "100%",
                            padding: "9px 14px",
                            borderRadius: 4,
                            border: `1px solid ${canSubmit ? "#f59e0b" : "#2a2a2a"}`,
                            backgroundColor: canSubmit ? "#f59e0b" : "#262626",
                            color: canSubmit ? "#0f0f0f" : "#888888",
                            fontWeight: 700,
                            fontSize: 12.5,
                            cursor: canSubmit ? "pointer" : "not-allowed",
                        }}
                    >
                        評価を確定して次へ（物体を元の位置へ戻す）
                    </button>
                </div>
            )}

            {/* 2. 実験条件コントロール */}
            <div
                style={{
                    backgroundColor: "#161616",
                    border: "1px solid #2a2a2a",
                    borderRadius: 4,
                    padding: 12,
                    marginBottom: 12,
                }}
            >
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        paddingBottom: 10,
                        marginBottom: 10,
                        borderBottom: "1px solid #2a2a2a",
                    }}
                >
                    <span style={{ fontSize: 12.5, fontWeight: 700 }}>
                        実験条件コントロール
                    </span>
                    <button
                        onClick={() =>
                            updateConfig({ illusionEnabled: !config.illusionEnabled })
                        }
                        style={{
                            padding: "5px 12px",
                            borderRadius: 4,
                            border: `1px solid ${config.illusionEnabled ? "#f59e0b" : "#2a2a2a"}`,
                            backgroundColor: config.illusionEnabled ? "#f59e0b" : "#262626",
                            color: config.illusionEnabled ? "#0f0f0f" : "#e5e5e5",
                            fontWeight: 700,
                            cursor: "pointer",
                            fontSize: 12,
                        }}
                    >
                        擬似触覚: {config.illusionEnabled ? "ON" : "OFF"}
                    </button>
                </div>

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 10,
                        marginBottom: 12,
                    }}
                >
                    <div style={controlCardStyle}>
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                fontSize: 12,
                                marginBottom: 8,
                            }}
                        >
                            <span style={{ color: "#888888" }}>視覚 C/D 比</span>
                            <span
                                style={{
                                    color: "#f59e0b",
                                    fontWeight: 600,
                                    fontFamily: MONO_FONT,
                                    fontVariantNumeric: "tabular-nums",
                                }}
                            >
                                {config.cdRatioMode === "auto"
                                    ? "質量連動"
                                    : `${(config.manualCdRatio * 100).toFixed(0)} %`}
                            </span>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                            <button
                                onClick={() => updateConfig({ cdRatioMode: "auto" })}
                                style={modeBtnStyle(config.cdRatioMode === "auto")}
                            >
                                自動 (質量連動)
                            </button>
                            <button
                                onClick={() => updateConfig({ cdRatioMode: "manual" })}
                                style={modeBtnStyle(config.cdRatioMode === "manual")}
                            >
                                手動固定
                            </button>
                        </div>
                        {config.cdRatioMode === "manual" ? (
                            <input
                                type="range"
                                min={0.15}
                                max={1.0}
                                step={0.01}
                                value={config.manualCdRatio}
                                onChange={(e) =>
                                    updateConfig({ manualCdRatio: Number(e.target.value) })
                                }
                                style={{ width: "100%" }}
                            />
                        ) : (
                            <div style={{ fontSize: 11, color: "#888888" }}>
                                物体の重さ（kg）に応じて追従率を自動設定します
                            </div>
                        )}
                    </div>

                    <div style={controlCardStyle}>
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                fontSize: 12,
                                marginBottom: 8,
                            }}
                        >
                            <span style={{ color: "#888888" }}>ゲームパッド振動倍率</span>
                            <span
                                style={{
                                    color: "#f59e0b",
                                    fontWeight: 600,
                                    fontFamily: MONO_FONT,
                                    fontVariantNumeric: "tabular-nums",
                                }}
                            >
                                {(config.vibrationScale * 100).toFixed(0)} %
                            </span>
                        </div>
                        <input
                            type="range"
                            min={0}
                            max={2.0}
                            step={0.05}
                            value={config.vibrationScale}
                            onChange={(e) =>
                                updateConfig({ vibrationScale: Number(e.target.value) })
                            }
                            style={{ width: "100%", marginBottom: 8 }}
                        />
                        <div style={{ fontSize: 11, color: "#888888" }}>
                            0% にすると「視覚ズレのみ」条件で検証できます
                        </div>
                    </div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                    <button
                        onClick={() => send({ type: "ABORT_TRIAL" })}
                        disabled={!canAbort}
                        style={{
                            flex: 1,
                            padding: "6px 10px",
                            borderRadius: 4,
                            border: "1px solid #2a2a2a",
                            backgroundColor: "#262626",
                            color: canAbort ? "#e5e5e5" : "#888888",
                            opacity: canAbort ? 1 : 0.45,
                            cursor: canAbort ? "pointer" : "not-allowed",
                            fontSize: 12,
                        }}
                    >
                        進行中の試行を「未完了」で終了
                    </button>
                    <button
                        onClick={() => send({ type: "RESET_DROP" })}
                        style={{
                            padding: "6px 12px",
                            borderRadius: 4,
                            border: "1px solid #2a2a2a",
                            backgroundColor: "#262626",
                            color: "#e5e5e5",
                            cursor: "pointer",
                            fontSize: 12,
                        }}
                    >
                        物体位置リセット
                    </button>
                </div>
            </div>

            {/* 3. 記録済み試行ログ ＆ CSVエクスポート */}
            <div
                style={{
                    backgroundColor: "#161616",
                    border: "1px solid #2a2a2a",
                    borderRadius: 4,
                    padding: 12,
                }}
            >
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        paddingBottom: 10,
                        marginBottom: 8,
                        borderBottom: "1px solid #2a2a2a",
                    }}
                >
                    <span style={{ fontSize: 12.5, fontWeight: 700 }}>
                        記録ログ（全{" "}
                        <span style={{ fontFamily: MONO_FONT }}>{logs.length}</span> 件）
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button
                            onClick={() => downloadTrialCsv(logs)}
                            disabled={logs.length === 0}
                            style={{
                                padding: "5px 12px",
                                borderRadius: 4,
                                border: `1px solid ${logs.length > 0 ? "#f59e0b" : "#2a2a2a"}`,
                                backgroundColor: logs.length > 0 ? "#f59e0b" : "#262626",
                                color: logs.length > 0 ? "#0f0f0f" : "#888888",
                                opacity: logs.length > 0 ? 1 : 0.45,
                                fontWeight: 700,
                                cursor: logs.length > 0 ? "pointer" : "not-allowed",
                                fontSize: 12,
                            }}
                        >
                            CSVダウンロード
                        </button>
                        <button
                            onClick={() => {
                                if (window.confirm("記録済みの試行ログをすべて消去しますか？")) {
                                    send({ type: "CLEAR_LOGS" });
                                }
                            }}
                            disabled={logs.length === 0}
                            style={{
                                padding: "5px 10px",
                                borderRadius: 4,
                                border: "1px solid #2a2a2a",
                                backgroundColor: "#262626",
                                color: logs.length > 0 ? "#e5e5e5" : "#888888",
                                opacity: logs.length > 0 ? 1 : 0.45,
                                cursor: logs.length > 0 ? "pointer" : "not-allowed",
                                fontSize: 12,
                            }}
                        >
                            全消去
                        </button>
                    </div>
                </div>

                <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
                    <table
                        style={{
                            width: "100%",
                            borderCollapse: "collapse",
                            fontSize: 11.5,
                            textAlign: "left",
                        }}
                    >
                        <thead>
                            <tr style={{ borderBottom: "1px solid #2a2a2a", color: "#888888" }}>
                                <th style={thStyle}>#</th>
                                <th style={thStyle}>状態</th>
                                <th style={thStyle}>物体 (kg)</th>
                                <th style={thStyle}>C/D</th>
                                <th style={thStyle}>振動</th>
                                <th style={thStyle}>時間</th>
                                <th style={thStyle}>lag平均</th>
                                <th style={thStyle}>違和感</th>
                                <th style={thStyle}>重さ感</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={9}
                                        style={{
                                            padding: 20,
                                            textAlign: "center",
                                            color: "#888888",
                                        }}
                                    >
                                        まだ記録がありません。3D画面で物体を掴んでゴールマットへ運ぶと自動で記録されます。
                                    </td>
                                </tr>
                            ) : (
                                [...logs].reverse().map((r) => (
                                    <tr
                                        key={r.trialNumber}
                                        style={{ borderBottom: "1px solid #2a2a2a" }}
                                    >
                                        <td style={tdMonoStyle}>{r.trialNumber}</td>
                                        <td
                                            style={{
                                                ...tdStyle,
                                                color: r.status === "completed" ? "#e5e5e5" : "#ef4444",
                                                fontWeight: r.status === "completed" ? 400 : 600,
                                            }}
                                        >
                                            {r.status === "completed" ? "完了" : "未完了"}
                                        </td>
                                        <td style={tdStyle}>
                                            {r.objectName}{" "}
                                            <span style={{ fontFamily: MONO_FONT, color: "#888888" }}>
                                                ({r.massKg.toFixed(1)})
                                            </span>
                                        </td>
                                        <td style={tdMonoStyle}>
                                            {(r.cdRatioSetting * 100).toFixed(0)}%
                                        </td>
                                        <td style={tdMonoStyle}>
                                            {(r.vibrationSetting * 100).toFixed(0)}%
                                        </td>
                                        <td style={tdMonoStyle}>{r.liftDurationSec.toFixed(1)}s</td>
                                        <td style={tdMonoStyle}>{(r.avgLagM * 100).toFixed(1)}cm</td>
                                        <td style={tdMonoStyle}>{r.discomfortScore ?? "-"}</td>
                                        <td style={tdMonoStyle}>{r.perceivedWeightScore ?? "-"}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* 将来拡張メモ */}
            <div
                style={{
                    marginTop: 12,
                    fontSize: 11,
                    color: "#888888",
                    lineHeight: 1.5,
                }}
            >
                ※ 将来拡張：本コンソールの C/D比・振動パラメータおよび UNIX 時刻付き CSV は、配属後の本実験で Muse / OpenBCI 等の生体信号と同期・自動制御するための共通インターフェースとして設計しています。
            </div>
        </div>
    );
}

const metricRowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "6px 0",
    borderBottom: "1px solid #2a2a2a",
    fontSize: 12,
};

const metricLabelStyle: React.CSSProperties = {
    color: "#888888",
};

const metricValStyle: React.CSSProperties = {
    fontFamily: MONO_FONT,
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
    color: "#e5e5e5",
};

const controlCardStyle: React.CSSProperties = {
    backgroundColor: "#0f0f0f",
    border: "1px solid #2a2a2a",
    borderRadius: 4,
    padding: 10,
};

const thStyle: React.CSSProperties = {
    padding: "6px 6px",
    whiteSpace: "nowrap",
    fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
    padding: "6px 6px",
    whiteSpace: "nowrap",
    color: "#e5e5e5",
};

const tdMonoStyle: React.CSSProperties = {
    padding: "6px 6px",
    whiteSpace: "nowrap",
    fontFamily: MONO_FONT,
    fontVariantNumeric: "tabular-nums",
    color: "#e5e5e5",
};

function modeBtnStyle(active: boolean): React.CSSProperties {
    return {
        flex: 1,
        padding: "5px 6px",
        borderRadius: 4,
        border: `1px solid ${active ? "#f59e0b" : "#2a2a2a"}`,
        backgroundColor: "#262626",
        color: active ? "#f59e0b" : "#e5e5e5",
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        fontSize: 11.5,
    };
}

function ratingBtnStyle(active: boolean): React.CSSProperties {
    return {
        padding: "8px 4px",
        borderRadius: 4,
        border: `1px solid ${active ? "#f59e0b" : "#2a2a2a"}`,
        backgroundColor: active ? "#f59e0b" : "#262626",
        color: active ? "#0f0f0f" : "#e5e5e5",
        cursor: "pointer",
        fontSize: 11.5,
    };
}