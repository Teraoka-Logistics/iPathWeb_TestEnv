// ========================================================================================
// LayoutExtractor.js
// 倉庫レイアウト図面から棚位置を抽出するための Canvas 操作／画像処理スクリプト
// ========================================================================================

// Canvas に画像を描画する
window.drawImageOnCanvas = (canvas, dataUrl) => {
    if (!canvas) {
        return;
    }

    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
    };
    img.src = dataUrl;
};

// バイト配列から RGBA データをデコードする
window.decodeRgbaFromByteArray = (dotnetBytes) => {
    return new Promise((resolve) => {
        const blob = new Blob([dotnetBytes]);

        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;

                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);

                const imageData = ctx.getImageData(0, 0, img.width, img.height);

                resolve({
                    width: img.width,
                    height: img.height,
                    data: Array.from(imageData.data)
                });
            };
            img.src = reader.result;
        };

        reader.readAsDataURL(blob);
    });
};

// Canvas に RGBA データを描画する
window.drawRgbaOnCanvas = (canvas, width, height, bytes) => {
    if (!canvas) {
        return;
    }
    const ctx = canvas.getContext('2d');

    // データサイズチェック
    if (bytes.length !== width * height * 4) {
        console.warn("Data size mismatch. Canvas might be empty.");
        // 空データで初期化する場合のフォールバック
        canvas.width = width;
        canvas.height = height;
        ctx.clearRect(0, 0, width, height);
        return;
    }

    const data = new Uint8ClampedArray(bytes);
    const imageData = new ImageData(data, width, height);
    canvas.width = width;
    canvas.height = height;
    ctx.putImageData(imageData, 0, 0);
};

// 青色ブラシ（マスク用）を有効にする
window.enableBlueBrush = (canvas) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    let drawing = false;

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    };

    const start = (e) => {
        drawing = true;
        draw(e);
    };

    const end = () => {
        drawing = false;
        ctx.beginPath();
    };

    const draw = (e) => {
        if (!drawing) return;

        const pos = getPos(e);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = "rgba(0, 120, 255, 1.0)";

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
        ctx.fill();
    };

    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mouseup", end);
    canvas.addEventListener("mouseleave", end);
    canvas.addEventListener("mousemove", draw);

    canvas.style.opacity = "0.6"; // 視認性を向上します
    canvas.style.cursor = "crosshair";
};

// マスク画像の RGBA データを取得する
window.getMaskRgba = (canvas) => {
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    return {
        width: w,
        height: h,
        data: Array.from(imgData.data)
    };
};

