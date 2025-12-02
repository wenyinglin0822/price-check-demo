// ======================
// DOM
// ======================
const input = document.getElementById("barcode-input");
const btnSearch = document.getElementById("btn-search");
const btnScan = document.getElementById("btn-scan");
const btnCloseScan = document.getElementById("btn-close-scan");

const resultPanel = document.getElementById("result-panel");
const errorPanel = document.getElementById("error-panel");

const resName = document.getElementById("res-name");
const resBarcode = document.getElementById("res-barcode");
const resPrice = document.getElementById("res-price");
const resExtra = document.getElementById("res-extra");

const scannerOverlay = document.getElementById("scanner-overlay");
const scannerNode = document.getElementById("scanner");

// Demo 區塊（沒有也不會當掉）
const demoPhotoMain = document.getElementById("demo-photo-main");
const demoPhotoText = document.getElementById("demo-photo-text");
const demoThumbs = document.querySelectorAll(".demo-thumb");


// ======================
// 錯誤/結果顯示
// ======================
function showError(msg) {
    if (!errorPanel) return;
    errorPanel.textContent = msg;
    errorPanel.classList.remove("hidden");
    if (resultPanel) resultPanel.classList.add("hidden");
}

function clearError() {
    if (!errorPanel) return;
    errorPanel.textContent = "";
    errorPanel.classList.add("hidden");
}

function showResult(data) {
    if (!resultPanel) return;

    if (resName) resName.textContent = data.product_name || "未命名商品";
    if (resBarcode) resBarcode.textContent = data.barcode || "";
    if (resPrice) {
        resPrice.textContent = data.price_excl_tax ?? "—";
    }
    if (resExtra) resExtra.textContent = data.item_no || "";

    clearError();
    resultPanel.classList.remove("hidden");
}


// ======================
// 每日密碼 + Session（30 分鐘）
// ======================
let loggedIn = false;

async function ensureSession() {
    if (loggedIn) return true;

    const p = window.prompt("請輸入今日店內查價密碼（例如：MMDD+1234）");
    if (!p) {
        showError("尚未輸入密碼，無法查價。");
        return false;
    }

    try {
        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: p.trim() })
        });

        if (res.status === 401) {
            showError("今日密碼錯誤，請洽門市確認。");
            loggedIn = false;
            return false;
        }

        if (!res.ok) {
            showError("登入失敗，請稍後再試。");
            loggedIn = false;
            return false;
        }

        const data = await res.json();
        if (!data.success) {
            showError("登入失敗，請稍後再試。");
            loggedIn = false;
            return false;
        }

        loggedIn = true;
        clearError();
        return true;

    } catch (err) {
        console.error(err);
        showError("伺服器連線錯誤。");
        return false;
    }
}


// ======================
// 查價功能
// ======================
async function fetchPrice(barcode) {
    const code = (barcode || "").trim();
    if (!code) {
        showError("請先輸入條碼。");
        return;
    }

    clearError();

    const auth = await ensureSession();
    if (!auth) return;

    try {
        const res = await fetch(`/api/price?barcode=${encodeURIComponent(code)}`);

        if (res.status === 401) {
            loggedIn = false;
            showError("使用時間已超過 30 分鐘，請回門市重新掃描 QRcode 啟用。");
            return;
        }

        if (!res.ok) {
            showError("伺服器錯誤，請稍後再試。");
            return;
        }

        const data = await res.json();

        if (!data.success) {
            showError(data.message || "查無條碼");
            return;
        }

        showResult(data);

    } catch (err) {
        console.error(err);
        showError("連線錯誤。");
    }
}

// 查詢按鈕
if (btnSearch) {
    btnSearch.addEventListener("click", () => {
        fetchPrice(input ? input.value : "");
    });
}

// Enter 查詢
if (input) {
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            fetchPrice(input.value);
        }
    });
}


// ======================
// 掃描（QuaggaJS）
// ======================
let quaggaRunning = false;

async function startScanner() {
    const auth = await ensureSession();
    if (!auth) return;

    if (typeof Quagga === "undefined") {
        showError("無法啟動相機模組。");
        return;
    }

    if (scannerOverlay) scannerOverlay.classList.remove("hidden");
    if (quaggaRunning) return;

    Quagga.init(
        {
            inputStream: {
                type: "LiveStream",
                target: scannerNode,
                constraints: {
                    facingMode: "environment",
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            },
            locator: { patchSize: "medium", halfSample: true },
            numOfWorkers: navigator.hardwareConcurrency || 2,
            decoder: {
                readers: ["ean_reader", "ean_8_reader", "upc_reader", "upc_e_reader", "code_128_reader"]
            },
            locate: true
        },
        function (err) {
            if (err) {
                console.error(err);
                showError("啟動相機失敗：" + err.name);
                stopScanner();
                return;
            }
            Quagga.start();
            quaggaRunning = true;
        }
    );

    Quagga.offDetected();
    Quagga.onDetected((result) => {
        const raw = result?.codeResult?.code;
        if (!raw) return;

        const code = String(raw).trim();
        if (!/^[0-9]{13}$/.test(code)) return;

        console.log("Detected:", code);

        if (input) input.value = code;

        stopScanner();
        fetchPrice(code);
    });
}

function stopScanner() {
    if (quaggaRunning) {
        try { Quagga.stop(); } catch {}
        quaggaRunning = false;
    }
    if (scannerOverlay) scannerOverlay.classList.add("hidden");
}

if (btnScan) btnScan.addEventListener("click", startScanner);
if (btnCloseScan) btnCloseScan.addEventListener("click", stopScanner);

window.addEventListener("beforeunload", stopScanner);


// ======================
// DEMO 輪播（若你有這區）
// ======================
const demoSlides = ["DEMO 左", "DEMO 中", "DEMO 右"];
let demoCurrentIndex = 0;
let demoTimer = null;

function demoUpdate(i) {
    demoCurrentIndex = i;
    if (demoPhotoText) demoPhotoText.textContent = demoSlides[i];

    demoThumbs.forEach(btn => {
        const idx = Number(btn.dataset.index);
        btn.classList.toggle("active", idx === i);
    });
}

function demoStart() {
    demoStop();
    if (!demoPhotoText) return;

    demoTimer = setInterval(() => {
        const next = (demoCurrentIndex + 1) % demoSlides.length;
        demoUpdate(next);
    }, 4000);
}

function demoStop() {
    if (demoTimer) clearInterval(demoTimer);
    demoTimer = null;
}

demoThumbs.forEach(btn => {
    btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        demoUpdate(idx);
        demoStop();
    });
});

let touchStartX = null;
if (demoPhotoMain) {
    demoPhotoMain.addEventListener("touchstart", e => {
        touchStartX = e.touches[0].clientX;
    });

    demoPhotoMain.addEventListener("touchend", e => {
        if (touchStartX == null) return;
        const dx = e.changedTouches[0].clientX - touchStartX;

        if (Math.abs(dx) > 40) {
            if (dx < 0)
                demoUpdate((demoCurrentIndex + 1) % demoSlides.length);
            else
                demoUpdate((demoCurrentIndex - 1 + demoSlides.length) % demoSlides.length);

            demoStop();
        }
        touchStartX = null;
    });
}

if (demoPhotoText) {
    demoUpdate(0);
    demoStart();
}
