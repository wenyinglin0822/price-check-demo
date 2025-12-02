// ======================
// DOM 元件
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

// Demo 區塊（若沒有這些元素也不會當掉）
const demoPhotoMain = document.getElementById("demo-photo-main");
const demoPhotoText = document.getElementById("demo-photo-text");
const demoThumbs = document.querySelectorAll(".demo-thumb");

// Session 倒數顯示
const sessionTimerBlock = document.getElementById("session-timer");
const sessionTimerText = document.getElementById("session-timer-text");

// ======================
// 錯誤/結果 顯示
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

    if (resName) {
        resName.textContent = data.product_name || "未命名商品";
    }
    if (resBarcode) {
        resBarcode.textContent = data.barcode || "";
    }
    if (resPrice) {
        if (data.price_excl_tax !== undefined && data.price_excl_tax !== null) {
            resPrice.textContent = data.price_excl_tax;
        } else {
            resPrice.textContent = "—";
        }
    }
    if (resExtra) {
        resExtra.textContent = data.item_no || "";
    }

    clearError();
    resultPanel.classList.remove("hidden");
}


// ======================
// 每日密碼 + 30 分鐘 session + 倒數
// ======================
let loggedIn = false;              // 這支手機是否已通過密碼
let sessionExpiresAt = null;       // ms
let sessionTimerHandle = null;

// 讀 cookie（登入後端有寫入 session_exp）
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
        return parts.pop().split(";").shift();
    }
    return null;
}

// 啟動倒數顯示
function startSessionTimer() {
    if (!sessionExpiresAt || !sessionTimerText || !sessionTimerBlock) return;

    // 先更新一次
    function update() {
        const now = Date.now();
        const diff = sessionExpiresAt - now;

        if (diff <= 0) {
            // 時間到，自動登出
            clearInterval(sessionTimerHandle);
            sessionTimerHandle = null;
            loggedIn = false;
            sessionExpiresAt = null;

            sessionTimerText.textContent = "--:--";
            sessionTimerBlock.classList.add("hidden");
            showError("使用時間已到，請重新輸入密碼。");
            return;
        }

        const totalSec = Math.floor(diff / 1000);
        const minutes = String(Math.floor(totalSec / 60)).padStart(2, "0");
        const seconds = String(totalSec % 60).padStart(2, "0");
        sessionTimerText.textContent = `${minutes}:${seconds}`;
        sessionTimerBlock.classList.remove("hidden");
    }

    if (sessionTimerHandle) {
        clearInterval(sessionTimerHandle);
        sessionTimerHandle = null;
    }

    update();
    sessionTimerHandle = setInterval(update, 1000);
}

// 進入頁面時，如果 cookie 還有效，自動接回 session
function initSessionFromCookie() {
    const exp = getCookie("session_exp"); // 後端設的 cookie 名稱
    if (!exp) return;

    const expInt = parseInt(exp, 10);
    if (!Number.isFinite(expInt)) return;

    const expMs = expInt * 1000;
    if (expMs <= Date.now()) return;

    // 還有效，直接當作已登入
    loggedIn = true;
    sessionExpiresAt = expMs;
    startSessionTimer();
}

// 確認目前是否有有效 session，若沒有就跳出密碼視窗
async function ensureSession() {
    // 前端覺得自己還在登入狀態，就讓後端驗證
    if (loggedIn && sessionExpiresAt && sessionExpiresAt > Date.now()) {
        return true;
    }

    // ❗ 提示文字改成只有「請輸入密碼」
    const pw = window.prompt("請輸入密碼");
    if (!pw) {
        showError("尚未輸入密碼，無法查價。");
        return false;
    }

    try {
        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: pw.trim() })
        });

        if (res.status === 401) {
            showError("密碼錯誤或已失效，請洽門市確認。");
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

        // 後端會回傳 expires_at（Unix 秒）
        if (data.expires_at) {
            sessionExpiresAt = data.expires_at * 1000;
            startSessionTimer();
        } else {
            sessionExpiresAt = null;
            if (sessionTimerBlock) sessionTimerBlock.classList.add("hidden");
        }

        loggedIn = true;
        clearError();
        return true;

    } catch (err) {
        console.error("login error:", err);
        showError("伺服器連線錯誤，請稍後再試。");
        return false;
    }
}