// 壁指定ツールを有効にする
window.enableWallPicker = (canvas) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (canvas.__wallPickerEnabled) return;
    canvas.__wallPickerEnabled = true;

    const points = canvas.__wallPoints || [];
    canvas.__wallPoints = points;
    canvas.__wallFinished = false;
    canvas.style.cursor = "crosshair";

    const getPos = (e) => {
        const canvasRect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / canvasRect.width;
        const scaleY = canvas.height / canvasRect.height;
        return {
            x: (e.clientX - canvasRect.left) * scaleX,
            y: (e.clientY - canvasRect.top) * scaleY
        };
    };

    const snapToExistingPoints = (pos, snapThreshold = 20) => {
        let snappedX = pos.x;
        let snappedY = pos.y;
        for (let p of points) {
            if (Math.abs(pos.x - p.x) < snapThreshold) snappedX = p.x;
            if (Math.abs(pos.y - p.y) < snapThreshold) snappedY = p.y;
        }
        return { x: snappedX, y: snappedY };
    };

    const snapAngleTo5Degrees = (x1, y1, x2, y2) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 1) return { x: x2, y: y2 };
        let angle = Math.atan2(dy, dx);
        let degrees = angle * 180 / Math.PI;
        const snapDegrees = Math.round(degrees / 5) * 5;
        const snappedAngle = snapDegrees * Math.PI / 180;
        return {
            x: x1 + distance * Math.cos(snappedAngle),
            y: y1 + distance * Math.sin(snappedAngle)
        };
    };

    const redrawAll = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1.0;

        ctx.fillStyle = "rgba(100, 50, 0, 1.0)";
        for (let p of points) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.strokeStyle = "rgba(150, 75, 0, 0.8)";
        ctx.lineWidth = 3;
        for (let i = 0; i + 1 < points.length; i++) {
            const p1 = points[i], p2 = points[i + 1];
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
        }

        if (points.length > 2 && canvas.__wallFinished) { // 閉じている場合のみ最後の線を描画します
            const first = points[0];
            const last = points[points.length - 1];
            ctx.beginPath();
            ctx.moveTo(last.x, last.y);
            ctx.lineTo(first.x, first.y);
            ctx.stroke();
        }
    };

    const isNear = (p, q, threshold = 15) => {
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        return Math.sqrt(dx * dx + dy * dy) <= threshold;
    };

    const onMouseMove = (e) => {
        if (canvas.__wallFinished) return;
        if (points.length === 0) return;

        const pos = getPos(e);
        const last = points[points.length - 1];
        let snappedPos = snapToExistingPoints(pos);
        snappedPos = snapAngleTo5Degrees(last.x, last.y, snappedPos.x, snappedPos.y);

        redrawAll();

        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(snappedPos.x, snappedPos.y);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(150, 75, 0, 0.5)"; // ガイド線は薄めに描画します
        ctx.stroke();
    };

    const onMouseDown = (e) => {
        if (e.button !== 0) return;
        if (canvas.__wallFinished) return; // 完了している場合は追加しません

        const pos = getPos(e);

        if (points.length >= 3 && isNear(pos, points[0])) {
            canvas.__wallFinished = true;
            redrawAll();
            return;
        }

        let finalPos = snapToExistingPoints(pos);
        if (points.length > 0) {
            const last = points[points.length - 1];
            finalPos = snapAngleTo5Degrees(last.x, last.y, finalPos.x, finalPos.y);
        }

        points.push(finalPos);
        redrawAll();
    };

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
};

window.getWallPoints = (canvas) => {
    if (!canvas || !canvas.__wallPoints) return [];
    return canvas.__wallPoints;
};

window.clearWallPoints = (canvas) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (canvas.__wallPoints) canvas.__wallPoints.length = 0;
    canvas.__wallFinished = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
};

// ------------------------------------------------------------------
// [修正] 実測設定ツール（横／縦スロットの分離および色変更）
// ------------------------------------------------------------------

