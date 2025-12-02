// ================== 基本 DOM 物件 ==================
const barcodeInput = document.getElementById('barcode-input');
const searchBtn = document.getElementById('btn-search');
const scanBtn = document.getElementById('btn-scan');

const resultPanel = document.getElementById('result-panel');
const errorPanel = document.getElementById('error-panel');

const nameSpan = document.getElementById('res-name');
const barcodeSpan = document.getElementById('res-barcode');
const priceSpan = document.getElementById('res-price');
const unitSpan = document.getElementById('res-unit');
const extraSpan = document.getElementById('res-extra');

const sessionTimerLabel = document.getElementById('session-timer');

// 掃描相關 DOM
const scannerOverlay = document.getElementById('scanner-overlay');
const scannerArea = document.getElementById('scanner');
const closeScanBtn = document.getElementById('btn-close-scan');

// ================== Session / 密碼設定 ==================
const SESSION_KEY = 'pricecheck_session_expires';
const SESSION_DURATION_MS = 30 * 60 * 1000; // 30 分鐘

let sessionTimerInterval = null;

// 今日密碼：MMDD + 1234，例如 1202 -> 1202 + 1234 = 2436
function calcTodayPassword() {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const base = parseInt(mm + dd, 10);
    return String(base + 1234);
}

function getSessionExpire() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
}

function hasValidSession() {
    const expire = getSessionExpire();
    return expire && Date.now() < expire;
}

function setNewSession() {
    const expire = Date.now() + SESSION_DURATION_MS;
    sessionStorage.setItem(SESSION_KEY, String(expire));
    startSessionCountdown();
}

function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    if (sessionTimerInterval) {
        clearInterval(sessionTimerInterval);
        sessionTimerInterval = null;
    }
    if (sessionTimerLabel) {
        sessionTimerLabel.textContent = '登入已過期，請重新輸入密碼';
    }
}

// 顯示倒數計時（如果 HTML 有 session-timer 這個元素的話）
function startSessionCountdown() {
    if (!sessionTimerLabel) return;

    function update() {
        const expire = getSessionExpire();
        if (!expire) {
            sessionTimerLabel.textContent = '';
            return;
        }
        const diff = expire - Date.now();
        if (diff <= 0) {
            clearSession();
            alert('登入已過期，請重新輸入密碼');
            // 再次要求登入
            ensureSession();
            return;
        }
        const totalSec = Math.floor(diff / 1000);
        const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const s = String(totalSec % 60).padStart(2, '0');
        sessionTimerLabel.textContent = `本次登入剩餘 ${m}:${s}`;
    }

    if (sessionTimerInterval) clearInterval(sessionTimerInterval);
    update();
    sessionTimerInterval = setInterval(update, 1000);
}

// 這個函式會在需要時要求使用者輸入密碼
async function ensureSession() {
    // 如果已經有有效 session，就直接返回
    if (hasValidSession()) {
        return;
    }

    // 沒有 session，進入輸入密碼流程
    const todayPassword = calcTodayPassword();

    // 用 while 迴圈，直到輸入正確或使用者取消
    // 不使用後端 /api/login，一切在前端完成
    while (true) {
        const input = window.prompt('請輸入密碼');

        // 使用者按「取消」或關閉視窗
        if (input === null) {
            alert('未輸入密碼，無法使用查價功能');
            // 拋出錯誤讓呼叫端知道被取消
            throw new Error('login-cancelled');
        }

        if (input.trim() === todayPassword) {
            setNewSession();
            return;
        } else {
            alert('密碼錯誤，請重新輸入');
        }
    }
}

// ================== 查價 / 顯示結果 ==================
function showError(message) {
    if (errorPanel) {
        errorPanel.style.display = 'block';
        errorPanel.textContent = message;
    }
    if (resultPanel) {
        resultPanel.style.display = 'none';
    }
}

