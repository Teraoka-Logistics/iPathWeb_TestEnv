window.downloadTextFile = (filename, contentType, content) => {
    // 1. UTF-8 문자열을 Blob으로 변환 (엑셀 한글/일어 깨짐 방지를 위해 BOM 추가)
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const file = new Blob([bom, content], { type: contentType });

    // 2. 다운로드 링크 생성
    const exportUrl = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = exportUrl;
    a.download = filename;

    // 3. 클릭 및 제거
    document.body.appendChild(a);
    a.click();

    // 메모리 관리
    setTimeout(() => {
        URL.revokeObjectURL(exportUrl);
        document.body.removeChild(a);
    }, 100);
};