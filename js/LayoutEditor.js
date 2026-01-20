// ========================================================================================
// LayoutEditor.js
// Warehouse layout SVG editor (Pan, Zoom, Drag & Drop, Drawing)
// Refactored for performance and maintainability
// ========================================================================================

window.layoutMap = window.layoutMap || {};

// ========================================================================================
// 🛠️ 共通ユーティリティ (Utilities)
// ========================================================================================
window.layoutMap.utils = {
    // 座標変換 (Client -> SVG World)
    getSvgCoords: (svg, clientX, clientY) => {
        if (!svg) return null;
        try {
            const pt = svg.createSVGPoint();
            pt.x = clientX;
            pt.y = clientY;
            const ctm = svg.getScreenCTM();
            if (!ctm) return null;
            const svgPt = pt.matrixTransform(ctm.inverse());
            return { x: svgPt.x, y: svgPt.y };
        } catch (e) {
            console.error('Coordinate transform error:', e);
            return null;
        }
    },

    // イベントターゲットからデータ要素を探す (bubble up)
    findElement: (target, rootSvg) => {
        let element = target;
        let depth = 0;
        while (element && element !== rootSvg && depth < 10) {
            if (element.tagName === 'g' && element.hasAttribute('data-element-type')) {
                return element;
            }
            element = element.parentElement;
            depth++;
        }
        return null;
    },

    // 要素タイプごとの設定 (C#メソッド名マッピング)
    typeConfig: {
        'shelf': {
            select: 'SelectShelf',
            toggle: 'ToggleShelfSelection',
            getIds: 'GetSelectedShelfIds',
            getCoords: 'GetShelfCoords',
            dragStart: 'OnShelfDragStart',
            updateFinal: 'UpdateShelfCoordsBatchFinal', // Batchで統一
            updateSingleFinal: 'UpdateShelfCoordsFinal', // ESC用
            getAllIds: 'GetAllShelfIds',
            addToSelection: 'AddToSelection'
        },
        'obstacle': {
            select: 'SelectObstacle',
            toggle: 'ToggleObstacleSelection',
            getIds: 'GetSelectedObstacleIds',
            getCoords: 'GetObstacleCoords',
            dragStart: 'OnObstacleDragStart',
            updateFinal: 'UpdateObstacleCoordsBatchFinal',
            updateSingleFinal: 'UpdateObstacleCoordsFinal',
            getAllIds: 'GetAllObstacleIds',
            addToSelection: 'AddObstaclesToSelection'
        },
        'column': {
            select: 'SelectColumn',
            toggle: 'ToggleColumnSelection',
            getIds: 'GetSelectedColumnIds',
            getCoords: 'GetColumnCoords',
            dragStart: 'OnColumnDragStart',
            updateFinal: 'UpdateColumnCoordsBatchFinal',   // Batch 업데이트 메서드
            updateSingleFinal: 'UpdateColumnCoordsFinal',  // ESC 취소용 단일 업데이트
            getAllIds: 'GetAllColumnIds',
            addToSelection: 'AddColumnsToSelection'
        },
        'startArea': {
            select: 'SelectStartArea',
            toggle: 'SelectStartArea',
            getIds: 'GetSelectedStartAreaId',
            getCoords: 'GetStartAreaCoords',
            dragStart: 'OnStartAreaDragStart',
            updateFinal: 'UpdateStartAreaCoordsBatchFinal',
            updateSingleFinal: 'UpdateStartAreaCoordsFinal'
        },
        'endArea': {
            select: 'SelectEndArea',
            toggle: 'SelectEndArea',
            getIds: 'GetSelectedEndAreaId',
            getCoords: 'GetEndAreaCoords',
            dragStart: 'OnEndAreaDragStart',
            updateFinal: 'UpdateEndAreaCoordsBatchFinal',
            updateSingleFinal: 'UpdateEndAreaCoordsFinal'
        },
        'aisle': {
            select: 'SelectAisle',
            toggle: 'SelectAisle',
            getIds: 'GetSelectedAisleId'
        }
    }
};