function showResult(data) {
    if (errorPanel) {
        errorPanel.style.display = 'none';
    }
    if (resultPanel) {
        resultPanel.style.display = 'block';
    }

    if (nameSpan) nameSpan.textContent = data.product_name || '—';
    if (barcodeSpan) barcodeSpan.textContent = data.barcode || '—';
    if (priceSpan) priceSpan.textContent = data.price_excl_tax != null ? data.price_excl_tax : '—';
    if (unitSpan) unitSpan.textContent = data.unit || '';
    if (extraSpan) extraSpan.textContent = data.item_no ? `料號：${data.item_no}` : '';
}

async function fetchAndShow(barcode) {
    if (!barcode) {
        showError('請先輸入或掃描條碼');
        return;
    }

    try {
        const resp = await fetch(`/api/price?barcode=${encodeURIComponent(barcode)}`);
        if (!resp.ok) {
            throw new Error('伺服器錯誤');
        }
        const data = await resp.json();
        if (!data || data.success === false) {
            showError(data && data.message ? data.message : '查無此商品');
            return;
        }
        showResult(data);
    } catch (err) {
        console.error(err);
        showError('查詢失敗，請稍後再試');
    }
}

async function handleSearch() {
    try {
        await ensureSession();
    } catch (err) {
        // 登入被取消
        return;
    }
    const barcode = barcodeInput ? barcodeInput.value.trim() : '';
    fetchAndShow(barcode);
}

// ================== 條碼掃描（Quagga） ==================
let lastDetectedCode = '';
let lastDetectedTime = 0;

function startScanner() {
    if (!window.Quagga || !scannerOverlay || !scannerArea) {
        alert('目前瀏覽器不支援攝影機掃描');
        return;
    }

    scannerOverlay.style.display = 'flex';

    Quagga.init({
        inputStream: {
            name: 'Live',
            type: 'LiveStream',
            target: scannerArea,
            constraints: {
                facingMode: 'environment'
            }
        },
        decoder: {
            readers: [
                'ean_reader',
                'ean_8_reader',
                'upc_reader',
                'code_128_reader'
            ]
        },
        locate: true
    }, function (err) {
        if (err) {
            console.error(err);
            alert('無法啟動攝影機');
            scannerOverlay.style.display = 'none';
            return;
        }
        Quagga.start();
    });

    Quagga.onDetected(onBarcodeDetected);
}

function stopScanner() {
    try {
        Quagga.offDetected(onBarcodeDetected);
        Quagga.stop();
    } catch (e) {
        // ignore
    }
    if (scannerOverlay) {
        scannerOverlay.style.display = 'none';
    }
}

function onBarcodeDetected(result) {
    if (!result || !result.codeResult || !result.codeResult.code) return;
    const code = result.codeResult.code;

    const now = Date.now();
    if (code === lastDetectedCode && (now - lastDetectedTime) < 4500) {
        // 4.5 秒內重複讀取同一條碼就忽略
        return;
    }
    lastDetectedCode = code;
    lastDetectedTime = now;

    if (barcodeInput) {
        barcodeInput.value = code;
    }
    // 掃到條碼後直接查價（會自動檢查 session）
    handleSearch();
}

// ================== 綁定事件 ==================
document.addEventListener('DOMContentLoaded', () => {
    // 初始 session 狀態
    if (hasValidSession()) {
        startSessionCountdown();
    } else {
        // 一進來就問一次密碼
        ensureSession().catch(() => {
            // 使用者取消時就保持在未登入狀態
        });
    }

    if (searchBtn) {
        searchBtn.addEventListener('click', handleSearch);
    }
    if (barcodeInput) {
        barcodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handleSearch();
            }
        });
    }
    if (scanBtn) {
        scanBtn.addEventListener('click', async () => {
            try {
                await ensureSession();
            } catch {
                return;
            }
            startScanner();
        });
    }
    if (closeScanBtn) {
        closeScanBtn.addEventListener('click', () => {
            stopScanner();
        });
    }
});
