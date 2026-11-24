# Web3D Pseudo-Haptics Lab

## 背景と目的

私の夢は、仮想世界を五感でリアルに再現することです。その第一歩として、脳が感覚をどう作るかを、最も手が届く感覚である「重さ」で確かめたいと考えています。

脳は視覚と手の感覚を統合して重さを作ります。この仕組みを利用すれば、画面の手の動きを遅らせる視覚ズレ（擬似触覚）とゲームパッドの振動だけで、専用の力覚装置がなくても「重い」という手応えを作ることができます。ただ、決め打ちの設定では個人差や慣れで違和感が生じ、錯覚が破綻してしまいます。そこで、生体信号で脳の違和感のサインを読み取り、ズレや振動を自動で調整する閉ループ制御を目指しています。

このプロトタイプは、その検証のための実験基盤です。身近なデバイスとWeb技術だけで、実験条件の統制・主観評価の記録・UNIXタイムスタンプ付き操作ログのCSV出力までを一貫して行えます。

---

## Demo

[▶ デモ動画を再生する（docs/demo.mp4）](docs/demo.mp4)

※ リンクを開いた先で再生、または「View raw」からそのままブラウザ再生できます。

### Screenshots

| 3D 実験空間（一人称） | 別ウィンドウ実験コンソール（条件統制・主観評価・CSV出力） |
| :---: | :---: |
| ![3D Environment](docs/screenshot_3d.png) | ![Experiment Console](docs/screenshot_console.png) |

---

## 主な機能

### 1. 擬似触覚（視覚 C/D 比）× 振動ハイブリッド提示
- 掴んだ物体の設定質量（kg）に応じて視覚上の手の追従速度・持ち上げ上限・移動速度を減衰させ、擬似的な重さ・抵抗感を提示します。
- 5kg 以上の重量物は自動的に両手抱えモーションへ切り替わり、手元の微細震え（トレモア）も重畳されます。
- Gamepad API の 2 モーター振動（dual-rumble）を質量と持ち上げ動作に連動して出力します。

### 2. 2画面分離構成の実験コンソール（BroadcastChannel 同期）
- メインの 3D 実験画面と別ウィンドウの実験コンソールをリアルタイム同期できます（マルチモニター運用対応）。
- 擬似触覚の ON / OFF、C/D 比のモード切替（質量連動 / 手動固定 15%〜100%）、振動倍率を実験者側から即座に統制できます。

### 3. 行動ログ計測 ＆ 主観評価の同期 CSV 出力
- 物体を掴んでゴールエリアへ納品するまでを 1 試行として計測し、開始/終了時刻（ISO / UNIX ms）、運搬時間、移動距離、平均/最大速度、落下回数、平均/最大ラグ（手と実入力の乖離量）を自動記録します。
- 納品直後にコンソール側で 5 段階の主観評価（違和感・重さの実感）を入力でき、客観ログと紐づけて UTF-8 CSV としてダウンロードできます。
- 記録される UNIX タイムスタンプは、外部の生体計測データ（EEG / HRV 等）との事後同期を想定しています。

### 4. DIY 家具・実験タスク配置モード
- B キーひとつで実験モードと DIY 配置モードを切り替えられ、家具・掴める物体・ゴールエリアの位置、向き、サイズ、擬似重量を自由に編集できます。
- レイアウトは JSON 形式で保存・読込できます。

---

## 操作方法

| 操作 | キーボード / マウス | ゲームパッド |
| :--- | :--- | :--- |
| 視点操作 | 画面クリックでロック → マウス移動 | 右スティック |
| 移動 | W / A / S / D（または矢印キー） | 左スティック |
| 物体を掴む・運ぶ | 左クリック長押し（または E） | RT（または A）長押し |
| しゃがむ | Space 長押し | LT / LB 長押し（または L3 切替） |
| 手の高さ調整 | マウスホイール（または R / F） | 十字キー 上 / 下 |
| 視点切替（一人称 / 三人称） | V | B |
| 擬似触覚 ON / OFF | T | Y |
| DIY 配置モード切替 | B | - |
| HUD 表示切替 | H | - |
| 落下リセット | X | X |
| カーソル復帰 | Tab / Esc | - |

---

## セットアップ ＆ 起動手順

### 動作環境
- Node.js 18 以上推奨
- モダンブラウザ（Chrome / Edge 推奨、Gamepad API 振動対応）

### ローカル起動

```bash
npm install
npm run dev
```

起動後、ブラウザで `http://localhost:5173/` を開きます。
実験コンソールは画面左上のボタン（または `http://localhost:5173/?mode=console`）から別ウィンドウで開けます。

---

## 技術スタック

- Frontend: React / TypeScript / Vite
- 3D Rendering: Three.js / React Three Fiber / drei / postprocessing
- Physics: Rapier (`@react-three/rapier`)
- Avatar: VRM (`@pixiv/three-vrm`)
- Device & Sync: Gamepad API / BroadcastChannel API

---

## 今後の課題・展望

このプロトタイプは、夢への第一歩として作った実験基盤です。目指すのは、五感や仮想世界をリアルに再現すること。まずは最も手が届く感覚である「重さ」から、脳が感覚をどう作るかを確かめています。

