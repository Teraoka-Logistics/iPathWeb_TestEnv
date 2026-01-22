// ========================================================================================
// LayoutRenderer.js
// 静的要素（非選択要素）の高速レンダリングおよび背景描画
// ========================================================================================
window.layoutRenderer = {
    canvas: null,
    ctx: null,

    // [追加] ミニマップ用変数
    minimapCanvas: null,
    minimapCtx: null,

    // [追加] 経路可視化データ
    flowPath: null, // { points: [{x,y}, ...], color: "#00FF00" }

    data: null,
    hiddenIds: {},
    viewBox: { x: 0, y: 0, w: 1000, h: 1000 },
    layoutSize: { w: 0, h: 0 },

    // [追加1] 不良要素IDリスト格納
    invalidIds: { shelf: [], obstacle: [], column: [] },

    // [追加] グリッド設定値格納
    gridConfig: { enabled: true, size: 1000 },

    init: function (canvasElement, layoutWidth, layoutHeight) {
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d', { alpha: false });

        // [修正] 受け取ったマップサイズを格納します
        this.layoutSize = { w: layoutWidth, h: layoutHeight };

        // ★ [重要修正] 初期 viewBox をマップ全体のサイズに設定すると表示が正しくなります
        this.viewBox = { x: 0, y: 0, w: layoutWidth, h: layoutHeight };

        this.resize();
        window.addEventListener('resize', () => this.resize());
    },

    // [追加] C# から経路データを受け取る関数
    updateFlowPath: function (jsonPathData) {
        if (!jsonPathData) {
            this.flowPath = null;
        } else {
            this.flowPath = JSON.parse(jsonPathData);
        }
        this.render(); // 再描画します
    },

    // [追加] C# からグリッド設定を受け取る関数
    updateGridConfig: function (enabled, size) {
        this.gridConfig = { enabled, size };
        this.render();
    },

    // [追加] ミニマップ初期化関数
    initMinimap: function (canvasElement) {
        this.minimapCanvas = canvasElement;
        this.minimapCtx = canvasElement.getContext('2d', { alpha: false });
        this.renderMinimap(); // データがあれば即座に描画します
    },

    resize: function () {
        if (!this.canvas) return;
        // キャンバスの実際のピクセルサイズを親要素に合わせます
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;

        this.render();
        this.renderMinimap(); // [追加] データが変わったらミニマップも更新します
    },

    updateData: function (jsonData) {
        this.data = JSON.parse(jsonData);

        if (this.data.LayoutXSize && this.data.LayoutYSize) {
            this.layoutSize = { w: this.data.LayoutXSize, h: this.data.LayoutYSize };
            // [修正] this.viewBox 初期化の行は削除しました。
            // 既存のズーム/パン状態を保持したままデータを更新して再描画します。
        }

        this.render();
    },

    // [修正] 最適化された ID リスト(Object of Arrays)を受け取りルックアップテーブルを生成します
    updateHiddenIds: function (jsonDto) {
        if (!jsonDto) return;

        const data = JSON.parse(jsonDto);
        this.hiddenIds = {}; // 初期化します

        // 配列を走査して検索用のマップに変換します
        // 例: this.hiddenIds["shelf-123"] = true
        if (data.shelf) {
            data.shelf.forEach(id => this.hiddenIds[`shelf-${id}`] = true);
        }
        if (data.obstacle) {
            data.obstacle.forEach(id => this.hiddenIds[`obstacle-${id}`] = true);
        }
        if (data.column) {
            data.column.forEach(id => this.hiddenIds[`column-${id}`] = true);
        }

        this.render();
        // ミニマップも選択状態（非表示の反映）を行う場合は呼び出します
        if (this.minimapCtx) this.renderMinimap();
    },

    updateViewport: function (x, y, w, h) {
        this.viewBox = { x, y, w, h };
        requestAnimationFrame(() => this.render());
    },

    // [追加2] C# から不良リストを受け取る関数
    updateInvalidItems: function (jsonIds) {
        if (!jsonIds) return;
        const rawList = JSON.parse(jsonIds);

        // 配列ではなくオブジェクトに変換して検索速度を向上させます
        this.invalidIds = {
            shelf: {},
            obstacle: {},
            column: {}
        };

        // 例: [1, 2, 3] -> { "1": true, "2": true, "3": true }
        if (rawList.shelf) rawList.shelf.forEach(id => this.invalidIds.shelf[id] = true);
        if (rawList.obstacle) rawList.obstacle.forEach(id => this.invalidIds.obstacle[id] = true);
        if (rawList.column) rawList.column.forEach(id => this.invalidIds.column[id] = true);

        this.render();
        this.renderMinimap();
    },

    render: function () {
        if (!this.ctx || !this.data) return;

        const ctx = this.ctx;
        const cvs = this.canvas;
        const vb = this.viewBox;

        // 1. 全体キャンバスを初期化（透明）します。これにより親コンテナの背景色が表示されます。
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cvs.width, cvs.height);

        const scaleX = cvs.width / vb.w;
        const scaleY = cvs.height / vb.h;
        const scale = Math.min(scaleX, scaleY);

        const renderW = vb.w * scale;
        const renderH = vb.h * scale;
        const offsetX = (cvs.width - renderW) / 2;
        const offsetY = (cvs.height - renderH) / 2;

        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
        ctx.translate(-vb.x, -vb.y);

        // ============================================================
        // [順序重要] 以降の描画順が Z-index になります
        // ============================================================

        // 2. マップ領域の背景色を塗ります（白）。
        // マップ外は先に clearRect しているため親 div の色が表示されます。
        ctx.fillStyle = "#f5f5f5";
        ctx.fillRect(0, 0, this.layoutSize.w, this.layoutSize.h);

        // 3. グリッドを描画します（アイテムより先に描画します）
        if (this.gridConfig.enabled && this.gridConfig.size > 0) {
            this._drawGrid(ctx, scale);
        }

        // 4. アイテム（棚など）を描画します
        this._drawScene(ctx, scale);

        // [追加] 経路（Flow Path）を描画します
        if (this.flowPath && this.flowPath.points && this.flowPath.points.length > 1) {
            this._drawFlowPath(ctx, scale);
        }

        ctx.restore();
    },

    _drawFlowPath: function (ctx, scale) {
        const points = this.flowPath.points;
        if (!points || points.length < 2) return;

        const color = this.flowPath.color || "#00E676";
        const outlineColor = "#FFFFFF";

        ctx.save();

        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        const mainLineWidth = 2 / scale;
        const outlineWidth = 5 / scale;
        const headLen = 12 / scale;
        const fontSize = 14 / scale; // ズームに応じたフォントサイズ

        // --- 1. 背景の白い縁取り（線 + 矢印）を描画します ---
        ctx.beginPath();
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = outlineWidth;
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
            ctx.moveTo(p2.x, p2.y);
            ctx.lineTo(p2.x - headLen * Math.cos(angle - Math.PI / 6), p2.y - headLen * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(p2.x, p2.y);
            ctx.lineTo(p2.x - headLen * Math.cos(angle + Math.PI / 6), p2.y - headLen * Math.sin(angle + Math.PI / 6));
        }
        ctx.stroke();

        // --- 2. メインのカラー線（線 + 矢印）を描画します ---
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = mainLineWidth;
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
            ctx.moveTo(p2.x, p2.y);
            ctx.lineTo(p2.x - headLen * Math.cos(angle - Math.PI / 6), p2.y - headLen * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(p2.x, p2.y);
            ctx.lineTo(p2.x - headLen * Math.cos(angle + Math.PI / 6), p2.y - headLen * Math.sin(angle + Math.PI / 6));
        }
        ctx.stroke();

        // --- 3. 線の中心に順番（インデックス）を描画します ---
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];

            // 中間地点の計算
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;

            const label = (i + 1).toString(); // 1 から表示します

            // テキストの縁取り（可読性向上のため白い外枠を追加）
            ctx.strokeStyle = outlineColor;
            ctx.lineWidth = 4 / scale;
            ctx.strokeText(label, midX, midY);

            // テキスト本体を描画します
            ctx.fillStyle = "#333333"; // 濃い色の方が読みやすいです
            ctx.fillText(label, midX, midY);
        }

        // --- 4. 開始地点（縁取り付き円）を描画します ---
        ctx.beginPath();
        ctx.fillStyle = outlineColor;
        ctx.arc(points[0].x, points[0].y, 10 / scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(points[0].x, points[0].y, 7 / scale, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    },

    // [修正] グリッド描画（マップ全体を描画する簡易版）
    _drawGrid: function (ctx, scale) {
        const gridSize = this.gridConfig.size;
        const w = this.layoutSize.w;
        const h = this.layoutSize.h;

        // 1px 相当の線幅を維持します
        ctx.lineWidth = 1 / scale;
        ctx.strokeStyle = "#cccccc";

        // 点線スタイル
        const dashSize = 4 / scale;
        const gapSize = 3 / scale;
        ctx.setLineDash([dashSize, gapSize]);

        ctx.beginPath();

        // マップ全体（0 から 終端 w,h）を描画します。
        // ビューポート計算やバッファは省略しています。

        // 縦線を描画します
        for (let x = 0; x <= w; x += gridSize) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
        }

        // 横線を描画します
        for (let y = 0; y <= h; y += gridSize) {
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
        }

        ctx.stroke();
        ctx.setLineDash([]); // 点線をリセットします
    },

    // [追加] ミニマップ描画（全体マップをキャンバスサイズに合わせて描画します）
    renderMinimap: function () {
        if (!this.minimapCtx || !this.minimapCanvas || !this.data) return;

        const ctx = this.minimapCtx;
        const cvs = this.minimapCanvas;
        const layoutW = this.layoutSize.w;
        const layoutH = this.layoutSize.h;

        // 1. 初期化
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#f5f5f5"; // ミニマップ背景色
        ctx.fillRect(0, 0, cvs.width, cvs.height);

        if (layoutW <= 0 || layoutH <= 0) return;

        // 2. 全体マップをキャンバスに収まるようにスケーリングします
        // (LayoutMap.razor 側でサイズを合わせているためここではそのまま使用します)
        const scaleX = cvs.width / layoutW;
        const scaleY = cvs.height / layoutH;
        const scale = Math.min(scaleX, scaleY);

        ctx.save();
        ctx.scale(scale, scale);

        // 3. 描画（データが多いためストロークは省略し塗りのみ行います）
        this._drawScene(ctx, scale, true); // true = isMinimap

        ctx.restore();
    },

    // [修正] 描画ロジックを共通化した内部関数です
    _drawScene: function (ctx, scale, isMinimap = false) {
        // 1. 壁の描画
        if (this.data.WallPoint && this.data.WallPoint.length > 1) {
            const p = this.data.WallPoint;

            ctx.save();
            ctx.beginPath();

            ctx.rect(-100000, -100000, 200000, 200000);

            ctx.moveTo(p[0].X, p[0].Y);
            for (let i = 1; i < p.length; i++) {
                ctx.lineTo(p[i].X, p[i].Y);
            }
            ctx.closePath();

            ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
            ctx.fill("evenodd");
            ctx.restore();

            ctx.beginPath();
            ctx.strokeStyle = "#444";
            const baseWidth = 4;
            ctx.lineWidth = isMinimap ? (baseWidth / scale) : (baseWidth * 2 / scale);
            ctx.lineJoin = "round";
            ctx.lineCap = "round";

            ctx.moveTo(p[0].X, p[0].Y);
            for (let i = 1; i < p.length; i++) {
                ctx.lineTo(p[i].X, p[i].Y);
            }
            ctx.closePath();
            ctx.stroke();
        }

        // 2. 四角形描画ヘルパー
        const drawRects = (items, type, color) => {
            if (!items) return;

            ctx.fillStyle = color;
            const lineWidth = Math.max(2.5, 2.5 / scale);
            if (!isMinimap) ctx.lineWidth = lineWidth;

            items.forEach(item => {
                if (!isMinimap && this.hiddenIds[`${type}-${item.Id}`]) return;

                const isInvalid = this.invalidIds[type] && this.invalidIds[type][item.Id];
                if (isInvalid) ctx.fillStyle = "rgba(255, 82, 82, 0.8)";
                else ctx.fillStyle = color;

                if (!item.coord || item.coord.length === 0) return;

                // 座標からバウンディングボックス（min/max）を計算します
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                item.coord.forEach(p => {
                    if (p.X < minX) minX = p.X;
                    if (p.Y < minY) minY = p.Y;
                    if (p.X > maxX) maxX = p.X;
                    if (p.Y > maxY) maxY = p.Y;
                });
                const w = maxX - minX;
                const h = maxY - minY;

                if (w > 0 && h > 0) {
                    // 1) 四角形を塗りつぶします
                    ctx.fillRect(minX, minY, w, h);

                    if (!isMinimap && type === 'shelf') { // ★ 修正: グラデーション適用ロジック
                        ctx.fillStyle = item.AreaColor;

                        // 三角形サイズを設定します（棚サイズに比例しますが大きくなりすぎないようにします）
                        const triSize = Math.min(w, h) * 0.7;

                        ctx.beginPath();
                        ctx.moveTo(maxX, maxY);             // 右下の頂点
                        ctx.lineTo(maxX - triSize, maxY);    // 底辺の左側
                        ctx.lineTo(maxX, maxY - triSize);    // 右辺の上側
                        ctx.closePath();
                        ctx.fill();
                    }

                    // ★ [重要] ミニマップでない場合のみ詳細（枠、X印、向き）を描画します
                    if (!isMinimap) {
                        let strokeColor = '#444';
                        if (type === 'shelf') strokeColor = '#A3937C';

                        ctx.strokeStyle = isInvalid ? "#d50000" : strokeColor;

                        // 2) 枠を描画します
                        ctx.strokeRect(minX, minY, w, h);

                        // ====================================================
                        // ★ [追加] 棚の Facing（向き）を強調表示します
                        // ====================================================
                        if (type === 'shelf' && item.Facing && item.Facing > 0) {
                            ctx.save(); // スタイルを保存します

                            ctx.beginPath();
                            // 視認性のため太めに描画します（基本線の2〜3倍）
                            ctx.lineWidth = Math.max(5, 5 / scale);
                            ctx.strokeStyle = "#2C3E50";
                            ctx.lineCap = "butt";

                            // Facing: 1=Top, 2=Right, 3=Bottom, 4=Left
                            switch (item.Facing) {
                                case 1: // Top（上辺）
                                    ctx.moveTo(minX, minY);
                                    ctx.lineTo(maxX, minY);
                                    break;
                                case 2: // Right（右辺）
                                    ctx.moveTo(maxX, minY);
                                    ctx.lineTo(maxX, maxY);
                                    break;
                                case 3: // Bottom（下辺）
                                    ctx.moveTo(minX, maxY);
                                    ctx.lineTo(maxX, maxY);
                                    break;
                                case 4: // Left（左辺）
                                    ctx.moveTo(minX, minY);
                                    ctx.lineTo(minX, maxY);
                                    break;
                            }
                            ctx.stroke();

                            ctx.restore(); // スタイルを復元します（必須）
                        }
                        // ====================================================
                        // ====================================================
                        // ★ [修正] 棚名の描画（回転および自動サイズ調整）
                        // ====================================================
                        if (type === 'shelf' && item.Name) {
                            const isVertical = h > w;
                            const shortSidePx = (isVertical ? w : h) * scale;
                            const longSidePx = (isVertical ? h : w) * scale;

                            if (shortSidePx > 10) {
                                ctx.save();

                                const centerX = minX + w / 2;
                                const centerY = minY + h / 2;
                                ctx.translate(centerX, centerY);

                                if (isVertical) {
                                    ctx.rotate(-Math.PI / 2);
                                }

                                // -----------------------------------------------------------
                                // 可読性向上: 文字色を濃い色に変更し縁取りを追加します
                                // -----------------------------------------------------------
                                ctx.textAlign = "center";
                                ctx.textBaseline = "middle";

                                // フォントサイズ計算ロジック
                                const fitWidth = isVertical ? h : w;
                                const fitHeight = isVertical ? w : h;
                                let fontSizeWorld = 12 / scale;
                                fontSizeWorld = Math.min(fontSizeWorld, fitHeight * 0.8);

                                const estimatedTextWidth = item.Name.length * fontSizeWorld * 0.6;
                                if (estimatedTextWidth > fitWidth * 0.9) {
                                    fontSizeWorld *= (fitWidth * 0.9) / estimatedTextWidth;
                                }

                                ctx.font = `bold ${fontSizeWorld}px sans-serif`;

                                // 1. 縁取りを描画します（白い光彩効果）
                                ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
                                ctx.lineWidth = 3 / scale;
                                ctx.lineJoin = "round";
                                ctx.strokeText(item.Name, 0, 0);

                                // 2. 文字本体を描画します（濃いグレー）
                                ctx.fillStyle = "#333333";
                                ctx.fillText(item.Name, 0, 0);

                                ctx.restore();
                            }
                        }
                        // ====================================================
                    }
                }
            });
        };

        // 2-1. 障害物四角形描画ヘルパー
        const drawObstacleRects = (items, type, color) => {
            if (!items) return;

            ctx.fillStyle = color;
            const lineWidth = Math.max(2.5, 2.5 / scale);
            if (!isMinimap) ctx.lineWidth = lineWidth;

            items.forEach(item => {
                if (!isMinimap && this.hiddenIds[`${type}-${item.Id}`]) return;

                const isInvalid = this.invalidIds[type] && this.invalidIds[type][item.Id];
                if (isInvalid) ctx.fillStyle = "rgba(255, 82, 82, 0.8)";
                else ctx.fillStyle = color;

                if (!item.coord || item.coord.length === 0) return;

                // 座標からバウンディングボックス（min/max）を計算します
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                item.coord.forEach(p => {
                    if (p.X < minX) minX = p.X;
                    if (p.Y < minY) minY = p.Y;
                    if (p.X > maxX) maxX = p.X;
                    if (p.Y > maxY) maxY = p.Y;
                });
                const w = maxX - minX;
                const h = maxY - minY;

                if (w > 0 && h > 0) {
                    // 1) 四角形を塗りつぶします
                    ctx.fillRect(minX, minY, w, h);

                    // ★ [重要] ミニマップでない場合のみ詳細（枠、X印、向き）を描画します
                    if (!isMinimap) {
                        let strokeColor = '#444';
                        if (type === 'column') strokeColor = '#cccccc';

                        ctx.strokeStyle = isInvalid ? "#d50000" : strokeColor;

                        // 2) 枠を描画します
                        ctx.strokeRect(minX, minY, w, h);

                        // 3) 障害物／柱の X 印を描画します
                        if (type === 'column') {
                            ctx.beginPath();
                            ctx.moveTo(minX, minY); ctx.lineTo(maxX, maxY);
                            ctx.moveTo(maxX, minY); ctx.lineTo(minX, maxY);
                            ctx.stroke();
                        }
                        else {
                            // obstacle: 斜めラインパターンを描画します
                            const step = 1000; // 線と線の間隔（調整可能）
                            ctx.beginPath();

                            for (let offset = 0; offset <= (maxX - minX) + (maxY - minY); offset += step) {
                                // 右上から左下へ向かう線の開始点と終了点を計算します
                                let startX = Math.min(minX + offset, maxX);
                                let startY = minY + Math.max(0, offset - (maxX - minX));

                                let endX = Math.max(minX, minX + offset - (maxY - minY));
                                let endY = Math.min(minY + offset, maxY);

                                ctx.moveTo(startX, startY);
                                ctx.lineTo(endX, endY);
                            }
                            ctx.stroke();
                        }

                        // 4) PassagePoints（通路）を描画します
                        if (type === 'obstacle' && item.PassagePoints && item.PassagePoints.length > 0) {
                            const passageColor = "#D0D0D0"; // マップ背景色に合わせた抜け表現
                            const passageWidth = 600; // 通路幅（単位は mm など、ズームに合わせて調整可能）
                            const overHang = Math.max(5, 5 / scale); // 手すりが障害物外にはみ出す長さ
                            const skewOffset = Math.max(5, 5 / scale); // 斜めに外側へ広がるオフセット

                            item.PassagePoints.forEach(pp => {
                                ctx.save();
                                ctx.fillStyle = passageColor;
                                ctx.strokeStyle = "#808080"; // 手すりはグレー
                                ctx.lineWidth = Math.max(4, 4 / scale);
                                ctx.lineCap = "butt";

                                if (pp.passDirection === 0) { // 縦方向の通路（][ 形状）
                                    const px = pp.nPoint - (passageWidth / 2);
                                    const pxRight = pp.nPoint + (passageWidth / 2);

                                    // 1. 通路の床を抜きます
                                    ctx.fillRect(px, minY, passageWidth, h);

                                    // 2. 左側の手すり（斜め）
                                    ctx.beginPath();
                                    ctx.moveTo(px - skewOffset, minY - overHang);
                                    ctx.lineTo(px, minY);
                                    ctx.lineTo(px, maxY);
                                    ctx.lineTo(px - skewOffset, maxY + overHang);
                                    ctx.stroke();

                                    // 3. 右側の手すり（斜め）
                                    ctx.beginPath();
                                    ctx.moveTo(pxRight + skewOffset, minY - overHang);
                                    ctx.lineTo(pxRight, minY);
                                    ctx.lineTo(pxRight, maxY);
                                    ctx.lineTo(pxRight + skewOffset, maxY + overHang);
                                    ctx.stroke();
                                }
                                else { // 横方向の通路（90度回転）
                                    const py = pp.nPoint - (passageWidth / 2);
                                    const pyBottom = pp.nPoint + (passageWidth / 2);

                                    // 1. 通路の床を抜きます
                                    ctx.fillRect(minX, py, w, passageWidth);

                                    // 2. 上側の手すり（斜め）
                                    ctx.beginPath();
                                    ctx.moveTo(minX - overHang, py - skewOffset);
                                    ctx.lineTo(minX, py);
                                    ctx.lineTo(maxX, py);
                                    ctx.lineTo(maxX + overHang, py - skewOffset);
                                    ctx.stroke();

                                    // 3. 下側の手すり（斜め）
                                    ctx.beginPath();
                                    ctx.moveTo(minX - overHang, pyBottom + skewOffset);
                                    ctx.lineTo(minX, pyBottom);
                                    ctx.lineTo(maxX, pyBottom);
                                    ctx.lineTo(maxX + overHang, pyBottom + skewOffset);
                                    ctx.stroke();
                                }
                                ctx.restore();
                            });
                        }
                    }
                }
            });
        };

        drawRects(this.data.StartAreas, 'start', '#4caf50');
        drawRects(this.data.EndAreas, 'end', '#f44336');

        // 障害物と柱は X 印を含めて描画します
        drawObstacleRects(this.data.Obstacles, 'obstacle', '#111111');
        drawObstacleRects(this.data.Columns, 'column', '#999999');

        drawRects(this.data.Shelves, 'shelf', '#D1C7B7');

        // LayoutRenderer.js 内の通路描画セクション
        if (!isMinimap) {
            const ctx = this.ctx;

            if (!isMinimap && this.data.Aisles && this.data.Aisles.length > 0) {
                ctx.save();

                this.data.Aisles.forEach(aisle => {
                    if (aisle.w <= 0 || aisle.h <= 0) return;

                    const isVertical = aisle.h > aisle.w;
                    const cx = aisle.x + aisle.w / 2;
                    const cy = aisle.y + aisle.h / 2;
                    const aisleColor = aisle.ColorCode || "#FFEB3B"; // 設定されたエリアカラー

                    // 1. 床の着色（控えめな黄色にします、任意）
                    ctx.fillStyle = "rgba(255, 160, 0, 0.25)";
                    ctx.fillRect(aisle.x, aisle.y, aisle.w, aisle.h);

                    // -----------------------------------------------------------
                    // 1. 中央ライン: 床全体ではなくエリアカラーで点線を描画します
                    // -----------------------------------------------------------
                    ctx.save();
                    ctx.strokeStyle = aisleColor;
                    ctx.lineWidth = Math.max(4, 6 / scale); // ズームに応じた太さを維持します
                    ctx.setLineDash([20 / scale, 15 / scale]); // 点線の間隔

                    ctx.beginPath();
                    if (isVertical) {
                        ctx.moveTo(cx, aisle.y + 10 / scale);
                        ctx.lineTo(cx, aisle.y + aisle.h - 10 / scale);
                    } else {
                        ctx.moveTo(aisle.x + 10 / scale, cy);
                        ctx.lineTo(aisle.x + aisle.w - 10 / scale, cy);
                    }
                    ctx.stroke();
                    ctx.restore();

                    // -----------------------------------------------------------
                    // 2. 文字と矢印を中央に揃えて描画します
                    // -----------------------------------------------------------
                    const fontSize = Math.max(7, 14 / scale);
                    ctx.save();
                    ctx.translate(cx, cy);
                    if (isVertical) ctx.rotate(Math.PI / 2);

                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";

                    // --- [A] 矢印（エリアカラーを適用） ---
                    let arrow = "";

                    // Up = 1,     // 上（北）
                    // Down = 2,   // 下（南）
                    // Left = 3,   // 左（西）
                    // Right = 4   // 右（東）
                    switch (aisle.Direction) {
                        case 1: arrow = isVertical ? "←" : "↑"; break;    // Up
                        case 2: arrow = isVertical ? "→" : "↓"; break;    // Down
                        case 4: arrow = isVertical ? "↑" : "←"; break;    // Left
                        case 8: arrow = isVertical ? "↓" : "→"; break;    // Right
                        case 3: arrow = isVertical ? "↔" : "↕"; break;    // BothVertical (1|2)
                        case 12: arrow = isVertical ? "↕" : "↔"; break;   // BothHorizontal (4|8)
                        case 15: arrow = "✥"; break;                      // All
                        default: arrow = ""; break;
                    }

                    if (arrow) {
                        ctx.fillStyle = aisleColor; // 矢印をエリアカラーで強調します
                        ctx.font = `bold ${fontSize * 3}px Arial`;
                        // 文字の縁取り（ハロー）で可読性を確保します
                        ctx.strokeStyle = "white";
                        ctx.lineWidth = 4 / scale;
                        ctx.strokeText(arrow, 0, 0);
                        ctx.fillText(arrow, 0, 0);
                    }

                    // --- [B] ★ 重要: テキスト情報（LOD 適用） ---
                    // scale が 0.02 より大きい場合のみ詳細情報を表示します
                    if (scale > 0.02) {
                        const offset = fontSize * 1.8;

                        // 共通のテキストスタイル設定
                        ctx.strokeStyle = "white";      // 縁取り色: 白
                        ctx.lineWidth = 3 / scale;      // ズームに合わせた縁取り幅
                        ctx.lineJoin = "round";         // 文字の外郭を滑らかにします
                        ctx.fillStyle = "rgba(0, 0, 0, 0.9)"; // 本文色: 黒

                        // 1. 左側: 通路名（Name）
                        if (aisle.Name) {
                            ctx.font = `${fontSize * 0.9}px Arial`;
                            ctx.textAlign = "right";

                            // まず縁取りを描画し、その上に文字を重ねます
                            ctx.strokeText(aisle.Name, -offset, 0);
                            ctx.fillText(aisle.Name, -offset, 0);
                        }

                        // 2. 右側: エリア番号（AreaNumber）
                        if (aisle.AreaNumber !== undefined) {
                            ctx.font = `bold ${fontSize * 1.0}px Arial`;
                            ctx.textAlign = "left";
                            const areaNumStr = String(aisle.AreaNumber).padStart(2, '0');
                            const displayText = `[${areaNumStr}]`;

                            // まず縁取りを描画し、その上に文字を重ねます
                            ctx.strokeText(displayText, offset, 0);
                            ctx.fillText(displayText, offset, 0);
                        }
                    }

                    ctx.restore();
                });

                ctx.restore();

                // -----------------------------------------------------------
                // ★ [修正] Zone（ゾーン）描画セクション: 可読性を高めるため赤色に変更します
                // -----------------------------------------------------------
                if (!this.data.Zones || this.data.Zones.length === 0) return;
                ctx.save();

                this.data.Zones.forEach(zone => {
                    // 1. 領域の塗りつぶし（半透明の赤）
                    // 領域が重なっても通路が見えるようにします
                    ctx.fillStyle = "rgba(255, 82, 82, 0.15)";
                    ctx.fillRect(zone.x, zone.y, zone.w, zone.h);

                    // 2. 境界線（赤の点線、太めで強調）
                    ctx.setLineDash([15 / scale, 8 / scale]); // 点線間隔を調整
                    ctx.strokeStyle = "rgba(255, 0, 0, 0.6)"; // 濃い赤
                    ctx.lineWidth = 3 / scale;
                    ctx.strokeRect(zone.x, zone.y, zone.w, zone.h);

                    // 3. ZoneConnectors（重複しない接続情報を表示）
                    if (zone.connectors && zone.connectors.length > 0) {
                        ctx.setLineDash([]);

                        zone.connectors.forEach(conn => {
                            // --- [A] コネクタポイント（円）を描画します ---
                            ctx.beginPath();
                            const radius = 6 / scale;
                            ctx.arc(conn.x, conn.y, radius, 0, Math.PI * 2);

                            ctx.fillStyle = "#FFEA00";
                            ctx.fill();

                            ctx.strokeStyle = "#FF0000";
                            ctx.lineWidth = 2 / scale;
                            ctx.stroke();

                            // --- [B] 接続情報テキスト（Z1-Z2 形式）を描画します ---
                            // 重複を避けるため、常に小さいIDを先にして表示します
                            if (scale > 0.005) {
                                ctx.save();

                                const fontSize = 14 / scale;
                                ctx.font = `bold ${fontSize}px Arial`;

                                // 現在のゾーンIDと接続先IDを比較し、常に小さい番号を先にします（重複防止）
                                const id1 = Math.min(zone.id, conn.id);
                                const id2 = Math.max(zone.id, conn.id);
                                const label = `Z${id1}-Z${id2}`;

                                const textWidth = ctx.measureText(label).width;
                                const padding = 4 / scale;

                                // --- 変更箇所: テキスト位置を円の右側に設定 ---
                                // tx: 円の中心(conn.x) + 半径(radius) + 余白(padding)
                                // ty: 円の中心(conn.y) と同じ高さ
                                const tx = conn.x + radius + padding;
                                const ty = conn.y;

                                // 可読性のため背景ボックスを描画します
                                ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
                                // 基準点が左端(textAlign="left")になるため、fillRectの開始位置を調整
                                ctx.fillRect(tx - padding, ty - fontSize / 2 - padding, textWidth + padding * 2, fontSize + padding * 2);

                                // テキスト本体（白色）
                                // 右側に配置する場合、中央揃え(center)より左揃え(left)の方が座標計算が楽だぞ
                                ctx.textAlign = "left";
                                ctx.textBaseline = "middle";
                                ctx.fillStyle = "#000000";
                                ctx.fillText(label, tx, ty);

                                ctx.restore();
                            }
                        });
                    }

                    // 4. ゾーンIDテキスト（青から赤に変更）
                    if (scale > 0.002) {
                        ctx.save();

                        const fontSize = 20 / scale; // 文字サイズをやや大きくします
                        ctx.font = `bold ${fontSize}px Arial`;
                        ctx.textBaseline = "top";
                        ctx.textAlign = "left";

                        const textX = zone.x + (8 / scale);
                        const textY = zone.y + (8 / scale);

                        // 縁取り（白）
                        ctx.strokeStyle = "#FFFFFF";
                        ctx.lineWidth = 5 / scale;
                        ctx.lineJoin = "round";
                        ctx.strokeText(`Z${zone.id}`, textX, textY);

                        // 文字本体（黒）
                        ctx.fillStyle = "#000000";
                        ctx.fillText(`Z${zone.id}`, textX, textY);

                        ctx.restore();
                    }
                });

                ctx.restore();
            }
        }
    }
};