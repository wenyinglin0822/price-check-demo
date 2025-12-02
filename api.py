
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import sqlite3

app = FastAPI()
DB_PATH = "price.db"

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def home():
    return FileResponse("index.html")

@app.get("/api/price")
def get_price(barcode: str = Query(..., min_length=1, max_length=64)):
    barcode = barcode.strip()
    if not barcode:
        raise HTTPException(status_code=400, detail="條碼不可為空白")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.cursor()
        cur.execute(
            '''
            SELECT
                p.item_no,
                p.product_name,
                p.price_excl_tax,
                COALESCE(p.unit, '') AS unit
            FROM products p
            JOIN product_barcodes b
              ON p.id = b.product_id
            WHERE b.barcode = ?
              AND p.is_active = 1
            ORDER BY
              b.is_primary DESC,
              p.updated_at DESC
            LIMIT 1
            ''',
            (barcode,),
        )
        row = cur.fetchone()
        if row is None:
            return {
                "success": False,
                "message": "查無此條碼對應的商品，請確認條碼是否正確。",
            }

        unit = (row["unit"] or "").strip()
        if unit.lower() == "nan":
            unit = ""

        return {
            "success": True,
            "barcode": barcode,
            "item_no": row["item_no"],
            "product_name": row["product_name"],
            "price_excl_tax": row["price_excl_tax"],
            "unit": unit,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