// ========================================================================================
// 🔍 Pan & Zoom
// ========================================================================================
window.layoutMap.enablePan = (svg, dotnetHelper) => {
    if (!svg) return;

    // クリーンアップ
    if (svg.__panHandlers) {
        svg.removeEventListener("mousedown", svg.__panHandlers.mousedown);
        window.removeEventListener("mousemove", svg.__panHandlers.mousemove);
        window.removeEventListener("mouseup", svg.__panHandlers.mouseup);
        window.removeEventListener("mouseleave", svg.__panHandlers.mouseleave);
        svg.removeEventListener("wheel", svg.__panHandlers.wheel);
    }

    const vb = svg.viewBox.baseVal;
    const baseWidth = vb.width;
    const baseHeight = vb.height;

    let zoom = 1.0;
    const minZoom = 0.2;
    const maxZoom = 5.0;

    let isPanning = false;
    let startX = 0, startY = 0;
    let originX = vb.x, originY = vb.y;
    let panEnabled = true;

    const applyZoom = (newZoom, notifyDotNet = true) => {
        newZoom = Math.max(minZoom, Math.min(maxZoom, newZoom));
        const centerX = vb.x + vb.width / 2;
        const centerY = vb.y + vb.height / 2;
        const newW = baseWidth / newZoom;
        const newH = baseHeight / newZoom;

        vb.width = newW;
        vb.height = newH;
        vb.x = centerX - newW / 2;
        vb.y = centerY - newH / 2;
        zoom = newZoom;

        if (notifyDotNet && dotnetHelper) dotnetHelper.invokeMethodAsync('OnZoomChanged', zoom);
        if (window.layoutRenderer) window.layoutRenderer.updateViewport(vb.x, vb.y, vb.width, vb.height);
        updateViewportBounds();
    };

    const updateViewportBounds = () => {
        if (dotnetHelper) {
            dotnetHelper.invokeMethodAsync('OnViewportChanged', vb.x, vb.y, vb.x + vb.width, vb.y + vb.height);

            // ★ [追加] 現在のViewBox(Layout座標)とZoom倍率をC#に送信
            // これがないと定規(Ruler)が追従しない
            dotnetHelper.invokeMethodAsync('UpdateViewOffset', vb.x, vb.y, zoom);
        }
    };

    const onMouseDown = (e) => {
        if (e.button !== 0 || !panEnabled || e.shiftKey) return;
        isPanning = true;
        svg.style.cursor = "grabbing";
        startX = e.clientX;
        startY = e.clientY;
        originX = vb.x;
        originY = vb.y;
    };

    const onMouseMove = (e) => {
        if (!isPanning || !panEnabled) return;
        const scaleX = vb.width / svg.clientWidth;
        const scaleY = vb.height / svg.clientHeight;
        const dxPx = e.clientX - startX;
        const dyPx = e.clientY - startY;

        vb.x = originX - dxPx * scaleX;
        vb.y = originY - dyPx * scaleY;

        if (window.layoutRenderer) window.layoutRenderer.updateViewport(vb.x, vb.y, vb.width, vb.height);
        updateViewportBounds();
    };

    const onMouseUp = () => {
        if (isPanning) updateViewportBounds();
        isPanning = false;
        if (panEnabled) svg.style.cursor = "grab";
    };

    const onWheel = (e) => {
        e.preventDefault();
        const factor = 1.1;
        let newZoom = zoom * (e.deltaY < 0 ? factor : 1 / factor);
        applyZoom(newZoom, true);
    };

    svg.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mouseleave", onMouseUp);
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.style.cursor = "grab";

    // 外部API公開
    svg.__applyZoom = applyZoom;
    svg.__setPanEnabled = (enabled) => {
        panEnabled = enabled;
        if (!enabled && isPanning) isPanning = false;
        svg.style.cursor = enabled ? "grab" : "";
    };
    svg.__resetPanState = () => {
        isPanning = false;
        if (panEnabled) svg.style.cursor = "grab";
    };

    svg.__panHandlers = { mousedown: onMouseDown, mousemove: onMouseMove, mouseup: onMouseUp, mouseleave: onMouseUp, wheel: onWheel };
    updateViewportBounds();
};

window.layoutMap.panToPosition = (svg, layoutX, layoutY) => {
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    vb.x = layoutX - vb.width / 2;
    vb.y = layoutY - vb.height / 2;
    if (window.layoutRenderer) window.layoutRenderer.updateViewport(vb.x, vb.y, vb.width, vb.height);
};

window.layoutMap.setPanEnabled = (svg, enabled) => svg && svg.__setPanEnabled && svg.__setPanEnabled(enabled);
window.layoutMap.setZoom = (svg, zoom) => svg && svg.__applyZoom && svg.__applyZoom(zoom, false);

