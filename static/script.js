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

const searchResultPanel = document.getElementById("search-result-panel");
const searchResultBody = document.getElementById("search-result-body");

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
// 關鍵字搜尋結果 顯示/清除
// ======================
function clearSearchResults() {
    if (searchResultPanel) {
        searchResultPanel.classList.add("hidden");
    }
    if (searchResultBody) {
        searchResultBody.innerHTML = "";
    }
}

function renderSearchResults(items) {
    if (!searchResultPanel || !searchResultBody) return;

    searchResultBody.innerHTML = "";

    if (!items.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 3;
        td.style.textAlign = "center";
        td.style.padding = "8px 0";
        td.textContent = "查無符合的商品，請嘗試其他關鍵字。";
        tr.appendChild(td);
        searchResultBody.appendChild(tr);
        searchResultPanel.classList.remove("hidden");
        return;
    }

    items.forEach((item) => {
        const tr = document.createElement("tr");
        const tdName = document.createElement("td");
        const tdBarcode = document.createElement("td");
        const tdPrice = document.createElement("td");

        tdName.textContent = item.product_name || "";
        tdBarcode.textContent = item.barcode || "";
        tdPrice.textContent =
            item.price_excl_tax != null
                ? item.price_excl_tax.toLocaleString("zh-TW")
                : "—";

        tr.appendChild(tdName);
        tr.appendChild(tdBarcode);
        tr.appendChild(tdPrice);

        tr.addEventListener("click", () => {
            if (input) {
                input.value = item.barcode || "";
            }
            clearSearchResults();
            // 直接以條碼查價
            fetchPrice(item.barcode || "");
        });

        searchResultBody.appendChild(tr);
    });

    searchResultPanel.classList.remove("hidden");
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
async function searchByKeyword(keyword) {
    const q = (keyword || "").trim();
    if (!q) {
        showError("請先輸入條碼或關鍵字。");
        return;
    }

    clearError();
    if (resultPanel) resultPanel.classList.add("hidden");

    const ok = await ensureSession();
    if (!ok) return;

    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.status === 401) {
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
            // 查無結果也使用搜尋結果面板顯示提示
            renderSearchResults([]);
            showError(data.message || "查無符合的商品，請嘗試其他關鍵字。");
            return;
        }

        renderSearchResults(data.items || []);
    } catch (err) {
        console.error("searchByKeyword error:", err);
        showError("連線錯誤，請稍後再試。");
    }
}

async function fetchPrice(barcode) {
    const code = (barcode || "").trim();
    clearSearchResults();
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
        if (!input) return;
        const val = (input.value || "").trim();
        if (!val) {
            showError("請先輸入條碼或關鍵字。");
            return;
        }
        const isBarcode = /^\d{6,}$/.test(val);
        if (isBarcode) {
            fetchPrice(val);
        } else {
            searchByKeyword(val);
        }
    });
}

