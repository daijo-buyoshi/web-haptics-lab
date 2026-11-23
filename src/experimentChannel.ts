import type { TrialRecord } from "./types";

export const EXPERIMENT_CHANNEL_NAME = "web-haptics-lab-sync-v1";
export const TRIAL_LOGS_STORAGE_KEY = "web-haptics-lab.trial-logs.v1";

export function loadSavedTrialLogs(): TrialRecord[] {
    try {
        const raw = localStorage.getItem(TRIAL_LOGS_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function saveTrialLogs(logs: TrialRecord[]): void {
    try {
        localStorage.setItem(TRIAL_LOGS_STORAGE_KEY, JSON.stringify(logs));
    } catch {
        // ignore storage quota errors
    }
}

function escapeCsvCell(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

export function buildTrialCsv(logs: TrialRecord[]): string {
    const headers = [
        "試行番号",
        "状態",
        "開始時刻",
        "終了時刻",
        "開始UNIX時刻_ms",
        "終了UNIX時刻_ms",
        "物体名",
        "重さ_kg",
        "擬似触覚",
        "CD比設定値",
        "振動強度設定値",
        "持ち上げ時間_秒",
        "運んだ距離_m",
        "平均速度_m_s",
        "最大速度_m_s",
        "落とした回数",
        "腕の遅れlag平均_m",
        "腕の遅れlag最大_m",
        "主観評価_違和感_1to5",
        "主観評価_重さ実感_1to5",
    ];

    const rows = logs.map((r) =>
        [
            r.trialNumber,
            r.status === "completed" ? "完了" : "未完了",
            r.startTimeIso,
            r.endTimeIso,
            r.startUnixMs,
            r.endUnixMs,
            r.objectName,
            r.massKg.toFixed(2),
            r.illusionEnabled ? "ON" : "OFF",
            r.cdRatioSetting.toFixed(3),
            r.vibrationSetting.toFixed(2),
            r.liftDurationSec.toFixed(3),
            r.carriedDistanceM.toFixed(3),
            r.avgSpeedMs.toFixed(3),
            r.maxSpeedMs.toFixed(3),
            r.dropCount,
            r.avgLagM.toFixed(4),
            r.maxLagM.toFixed(4),
            r.discomfortScore ?? "",
            r.perceivedWeightScore ?? "",
        ]
            .map(escapeCsvCell)
            .join(",")
    );

    // Excelで文字化けしないようUTF-8 BOMを先頭に付与
    return `\uFEFF${headers.join(",")}\n${rows.join("\n")}`;
}

export function downloadTrialCsv(logs: TrialRecord[]): void {
    const csv = buildTrialCsv(logs);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `haptics_experiment_${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}