- B4：前頭部脳波（Muse）・心拍変動のリアルタイム取得と、操作ログを組み合わせた違和感検出。3条件（固定・操作ログのみ適応・生体信号統合）の比較で、閉ループ適応制御の有効性を定量検証します。
- M1以降：3D仮想身体（WebXR）やマイコン制御の自作簡易ハプティクス、生成AI連動へ出力を広げ、入力もOpenBCI等の多チャンネル計測へ拡張します。同じ考え方を他の感覚へ広げ、五感再現の目標へ繋げます。

---

## 3D Assets & Credits

本プロジェクトの空間構成には、Sketchfab にて公開されている以下の CC BY 4.0 ライセンスの 3D モデルを使用しています。
| # | Model Title | Author | License |
| :---: | :--- | :--- | :--- |
| 1 | [Computer Desk](https://sketchfab.com/3d-models/computer-desk-98c5bd86d7bb4ca98dbc26dabb5e7196) | [draakon_4d](https://sketchfab.com/draakon_4d) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 2 | [Dining Table](https://sketchfab.com/3d-models/dining-table-ed7d3482ccd24712bb11f4aa779c4354) | [rizky alamsyah](https://sketchfab.com/rizki29) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 3 | [Noguchi Coffee Table](https://sketchfab.com/3d-models/noguchi-coffee-table-8f8a3dbd45534152b5771c36cc4742d9) | [3D Mädchen](https://sketchfab.com/3dmaedchen) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 4 | [Gaming chair](https://sketchfab.com/3d-models/gaming-chair-601afdea98f14c488ee0be0ffb4b92dd) | [snjvsngh_negi](https://sketchfab.com/snjvsngh_negi) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 5 | [Dining Chair](https://sketchfab.com/3d-models/dining-chair-3503f197fe8f4e2cb64d10bf44134930) | [Heliona](https://sketchfab.com/Heliona) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 6 | [Monitor \| Computer \| Realistic Computer Monitor](https://sketchfab.com/3d-models/monitor-computer-realistic-computer-monitor-384ff6cf0bb947af9690529008f843a4) | [Model Wala](https://sketchfab.com/modelwala) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 7 | [Dell XPS Desktop (low-poly)](https://sketchfab.com/3d-models/dell-xps-desktop-low-poly-ff8542776c18472198c5955f74ea73e4) | [LagzDesign](https://sketchfab.com/LagzDesign) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 8 | [Keyboard](https://sketchfab.com/3d-models/keyboard-cc7e7ed38d9a469ea499893295bc767a) | [thethieme](https://sketchfab.com/thethieme) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 9 | [Computer Mouse (low-poly)](https://sketchfab.com/3d-models/computer-mouse-low-poly-95eb7d0363bb4db79bd50168280ea1c7) | [LagzDesign](https://sketchfab.com/LagzDesign) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 10 | [Kitchen](https://sketchfab.com/3d-models/kitchen-83492c3bf9b5496aa16306098b188a41) | [AEN](https://sketchfab.com/aenikl) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 11 | [Refrigerator - Grey Polished Metal](https://sketchfab.com/3d-models/refrigerator-grey-polished-metal-2071bda681b642218b6829b82e4fd93b) | [Glowbox 3D](https://sketchfab.com/ra3id) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 12 | [Bed Agape](https://sketchfab.com/3d-models/bed-agape-96ed3f6ba55848809dfa8cd505edddae) | [Render - City](https://sketchfab.com/greshnovk) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 13 | [Modern Sofa](https://sketchfab.com/3d-models/modern-sofa-ac92f6e97eaa43c4ad6cb8f7c65ac43f) | [3dimentionalben](https://sketchfab.com/3dimentionalben) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 14 | [TV](https://sketchfab.com/3d-models/tv-1b7eff20a86b4cc692bc4222ac1ac252) | [CN Entertainment](https://sketchfab.com/cn-entertainment) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 15 | [Coffee Cup](https://sketchfab.com/3d-models/coffee-cup-992750b0df674378989fa915b0688ce1) | [AK STUDIO](https://sketchfab.com/inven2000) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 16 | [Bedside Lamp - Low Poly](https://sketchfab.com/3d-models/bedside-lamp-low-poly-1b50065ebc474978862e09868b002495) | [lucaboechat](https://sketchfab.com/lucaboechat) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 17 | [Double Whopper Hamburger Value Meal](https://sketchfab.com/3d-models/double-whopper-hamburger-value-meal-47196b81811f40239607dbd9932493f8) | [ஜCIHIRISஜ](https://sketchfab.com/crazy4creativity) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 18 | [Monstera Deliciosa Potted Mid-Century plant](https://sketchfab.com/3d-models/monstera-deliciosa-potted-mid-century-plant-1ab9bf841df04c07b1819be596327629) | [Giora](https://sketchfab.com/ChubbyPanda) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 19 | [Fender Precision bass 1953](https://sketchfab.com/3d-models/fender-precision-bass-1953-79294354b1f5484cb8881feba4684af1) | [stefann22](https://sketchfab.com/stefann22) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| 20 | [Marshall Guitar Amp](https://sketchfab.com/3d-models/marshall-guitar-amp-cd52e1b5299a40968f44c209899b4597) | [D3](https://sketchfab.com/dentro) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |

- その他の空間テクスチャ・HDRI・一部テスト用オブジェクトには CC0 ライセンス素材（Poly Haven 等）を使用しています。