// ======================
// 查價（手動輸入 + 掃描 共用）
// ======================
async function fetchPrice(barcode) {
    const code = (barcode || "").trim();
    if (!code) {
        showError("請先輸入條碼。");
        return;
    }

    clearError();

    const ok = await ensureSession();
    if (!ok) return;

    try {
        const res = await fetch(`/api/price?barcode=${encodeURIComponent(code)}`);

        if (res.status === 401) {
            // session 過期或不存在
            loggedIn = false;
            sessionExpiresAt = null;
            if (sessionTimerBlock) sessionTimerBlock.classList.add("hidden");
            showError("使用時間已超過 30 分鐘，請回門市重新啟用。");
            return;
        }

        if (!res.ok) {
            showError("伺服器錯誤，請稍後再試。");
            return;
        }

        const data = await res.json();

        if (!data.success) {
            showError(data.message || "查無此條碼，請確認是否輸入正確。");
            return;
        }

        showResult(data);

    } catch (err) {
        console.error("fetchPrice error:", err);
        showError("連線錯誤，請稍後再試。");
    }
}

// 查詢按鈕（手動輸入）
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
// 相機掃描（QuaggaJS）
// ======================
let quaggaRunning = false;

async function startScanner() {
    // 先關掉可能存在的舊掃描
    stopScanner();

    // 相機掃描也受相同限制：先確認密碼 / session
    const ok = await ensureSession();
    if (!ok) return;

    if (typeof Quagga === "undefined") {
        showError("無法啟動相機模組，請改用手動輸入。");
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
                    facingMode: "environment",
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            },
            locator: {
                patchSize: "medium",
                halfSample: true
            },
            numOfWorkers: navigator.hardwareConcurrency || 2,
            decoder: {
                readers: [
                    "ean_reader",
                    "ean_8_reader",
                    "upc_reader",
                    "upc_e_reader",
                    "code_128_reader"
                ]
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
        const raw = result && result.codeResult && result.codeResult.code;
        if (!raw) return;

        const code = String(raw).trim();

        // 只接受 13 碼數字條碼
        if (!/^[0-9]{13}$/.test(code)) {
            return;
        }

        console.log("Detected barcode:", code);
        if (input) input.value = code;

        stopScanner();
        fetchPrice(code);
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

if (btnScan) {
    btnScan.addEventListener("click", startScanner);
}

if (btnCloseScan) {
    btnCloseScan.addEventListener("click", stopScanner);
}

window.addEventListener("beforeunload", stopScanner);


// ======================
// DEMO 輪播（若你有這區）
// ======================
const demoSlides = ["DEMO 左", "DEMO 中", "DEMO 右"];
let demoCurrentIndex = 0;
let demoTimer = null;

function demoUpdate(i) {
    demoCurrentIndex = i;
    if (demoPhotoText) {
        demoPhotoText.textContent = demoSlides[i];
    }
    demoThumbs.forEach((btn) => {
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
    if (demoTimer) {
        clearInterval(demoTimer);
        demoTimer = null;
    }
}

demoThumbs.forEach((btn) => {
    btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        demoUpdate(idx);
        demoStop();
    });
});

let touchStartX = null;
if (demoPhotoMain) {
    demoPhotoMain.addEventListener("touchstart", (e) => {
        touchStartX = e.touches[0].clientX;
    });

    demoPhotoMain.addEventListener("touchend", (e) => {
        if (touchStartX === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        const threshold = 40;
        if (Math.abs(dx) > threshold) {
            if (dx < 0) {
                demoUpdate((demoCurrentIndex + 1) % demoSlides.length);
            } else {
                demoUpdate((demoCurrentIndex - 1 + demoSlides.length) % demoSlides.length);
            }
            demoStop();
        }
        touchStartX = null;
    });
}

if (demoPhotoText) {
    demoUpdate(0);
    demoStart();
}

// 頁面載入時，嘗試從 cookie 接回 session
document.addEventListener("DOMContentLoaded", () => {
    initSessionFromCookie();
});
