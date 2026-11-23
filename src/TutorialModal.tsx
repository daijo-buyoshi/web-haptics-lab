import { useEffect, useState } from "react";

const MONO_FONT =
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

type SlideItem = {
    title: string;
    badge: string;
    description: string[];
    tips: string;
    videoPath: string;
    imagePath: string;
    mediaNote: string;
};

const TUTORIAL_SLIDES: SlideItem[] = [
    {
        badge: "STEP 1 / 4",
        title: "ようこそ！ Web3D 擬似触覚ラボへ",
        description: [
            "この実験空間では、画面上の手の動きの遅れ（視覚ズレ）とコントローラーの振動を使って、モノの『重さ』や『手応え』をどこまで自然に再現できるか体験・検証できます。",
            "机の上の小物や、床に置かれた椅子・観葉植物・ベース・ギターアンプなどを手に取って、青く光るゴールマットまで運んでみましょう！",
        ],
        tips: "デスク・キッチン・冷蔵庫・ベッド・ソファ・テレビ等の大きな家具は固定されています。",
        videoPath: "/media/tutorial/slide1.mp4",
        imagePath: "/images/tutorial/slide1.png",
        mediaNote:
            "public/media/tutorial/slide1.mp4（動画）または public/images/tutorial/slide1.png（画像）を置くと自動表示",
    },
    {
        badge: "STEP 2 / 4",
        title: "基本の移動・しゃがみ・掴み方",
        description: [
            "【キーボード / マウス】 画面左クリックで視点ロック → WASD で移動、左クリック長押しで掴む、Space 長押しでしゃがむ、Tab / Esc でカーソル復帰。",
            "【ゲームパッド】 左スティック移動・右スティック視点、RT（または A）長押しで掴む、LT / LB 長押し（または L3 押し込み）でしゃがむ。",
        ],
        tips: "運べる物に近づくと画面上部に『掴めます』と物体の名前が出るので、そのまま長押しで持ち上げられます。",
        videoPath: "/media/tutorial/slide2.mp4",
        imagePath: "/images/tutorial/slide2.png",
        mediaNote:
            "public/media/tutorial/slide2.mp4（動画）または public/images/tutorial/slide2.png（画像）を置くと自動表示",
    },
    {
        badge: "STEP 3 / 4",
        title: "ミッション：ゴールマットへ運んで評価しよう",
        description: [
            "1. 机の上の小物（カップ・ハンバーガー・PC周辺機器など）や、床の椅子・観葉植物・ベース・アンプに近づき、長押しで持ち上げます（5kg以上は自動で両手抱えになります）。",
            "2. 青く光る『ゴールマット』の上まで運び、緑色に光ったら手を離して置きます。",
            "3. 納品が完了したら、別ウィンドウの実験コンソールで『違和感』と『重さの実感』を 1〜5 で評価してください。",
        ],
        tips: "評価を確定すると物体が元の位置へ戻るので、そのまま次の試行へ進めます。",
        videoPath: "/media/tutorial/slide3.mp4",
        imagePath: "/images/tutorial/slide3.png",
        mediaNote:
            "public/media/tutorial/slide3.mp4（動画）または public/images/tutorial/slide3.png（画像）を置くと自動表示",
    },
    {
        badge: "STEP 4 / 4",
        title: "部屋のDIY配置 ＆ 2画面モード",
        description: [
            "・B キーを押すと『DIY配置モード』と『実験モード』を一発で切り替えられます。家具やゴールマットの位置・サイズ・擬似重量も自由に調整できます。",
            "・モニターが2枚ある場合は、実験コンソールをサブモニターへ移動し、メイン画面で H キーを押して HUD を隠すとスッキリ体験できます。",
        ],
        tips: "操作に迷ったら、画面左上の『ヘルプ』ボタンからいつでもこのガイドを開き直せます。",
        videoPath: "/media/tutorial/slide4.mp4",
        imagePath: "/images/tutorial/slide4.png",
        mediaNote:
            "public/media/tutorial/slide4.mp4（動画）または public/images/tutorial/slide4.png（画像）を置くと自動表示",
    },
];