// ========================================================================================
// ✏️ Object Drawing (Rectangle) - with Color per Type
// ========================================================================================
window.layoutMap.enableObjectDrawing = (svg, dotnetHelper, drawingMode) => { // ★ drawingMode 추가됨
    if (!svg) return;

    if (svg.__objectDrawingHandlers) window.layoutMap.disableObjectDrawing(svg);

    // ★ [핵심] 모드별 색상 정의 (Color Configuration)
    // AddingShelf, AddingObstacle, AddingColumn 등 C#의 enum 이름과 맞춰준다.
    const modeColors = {
        'AddingShelf': { stroke: '#2196f3', fill: 'rgba(33, 150, 243, 0.2)' },
        'AddingObstacle': { stroke: '#ff5722', fill: 'rgba(255, 87, 34, 0.2)' },
        'AddingColumn': { stroke: '#795548', fill: 'rgba(121, 85, 72, 0.2)' },
        'AddingStartArea': { stroke: '#4caf50', fill: 'rgba(76, 175, 80, 0.2)' }, // Green (시작)
        'AddingEndArea': { stroke: '#f44336', fill: 'rgba(244, 67, 54, 0.2)' },   // Red (종료)
        'default': { stroke: '#2196f3', fill: 'rgba(33, 150, 243, 0.2)' }
    };

    // 현재 모드에 맞는 색상 가져오기 (없으면 기본값)
    const activeColor = modeColors[drawingMode] || modeColors['default'];

    let isDrawing = false;
    let startPoint = null;
    let ghostRect = null;

    const getStrokeStyle = () => {
        const ctm = svg.getScreenCTM();
        const scale = ctm ? ctm.a : 1;
        const pixelSize = 1 / scale;

        return {
            width: pixelSize * 2,
            dash: pixelSize * 5,
            gap: pixelSize * 3
        };
    };

    const onMouseDown = (e) => {
        if (e.button !== 0) return;

        const coords = window.layoutMap.utils.getSvgCoords(svg, e.clientX, e.clientY);
        if (!coords) return;

        isDrawing = true;
        startPoint = coords;

        ghostRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        ghostRect.setAttribute('x', coords.x);
        ghostRect.setAttribute('y', coords.y);
        ghostRect.setAttribute('width', 0);
        ghostRect.setAttribute('height', 0);

        // ★ [핵심] 위에서 가져온 activeColor를 적용
        ghostRect.setAttribute('fill', activeColor.fill);     // 모드별 채우기 색
        ghostRect.setAttribute('stroke', activeColor.stroke); // 모드별 테두리 색

        const style = getStrokeStyle();
        ghostRect.setAttribute('stroke-width', style.width);

        // 점선 및 애니메이션 (이전 로직 유지)
        const dashArray = `${style.dash} ${style.gap}`;
        ghostRect.setAttribute('stroke-dasharray', dashArray);
        ghostRect.setAttribute('stroke-linecap', 'butt');
        ghostRect.style.pointerEvents = 'none';

        const anim = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
        anim.setAttribute('attributeName', 'stroke-dashoffset');
        anim.setAttribute('from', style.dash + style.gap);
        anim.setAttribute('to', '0');
        anim.setAttribute('dur', '0.5s');
        anim.setAttribute('repeatCount', 'indefinite');

        ghostRect.appendChild(anim);
        svg.appendChild(ghostRect);

        document.body.style.userSelect = 'none';
        if (svg.__setPanEnabled) svg.__setPanEnabled(false);

        e.preventDefault();
        e.stopPropagation();
    };

    // ... onMouseMove, onMouseUp 등 나머지 코드는 기존과 동일 ...
    const onMouseMove = (e) => {
        if (!isDrawing || !ghostRect || !startPoint) return;
        const coords = window.layoutMap.utils.getSvgCoords(svg, e.clientX, e.clientY);
        if (!coords) return;
        const x = Math.min(startPoint.x, coords.x);
        const y = Math.min(startPoint.y, coords.y);
        const width = Math.abs(coords.x - startPoint.x);
        const height = Math.abs(coords.y - startPoint.y);
        ghostRect.setAttribute('x', x);
        ghostRect.setAttribute('y', y);
        ghostRect.setAttribute('width', width);
        ghostRect.setAttribute('height', height);
    };

    const onMouseUp = async (e) => {
        if (!isDrawing) return;
        isDrawing = false;
        if (ghostRect) {
            ghostRect.remove();
            const coords = window.layoutMap.utils.getSvgCoords(svg, e.clientX, e.clientY);
            if (coords && startPoint) {
                const x = Math.min(startPoint.x, coords.x);
                const y = Math.min(startPoint.y, coords.y);
                const width = Math.abs(coords.x - startPoint.x);
                const height = Math.abs(coords.y - startPoint.y);
                const style = getStrokeStyle();
                if (width > style.width * 2 || height > style.width * 2) {
                    await dotnetHelper.invokeMethodAsync('OnObjectDrawn',
                        Math.round(x), Math.round(y), Math.round(width), Math.round(height));
                }
            }
            ghostRect = null;
        }
        startPoint = null;
        document.body.style.userSelect = '';
        if (svg.__setPanEnabled) svg.__setPanEnabled(true);
    };

    svg.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    svg.__objectDrawingHandlers = { mousedown: onMouseDown, mousemove: onMouseMove, mouseup: onMouseUp };
};