window.enableRealSizePicker = (canvas, dotnetRef) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (canvas.__realSizePickerEnabled) {
        // 既に有効化済みです
    }
    canvas.__realSizePickerEnabled = true;
    canvas.style.cursor = "crosshair";

    const backgroundSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (!canvas.__savedLines) {
        canvas.__savedLines = { horz: null, vert: null };
    }

    // [追加] スケール情報格納（初期値なし）
    // x, y は 1px あたりの mm 値
    if (!canvas.__scaleInfo) {
        canvas.__scaleInfo = { x: 0, y: 0 };
    }

    canvas.__currentPoints = [];
    canvas.__lastCommittedPoints = [];

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    };

    // [主要ロジック] 距離テキストを計算する関数
    const getDistText = (p1, p2) => {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;

        // スケール情報が設定されていれば mm で計算します
        if (canvas.__scaleInfo.x > 0 && canvas.__scaleInfo.y > 0) {
            // 横変位(mm) = dx(px) * scaleX(mm/px)
            const w_mm = dx * canvas.__scaleInfo.x;
            const h_mm = dy * canvas.__scaleInfo.y;
            const dist_mm = Math.sqrt(w_mm * w_mm + h_mm * h_mm);
            return `${Math.round(dist_mm)} mm`;
        }
        else {
            // 設定されていなければ px を表示します
            const dist_px = Math.sqrt(dx * dx + dy * dy);
            return `${Math.round(dist_px)} px`;
        }
    };

    const drawDimensionLine = (p1, p2, color) => {
        // テキスト内容を計算（px または mm）
        const text = getDistText(p1, p2);

        const barSize = 10;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;

        // 線を描画
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);

        const isHorizontal = Math.abs(p1.y - p2.y) < 1;

        if (isHorizontal) {
            ctx.moveTo(p1.x, p1.y - barSize); ctx.lineTo(p1.x, p1.y + barSize);
            ctx.moveTo(p2.x, p2.y - barSize); ctx.lineTo(p2.x, p2.y + barSize);
        } else {
            ctx.moveTo(p1.x - barSize, p1.y); ctx.lineTo(p1.x + barSize, p1.y);
            ctx.moveTo(p2.x - barSize, p2.y); ctx.lineTo(p2.x + barSize, p2.y);
        }
        ctx.stroke();

        if (text) {
            // 1. テキストサイズを測定
            ctx.font = "bold 14px sans-serif";
            const textMetrics = ctx.measureText(text);
            const textWidth = textMetrics.width;
            const textHeight = 14; // おおよその高さ
            const padding = 6;     // 余白
            const boxWidth = textWidth + padding * 2;
            const boxHeight = 20;

            // 2. 基本位置（線の中央）
            let drawX = (p1.x + p2.x) / 2;
            let drawY = (p1.y + p2.y) / 2;

            // 3. [重要] 画面境界との衝突判定および補正（スマートクランプ）

            // 左端をはみ出す場合 -> 右へ寄せる
            if (drawX - boxWidth / 2 < 0) {
                drawX = boxWidth / 2 + 2;
            }
            // 右端をはみ出す場合 -> 左へ寄せる
            else if (drawX + boxWidth / 2 > canvas.width) {
                drawX = canvas.width - boxWidth / 2 - 2;
            }

            // 上端をはみ出す場合 -> 下へ寄せる
            if (drawY - boxHeight / 2 < 0) {
                drawY = boxHeight / 2 + 2;
            }
            // 下端をはみ出す場合 -> 上へ寄せる
            else if (drawY + boxHeight / 2 > canvas.height) {
                drawY = canvas.height - boxHeight / 2 - 2;
            }

            // 4. 背景ボックスおよびテキストを描画（補正後の drawX, drawY を使用）
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            // 背景ボックス（白）
            ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
            ctx.fillRect(drawX - boxWidth / 2, drawY - boxHeight / 2, boxWidth, boxHeight);

            // 文字
            ctx.fillStyle = color;
            ctx.fillText(text, drawX, drawY);
        }
    };

    // redrawAll をキャンバスオブジェクトにアタッチして、外部（setRealSizeScale）からも呼べるようにします
    canvas.__redrawAll = () => {
        ctx.putImageData(backgroundSnapshot, 0, 0);

        const greenColor = "rgba(0, 200, 0, 1.0)"; // 確定した線
        if (canvas.__savedLines.horz) {
            const L = canvas.__savedLines.horz;
            drawDimensionLine(L.p1, L.p2, greenColor);
        }
        if (canvas.__savedLines.vert) {
            const L = canvas.__savedLines.vert;
            drawDimensionLine(L.p1, L.p2, greenColor);
        }

        const redColor = "rgba(255, 0, 0, 1.0)"; // 描画中の線
        const pts = canvas.__currentPoints;
        if (pts.length > 1) {
            const p1 = pts[0];
            const p2 = pts[pts.length - 1];
            drawDimensionLine(p1, p2, redColor);
        }
    };

    const onMouseMove = (e) => {
        if (canvas.__currentPoints.length === 0) return;

        const start = canvas.__currentPoints[0];
        const pos = getPos(e);
        let x1 = start.x, y1 = start.y;
        let x2 = pos.x, y2 = pos.y;
        const dx = x2 - x1, dy = y2 - y1;

        let isHorizontal = Math.abs(dx) >= Math.abs(dy);
        if (isHorizontal) y2 = y1;
        else x2 = x1;

        canvas.__currentPoints = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
        canvas.__redrawAll(); // 更新された redrawAll を呼び出します
    };

    const onMouseDown = (e) => {
        if (e.button !== 0) return;
        const pos = getPos(e);

        if (canvas.__currentPoints.length === 0) {
            canvas.__currentPoints.push(pos);
            return;
        }

        const start = canvas.__currentPoints[0];
        let x2 = pos.x, y2 = pos.y;
        const dx = x2 - start.x, dy = y2 - start.y;
        const isHorizontal = Math.abs(dx) >= Math.abs(dy);

        if (isHorizontal) y2 = start.y;
        else x2 = start.x;

        const end = { x: x2, y: y2 };

        // テキストは保存せず、点のみ保存（描画時に毎回計算します）
        if (isHorizontal) {
            canvas.__savedLines.horz = { p1: start, p2: end };
        } else {
            canvas.__savedLines.vert = { p1: start, p2: end };
        }

        canvas.__lastCommittedPoints = [start, end];
        canvas.__currentPoints = [];
        canvas.__redrawAll();

        if (dotnetRef) {
            dotnetRef.invokeMethodAsync('OnLineDrawnAsync')
                .catch(err => console.error(err));
        }
    };

    canvas.removeEventListener("mousedown", canvas._onMouseDownFunc);
    canvas.removeEventListener("mousemove", canvas._onMouseMoveFunc);

    canvas._onMouseDownFunc = onMouseDown;
    canvas._onMouseMoveFunc = onMouseMove;

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
};

