
from fastapi import FastAPI, HTTPException
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
def get_price(barcode: str):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    try:
        cur.execute("SELECT product_id FROM product_barcodes WHERE barcode=?", (barcode,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "查無此條碼")
        pid = row[0]

        cur.execute("""
            SELECT item_no, product_name, price_excl_tax, unit
            FROM products
            WHERE id=?
        """, (pid,))
        p = cur.fetchone()
        if not p:
            raise HTTPException(404, "產品主檔不存在")

        item_no, name, price, unit = p
        return {
            "success": True,
            "barcode": barcode,
            "item_no": item_no,
            "product_name": name,
            "price_excl_tax": price,
            "unit": unit
        }
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        conn.close()