// 해제 함수 (기존과 동일하지만 짝을 맞춰둠)
window.layoutMap.disableObjectDrawing = (svg) => {
    if (!svg || !svg.__objectDrawingHandlers) return;
    const h = svg.__objectDrawingHandlers;

    svg.removeEventListener('mousedown', h.mousedown);
    window.removeEventListener('mousemove', h.mousemove);
    window.removeEventListener('mouseup', h.mouseup);

    delete svg.__objectDrawingHandlers;
};

// ========================================================================================
// ✋ Drag & Drop / Selection (Refactored & Fixed)
// ========================================================================================
window.layoutMap.enableShelfDragging = (svg, dotnetHelper, snapGridSize, snapEnabled) => {
    if (!svg) return;
    if (svg.__shelfDraggingHandlers) window.layoutMap.disableShelfDragging(svg);

    // State
    let isDragging = false;
    let draggedElementIds = [];
    let draggedElementType = null;
    let dragStartPoint = null;
    let elementsOriginalCoords = new Map();

    // Box Selection State
    let isBoxSelecting = false;
    let boxSelectStart = null;
    let selectionBox = null; // 選択範囲を表示するSVG要素

    // Mouse State
    let mouseDownPos = null;
    let mouseMoved = false;
    const CLICK_THRESHOLD = 5;
    let previewUpdatePending = false;
    let previewAnimationFrame = null;

    const Utils = window.layoutMap.utils;
    const Config = Utils.typeConfig;

    // ----------------------------------------------------------------------
    // 🛠️ Internal Helpers
    // ----------------------------------------------------------------------

    // ドラッグ・選択状態のリセット
    const resetDragState = () => {
        if (previewAnimationFrame) cancelAnimationFrame(previewAnimationFrame);

        // スタイルの復元
        draggedElementIds.forEach(id => {
            if (!draggedElementType) return;
            const selector = draggedElementType === 'shelf' ?
                `g[data-shelf-id="${id}"]` :
                `g[data-element-type="${draggedElementType}"][data-element-id="${id}"]`;
            const el = svg.querySelector(selector);
            if (el) {
                el.style.opacity = '';
                el.style.cursor = '';
            }
        });

        isDragging = false;
        draggedElementIds = [];
        dragStartPoint = null;
        elementsOriginalCoords.clear();
        draggedElementType = null;
        previewUpdatePending = false;

        document.body.style.userSelect = '';
        if (svg.__setPanEnabled) svg.__setPanEnabled(true);
        if (svg.__resetPanState) svg.__resetPanState();

        // C#側の状態もリセット
        dotnetHelper.invokeMethodAsync('ResetDragState');
    };

    // 選択範囲ボックスの描画更新
    const updateSelectionBox = (currentCoords) => {
        if (!selectionBox || !boxSelectStart) return;

        const x = Math.min(boxSelectStart.x, currentCoords.x);
        const y = Math.min(boxSelectStart.y, currentCoords.y);
        const width = Math.abs(currentCoords.x - boxSelectStart.x);
        const height = Math.abs(currentCoords.y - boxSelectStart.y);

        selectionBox.setAttribute('x', x);
        selectionBox.setAttribute('y', y);
        selectionBox.setAttribute('width', width);
        selectionBox.setAttribute('height', height);
    };

    // ----------------------------------------------------------------------
    // 🖱️ Event Handlers
    // ----------------------------------------------------------------------

    const onMouseDown = async (e) => {
        if (e.button !== 0) return;

        mouseDownPos = { x: e.clientX, y: e.clientY };
        mouseMoved = false;

        if (isDragging) return;

        const coords = Utils.getSvgCoords(svg, e.clientX, e.clientY);
        if (!coords) return;

        const element = Utils.findElement(e.target, svg);

        // 1. 要素をクリックした場合 (Drag準備 or Toggle)
        if (element) {
            const elementType = element.getAttribute('data-element-type');
            const elementId = parseInt(element.getAttribute('data-element-id'));
            const cfg = Config[elementType];

            if (!cfg) return;

            // Shift+Click (Toggle)
            if (e.shiftKey) {
                console.log(`[Shift+Click] Toggling ${elementType} ID: ${elementId}`); // 디버깅용 로그

                e.preventDefault();
                e.stopPropagation();
                await dotnetHelper.invokeMethodAsync(cfg.toggle, elementId);
                return;
            }

            // Drag開始準備
            try {
                // 既に選択されているかチェック
                const selectedIds = await dotnetHelper.invokeMethodAsync(cfg.getIds);

                if (selectedIds && selectedIds.includes(elementId)) {
                    draggedElementIds = selectedIds;
                } else {
                    await dotnetHelper.invokeMethodAsync(cfg.select, elementId, false);
                    draggedElementIds = [elementId];
                }

                draggedElementType = elementType;
                elementsOriginalCoords.clear();

                // 選択された全要素の座標を取得
                for (const id of draggedElementIds) {
                    const data = await dotnetHelper.invokeMethodAsync(cfg.getCoords, id);
                    if (data) elementsOriginalCoords.set(id, data.coords);
                }

                dragStartPoint = coords;
                if (svg.__setPanEnabled) svg.__setPanEnabled(false);
                document.body.style.userSelect = 'none';

                e.preventDefault();
                e.stopPropagation();
            } catch (err) {
                console.error('Drag init error:', err);
                resetDragState();
            }
        }
        else {
            // 🔥 ここが修正ポイント (여기가 수정 포인트)
            // Shiftキーが押されていても、まずは「そこに何かあるか？」をC#に聞く
            // Shift가 눌려있든 말든, 일단 "거기 뭐 있냐?"고 C#에 물어본다.

            let hitFound = false;
            try {
                // Hit Test 실행 (Shift 여부도 같이 보냄)
                hitFound = await dotnetHelper.invokeMethodAsync('TrySelectElementAt', coords.x, coords.y, e.shiftKey);

            } catch (err) {
                console.error('Hit test error:', err);
            }

            // A. 何かヒットした場合 (뭔가 잡혔다!)
            if (hitFound) {
                // C#側で選択・トグル処理が終わっているので、ここで止める
                // Canvas요소라도 여기서 잡히면 박스 선택으로 넘어가지 않음
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            // B. 何もヒットせず、かつShiftキーの場合 -> Box Selection (아무것도 없고 + Shift -> 박스 선택)
            if (e.shiftKey) {
                isBoxSelecting = true;
                boxSelectStart = coords;
                if (svg.__setPanEnabled) svg.__setPanEnabled(false);

                // [Box作成]
                selectionBox = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                selectionBox.setAttribute('x', coords.x);
                selectionBox.setAttribute('y', coords.y);
                selectionBox.setAttribute('width', 0);
                selectionBox.setAttribute('height', 0);

                // Style
                selectionBox.setAttribute('fill', 'rgba(0, 120, 215, 0.2)');
                selectionBox.setAttribute('stroke', '#0078D7');
                selectionBox.setAttribute('stroke-width', '1');
                selectionBox.setAttribute('stroke-dasharray', '4 2');
                selectionBox.style.pointerEvents = 'none';

                svg.appendChild(selectionBox);

                e.preventDefault(); e.stopPropagation();
            }

            // C. 何もヒットせず、Shiftもない -> Pan (그냥 배경 클릭)
            else {
                // 何もしない（Pan動作に任せる）
            }
        }
    };

    const onMouseMove = async (e) => {
        if (mouseDownPos) {
            if (Math.abs(e.clientX - mouseDownPos.x) > CLICK_THRESHOLD ||
                Math.abs(e.clientY - mouseDownPos.y) > CLICK_THRESHOLD) {
                mouseMoved = true;
            }
        }

        const coords = Utils.getSvgCoords(svg, e.clientX, e.clientY);
        if (!coords) return;

        // A. ドラッグ処理
        if (!isDragging && dragStartPoint && elementsOriginalCoords.size > 0 && mouseMoved) {
            isDragging = true;
            const cfg = Config[draggedElementType];
            if (cfg && draggedElementIds.length > 0) {
                dotnetHelper.invokeMethodAsync(cfg.dragStart, draggedElementIds[0]);
            }

            draggedElementIds.forEach(id => {
                const selector = draggedElementType === 'shelf' ?
                    `g[data-shelf-id="${id}"]` :
                    `g[data-element-type="${draggedElementType}"][data-element-id="${id}"]`;
                const el = svg.querySelector(selector);
                if (el) { el.style.opacity = '0.7'; el.style.cursor = 'move'; }
            });
        }

        if (isDragging && dragStartPoint) {
            let dx = coords.x - dragStartPoint.x;
            let dy = coords.y - dragStartPoint.y;

            if (!previewUpdatePending) {
                previewUpdatePending = true;
                previewAnimationFrame = requestAnimationFrame(() => {
                    for (const [elemId, originalCoords] of elementsOriginalCoords) {
                        const selector = draggedElementType === 'shelf' ?
                            `g[data-shelf-id="${elemId}"] rect` :
                            `g[data-element-type="${draggedElementType}"][data-element-id="${elemId}"] rect`;
                        const rectEl = svg.querySelector(selector);

                        if (rectEl && originalCoords.length > 0) {
                            // 기준 위치 (원래 위치 + 마우스 이동량)
                            let targetX = originalCoords[0].x + dx;
                            let targetY = originalCoords[0].y + dy;

                            // ★ [SNAP LOGIC] JS에서 실시간 스냅 적용
                            // Edge 스냅은 복잡해서 패스하더라도, Grid 스냅은 여기서 해줘야 "딱딱" 붙는 느낌이 남
                            if (snapEnabled && snapGridSize > 0) {
                                targetX = Math.round(targetX / snapGridSize) * snapGridSize;
                                targetY = Math.round(targetY / snapGridSize) * snapGridSize;
                            }

                            rectEl.setAttribute('x', targetX);
                            rectEl.setAttribute('y', targetY);
                        }
                    }
                    previewUpdatePending = false;
                });
            }
            e.preventDefault(); e.stopPropagation();
        }
        // B. ボックス選択中の更新
        else if (isBoxSelecting && boxSelectStart) {
            updateSelectionBox(coords); // [ここでBoxサイズ更新]
            e.preventDefault(); e.stopPropagation();
        }
    };

    const onMouseUp = async (e) => {
        const coords = Utils.getSvgCoords(svg, e.clientX, e.clientY);

        // 1. ドラッグ終了 (確定)
        if (isDragging && coords && dragStartPoint) {
            const dx = Math.round(coords.x - dragStartPoint.x);
            const dy = Math.round(coords.y - dragStartPoint.y);
            const cfg = Config[draggedElementType];

            // 1. C#에 보낼 데이터를 미리 준비 (변수에 담아둠)
            let batchUpdates = null;
            if ((dx !== 0 || dy !== 0) && cfg) {
                batchUpdates = [];
                for (const [elemId, originalCoords] of elementsOriginalCoords) {
                    const newCoords = originalCoords.map(p => ({ x: p.x + dx, y: p.y + dy }));
                    batchUpdates.push({ id: elemId, coords: newCoords });
                }
            }

            // 2. ★ [핵심] C# 응답 기다리지 말고, 즉시 드래그 상태 강제 종료!
            // 이걸 먼저 해야 await 하는 동안 마우스 움직여도 반응 안 함
            resetDragState();

            // 3. 이제 느긋하게 C#으로 데이터 전송
            if (batchUpdates && cfg) {
                await dotnetHelper.invokeMethodAsync(cfg.updateFinal, batchUpdates);
            }

            e.preventDefault(); e.stopPropagation();
        }
        // 2. ドラッグ準備のみで移動せず (クリック扱い)
        else if (dragStartPoint && !mouseMoved) {
            dragStartPoint = null;
            elementsOriginalCoords.clear();
            draggedElementIds = [];
            draggedElementType = null;
            if (svg.__setPanEnabled) svg.__setPanEnabled(true);
            document.body.style.userSelect = '';
        }
        // 3. ボックス選択終了 (ここで選択判定を実行)
        else if (isBoxSelecting && boxSelectStart && coords) {
            // 박스 선택 로직 (기존과 동일)
            const rect = {
                x: Math.min(boxSelectStart.x, coords.x),
                y: Math.min(boxSelectStart.y, coords.y),
                width: Math.abs(coords.x - boxSelectStart.x),
                height: Math.abs(coords.y - boxSelectStart.y)
            };

            try {
                await dotnetHelper.invokeMethodAsync('SelectElementsInRect',
                    rect.x, rect.y, rect.width, rect.height, e.shiftKey);
            } catch (err) {
                console.error('Box selection error:', err);
            }

            if (selectionBox) { selectionBox.remove(); selectionBox = null; }
            isBoxSelecting = false;
            if (svg.__setPanEnabled) svg.__setPanEnabled(true);
            e.preventDefault(); e.stopPropagation();
        }
        // 4. 背景クリック (選択解除)
        else if (mouseDownPos && !mouseMoved && !e.shiftKey && !Utils.findElement(e.target, svg)) {
            try {
                await dotnetHelper.invokeMethodAsync('ClearSelection');
            } catch (err) { console.error(err); }
        }

        mouseDownPos = null;
        mouseMoved = false;
    };

    const onKeyDown = (e) => {
        if (e.key === 'Escape' && isDragging) {
            const cfg = Config[draggedElementType];
            if (cfg) {
                // 元の位置に戻す
                for (const [elemId, originalCoords] of elementsOriginalCoords) {
                    dotnetHelper.invokeMethodAsync(cfg.updateSingleFinal, elemId, originalCoords);
                }
            }
            resetDragState();
            dotnetHelper.invokeMethodAsync('OnEscapeKeyPressed');
            e.preventDefault(); e.stopPropagation();
        }
    };

    // イベント登録
    svg.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown, true);

    svg.__shelfDraggingHandlers = { mousedown: onMouseDown, mousemove: onMouseMove, mouseup: onMouseUp, keydown: onKeyDown };
};

