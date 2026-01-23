// ========================================================================================
// LayoutEditor.js
// Warehouse layout SVG editor (Pan, Zoom, Drag & Drop, Drawing)
// Refactored for performance, maintainability, and precise shortcut control
// ========================================================================================

// 전역 상태: 마우스가 지도(SVG) 영역 위에 있는지 여부
let isMouseOverMap = false;

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
            updateFinal: 'UpdateShelfCoordsBatchFinal',
            updateSingleFinal: 'UpdateShelfCoordsFinal',
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
            updateFinal: 'UpdateColumnCoordsBatchFinal',
            updateSingleFinal: 'UpdateColumnCoordsFinal',
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

    // 클린업 및 마우스 오버 이벤트 등록
    if (svg.__panHandlers) {
        svg.removeEventListener("mousedown", svg.__panHandlers.mousedown);
        svg.removeEventListener("mouseenter", svg.__panHandlers.mouseenter);
        svg.removeEventListener("mouseleave", svg.__panHandlers.mouseleave);
        window.removeEventListener("mousemove", svg.__panHandlers.mousemove);
        window.removeEventListener("mouseup", svg.__panHandlers.mouseup);
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

    const onMouseEnter = () => { isMouseOverMap = true; };
    const onMouseLeave = () => { isMouseOverMap = false; };

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
    svg.addEventListener("mouseenter", onMouseEnter);
    svg.addEventListener("mouseleave", onMouseLeave);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.style.cursor = "grab";

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

    svg.__panHandlers = { mousedown: onMouseDown, mouseenter: onMouseEnter, mouseleave: onMouseLeave, mousemove: onMouseMove, mouseup: onMouseUp, wheel: onWheel };
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
// ✏️ Object Drawing (Rectangle)
// ========================================================================================
window.layoutMap.enableObjectDrawing = (svg, dotnetHelper, drawingMode) => {
    if (!svg) return;
    if (svg.__objectDrawingHandlers) window.layoutMap.disableObjectDrawing(svg);

    const modeColors = {
        'AddingShelf': { stroke: '#2196f3', fill: 'rgba(33, 150, 243, 0.2)' },
        'AddingObstacle': { stroke: '#ff5722', fill: 'rgba(255, 87, 34, 0.2)' },
        'AddingColumn': { stroke: '#795548', fill: 'rgba(121, 85, 72, 0.2)' },
        'AddingStartArea': { stroke: '#4caf50', fill: 'rgba(76, 175, 80, 0.2)' },
        'AddingEndArea': { stroke: '#f44336', fill: 'rgba(244, 67, 54, 0.2)' },
        'default': { stroke: '#2196f3', fill: 'rgba(33, 150, 243, 0.2)' }
    };

    const activeColor = modeColors[drawingMode] || modeColors['default'];
    let isDrawing = false;
    let startPoint = null;
    let ghostRect = null;

    const getStrokeStyle = () => {
        const ctm = svg.getScreenCTM();
        const scale = ctm ? ctm.a : 1;
        const pixelSize = 1 / scale;
        return { width: pixelSize * 2, dash: pixelSize * 5, gap: pixelSize * 3 };
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
        ghostRect.setAttribute('fill', activeColor.fill);
        ghostRect.setAttribute('stroke', activeColor.stroke);

        const style = getStrokeStyle();
        ghostRect.setAttribute('stroke-width', style.width);
        ghostRect.setAttribute('stroke-dasharray', `${style.dash} ${style.gap}`);
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
        e.preventDefault(); e.stopPropagation();
    };

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
                    await dotnetHelper.invokeMethodAsync('OnObjectDrawn', Math.round(x), Math.round(y), Math.round(width), Math.round(height));
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

window.layoutMap.disableObjectDrawing = (svg) => {
    if (!svg || !svg.__objectDrawingHandlers) return;
    const h = svg.__objectDrawingHandlers;
    svg.removeEventListener('mousedown', h.mousedown);
    window.removeEventListener('mousemove', h.mousemove);
    window.removeEventListener('mouseup', h.mouseup);
    delete svg.__objectDrawingHandlers;
};

// ========================================================================================
// ✋ Drag & Drop / Selection
// ========================================================================================
window.layoutMap.enableShelfDragging = (svg, dotnetHelper, snapGridSize, snapEnabled) => {
    if (!svg) return;
    if (svg.__shelfDraggingHandlers) window.layoutMap.disableShelfDragging(svg);

    let isDragging = false;
    let draggedElementIds = [];
    let draggedElementType = null;
    let dragStartPoint = null;
    let elementsOriginalCoords = new Map();
    let isBoxSelecting = false;
    let boxSelectStart = null;
    let selectionBox = null;
    let mouseDownPos = null;
    let mouseMoved = false;
    const CLICK_THRESHOLD = 5;
    let previewUpdatePending = false;
    let previewAnimationFrame = null;

    const Utils = window.layoutMap.utils;
    const Config = Utils.typeConfig;

    const resetDragState = () => {
        if (previewAnimationFrame) cancelAnimationFrame(previewAnimationFrame);
        draggedElementIds.forEach(id => {
            if (!draggedElementType) return;
            const selector = draggedElementType === 'shelf' ? `g[data-shelf-id="${id}"]` : `g[data-element-type="${draggedElementType}"][data-element-id="${id}"]`;
            const el = svg.querySelector(selector);
            if (el) { el.style.opacity = ''; el.style.cursor = ''; }
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
        dotnetHelper.invokeMethodAsync('ResetDragState');
    };

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

    const onMouseDown = async (e) => {
        if (e.button !== 0) return;
        mouseDownPos = { x: e.clientX, y: e.clientY };
        mouseMoved = false;
        if (isDragging) return;

        const coords = Utils.getSvgCoords(svg, e.clientX, e.clientY);
        if (!coords) return;
        const element = Utils.findElement(e.target, svg);

        if (element) {
            const elementType = element.getAttribute('data-element-type');
            const elementId = parseInt(element.getAttribute('data-element-id'));
            const cfg = Config[elementType];
            if (!cfg) return;

            if (e.shiftKey) {
                e.preventDefault(); e.stopPropagation();
                await dotnetHelper.invokeMethodAsync(cfg.toggle, elementId);
                return;
            }

            try {
                const selectedIds = await dotnetHelper.invokeMethodAsync(cfg.getIds);
                draggedElementIds = (selectedIds && selectedIds.includes(elementId)) ? selectedIds : [elementId];
                if (!selectedIds || !selectedIds.includes(elementId)) await dotnetHelper.invokeMethodAsync(cfg.select, elementId, false);

                draggedElementType = elementType;
                elementsOriginalCoords.clear();
                for (const id of draggedElementIds) {
                    const data = await dotnetHelper.invokeMethodAsync(cfg.getCoords, id);
                    if (data) elementsOriginalCoords.set(id, data.coords);
                }
                dragStartPoint = coords;
                if (svg.__setPanEnabled) svg.__setPanEnabled(false);
                document.body.style.userSelect = 'none';
                e.preventDefault(); e.stopPropagation();
            } catch (err) { resetDragState(); }
        } else {
            let hitFound = false;
            try { hitFound = await dotnetHelper.invokeMethodAsync('TrySelectElementAt', coords.x, coords.y, e.shiftKey); } catch (err) { }
            if (hitFound) { e.preventDefault(); e.stopPropagation(); return; }

            if (e.shiftKey) {
                isBoxSelecting = true;
                boxSelectStart = coords;
                if (svg.__setPanEnabled) svg.__setPanEnabled(false);
                selectionBox = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                selectionBox.setAttribute('fill', 'rgba(0, 120, 215, 0.2)');
                selectionBox.setAttribute('stroke', '#0078D7');
                selectionBox.setAttribute('stroke-width', '1');
                selectionBox.setAttribute('stroke-dasharray', '4 2');
                selectionBox.style.pointerEvents = 'none';
                svg.appendChild(selectionBox);
                e.preventDefault(); e.stopPropagation();
            }
        }
    };

    const onMouseMove = async (e) => {
        if (mouseDownPos && (Math.abs(e.clientX - mouseDownPos.x) > CLICK_THRESHOLD || Math.abs(e.clientY - mouseDownPos.y) > CLICK_THRESHOLD)) mouseMoved = true;
        const coords = Utils.getSvgCoords(svg, e.clientX, e.clientY);
        if (!coords) return;

        if (!isDragging && dragStartPoint && elementsOriginalCoords.size > 0 && mouseMoved) {
            isDragging = true;
            const cfg = Config[draggedElementType];
            if (cfg && draggedElementIds.length > 0) dotnetHelper.invokeMethodAsync(cfg.dragStart, draggedElementIds[0]);
            draggedElementIds.forEach(id => {
                const selector = draggedElementType === 'shelf' ? `g[data-shelf-id="${id}"]` : `g[data-element-type="${draggedElementType}"][data-element-id="${id}"]`;
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
                        const selector = draggedElementType === 'shelf' ? `g[data-shelf-id="${elemId}"] rect` : `g[data-element-type="${draggedElementType}"][data-element-id="${elemId}"] rect`;
                        const rectEl = svg.querySelector(selector);
                        if (rectEl && originalCoords.length > 0) {
                            let tx = originalCoords[0].x + dx, ty = originalCoords[0].y + dy;
                            if (snapEnabled && snapGridSize > 0) { tx = Math.round(tx / snapGridSize) * snapGridSize; ty = Math.round(ty / snapGridSize) * snapGridSize; }
                            rectEl.setAttribute('x', tx); rectEl.setAttribute('y', ty);
                        }
                    }
                    previewUpdatePending = false;
                });
            }
            e.preventDefault(); e.stopPropagation();
        } else if (isBoxSelecting && boxSelectStart) {
            updateSelectionBox(coords);
            e.preventDefault(); e.stopPropagation();
        }
    };

    const onMouseUp = async (e) => {
        const coords = Utils.getSvgCoords(svg, e.clientX, e.clientY);
        if (isDragging && coords && dragStartPoint) {
            const dx = Math.round(coords.x - dragStartPoint.x), dy = Math.round(coords.y - dragStartPoint.y), cfg = Config[draggedElementType];
            let updates = null;
            if ((dx !== 0 || dy !== 0) && cfg) {
                updates = [];
                for (const [elemId, original] of elementsOriginalCoords) {
                    updates.push({ id: elemId, coords: original.map(p => ({ x: p.x + dx, y: p.y + dy })) });
                }
            }
            resetDragState();
            if (updates && cfg) await dotnetHelper.invokeMethodAsync(cfg.updateFinal, updates);
            e.preventDefault(); e.stopPropagation();
        } else if (dragStartPoint && !mouseMoved) {
            dragStartPoint = null; elementsOriginalCoords.clear(); draggedElementIds = []; draggedElementType = null;
            if (svg.__setPanEnabled) svg.__setPanEnabled(true);
            document.body.style.userSelect = '';
        } else if (isBoxSelecting && boxSelectStart && coords) {
            const r = { x: Math.min(boxSelectStart.x, coords.x), y: Math.min(boxSelectStart.y, coords.y), w: Math.abs(coords.x - boxSelectStart.x), h: Math.abs(coords.y - boxSelectStart.y) };
            try { await dotnetHelper.invokeMethodAsync('SelectElementsInRect', r.x, r.y, r.w, r.h, e.shiftKey); } catch (err) { }
            if (selectionBox) { selectionBox.remove(); selectionBox = null; }
            isBoxSelecting = false;
            if (svg.__setPanEnabled) svg.__setPanEnabled(true);
            e.preventDefault(); e.stopPropagation();
        } else if (mouseDownPos && !mouseMoved && !e.shiftKey && !Utils.findElement(e.target, svg)) {
            try { await dotnetHelper.invokeMethodAsync('ClearSelection'); } catch (err) { }
        }
        mouseDownPos = null; mouseMoved = false;
    };

    const onKeyDown = (e) => {
        if (e.key === 'Escape' && isDragging) {
            const cfg = Config[draggedElementType];
            if (cfg) { for (const [id, coord] of elementsOriginalCoords) dotnetHelper.invokeMethodAsync(cfg.updateSingleFinal, id, coord); }
            resetDragState();
            dotnetHelper.invokeMethodAsync('OnEscapeKeyPressed');
            e.preventDefault(); e.stopPropagation();
        }
    };

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

    // 이동 중인지 확인하는 플래그
    let isMovingWithArrow = false;

    const onKeyDown = (e) => { // async 제거
        if (!isMouseOverMap) return;

        const activeEl = document.activeElement;
        const isInput = activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable || activeEl.tagName === 'SELECT';
        if (isInput) return;

        const key = e.key.toLowerCase();

        // 방향키 처리
        if (key.startsWith('arrow')) {
            e.preventDefault();
            const dir = key.replace('arrow', '');

            // 처음 누르기 시작했을 때만 이동 시작 알림 (필요 시)
            if (!isMovingWithArrow) {
                isMovingWithArrow = true;
                // dotnetHelper.invokeMethodAsync('OnMoveStart'); // 필요하면 추가
            }

            // [핵심] await 제거! 응답을 기다리지 않고 C#에 명령을 던짐
            dotnetHelper.invokeMethodAsync('OnArrowKeyPressed', dir, e.shiftKey);
            return;
        }

        const normalized = key === 'esc' ? 'escape' : key;
        const actions = {
            'escape': 'OnEscapeKeyPressed',
            'delete': 'OnDeleteKeyPressed',
            'c': e.ctrlKey ? 'OnCopyKeyPressed' : null,
            'v': e.ctrlKey ? 'OnPasteKeyPressed' : null,
            'a': e.ctrlKey ? 'OnSelectAllKeyPressed' : null,
            'z': e.ctrlKey ? 'OnUndoKeyPressed' : null,
            'y': e.ctrlKey ? 'OnRedoKeyPressed' : null
        };

        const action = actions[normalized];
        if (action) {
            dotnetHelper.invokeMethodAsync(action);
            e.preventDefault();
        }
    };

    // 키를 뗐을 때 처리 (스냅샷 저장용)
    const onKeyUp = (e) => {
        if (e.key.toLowerCase().startsWith('arrow')) {
            if (isMovingWithArrow) {
                isMovingWithArrow = false;
                // [중요] 이동이 끝났으니 이때 스냅샷을 찍으라고 명령
                dotnetHelper.invokeMethodAsync('OnMoveEnd');
            }
        }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // 핸들러 저장은 해제 시 필요하므로 배열이나 객체로 관리
    window.__keyboardShortcutsHandler = { keydown: onKeyDown, keyup: onKeyUp };
};

window.layoutMap.disableKeyboardShortcuts = () => {
    if (window.__keyboardShortcutsHandler) {
        window.removeEventListener('keydown', window.__keyboardShortcutsHandler.keydown);
        window.removeEventListener('keyup', window.__keyboardShortcutsHandler.keyup);
        delete window.__keyboardShortcutsHandler;
    }
};

// ========================================================================================
// 🧱 Wall Picker & Auto Resizer (Remaining original logic)
// ========================================================================================
window.layoutMap.enableEditorWallPicker = (canvas) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx || canvas.__wallPickerEnabled) return;
    canvas.__wallPickerEnabled = true;
    const points = canvas.__wallPoints || [];
    canvas.__wallPoints = points;
    canvas.__wallFinished = false;

    const getPos = (e) => {
        const r = canvas.getBoundingClientRect();
        const sx = canvas.width / r.width, sy = canvas.height / r.height;
        return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    };

    const snapToPoints = (pos, threshold = 20) => {
        let sx = pos.x, sy = pos.y;
        for (let p of points) {
            if (Math.abs(pos.x - p.x) < threshold) sx = p.x;
            if (Math.abs(pos.y - p.y) < threshold) sy = p.y;
        }
        return { x: sx, y: sy };
    };

    const snapAngle = (x1, y1, x2, y2) => {
        const dx = x2 - x1, dy = y2 - y1, dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return { x: x2, y: y2 };
        const snapDeg = Math.round((Math.atan2(dy, dx) * 180 / Math.PI) / 5) * 5;
        const rad = snapDeg * Math.PI / 180;
        return { x: x1 + dist * Math.cos(rad), y: y1 + dist * Math.sin(rad) };
    };

    const redraw = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "rgba(100, 50, 0, 1.0)";
        for (let p of points) { ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); }
        ctx.strokeStyle = "rgba(150, 75, 0, 0.8)"; ctx.lineWidth = 3;
        for (let i = 0; i + 1 < points.length; i++) { ctx.beginPath(); ctx.moveTo(points[i].x, points[i].y); ctx.lineTo(points[i + 1].x, points[i + 1].y); ctx.stroke(); }
        if (points.length > 2) { ctx.beginPath(); ctx.moveTo(points[points.length - 1].x, points[points.length - 1].y); ctx.lineTo(points[0].x, points[0].y); ctx.stroke(); }
    };

    canvas.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        const pos = getPos(e);
        if (points.length >= 3 && Math.sqrt(Math.pow(pos.x - points[0].x, 2) + Math.pow(pos.y - points[0].y, 2)) <= 15) {
            canvas.__wallFinished = true; redraw(); return;
        }
        let finalPos = snapToPoints(pos);
        if (points.length > 0) finalPos = snapAngle(points[points.length - 1].x, points[points.length - 1].y, finalPos.x, finalPos.y);
        points.push(finalPos); redraw();
    });

    canvas.addEventListener("mousemove", (e) => {
        if (canvas.__wallFinished || points.length === 0) return;
        const pos = getPos(e);
        let sPos = snapAngle(points[points.length - 1].x, points[points.length - 1].y, snapToPoints(pos).x, snapToPoints(pos).y);
        redraw(); ctx.beginPath(); ctx.moveTo(points[points.length - 1].x, points[points.length - 1].y); ctx.lineTo(sPos.x, sPos.y); ctx.stroke();
    });
};

