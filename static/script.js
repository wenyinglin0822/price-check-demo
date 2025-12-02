// =======================
// 取得 DOM
// =======================
const input = document.getElementById("barcode-input");
const btnSearch = document.getElementById("btn-search");
const btnScan = document.getElementById("btn-scan");
const btnCloseScan = document.getElementById("btn-close-scan");

const resultPanel = document.getElementById("result-panel");
const errorPanel = document.getElementById("error-panel");

const resName = document.getElementById("res-name");
const resBarcode = document.getElementById("res-barcode");
const resPrice = document.getElementById("res-price");
const resExtra = document.getElementById("res-extra"); // 料號區塊（只顯示數字）

const scannerOverlay = document.getElementById("scanner-overlay");
const scannerNode = document.getElementById("scanner");

// =======================
// 查價相關
// =======================
async function fetchPrice(barcode) {
    // 清理舊訊息
    if (errorPanel) errorPanel.classList.add("hidden");
    if (resultPanel) resultPanel.classList.add("hidden");

    if (!barcode) {
        showError("請先輸入或掃描條碼。");
        return;
    }

    try {
        const resp = await fetch(
            `/api/price?barcode=${encodeURIComponent(barcode)}`
        );
        if (!resp.ok) {
            throw new Error(`伺服器回應錯誤：${resp.status}`);
        }
        const data = await resp.json();

        if (!data.success) {
            showError(data.message || "查無此條碼，請確認是否輸入正確。");
            return;
        }

        // ===== 正常結果寫入畫面 =====
        if (resName) {
            resName.textContent = data.product_name || "未命名商品";
        }
        if (resBarcode) {
            resBarcode.textContent = data.barcode || barcode;
        }
        if (resPrice) {
            resPrice.textContent =
                data.price_excl_tax !== undefined &&
                data.price_excl_tax !== null
                    ? data.price_excl_tax
                    : "—";
        }
        if (resExtra) {
            // 這裡只放料號數字，前面的「料號：」已經在 HTML 寫死
            resExtra.textContent = data.item_no || "";
        }

        if (resultPanel) resultPanel.classList.remove("hidden");
    } catch (err) {
        console.error(err);
        showError(err.message || "發生未知錯誤。");
    }
}

function showError(msg) {
    if (!errorPanel) return;
    errorPanel.textContent = msg;
    errorPanel.classList.remove("hidden");
    if (resultPanel) resultPanel.classList.add("hidden");
}

// 按鈕與 Enter
if (btnSearch) {
    btnSearch.addEventListener("click", () => {
        fetchPrice((input.value || "").trim());
    });
}

if (input) {
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            fetchPrice((input.value || "").trim());
        }
    });
}

// =======================
// 掃描（QuaggaJS）
// =======================
let quaggaRunning = false;

function startScanner() {
    if (typeof Quagga === "undefined") {
        showError(
            "無法載入條碼掃描模組，請改用手動輸入或使用支援的瀏覽器/裝置。"
        );
        return;
    }

    if (scannerOverlay) {
        scannerOverlay.classList.remove("hidden");
    }

    if (quaggaRunning) return;

    Quagga.init(
        {
            inputStream: {
                type: "LiveStream",
                target: scannerNode,
                constraints: {
                    facingMode: "environment", // 優先後鏡頭（手機）
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                },
            },
            locator: {
                patchSize: "medium",
                halfSample: true,
            },
            numOfWorkers: navigator.hardwareConcurrency || 2,
            decoder: {
                readers: [
                    "ean_reader",
                    "ean_8_reader",
                    "upc_reader",
                    "upc_e_reader",
                    "code_128_reader",
                ],
            },
            locate: true,
        },
        function (err) {
            if (err) {
                console.error(err);
                showError("啟動攝影機失敗：" + err.name);
                stopScanner();
                return;
            }
            Quagga.start();
            quaggaRunning = true;
        }
    );

    // 掃描到條碼：只接受 13 碼純數字，一次就關閉相機＋查價
    Quagga.offDetected();
    Quagga.onDetected((result) => {
        const raw = result && result.codeResult && result.codeResult.code;
        if (!raw) return;

        const code = String(raw).trim();

        // 只接受 13 碼純數字（EAN-13），其他全部忽略
        if (!/^[0-9]{13}$/.test(code)) {
            return;
        }

        console.log("Detected barcode:", code);
        if (input) input.value = code;

        stopScanner();      // 關閉相機畫面
        fetchPrice(code);   // 顯示查價結果
    });
}

function stopScanner() {
    if (quaggaRunning) {
        try {
            Quagga.stop();
        } catch (e) {
            console.warn("停止 Quagga 發生錯誤：", e);
        }
        quaggaRunning = false;
    }
    if (scannerOverlay) {
        scannerOverlay.classList.add("hidden");
    }
}

if (btnScan) btnScan.addEventListener("click", startScanner);
if (btnCloseScan) btnCloseScan.addEventListener("click", stopScanner);
window.addEventListener("beforeunload", stopScanner);

// =======================
// DEMO 照片輪播（DEMO 左 / 中 / 右）
// =======================
const demoSlides = ["DEMO 左", "DEMO 中", "DEMO 右"];
const demoPhotoMain = document.getElementById("demo-photo-main");
const demoPhotoText = document.getElementById("demo-photo-text");
const demoThumbs = document.querySelectorAll(".demo-thumb");

let demoCurrentIndex = 0;
let demoAutoTimer = null;
const DEMO_INTERVAL = 4000; // 每 4 秒換一張

function demoUpdateSlide(index) {
    demoCurrentIndex = index;
    if (demoPhotoText) {
        demoPhotoText.textContent = demoSlides[demoCurrentIndex];
    }
    demoThumbs.forEach((btn) => {
        const idx = Number(btn.dataset.index);
        btn.classList.toggle("active", idx === demoCurrentIndex);
    });
}

function demoStartAuto() {
    demoStopAuto();
    if (!demoPhotoText) return;
    demoAutoTimer = setInterval(() => {
        const next = (demoCurrentIndex + 1) % demoSlides.length;
        demoUpdateSlide(next);
    }, DEMO_INTERVAL);
}

function demoStopAuto() {
    if (demoAutoTimer) {
        clearInterval(demoAutoTimer);
        demoAutoTimer = null;
    }
}

// 縮圖點擊：切換 + 停止自動輪播
demoThumbs.forEach((btn) => {
    btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        demoUpdateSlide(idx);
        demoStopAuto();
    });
});

// 手機左右滑：切圖 + 停止自動輪播
let demoTouchStartX = null;
if (demoPhotoMain) {
    demoPhotoMain.addEventListener(
        "touchstart",
        (e) => {
            demoTouchStartX = e.touches[0].clientX;
        },
        { passive: true }
    );

    demoPhotoMain.addEventListener(
        "touchend",
        (e) => {
            if (demoTouchStartX === null) return;
            const dx = e.changedTouches[0].clientX - demoTouchStartX;
            const threshold = 40;

            if (Math.abs(dx) > threshold) {
                if (dx < 0) {
                    // 往左滑 → 下一張
                    demoUpdateSlide((demoCurrentIndex + 1) % demoSlides.length);
                } else {
                    // 往右滑 → 上一張
                    demoUpdateSlide(
                        (demoCurrentIndex - 1 + demoSlides.length) %
                            demoSlides.length
                    );
                }
                demoStopAuto();
            }
            demoTouchStartX = null;
        },
        { passive: true }
    );
}

// 啟動 DEMO 輪播
if (demoPhotoText) {
    demoUpdateSlide(0);
    demoStartAuto();
}