window.layoutMap.disableShelfDragging = (svg) => {
    if (!svg || !svg.__shelfDraggingHandlers) return;
    const h = svg.__shelfDraggingHandlers;
    svg.removeEventListener('mousedown', h.mousedown);
    window.removeEventListener('mousemove', h.mousemove);
    window.removeEventListener('mouseup', h.mouseup);
    window.removeEventListener('keydown', h.keydown, true);
    delete svg.__shelfDraggingHandlers;
};

// ========================================================================================
// ⌨️ Keyboard Shortcuts
// ========================================================================================
window.layoutMap.enableKeyboardShortcuts = (dotnetHelper) => {
    if (window.__keyboardShortcutsHandler) window.layoutMap.disableKeyboardShortcuts();

    const onKeyDown = async (e) => {
        const key = e.key.toLowerCase();
        const normalized = key === 'esc' ? 'escape' : key;

        // C#メソッドマッピング
        const actions = {
            'escape': 'OnEscapeKeyPressed',
            'delete': 'OnDeleteKeyPressed',
            'arrow': 'OnArrowKeyPressed',
            'c': e.ctrlKey ? 'OnCopyKeyPressed' : null,
            'v': e.ctrlKey ? 'OnPasteKeyPressed' : null,
            'a': e.ctrlKey ? 'OnSelectAllKeyPressed' : null,
            'z': e.ctrlKey ? 'OnUndoKeyPressed' : null,
            'y': e.ctrlKey ? 'OnRedoKeyPressed' : null
        };

        if (key.startsWith('arrow')) {
            const dir = normalized.replace('arrow', '');
            await dotnetHelper.invokeMethodAsync('OnArrowKeyPressed', dir, e.shiftKey);
            e.preventDefault();
            return;
        }

        const action = actions[normalized];
        if (action) {
            await dotnetHelper.invokeMethodAsync(action);
            e.preventDefault();
        }
    };

    window.addEventListener('keydown', onKeyDown);
    window.__keyboardShortcutsHandler = onKeyDown;
};

