import os
from typing import List, Optional, Any, Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

from pydantic import BaseModel, Field

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json


# =========================
# Config
# =========================
APP_TITLE = "price-check-order-clean"
STATIC_DIR = "static"          # repo 根目錄下的 static/
ORDERS_TABLE = "orders"

def get_database_url() -> str:
    # Render 建議用 DATABASE_URL（你已配置）
    url = (os.getenv("DATABASE_URL") or "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL not set in Render Environment Variables.")
    return url


def get_conn():
    # Supabase 通常需要 sslmode=require；即便 URL 已帶，也不會壞
    return psycopg.connect(
        get_database_url(),
        sslmode="require",
        row_factory=dict_row,
    )


# =========================
# App (app 一定要先建立)
# =========================
app = FastAPI(title=APP_TITLE, version="1.0.0")

# CORS：先放寬，避免前端被擋；穩定後再收緊 allow_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ✅ static 掛載：必須在 app 定義後
# ✅ directory="static"：對應 GitHub repo 根目錄 /static
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# =========================
# Models (Swagger 會出 Request body)
# =========================
class OrderItem(BaseModel):
    barcode: Optional[str] = None
    name: Optional[str] = None
    unit: Optional[str] = None
    qty: float = 1
    price: float = 0
    subtotal: Optional[float] = None


class CreateOrderRequest(BaseModel):
    items: List[OrderItem] = Field(default_factory=list)
    note: Optional[str] = None
    shop_name: Optional[str] = None


class UpdateStatusRequest(BaseModel):
    status: str = Field(..., description="NEW / PAID / DONE / CANCELED / RETURN")


class PriceCheckItem(BaseModel):
    barcode: str
    qty: float = 1


class PriceCheckRequest(BaseModel):
    items: List[PriceCheckItem] = Field(default_factory=list)


# =========================
# Helpers
# =========================
def calc_totals(items: List[OrderItem]) -> Dict[str, Any]:
    total_qty = 0.0
    total_amount = 0.0

    norm_items = []
    for it in items:
        q = float(it.qty or 0)
        p = float(it.price or 0)
        s = float(it.subtotal) if it.subtotal is not None else q * p
        total_qty += q
        total_amount += s

        norm_items.append({
            "barcode": it.barcode,
            "name": it.name,
            "unit": it.unit,
            "qty": q,
            "price": p,
            "subtotal": s,
        })

    return {
        "items": norm_items,
        "total_qty": int(total_qty) if float(total_qty).is_integer() else total_qty,
        "total_amount": total_amount,
    }


# =========================
# Routes
# =========================
@app.get("/", response_class=HTMLResponse)
def home():
    # 讓根網址不要再 404，並指引你去測試
    return f"""
    <html>
      <body style="font-family: Arial; padding: 16px;">
        <h3>{APP_TITLE}</h3>
        <ul>
          <li><a href="/docs">API Docs (Swagger)</a></li>
          <li><a href="/health">Health</a></li>
          <li><a href="/static/order.html">Customer Order Page</a></li>
        </ul>
      </body>
    </html>
    """


@app.get("/health")
def health():
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("select 1 as ok;")
                row = cur.fetchone()
        return {"ok": True, "db": "ok", "check": row}
    except Exception as e:
        return {"ok": False, "db": "fail", "error": str(e)}


# 顧客端：查價（目前先做「回傳」，未接商品主檔）
@app.post("/api/price-check")
def price_check(payload: PriceCheckRequest):
    # 先讓前端流程跑通：回傳你送的 items
    return {"success": True, "items": [it.model_dump() for it in payload.items]}


# 顧客端：建立訂單（寫 Supabase）
@app.post("/api/orders")
def create_order(payload: CreateOrderRequest):
    if not payload.items:
        raise HTTPException(status_code=422, detail="items is empty")

    totals = calc_totals(payload.items)

    # ✅ jsonb 正確寫法：Json(dict/list)
    items_jsonb = Json(totals["items"])
    raw_jsonb = Json(payload.model_dump())

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    insert into {ORDERS_TABLE}
                      (items, total_qty, total_amount, status, note, shop_name, raw_json)
                    values
                      (%s, %s, %s, %s, %s, %s, %s)
                    returning id, created_at, status, total_qty, total_amount
                    """,
                    (
                        items_jsonb,
                        totals["total_qty"],
                        totals["total_amount"],
                        "NEW",
                        payload.note,
                        payload.shop_name,
                        raw_jsonb,
                    ),
                )
                row = cur.fetchone()
                conn.commit()

        return {"success": True, **row}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB insert failed: {e}")


# 管理端：訂單列表（先不做登入，之後再鎖）
@app.get("/api/orders")
def list_orders(limit: int = 50, offset: int = 0):
    limit = max(1, min(int(limit), 200))
    offset = max(0, int(offset))

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    select id, created_at, status, total_qty, total_amount, note, shop_name, items
                    from {ORDERS_TABLE}
                    order by id desc
                    limit %s offset %s
                    """,
                    (limit, offset),
                )
                rows = cur.fetchall()

        return {"success": True, "count": len(rows), "rows": rows}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB query failed: {e}")


# 管理端：單筆訂單
@app.get("/api/orders/{order_id}")
def get_order(order_id: int):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    select id, created_at, status, total_qty, total_amount, note, shop_name, items, raw_json
                    from {ORDERS_TABLE}
                    where id = %s
                    """,
                    (order_id,),
                )
                row = cur.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Order not found")

        return {"success": True, "row": row}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB query failed: {e}")


# 管理端：更新狀態
@app.patch("/api/orders/{order_id}/status")
def update_status(order_id: int, payload: UpdateStatusRequest):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    update {ORDERS_TABLE}
                    set status = %s
                    where id = %s
                    returning id, status
                    """,
                    (payload.status, order_id),
                )
                row = cur.fetchone()
                conn.commit()

        if not row:
            raise HTTPException(status_code=404, detail="Order not found")

        return {"success": True, **row}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB update failed: {e}")