// Enter 查詢
if (input) {
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            const val = (input.value || "").trim();
            if (!val) {
                showError("請先輸入條碼或關鍵字。");
                return;
            }
            const isBarcode = /^\d{6,}$/.test(val);
            if (isBarcode) {
                fetchPrice(val);
            } else {
                searchByKeyword(val);
            }
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
const demoSlides = [
    { text: "促銷商品示意", bg: "#fbe2c6" },
    { text: "掃描條碼示意", bg: "#dcfce7" },
    { text: "加入購物籃示意", bg: "#dbeafe" }
];
let demoCurrentIndex = 0;
let demoTimer = null;

function demoUpdate(i) {
    demoCurrentIndex = i;
    if (demoPhotoText) {
        demoPhotoText.textContent = demoSlides[i].text;
    }
    if (demoPhotoMain) {
        demoPhotoMain.style.backgroundColor = demoSlides[i].bg;
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




// ================================
// 簡易購物籃功能（前端）
// ================================
(function () {
    if (!resultPanel) return;

    // 購物籃資料
    let cart = [];

    // 外層摘要列 UI
    let cartSummaryBar = null;
    let cartSummaryText = null;
    let cartViewBtn = null;

    // 查價結果區的數量控制
    let qtyWrapper = null;
    let qtyInput = null;
    let qtyMinusBtn = null;
    let qtyPlusBtn = null;
    let addToCartBtn = null;

    // 購物籃視窗相關
    let cartOverlay = null;
    let cartDialog = null;
    let cartTableBody = null;
    let cartTotalText = null;
    let cartClearBtn = null;
    let cartCloseBtn = null;
    let cartCheckoutBtn = null;

    // 帳單預覽相關
    let invoiceOverlay = null;
    let invoiceDialog = null;
    let invoiceBody = null;
    let invoiceTaxInput = null;
    let invoiceSummaryText = null;
    let invoiceBackBtn = null;
    let invoicePrintBtn = null;

    function showCartMessage(msg) {
        if (typeof showError === "function") {
            showError(msg);
        } else {
            alert(msg);
        }
    }

    // -----------------------------
    // 共用：計算總數 / 金額
    // -----------------------------
    function getCartSummary() {
        let totalQty = 0;
        let totalAmount = 0;
        cart.forEach((item) => {
            totalQty += item.qty;
            totalAmount += item.price * item.qty;
        });
        return { totalQty, totalAmount };
    }

    // -----------------------------
    // 外層摘要列：🛒 購物籃：共 X 件
    // -----------------------------
    function initCartSummary() {
        if (cartSummaryBar) return;

        cartSummaryBar = document.createElement("div");
        cartSummaryBar.id = "cart-summary";
        cartSummaryBar.style.marginTop = "8px";
        cartSummaryBar.style.padding = "6px 8px";
        cartSummaryBar.style.borderRadius = "6px";
        cartSummaryBar.style.border = "1px solid #ddd";
        cartSummaryBar.style.display = "flex";
        cartSummaryBar.style.justifyContent = "space-between";
        cartSummaryBar.style.alignItems = "center";
        cartSummaryBar.style.fontSize = "13px";
        cartSummaryBar.style.backgroundColor = "#f9fafb";

        cartSummaryText = document.createElement("span");
        cartSummaryText.textContent = "🛒 購物籃目前是空的。";

        cartViewBtn = document.createElement("button");
        cartViewBtn.type = "button";
        cartViewBtn.textContent = "🛒 查看購物籃";
        cartViewBtn.style.fontSize = "13px";
        cartViewBtn.style.padding = "4px 10px";
        cartViewBtn.style.borderRadius = "999px";
        cartViewBtn.style.border = "1px solid #4b5563";
        cartViewBtn.style.background = "#111827";
        cartViewBtn.style.color = "#fff";
        cartViewBtn.style.cursor = "pointer";

        cartSummaryBar.appendChild(cartSummaryText);
        cartSummaryBar.appendChild(cartViewBtn);

        if (resultPanel && resultPanel.parentNode) {
            resultPanel.parentNode.insertBefore(cartSummaryBar, resultPanel.nextSibling);
        }

        cartViewBtn.addEventListener("click", () => {
            if (!cart.length) {
                showCartMessage("購物籃目前是空的。");
                return;
            }
            openCartDialog();
        });
    }

    function updateCartSummary() {
        if (!cartSummaryText) return;

        if (!cart.length) {
            cartSummaryText.textContent = "🛒 購物籃目前是空的。";
            return;
        }

        const { totalQty, totalAmount } = getCartSummary();

        cartSummaryText.textContent =
            "🛒 購物籃：共 " + totalQty +
            " 件，合計 " + totalAmount.toLocaleString("zh-TW") +
            " 元（未稅）";
    }

    // -----------------------------
    // 查價結果卡片：數量控制 + 加入購物籃
    // -----------------------------
    function ensureQuantityControls() {
        if (!resultPanel) return;

        if (!qtyWrapper) {
            qtyWrapper = document.createElement("div");
            qtyWrapper.id = "cart-qty-wrapper";
            qtyWrapper.style.marginTop = "8px";
            qtyWrapper.style.display = "flex";
            qtyWrapper.style.alignItems = "center";
            qtyWrapper.style.gap = "6px";
            qtyWrapper.style.fontSize = "14px";

            const label = document.createElement("span");
            label.textContent = "數量：";

            qtyMinusBtn = document.createElement("button");
            qtyMinusBtn.type = "button";
            qtyMinusBtn.textContent = "-";
            qtyMinusBtn.style.minWidth = "28px";
            qtyMinusBtn.style.height = "28px";
            qtyMinusBtn.style.borderRadius = "4px";
            qtyMinusBtn.style.border = "1px solid #d4d4d4";
            qtyMinusBtn.style.background = "#f3f4f6";
            qtyMinusBtn.style.cursor = "pointer";

            qtyInput = document.createElement("input");
            qtyInput.type = "number";
            qtyInput.value = "1";
            qtyInput.step = "1";
            qtyInput.style.width = "60px";
            qtyInput.style.height = "28px";
            qtyInput.style.textAlign = "center";
            qtyInput.style.borderRadius = "4px";
            qtyInput.style.border = "1px solid #d4d4d4";

            qtyPlusBtn = document.createElement("button");
            qtyPlusBtn.type = "button";
            qtyPlusBtn.textContent = "+";
            qtyPlusBtn.style.minWidth = "28px";
            qtyPlusBtn.style.height = "28px";
            qtyPlusBtn.style.borderRadius = "4px";
            qtyPlusBtn.style.border = "1px solid #d4d4d4";
            qtyPlusBtn.style.background = "#f3f4f6";
            qtyPlusBtn.style.cursor = "pointer";

            qtyWrapper.appendChild(label);
            qtyWrapper.appendChild(qtyMinusBtn);
            qtyWrapper.appendChild(qtyInput);
            qtyWrapper.appendChild(qtyPlusBtn);

            resultPanel.appendChild(qtyWrapper);

            qtyMinusBtn.addEventListener("click", () => {
                if (!qtyInput) return;
                const current = parseInt(qtyInput.value, 10) || 0;
                qtyInput.value = String(current - 1);
            });

            qtyPlusBtn.addEventListener("click", () => {
                if (!qtyInput) return;
                const current = parseInt(qtyInput.value, 10) || 0;
                qtyInput.value = String(current + 1);
            });

            qtyInput.addEventListener("focus", () => {
                qtyInput.select();
            });
        }

        // 每次顯示新查價結果時，預設回到 1
        if (qtyInput) {
            qtyInput.value = "1";
        }
    }

    function ensureAddToCartButton() {
        if (!resultPanel) return;

        let btn = document.getElementById("btn-add-to-cart");
        if (btn) {
            addToCartBtn = btn;
            return;
        }

        addToCartBtn = document.createElement("button");
        addToCartBtn.id = "btn-add-to-cart";
        addToCartBtn.type = "button";
        addToCartBtn.textContent = "加入購物籃";
        addToCartBtn.style.marginTop = "6px";
        addToCartBtn.style.padding = "6px 10px";
        addToCartBtn.style.fontSize = "14px";
        addToCartBtn.style.borderRadius = "6px";
        addToCartBtn.style.border = "1px solid #16a34a";
        addToCartBtn.style.background = "#22c55e";
        addToCartBtn.style.color = "#fff";
        addToCartBtn.style.cursor = "pointer";
        addToCartBtn.style.display = "inline-block";

        resultPanel.appendChild(addToCartBtn);

        addToCartBtn.addEventListener("click", () => {
            addCurrentResultToCart();
        });
    }

    function addCurrentResultToCart() {
        if (!resName || !resBarcode || !resPrice) {
            showCartMessage("無法加入購物籃：查價結果不存在。");
            return;
        }

        const name = (resName.textContent || "").trim();
        const barcode = (resBarcode.textContent || "").trim();
        const priceText = (resPrice.textContent || "").replace(/,/g, "").trim();

        if (!name || !barcode || !priceText || priceText === "—") {
            showCartMessage("目前沒有可加入購物籃的查價結果。");
            return;
        }

        const price = parseFloat(priceText);
        if (!Number.isFinite(price)) {
            showCartMessage("查價結果中的單價不正確，無法加入購物籃。");
            return;
        }

        let qty = 1;
        if (qtyInput) {
            qty = parseInt(qtyInput.value, 10);
            if (!Number.isFinite(qty) || qty === 0) {
                showCartMessage("數量為 0，未加入購物籃。");
                return;
            }
        }

        // 單位暫時固定顯示為 set
        const unit = "set";

        const existing = cart.find((item) => item.barcode === barcode);
        if (existing) {
            existing.qty += qty;
            if (existing.qty === 0) {
                // 數量歸 0 就刪除
                cart = cart.filter((item) => item !== existing);
            }
        } else {
            cart.push({
                name,
                barcode,
                price,
                qty,
                unit
            });
        }

        updateCartSummary();
        showCartMessage("已加入購物籃：" + name);
    }

    // -----------------------------
    // 購物籃視窗（表格）
    // -----------------------------
    function ensureCartDialog() {
        if (cartOverlay && cartTableBody && cartTotalText && cartCheckoutBtn) return;

        cartOverlay = document.getElementById("cart-overlay");
        if (!cartOverlay) {
            cartOverlay = document.createElement("div");
            cartOverlay.id = "cart-overlay";
            cartOverlay.className = "cart-overlay hidden";
            document.body.appendChild(cartOverlay);
        }

        cartOverlay.innerHTML = "";

        cartDialog = document.createElement("div");
        cartDialog.className = "cart-dialog";

        const header = document.createElement("div");
        header.className = "cart-dialog-header";

        const title = document.createElement("div");
        title.textContent = "新順興行 - 購物籃";

        const closeIconBtn = document.createElement("button");
        closeIconBtn.type = "button";
        closeIconBtn.className = "cart-close-icon";
        closeIconBtn.textContent = "✕";

        header.appendChild(title);
        header.appendChild(closeIconBtn);

        const body = document.createElement("div");
        body.className = "cart-dialog-body";

        const table = document.createElement("table");
        table.className = "cart-table";

        const thead = document.createElement("thead");
        thead.innerHTML = "<tr>" +
            "<th>項次</th>" +
            "<th>品名</th>" +
            "<th>數量</th>" +
            "<th>單位</th>" +
            "<th>單價</th>" +
            "<th>合計</th>" +
            "</tr>";

        cartTableBody = document.createElement("tbody");
        cartTableBody.id = "cart-table-body";

        table.appendChild(thead);
        table.appendChild(cartTableBody);

        body.appendChild(table);

        cartTotalText = document.createElement("div");
        cartTotalText.className = "cart-total";
        body.appendChild(cartTotalText);

        const footer = document.createElement("div");
        footer.className = "cart-dialog-footer";

        cartClearBtn = document.createElement("button");
        cartClearBtn.type = "button";
        cartClearBtn.className = "cart-clear-btn";
        cartClearBtn.textContent = "清空購物籃";

        cartCheckoutBtn = document.createElement("button");
        cartCheckoutBtn.type = "button";
        cartCheckoutBtn.className = "cart-checkout-btn";
        cartCheckoutBtn.textContent = "結帳（輸出帳單）";

        cartCloseBtn = document.createElement("button");
        cartCloseBtn.type = "button";
        cartCloseBtn.className = "cart-close-btn";
        cartCloseBtn.textContent = "關閉視窗";

        footer.appendChild(cartClearBtn);
        footer.appendChild(cartCheckoutBtn);
        footer.appendChild(cartCloseBtn);

        cartDialog.appendChild(header);
        cartDialog.appendChild(body);
        cartDialog.appendChild(footer);

        cartOverlay.appendChild(cartDialog);

        // 關閉行為
        function closeCart() {
            if (cartOverlay) {
                cartOverlay.classList.add("hidden");
            }
        }

        closeIconBtn.addEventListener("click", closeCart);
        cartCloseBtn.addEventListener("click", closeCart);
        cartOverlay.addEventListener("click", (e) => {
            if (e.target === cartOverlay) {
                closeCart();
            }
        });

        cartClearBtn.addEventListener("click", () => {
            if (!cart.length) {
                showCartMessage("購物籃目前是空的。");
                return;
            }
            if (!confirm("確定要清空購物籃嗎？")) return;
            cart = [];
            updateCartSummary();
            renderCartTable();
            closeCart();
        });

        cartCheckoutBtn.addEventListener("click", () => {
            if (!cart.length) {
                showCartMessage("購物籃目前是空的，無法結帳。");
                return;
            }
            openInvoicePreview();
        });

        // 數量調整（事件委派）
        cartTableBody.addEventListener("click", (e) => {
            const btn = e.target.closest(".cart-qty-btn");
            if (!btn) return;
            const index = parseInt(btn.dataset.index, 10);
            if (!Number.isFinite(index) || !cart[index]) return;

            let delta = 0;
            if (btn.dataset.action === "inc") delta = 1;
            if (btn.dataset.action === "dec") delta = -1;
            if (!delta) return;

            cart[index].qty += delta;
            if (cart[index].qty === 0) {
                cart.splice(index, 1);
            }
            renderCartTable();
            updateCartSummary();
        });

        cartTableBody.addEventListener("change", (e) => {
            const input = e.target.closest(".cart-qty-input");
            if (!input) return;
            const index = parseInt(input.dataset.index, 10);
            if (!Number.isFinite(index) || !cart[index]) return;

            let v = parseInt(input.value, 10);
            if (!Number.isFinite(v)) {
                // 還原
                input.value = String(cart[index].qty);
                return;
            }
            if (v === 0) {
                cart.splice(index, 1);
            } else {
                cart[index].qty = v;
            }
            renderCartTable();
            updateCartSummary();
        });
    }

    function renderCartTable() {
        if (!cartTableBody) return;

        cartTableBody.innerHTML = "";

        if (!cart.length) {
            const emptyRow = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 6;
            cell.textContent = "購物籃目前是空的。";
            cell.style.textAlign = "center";
            cell.style.padding = "10px 0";
            emptyRow.appendChild(cell);
            cartTableBody.appendChild(emptyRow);

            if (cartTotalText) {
                cartTotalText.textContent = "總計：0 元（未稅）";
            }
            return;
        }

        const { totalAmount } = getCartSummary();

        cart.forEach((item, index) => {
            const tr = document.createElement("tr");

            const tdIndex = document.createElement("td");
            tdIndex.textContent = String(index + 1);
            tr.appendChild(tdIndex);

            const tdName = document.createElement("td");
            tdName.textContent = item.name;
            tr.appendChild(tdName);

            const tdQty = document.createElement("td");
            const qtyBox = document.createElement("div");
            qtyBox.className = "cart-qty-box";

            const btnDec = document.createElement("button");
            btnDec.type = "button";
            btnDec.className = "cart-qty-btn";
            btnDec.dataset.index = String(index);
            btnDec.dataset.action = "dec";
            btnDec.textContent = "-";

            const input = document.createElement("input");
            input.type = "number";
            input.className = "cart-qty-input";
            input.dataset.index = String(index);
            input.value = String(item.qty);

            const btnInc = document.createElement("button");
            btnInc.type = "button";
            btnInc.className = "cart-qty-btn";
            btnInc.dataset.index = String(index);
            btnInc.dataset.action = "inc";
            btnInc.textContent = "+";

            qtyBox.appendChild(btnDec);
            qtyBox.appendChild(input);
            qtyBox.appendChild(btnInc);
            tdQty.appendChild(qtyBox);
            tr.appendChild(tdQty);

            const tdUnit = document.createElement("td");
            tdUnit.textContent = item.unit || "set";
            tr.appendChild(tdUnit);

            const tdPrice = document.createElement("td");
            tdPrice.textContent = item.price.toLocaleString("zh-TW");
            tr.appendChild(tdPrice);

            const tdSubtotal = document.createElement("td");
            const subtotal = item.price * item.qty;
            tdSubtotal.textContent = subtotal.toLocaleString("zh-TW");
            tr.appendChild(tdSubtotal);

            cartTableBody.appendChild(tr);
        });

        if (cartTotalText) {
            cartTotalText.textContent =
                "總計：" + totalAmount.toLocaleString("zh-TW") + " 元（未稅）";
        }
    }

    function openCartDialog() {
        ensureCartDialog();
        renderCartTable();
        if (cartOverlay) {
            cartOverlay.classList.remove("hidden");
        }
    }

    // -----------------------------
    // 帳單預覽（含稅率輸入）
    // -----------------------------
    function ensureInvoiceOverlay() {
        if (invoiceOverlay && invoiceBody && invoiceTaxInput && invoiceSummaryText) return;

        invoiceOverlay = document.getElementById("invoice-overlay");
        if (!invoiceOverlay) {
            invoiceOverlay = document.createElement("div");
            invoiceOverlay.id = "invoice-overlay";
            invoiceOverlay.className = "invoice-overlay hidden";
            document.body.appendChild(invoiceOverlay);
        }

        invoiceOverlay.innerHTML = "";

        invoiceDialog = document.createElement("div");
        invoiceDialog.className = "invoice-dialog";

        const header = document.createElement("div");
        header.className = "invoice-header";
        header.textContent = "新順興行 - 帳單預覽";

        invoiceBody = document.createElement("div");
        invoiceBody.className = "invoice-body";

        invoiceSummaryText = document.createElement("div");
        invoiceSummaryText.className = "invoice-summary";

        const footer = document.createElement("div");
        footer.className = "invoice-footer";

        const taxLabel = document.createElement("label");
        taxLabel.textContent = "稅率：";
        taxLabel.style.marginRight = "4px";

        invoiceTaxInput = document.createElement("input");
        invoiceTaxInput.type = "number";
        invoiceTaxInput.className = "invoice-tax-input";
        invoiceTaxInput.value = "0"; // 內建 0%，可人工輸入
        invoiceTaxInput.min = "0";
        invoiceTaxInput.step = "0.1";

        const taxSuffix = document.createElement("span");
        taxSuffix.textContent = "％";

        invoiceBackBtn = document.createElement("button");
        invoiceBackBtn.type = "button";
        invoiceBackBtn.className = "invoice-back-btn";
        invoiceBackBtn.textContent = "返回購物籃";

        invoicePrintBtn = document.createElement("button");
        invoicePrintBtn.type = "button";
        invoicePrintBtn.className = "invoice-print-btn";
        invoicePrintBtn.textContent = "列印帳單";

        const taxBox = document.createElement("div");
        taxBox.className = "invoice-tax-box";
        taxBox.appendChild(taxLabel);
        taxBox.appendChild(invoiceTaxInput);
        taxBox.appendChild(taxSuffix);

        footer.appendChild(taxBox);
        footer.appendChild(invoiceBackBtn);
        footer.appendChild(invoicePrintBtn);

        invoiceDialog.appendChild(header);
        invoiceDialog.appendChild(invoiceBody);
        invoiceDialog.appendChild(invoiceSummaryText);
        invoiceDialog.appendChild(footer);

        invoiceOverlay.appendChild(invoiceDialog);

        invoiceOverlay.addEventListener("click", (e) => {
            if (e.target === invoiceOverlay) {
                closeInvoiceOverlay();
            }
        });

        invoiceBackBtn.addEventListener("click", () => {
            closeInvoiceOverlay();
            openCartDialog();
        });

        invoicePrintBtn.addEventListener("click", () => {
            window.print();
        });

        invoiceTaxInput.addEventListener("input", () => {
            renderInvoice();
        });
    }

    function closeInvoiceOverlay() {
        if (invoiceOverlay) {
            invoiceOverlay.classList.add("hidden");
        }
    }

    function renderInvoice() {
        if (!invoiceBody || !invoiceSummaryText) return;

        invoiceBody.innerHTML = "";

        if (!cart.length) {
            invoiceBody.textContent = "購物籃目前是空的。";
            invoiceSummaryText.textContent = "";
            return;
        }

        const table = document.createElement("table");
        table.className = "invoice-table";

        const thead = document.createElement("thead");
        thead.innerHTML = "<tr>" +
            "<th>項次</th>" +
            "<th>品名</th>" +
            "<th>條碼</th>" +
            "<th>數量</th>" +
            "<th>單位</th>" +
            "<th>單價(未稅)</th>" +
            "<th>小計(未稅)</th>" +
            "</tr>";
        table.appendChild(thead);

        const tbody = document.createElement("tbody");

        let subtotal = 0;
        cart.forEach((item, index) => {
            const tr = document.createElement("tr");

            const tdIndex = document.createElement("td");
            tdIndex.textContent = String(index + 1);
            tr.appendChild(tdIndex);

            const tdName = document.createElement("td");
            tdName.textContent = item.name;
            tr.appendChild(tdName);

            const tdBarcode = document.createElement("td");
            tdBarcode.textContent = item.barcode;
            tr.appendChild(tdBarcode);

            const tdQty = document.createElement("td");
            tdQty.textContent = String(item.qty);
            tr.appendChild(tdQty);

            const tdUnit = document.createElement("td");
            tdUnit.textContent = item.unit || "set";
            tr.appendChild(tdUnit);

            const tdPrice = document.createElement("td");
            tdPrice.textContent = item.price.toLocaleString("zh-TW");
            tr.appendChild(tdPrice);

            const itemSubtotal = item.price * item.qty;
            subtotal += itemSubtotal;

            const tdItemSubtotal = document.createElement("td");
            tdItemSubtotal.textContent = itemSubtotal.toLocaleString("zh-TW");
            tr.appendChild(tdItemSubtotal);

            tbody.appendChild(tr);
        });

        table.appendChild(tbody);

        // 建立表格底部小計 / 稅額 / 合計
        let taxRate = parseFloat(invoiceTaxInput.value);
        if (!Number.isFinite(taxRate) || taxRate < 0) {
            taxRate = 0;
        }
        const taxAmount = Math.round(subtotal * taxRate / 100);
        const grandTotal = subtotal + taxAmount;

        const tfoot = document.createElement("tfoot");
        const rowSubtotal = document.createElement("tr");
        rowSubtotal.innerHTML =
            "<td colspan=\"6\" style=\"text-align:right\">小計（未稅）</td>" +
            "<td>" + subtotal.toLocaleString("zh-TW") + "</td>";
        const rowTax = document.createElement("tr");
        rowTax.innerHTML =
            "<td colspan=\"6\" style=\"text-align:right\">稅率 " +
            taxRate.toFixed(1).replace(/\\.0$/, "") +
            "％，營業稅</td>" +
            "<td>" + taxAmount.toLocaleString("zh-TW") + "</td>";
        const rowTotal = document.createElement("tr");
        rowTotal.innerHTML =
            "<td colspan=\"6\" style=\"text-align:right;font-weight:700\">合計（含稅）</td>" +
            "<td style=\"font-weight:700\">" + grandTotal.toLocaleString("zh-TW") + "</td>";

        tfoot.appendChild(rowSubtotal);
        tfoot.appendChild(rowTax);
        tfoot.appendChild(rowTotal);
        table.appendChild(tfoot);

        invoiceBody.appendChild(table);

        // 上方摘要仍保留，與表格數字一致
        invoiceSummaryText.innerHTML =
            "小計（未稅）：<strong>" + subtotal.toLocaleString("zh-TW") + " 元</strong><br>" +
            "稅率：" + taxRate.toFixed(1).replace(/\.0$/, "") + "％，營業稅：<strong>" +
            taxAmount.toLocaleString("zh-TW") + " 元</strong><br>" +
            "合計（含稅）：<strong>" + grandTotal.toLocaleString("zh-TW") + " 元</strong>";
    }
    function openInvoicePreview() {
        ensureInvoiceOverlay();
        renderInvoice();
        if (invoiceOverlay) {
            invoiceOverlay.classList.remove("hidden");
        }
    }

    // 若一開始就有結果，就立刻建立 UI
    if (!resultPanel.classList.contains("hidden")) {
        initCartSummary();
        ensureQuantityControls();
        ensureAddToCartButton();
    }

    // 攔截 fetchPrice：在查價成功後，建立購物籃 UI
    if (typeof fetchPrice === "function") {
        const originalFetchPrice = fetchPrice;
        fetchPrice = async function (barcode) {
            await originalFetchPrice(barcode);
            initCartSummary();
            ensureQuantityControls();
            ensureAddToCartButton();
        };
    } else {
        console.warn("找不到 fetchPrice 函式，購物籃功能未啟用。");
    }
})();
;
