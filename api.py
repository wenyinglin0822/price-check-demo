from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import sqlite3
import time
from datetime import datetime, timedelta

app = FastAPI()
DB_PATH = "price.db"

# Session 時效：30 分鐘
SESSION_DURATION = 30 * 60  # 1800 秒

app.mount("/static", StaticFiles(directory="static"), name="static")


def get_daily_password() -> str:
    """
    今日密碼：
    台灣時間 MMDD → 轉成整數後加上 1234 → 再轉回字串
    例如：1202 + 1234 = 2436
    """
    now = datetime.utcnow() + timedelta(hours=8)  # 台灣時間
    mmdd = int(now.strftime("%m%d"))  # 轉成整數，例如 1202
    password = mmdd + 1234
    return str(password)


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@app.get("/")
def home():
    return FileResponse("index.html")


@app.post("/api/login")
async def login(data: dict, response: Response):
    """
    檢查每日密碼 + 建立 30 分鐘 session。
    前端會呼叫本 API 並送出 {"password": "..."}。
    """
    password = (data or {}).get("password", "").strip()
    if not password:
        raise HTTPException(status_code=400, detail="empty_password")

    expected = get_daily_password()
    if password != expected:
        raise HTTPException(status_code=401, detail="invalid_password")

    expires_at = int(time.time()) + SESSION_DURATION

    resp = JSONResponse({
        "success": True,
        "expires_at": expires_at
    })

    resp.set_cookie(
        key="session_exp",
        value=str(expires_at),
        max_age=SESSION_DURATION,
        httponly=True,
        samesite="lax"
    )

    return resp


def ensure_session(request: Request):
    """
    session_exp cookie 有效就放行，失效則丟 401。
    """
    exp = request.cookies.get("session_exp")
    now = int(time.time())

    if not exp:
        raise HTTPException(status_code=401, detail="no_session")

    try:
        if int(exp) < now:
            raise HTTPException(status_code=401, detail="session_expired")
    except ValueError:
        raise HTTPException(status_code=401, detail="session_expired")


@app.get("/api/price")
def get_price(barcode: str, request: Request):
    """查價 API，需要有效 session"""
    ensure_session(request)

    barcode = (barcode or "").strip()
    if not barcode:
        raise HTTPException(status_code=400, detail="empty_barcode")

    conn = get_db_connection()
    try:
        cur = conn.cursor()

        cur.execute(
            """
            SELECT
                p.item_no,
                p.product_name,
                p.price_excl_tax,
                p.unit
            FROM product_barcodes b
            JOIN products p ON p.id = b.product_id
            WHERE b.barcode = ?
            LIMIT 1
            """,
            (barcode,)
        )

        row = cur.fetchone()
        if not row:
            return {
                "success": False,
                "message": "查無此條碼，請確認是否輸入正確。"
            }

        return {
            "success": True,
            "barcode": barcode,
            "item_no": row["item_no"],
            "product_name": row["product_name"],
            "price_excl_tax": row["price_excl_tax"],
            "unit": row["unit"]
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