window.layoutMap.disableKeyboardShortcuts = () => {
    if (window.__keyboardShortcutsHandler) {
        window.removeEventListener('keydown', window.__keyboardShortcutsHandler);
        delete window.__keyboardShortcutsHandler;
    }
};



// ========================================================================================
// 🧱 Wall Picker (Canvas上で壁を描画するツール)
// ========================================================================================
window.layoutMap.enableEditorWallPicker = (canvas) => {
    if (!canvas) {
        console.error('[WallPicker] Canvas element is null');
        return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        console.error('[WallPicker] Cannot get 2d context');
        return;
    }

    if (canvas.__wallPickerEnabled) {
        console.log('[WallPicker] Already enabled, skipping');
        return;
    }
    canvas.__wallPickerEnabled = true;
    console.log('[WallPicker] Initializing wall picker');

    const points = canvas.__wallPoints || [];
    canvas.__wallPoints = points;

    canvas.__wallFinished = false;

    const getPos = (e) => {
        // Canvas? bounding rect ????
        const canvasRect = canvas.getBoundingClientRect();

        console.log('[WallPicker:getPos] Canvas rect:', {
            left: canvasRect.left,
            top: canvasRect.top,
            width: canvasRect.width,
            height: canvasRect.height
        });

        // Canvas ?? ??? ?? (?? ??)
        const scaleX = canvas.width / canvasRect.width;
        const scaleY = canvas.height / canvasRect.height;

        console.log('[WallPicker:getPos] Canvas internal size:', {
            width: canvas.width,
            height: canvas.height,
            scaleX: scaleX,
            scaleY: scaleY
        });

        // Canvas ?? ?? ?? (0?? ??)
        const canvasX = (e.clientX - canvasRect.left) * scaleX;
        const canvasY = (e.clientY - canvasRect.top) * scaleY;

        console.log('[WallPicker:getPos] Mouse position:', {
            clientX: e.clientX,
            clientY: e.clientY,
            canvasX: canvasX,
            canvasY: canvasY
        });

        return {
            x: canvasX,
            y: canvasY
        };
    };

    // X/Y座標を既存ポイントにスナップする関数
    const snapToExistingPoints = (pos, snapThreshold = 20) => {
        let snappedX = pos.x;
        let snappedY = pos.y;

        // 既存の全ポイントをチェック
        for (let p of points) {
            // X座標が近い場合、その X にスナップ
            if (Math.abs(pos.x - p.x) < snapThreshold) {
                snappedX = p.x;
                console.log('[WallPicker:snap] Snapped X:', pos.x, '->', snappedX);
            }

            // Y座標が近い場合、その Y にスナップ
            if (Math.abs(pos.y - p.y) < snapThreshold) {
                snappedY = p.y;
                console.log('[WallPicker:snap] Snapped Y:', pos.y, '->', snappedY);
            }
        }

        return { x: snappedX, y: snappedY };
    };

    // 角度を5度単位にスナップする関数
    const snapAngleTo5Degrees = (x1, y1, x2, y2) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 1) {
            return { x: x2, y: y2 };
        }

        // 現在の角度を計算（ラジアン）
        let angle = Math.atan2(dy, dx);

        // 度数に変換
        let degrees = angle * 180 / Math.PI;

        // 5度単位に丸める
        const snapDegrees = Math.round(degrees / 5) * 5;

        console.log('[WallPicker:angleSnap] Angle:', degrees.toFixed(2), '-> Snapped:', snapDegrees);

        // ラジアンに戻す
        const snappedAngle = snapDegrees * Math.PI / 180;

        // スナップした角度で新しい座標を計算
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

        if (points.length > 2) {
            const first = points[0];
            const last = points[points.length - 1];

            ctx.beginPath();
            ctx.moveTo(last.x, last.y);
            ctx.lineTo(first.x, first.y);
            ctx.stroke();
        }

        console.log('[WallPicker:redraw] Drew', points.length, 'points');
    };

    const isNear = (p, q, threshold = 15) => {
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        return Math.sqrt(dx * dx + dy * dy) <= threshold;
    };

    const onMouseMove = (e) => {
        if (canvas.__wallFinished) {
            return;
        }
        if (points.length === 0) {
            return;
        }

        const pos = getPos(e);
        const last = points[points.length - 1];

        // まず既存ポイントにX/Yスナップ
        let snappedPos = snapToExistingPoints(pos);

        // 次に角度を5度単位にスナップ
        snappedPos = snapAngleTo5Degrees(last.x, last.y, snappedPos.x, snappedPos.y);

        redrawAll();

        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(snappedPos.x, snappedPos.y);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(150, 75, 0, 0.7)";
        ctx.stroke();

        // スナップしたポイントを示す小さな円を描画
        ctx.beginPath();
        ctx.arc(snappedPos.x, snappedPos.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 100, 0, 0.8)";
        ctx.fill();
    };

    const onMouseDown = (e) => {
        if (e.button !== 0) return;

        const pos = getPos(e);

        console.log('[WallPicker:mouseDown] Raw position:', pos);

        if (points.length >= 3 && isNear(pos, points[0])) {
            console.log('[WallPicker:mouseDown] Closing wall (near first point)');
            canvas.__wallFinished = true;

            redrawAll();

            const first = points[0];
            const last = points[points.length - 1];

            ctx.beginPath();
            ctx.moveTo(last.x, last.y);
            ctx.lineTo(first.x, first.y);
            ctx.lineWidth = 3;
            ctx.strokeStyle = "rgba(150, 75, 0, 0.8)";
            ctx.stroke();

            return;
        }

        // まず既存ポイントにX/Yスナップ
        let finalPos = snapToExistingPoints(pos);

        // 前のポイントがあれば角度をスナップ
        if (points.length > 0) {
            const last = points[points.length - 1];
            finalPos = snapAngleTo5Degrees(last.x, last.y, finalPos.x, finalPos.y);
        }

        console.log('[WallPicker:mouseDown] Adding point:', finalPos, '(total:', points.length + 1, ')');
        points.push(finalPos);

        redrawAll();
    };

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);

    console.log('[WallPicker] Event listeners attached');
};