window.layoutMap.getEditorWallPoints = (canvas) => canvas?.__wallPoints || [];
window.layoutMap.clearEditorWallPoints = (canvas) => {
    if (!canvas) return;
    if (canvas.__wallPoints) canvas.__wallPoints.length = 0;
    canvas.__wallFinished = false;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
};

window.layoutMap.initAutoResizer = (element, dotnetHelper) => {
    const ro = new ResizeObserver(entries => {
        for (let e of entries) dotnetHelper.invokeMethodAsync('OnContainerResize', e.contentRect.width, e.contentRect.height);
    });
    ro.observe(element); element.__resizeObserver = ro;
};

window.layoutMap.disposeAutoResizer = (element) => {
    element?.__resizeObserver?.disconnect();
    delete element?.__resizeObserver;
};

// ========================================================================================
// 新しいヘルパー関数（eval を置き換える）
// ========================================================================================

// Check if drawRgbaOnCanvas and layoutMap.enableEditorWallPicker exist
window.layoutMap.checkEditorWallPickerAvailable = function() {
    try {
        const drawFn = typeof window.drawRgbaOnCanvas === 'function';
        const pickerFn = window.layoutMap && typeof window.layoutMap.enableEditorWallPicker === 'function';
        return !!(drawFn && pickerFn);
    } catch (e) {
        console.error('checkEditorWallPickerAvailable error', e);
        return false;
    }
};