// [追加] C# 側で計算したスケール（1px 当たり mm）を受け取り保存し画面を更新する
window.setRealSizeScale = (canvas, xMmPerPx, yMmPerPx) => {
    if (!canvas) return;
    // スケール情報を更新（0 の場合は px 表示モード）
    canvas.__scaleInfo = { x: xMmPerPx, y: yMmPerPx };

    // 即時再描画（px -> mm にテキストが切り替わります）
    if (canvas.__redrawAll) {
        canvas.__redrawAll();
    }
};

// [修正] Blazor に渡すポイントデータ
// 全履歴ではなく、直近に描いたライン（2点）のみを返却し、Blazor 側で処理します
window.getRealSizePoints = (canvas) => {
    return (canvas && canvas.__lastCommittedPoints) ? canvas.__lastCommittedPoints : [];
};

// [修正] 初期化時に内部スロットも初期化する
window.clearRealSizePoints = (canvas) => {
    if (!canvas) return;
    canvas.__savedLines = { horz: null, vert: null };
    canvas.__currentPoints = [];
    canvas.__lastCommittedPoints = [];

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
};

// ズーム・パン関連
window.layoutMap = window.layoutMap || {};

window.layoutMap.getShelfPointer = (element, zoom, clientX, clientY) => {
    if (!element) return { x: 0, y: 0 };

    // 画面上で要素（SVG／Canvas）がどの位置にあるかを確認します
    const rect = element.getBoundingClientRect();

    // （マウス位置 - 要素の左上）／ズーム倍率
    return {
        x: (clientX - rect.left) / zoom,
        y: (clientY - rect.top) / zoom
    };
};

window.layoutMap.setShelfAdjustZoom = (canvas, svg, zoom) => {
    if (!canvas || !svg) return;
    const transform = `scale(${zoom})`;
    canvas.style.transform = transform;
    canvas.style.transformOrigin = '0 0';
    svg.style.transform = transform;
    svg.style.transformOrigin = '0 0';
};

window.layoutMap.initShelfAdjustZoom = (canvas, svg) => {
    if (!canvas || !svg) return;
    canvas.style.transformOrigin = '0 0';
    svg.style.transformOrigin = '0 0';
};