type TutorialModalProps = {
    open: boolean;
    dontShowAgain: boolean;
    onChangeDontShowAgain: (value: boolean) => void;
    onClose: () => void;
};

export function TutorialModal({
    open,
    dontShowAgain,
    onChangeDontShowAgain,
    onClose,
}: TutorialModalProps) {
    const [page, setPage] = useState(0);
    const [videoReady, setVideoReady] = useState<Record<number, boolean>>({});
    const [videoFailed, setVideoFailed] = useState<Record<number, boolean>>({});
    const [imageReady, setImageReady] = useState<Record<number, boolean>>({});
    const [imageFailed, setImageFailed] = useState<Record<number, boolean>>({});

    useEffect(() => {
        if (open) {
            setPage(0);
        }
    }, [open]);

    if (!open) return null;

    const slide = TUTORIAL_SLIDES[page];
    const isFirst = page === 0;
    const isLast = page === TUTORIAL_SLIDES.length - 1;

    const tryVideo = !videoFailed[page];
    const tryImage = !!videoFailed[page] && !imageFailed[page];
    const hasVisibleMedia =
        (tryVideo && !!videoReady[page]) || (tryImage && !!imageReady[page]);

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 100,
                backgroundColor: "rgba(15, 15, 15, 0.92)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
            }}
        >
            <div
                style={{
                    width: "calc(100vw - 32px)",
                    height: "calc(100vh - 32px)",
                    maxWidth: 1440,
                    backgroundColor: "#161616",
                    border: "1px solid #2a2a2a",
                    borderRadius: 4,
                    padding: "18px 24px",
                    color: "#e5e5e5",
                    display: "flex",
                    flexDirection: "column",
                    overflowY: "auto",
                }}
            >
                {/* ヘッダー */}
                <div
                    style={{
                        flexShrink: 0,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 14,
                        paddingBottom: 12,
                        marginBottom: 14,
                        borderBottom: "1px solid #2a2a2a",
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                        <span
                            style={{
                                fontSize: 13,
                                fontWeight: 600,
                                fontFamily: MONO_FONT,
                                color: "#f59e0b",
                                backgroundColor: "#0f0f0f",
                                border: "1px solid #2a2a2a",
                                padding: "4px 10px",
                                borderRadius: 4,
                                whiteSpace: "nowrap",
                            }}
                        >
                            {slide.badge}
                        </span>
                        <h2
                            style={{
                                margin: 0,
                                fontSize: 19,
                                fontWeight: 700,
                                lineHeight: 1.35,
                                color: "#e5e5e5",
                            }}
                        >
                            {slide.title}
                        </h2>
                    </div>

                    <button
                        onClick={onClose}
                        style={{
                            backgroundColor: "#262626",
                            border: "1px solid #2a2a2a",
                            color: "#e5e5e5",
                            borderRadius: 4,
                            padding: "6px 14px",
                            cursor: "pointer",
                            fontSize: 13,
                            whiteSpace: "nowrap",
                        }}
                    >
                        閉じる
                    </button>
                </div>

                {/* 動画・画像エリア（画面中央の残り高さを最大限に使って大きく表示） */}
                {(tryVideo || tryImage) && (
                    <div
                        style={
                            hasVisibleMedia
                                ? {
                                    flex: "1 1 0",
                                    minHeight: 260,
                                    width: "100%",
                                    borderRadius: 4,
                                    border: "1px solid #2a2a2a",
                                    backgroundColor: "#0f0f0f",
                                    marginBottom: 16,
                                    overflow: "hidden",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                }
                                : {
                                    width: 0,
                                    height: 0,
                                    overflow: "hidden",
                                    position: "absolute",
                                    pointerEvents: "none",
                                }
                        }
                    >
                        {tryVideo && (
                            <video
                                key={slide.videoPath}
                                src={slide.videoPath}
                                autoPlay
                                loop
                                muted
                                playsInline
                                onLoadedData={() =>
                                    setVideoReady((prev) => ({ ...prev, [page]: true }))
                                }
                                onError={() =>
                                    setVideoFailed((prev) => ({ ...prev, [page]: true }))
                                }
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "contain",
                                    display: "block",
                                }}
                            />
                        )}
                        {tryImage && (
                            <img
                                key={slide.imagePath}
                                src={slide.imagePath}
                                alt={slide.title}
                                onLoad={() =>
                                    setImageReady((prev) => ({ ...prev, [page]: true }))
                                }
                                onError={() =>
                                    setImageFailed((prev) => ({ ...prev, [page]: true }))
                                }
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "contain",
                                    display: "block",
                                }}
                            />
                        )}
                    </div>
                )}

                {/* 下側：説明テキスト・ポイント */}
                <div
                    style={{
                        flexShrink: 0,
                        backgroundColor: "#0f0f0f",
                        border: "1px solid #2a2a2a",
                        borderRadius: 4,
                        padding: "14px 18px",
                        marginBottom: 14,
                    }}
                >
                    <div style={{ marginBottom: 10 }}>
                        {slide.description.map((line, i) => (
                            <p
                                key={i}
                                style={{
                                    margin: i === slide.description.length - 1 ? 0 : "0 0 8px 0",
                                    fontSize: 14.5,
                                    lineHeight: 1.7,
                                    color: "#e5e5e5",
                                }}
                            >
                                {line}
                            </p>
                        ))}
                    </div>

                    <div
                        style={{
                            borderTop: "1px solid #2a2a2a",
                            paddingTop: 10,
                            fontSize: 13.5,
                            lineHeight: 1.6,
                            color: "#888888",
                        }}
                    >
                        ポイント：{slide.tips}
                    </div>
                </div>

                {/* フッター */}
                <div
                    style={{
                        flexShrink: 0,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 14,
                        flexWrap: "wrap",
                    }}
                >
                    <label
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 13.5,
                            color: "#888888",
                            cursor: "pointer",
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={dontShowAgain}
                            onChange={(e) => onChangeDontShowAgain(e.target.checked)}
                        />
                        次回から自動で開かない
                    </label>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {TUTORIAL_SLIDES.map((_, idx) => (
                            <button
                                key={idx}
                                onClick={() => setPage(idx)}
                                aria-label={`ページ ${idx + 1}`}
                                style={{
                                    width: idx === page ? 32 : 12,
                                    height: 8,
                                    borderRadius: 4,
                                    border: "none",
                                    padding: 0,
                                    backgroundColor: idx === page ? "#f59e0b" : "#2a2a2a",
                                    cursor: "pointer",
                                }}
                            />
                        ))}
                    </div>

                    <div style={{ display: "flex", gap: 10 }}>
                        <button
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                            disabled={isFirst}
                            style={{
                                padding: "8px 18px",
                                borderRadius: 4,
                                border: "1px solid #2a2a2a",
                                backgroundColor: "#262626",
                                color: isFirst ? "#888888" : "#e5e5e5",
                                opacity: isFirst ? 0.45 : 1,
                                cursor: isFirst ? "not-allowed" : "pointer",
                                fontSize: 13.5,
                            }}
                        >
                            前へ
                        </button>
                        {isLast ? (
                            <button
                                onClick={onClose}
                                style={{
                                    padding: "8px 22px",
                                    borderRadius: 4,
                                    border: "1px solid #f59e0b",
                                    backgroundColor: "#f59e0b",
                                    color: "#0f0f0f",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                    fontSize: 13.5,
                                }}
                            >
                                実験をはじめる
                            </button>
                        ) : (
                            <button
                                onClick={() =>
                                    setPage((p) => Math.min(TUTORIAL_SLIDES.length - 1, p + 1))
                                }
                                style={{
                                    padding: "8px 22px",
                                    borderRadius: 4,
                                    border: "1px solid #f59e0b",
                                    backgroundColor: "#f59e0b",
                                    color: "#0f0f0f",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                    fontSize: 13.5,
                                }}
                            >
                                次へ
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}