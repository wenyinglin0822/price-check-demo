// 取得 DOM
const input = document.getElementById('barcode-input');
const btnSearch = document.getElementById('btn-search');
const btnScan = document.getElementById('btn-scan');
const btnCloseScan = document.getElementById('btn-close-scan');

const resultPanel = document.getElementById('result-panel');
const errorPanel = document.getElementById('error-panel');

const resName = document.getElementById('res-name');
const resBarcode = document.getElementById('res-barcode');
const resPrice = document.getElementById('res-price');
const resUnit = document.getElementById('res-unit');
const resExtra = document.getElementById('res-extra');

const scannerOverlay = document.getElementById('scanner-overlay');
const scannerNode = document.getElementById('scanner');

let quaggaRunning = false;

// -------- 查價 --------
async function fetchPrice(barcode) {
    // 清空訊息
    errorPanel.classList.add('hidden');
    resultPanel.classList.add('hidden');

    if (!barcode) {
        showError('請先輸入或掃描條碼。');
        return;
    }

    try {
        const resp = await fetch(`/api/price?barcode=${encodeURIComponent(barcode)}`);
        if (!resp.ok) {
            throw new Error(`伺服器回應錯誤：${resp.status}`);
        }
        const data = await resp.json();

        if (!data.success) {
            showError(data.message || '查無此條碼，請確認是否輸入正確。');
            return;
        }

        // 正常顯示結果（友善格式）
        resName.textContent = data.product_name || '未命名商品';
        resBarcode.textContent = data.barcode || barcode;
        resPrice.textContent = data.price_excl_tax != null ? data.price_excl_tax : '—';
        resUnit.textContent = data.unit && data.unit !== 'nan' ? `（${data.unit}）` : '';
        resExtra.textContent = data.item_no ? `料號：${data.item_no}` : '';

        resultPanel.classList.remove('hidden');
    } catch (err) {
        console.error(err);
        showError(err.message || '發生未知錯誤。');
    }
}

function showError(msg) {
    errorPanel.textContent = msg;
    errorPanel.classList.remove('hidden');
    resultPanel.classList.add('hidden');
}

// 按鈕綁定
btnSearch.addEventListener('click', () => {
    fetchPrice(input.value.trim());
});

input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        fetchPrice(input.value.trim());
    }
});

// -------- 掃描相關（QuaggaJS） --------
function startScanner() {
    if (typeof Quagga === 'undefined') {
        showError('此瀏覽器或此裝置無法載入條碼掃描模組，請改用手動輸入或手機掃描。');
        return;
    }

    scannerOverlay.classList.remove('hidden');

    if (quaggaRunning) {
        return;
    }

    Quagga.init(
        {
            inputStream: {
                type: 'LiveStream',
                target: scannerNode,
                constraints: {
                    facingMode: 'environment', // 優先使用後鏡頭（手機）
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            },
            locator: {
                patchSize: 'medium',
                halfSample: true
            },
            numOfWorkers: navigator.hardwareConcurrency || 2,
            decoder: {
                readers: [
                    'ean_reader',
                    'ean_8_reader',
                    'upc_reader',
                    'code_128_reader'
                ]
            },
            locate: true
        },
        function (err) {
            if (err) {
                console.error(err);
                showError('啟動攝影機失敗：' + err.name);
                stopScanner();
                return;
            }
            Quagga.start();
            quaggaRunning = true;
        }
    );

   // 辨識成功（不自動關閉視窗，只是幫你查價）
    let lastDetectedCode = null;
    let lastDetectedTime = 0;

    Quagga.offDetected();
    Quagga.onDetected((result) => {
        if (!result || !result.codeResult || !result.codeResult.code) {
            return;
        }
        const code = result.codeResult.code;

        const now = Date.now();
        // 避免同一個條碼連續觸發太多次 → 4.5 秒內同一碼只處理一次
        if (code === lastDetectedCode && (now - lastDetectedTime) < 4500) {
            return;
        }
        lastDetectedCode = code;
        lastDetectedTime = now;

        // 顯示在輸入框 & 查價，但「不要」關閉掃描視窗
        input.value = code;
        fetchPrice(code);
   
    });
}

function stopScanner() {
    if (quaggaRunning) {
        Quagga.stop();
        quaggaRunning = false;
    }
    scannerOverlay.classList.add('hidden');
}

// 掃描按鈕/關閉按鈕
btnScan.addEventListener('click', () => {
    startScanner();
});

btnCloseScan.addEventListener('click', () => {
    stopScanner();
});

// 視窗關閉/重新整理時停止
window.addEventListener('beforeunload', () => {
    stopScanner();
});