// 壁のポイントを取得する関数
window.layoutMap.getEditorWallPoints = (canvas) => {
    if (!canvas || !canvas.__wallPoints) {
        console.warn('[WallPicker:getPoints] No points available');
        return [];
    }
    console.log('[WallPicker:getPoints] Returning', canvas.__wallPoints.length, 'points:', canvas.__wallPoints);
    return canvas.__wallPoints;
};

// 壁ピッカーを無効化する関数
window.layoutMap.clearEditorWallPoints = (canvas) => {
    if (!canvas) {
        return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
        return;
    }

    if (canvas.__wallPoints) {
        console.log('[WallPicker:clear] Clearing', canvas.__wallPoints.length, 'points');
        canvas.__wallPoints.length = 0;
    }

    canvas.__wallFinished = false;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    console.log('[WallPicker:clear] Canvas cleared');
};

// LayoutEditor.js 상단 혹은 적절한 위치에 추가
window.layoutMap.initAutoResizer = (element, dotnetHelper) => {
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            const { width, height } = entry.contentRect;
            dotnetHelper.invokeMethodAsync('OnContainerResize', width, height);
        }
    });
    resizeObserver.observe(element);
    element.__resizeObserver = resizeObserver;
};

window.layoutMap.disposeAutoResizer = (element) => {
    if (element && element.__resizeObserver) {
        element.__resizeObserver.disconnect();
        delete element.__resizeObserver;
    }
};