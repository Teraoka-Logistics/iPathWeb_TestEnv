// ========================================================================================
// NavigationRenderer.js (Refactored based on LayoutRenderer.js style)
// ========================================================================================
window.navigationRenderer = {
    canvas: null,
    ctx: null,

    // 데이터 저장소
    walls: [],      // [x, y, x, y, ...]
    arrows: [],     // [{x, y, dir}, ...]
    frees: [],      // [x, y, x, y, ...]

    cellSize: 500,

    // 뷰 상태
    transform: { x: 0, y: 0, k: 1 },
    layoutSize: { w: 0, h: 0 },

    init: function (canvasElement, layoutWidth, layoutHeight) {
        if (!canvasElement) {
            console.error("[NavRenderer] Canvas element not found!");
            return;
        }
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d', { alpha: true });
        this.layoutSize = { w: layoutWidth, h: layoutHeight };
        this.resize();
    },

    resize: function () {
        if (!this.canvas) return;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        if (this.canvas.width !== rect.width || this.canvas.height !== rect.height) {
            this.canvas.width = rect.width;
            this.canvas.height = rect.height;
            this.render();
        }
    },

    updateGridData: function (wallsFlat, arrows, freesFlat, cellSize) {
        this.walls = wallsFlat || [];
        this.arrows = arrows || [];
        this.frees = freesFlat || [];
        this.cellSize = cellSize;
        this.render();
    },

    updateView: function (x, y, zoom) {
        if (this.transform.x === x && this.transform.y === y && this.transform.k === zoom) return;
        this.transform = { x, y, k: zoom };
        this.resize(); // 캔버스 크기 방어 코드
        requestAnimationFrame(() => this.render());
    },

    render: function () {
        if (!this.ctx) return;

        const ctx = this.ctx;
        const { width, height } = this.canvas;
        const t = this.transform; // {x: viewBoxX, y: viewBoxY, k: zoomLevel}

        // 데이터 없으면 클리어 후 리턴
        if (this.walls.length === 0 && this.arrows.length === 0 && this.frees.length === 0) {
            ctx.clearRect(0, 0, width, height);
            return;
        }

        // ============================================================
        // 1. 화면 맞춤 비율(Fit Ratio) 계산
        // ============================================================
        const ratioX = width / this.layoutSize.w;
        const ratioY = height / this.layoutSize.h;
        const fitScale = Math.min(ratioX, ratioY); // SVG의 'meet' 옵션과 동일

        // ============================================================
        // ★ [핵심 수정] 중앙 정렬 오프셋(Centering Offset) 계산
        // SVG의 'xMidYMid' 처럼 남는 공간의 절반만큼 밀어줘야 함
        // ============================================================
        const drawnWidth = this.layoutSize.w * fitScale;
        const drawnHeight = this.layoutSize.h * fitScale;

        const offsetX = (width - drawnWidth) / 2;
        const offsetY = (height - drawnHeight) / 2;

        // 최종 스케일 (줌 포함)
        const currentScale = t.k * fitScale;

        // 화면 클리어
        ctx.clearRect(0, 0, width, height);

        ctx.save();

        // ============================================================
        // 2. 변환 적용 순서 (매우 중요)
        // ============================================================

        // (1) 중앙 정렬 보정: SVG가 가운데로 간 만큼 캔버스도 이동
        ctx.translate(offsetX, offsetY);

        // (2) 줌 중심점 보정: 줌이 커지면 중앙에서 퍼져나가야 함 (이 부분은 viewBox x,y가 처리함)
        // SVG viewBox 기준 이동:
        // 캔버스 원점을 현재 보고 있는 뷰박스의 시작점(t.x, t.y)만큼 반대로 이동
        // 이때, 이미 fitScale은 적용된 상태여야 하고, 줌(t.k)에 따라 이동량이 증폭됨

        // 공식: -(뷰박스X * 줌 * 핏스케일) + (줌으로 인한 중심점 보정...은 복잡하니 단순화)
        // SVG viewBox 메커니즘을 캔버스에 흉내내려면 아래와 같습니다.

        // 캔버스의 (0,0)은 이제 '화면에 그려진 맵의 좌상단'입니다 (Offset 적용됨).
        // 여기서 뷰포트 변환을 적용합니다.

        ctx.translate(-t.x * currentScale, -t.y * currentScale);
        ctx.scale(currentScale, currentScale);

        // ============================================================
        // 3. 그리기 (스타일)
        // ============================================================
        const px = 1 / currentScale;
        const lineWidth = px * 1.5;
        const showDetails = t.k > 0.5;

        // [RED] 벽 (Walls)
        if (this.walls.length > 0) {
            ctx.beginPath();
            const halfCell = this.cellSize / 2;
            const gap = this.cellSize * 0.05;
            const boxSize = this.cellSize - (gap * 2);

            for (let i = 0; i < this.walls.length; i += 2) {
                ctx.rect(
                    this.walls[i] - halfCell + gap,
                    this.walls[i + 1] - halfCell + gap,
                    boxSize, boxSize
                );
            }
            ctx.fillStyle = "rgba(255, 50, 50, 0.25)";
            ctx.fill();
        }

        // [BLUE] 화살표 (Arrows)
        if (this.arrows.length > 0) {
            ctx.beginPath();
            const halfCell = this.cellSize / 2;
            for (let i = 0; i < this.arrows.length; i++) {
                ctx.rect(this.arrows[i].x - halfCell, this.arrows[i].y - halfCell, this.cellSize, this.cellSize);
            }
            ctx.fillStyle = "rgba(0, 100, 255, 0.05)";
            ctx.fill();

            if (showDetails) {
                ctx.beginPath();
                const arrowSize = this.cellSize * 0.4;
                const DIR_UP = 1, DIR_DOWN = 2, DIR_LEFT = 4, DIR_RIGHT = 8;

                for (let i = 0; i < this.arrows.length; i++) {
                    const { x: cx, y: cy, dir } = this.arrows[i];
                    if (dir & DIR_UP) {
                        ctx.moveTo(cx, cy + arrowSize); ctx.lineTo(cx, cy - arrowSize);
                        ctx.lineTo(cx - arrowSize / 2, cy - arrowSize / 2);
                        ctx.moveTo(cx, cy - arrowSize); ctx.lineTo(cx + arrowSize / 2, cy - arrowSize / 2);
                    }
                    if (dir & DIR_DOWN) {
                        ctx.moveTo(cx, cy - arrowSize); ctx.lineTo(cx, cy + arrowSize);
                        ctx.lineTo(cx - arrowSize / 2, cy + arrowSize / 2);
                        ctx.moveTo(cx, cy + arrowSize); ctx.lineTo(cx + arrowSize / 2, cy + arrowSize / 2);
                    }
                    if (dir & DIR_LEFT) {
                        ctx.moveTo(cx + arrowSize, cy); ctx.lineTo(cx - arrowSize, cy);
                        ctx.lineTo(cx - arrowSize / 2, cy - arrowSize / 2);
                        ctx.moveTo(cx - arrowSize, cy); ctx.lineTo(cx - arrowSize / 2, cy + arrowSize / 2);
                    }
                    if (dir & DIR_RIGHT) {
                        ctx.moveTo(cx - arrowSize, cy); ctx.lineTo(cx + arrowSize, cy);
                        ctx.lineTo(cx + arrowSize / 2, cy - arrowSize / 2);
                        ctx.moveTo(cx + arrowSize, cy); ctx.lineTo(cx + arrowSize / 2, cy + arrowSize / 2);
                    }
                }
                ctx.lineWidth = lineWidth;
                ctx.strokeStyle = "rgba(0, 100, 255, 0.6)";
                ctx.lineCap = "round";
                ctx.stroke();
            }
        }

        // [GREEN] 자유 구역 (Frees)
        if (this.frees.length > 0 && showDetails) {
            ctx.beginPath();
            const radius = this.cellSize * 0.45;
            for (let i = 0; i < this.frees.length; i += 2) {
                const fx = this.frees[i];
                const fy = this.frees[i + 1];
                ctx.moveTo(fx + radius, fy);
                ctx.arc(fx, fy, radius, 0, Math.PI * 2);
            }
            ctx.fillStyle = "rgba(0, 200, 50, 0.5)";
            ctx.fill();
        }

        ctx.restore();
    }
};