// Given a minimap click (clientX, clientY), compute SVG coordinates relative to layout size
window.layoutMap.getMinimapSvgCoords = function(clientX, clientY, layoutWidth, layoutHeight) {
    try {
        const svg = document.querySelector('.minimap-container svg');
        if (!svg) return [0, 0];

        const rect = svg.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const svgX = (x / rect.width) * layoutWidth;
        const svgY = (y / rect.height) * layoutHeight;

        return [svgX, svgY];
    } catch (e) {
        console.error('getMinimapSvgCoords error', e);
        return [0, 0];
    }
};

// Get element size by selector - returns [width, height]
window.layoutMap.getElementSizeBySelector = function(selector) {
    try {
        const el = document.querySelector(selector);
        if (!el) return [800, 600];
        return [el.clientWidth || 800, el.clientHeight || 600];
    } catch (e) {
        console.error('getElementSizeBySelector error', e);
        return [800, 600];
    }
};

// Cleanup resources used by LayoutPainter (disconnect observers, remove references)
window.layoutMap.disposeLayoutPainterResources = function() {
    try {
        if (window.layoutMapResizeObserver) {
            try { window.layoutMapResizeObserver.disconnect(); } catch (e) { }
            try { delete window.layoutMapResizeObserver; } catch (e) { }
        }
        if (window.layoutPainterDotNetRef) {
            try { delete window.layoutPainterDotNetRef; } catch (e) { }
        }
        if (window.layoutPainterResize) {
            try { window.removeEventListener('resize', window.layoutPainterResize); } catch (e) { }
            try { delete window.layoutPainterResize; } catch (e) { }
        }
    } catch (e) {
        console.error('disposeLayoutPainterResources error', e);
    }
};