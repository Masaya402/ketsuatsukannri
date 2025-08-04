import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path

from flask import Flask, render_template, request, jsonify, send_from_directory, send_file
from PIL import Image
import pytesseract
import io
import base64
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from weasyprint import HTML

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "data.db"

app = Flask(__name__, static_url_path="/static", static_folder="static", template_folder="templates")

# Ensure DB exists
CREATE_SQL = """
CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    systolic INTEGER NOT NULL,
    diastolic INTEGER NOT NULL,
    pulse INTEGER NOT NULL
);
"""

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

with get_conn() as conn:
    conn.execute(CREATE_SQL)
    conn.commit()

# Regex patterns for OCR text
BP_REGEXES = [
    # Patterns like 120/80 70
    re.compile(r"(?P<sys>\d{2,3})\s*/\s*(?P<dia>\d{2,3})\s*(?P<pulse>\d{2,3})"),
    # Patterns like SYS 120 DIA 80 PUL 70
    re.compile(r"SYS\s*(?P<sys>\d{2,3}).*?DIA\s*(?P<dia>\d{2,3}).*?(PUL|PR|HR)\s*(?P<pulse>\d{2,3})", re.IGNORECASE),
]


def extract_bp(text: str):
    """Return (sys, dia, pulse) or None"""
    for pattern in BP_REGEXES:
        m = pattern.search(text)
        if m:
            try:
                sys = int(m.group("sys"))
                dia = int(m.group("dia"))
                pulse = int(m.group("pulse"))
                return sys, dia, pulse
            except ValueError:
                continue
    return None


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/upload", methods=["POST"])
def upload():
    if "image" not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files["image"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    # Save temp file
    img = Image.open(file.stream)
    # Convert to RGB just in case
    img = img.convert("RGB")

    ocr_text = pytesseract.image_to_string(img, lang="eng")
    result = extract_bp(ocr_text)
    if result is None:
        return jsonify({"error": "Could not detect blood pressure and pulse"}), 422

    sys_val, dia_val, pulse_val = result
    timestamp_str = datetime.now().isoformat(timespec="seconds")

    with get_conn() as conn:
        conn.execute(
            "INSERT INTO readings (timestamp, systolic, diastolic, pulse) VALUES (?, ?, ?, ?)",
            (timestamp_str, sys_val, dia_val, pulse_val),
        )
        conn.commit()

    return jsonify({"systolic": sys_val, "diastolic": dia_val, "pulse": pulse_val})


@app.route("/data")
def data():
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM readings ORDER BY timestamp").fetchall()
    readings = [
        {
            "timestamp": row["timestamp"],
            "systolic": row["systolic"],
            "diastolic": row["diastolic"],
            "pulse": row["pulse"],
        }
        for row in rows
    ]
    return jsonify(readings)


@app.route("/report")
def report():
    """Generate PDF report between from and to dates (inclusive)."""
    start = request.args.get("from")
    end = request.args.get("to")
    with get_conn() as conn:
        query = "SELECT * FROM readings"
        params = []
        if start and end:
            query += " WHERE date(timestamp) BETWEEN ? AND ?"
            params = [start, end]
        rows = conn.execute(query, params).fetchall()
    if not rows:
        return jsonify({"error": "No data"}), 404

    df = pd.DataFrame(rows, columns=["id", "timestamp", "systolic", "diastolic", "pulse"])
    df["date"] = pd.to_datetime(df["timestamp"]).dt.date

    # Bar chart per day average
    daily = df.groupby("date").mean(numeric_only=True)
    fig, ax = plt.subplots(figsize=(6,3))
    daily[["systolic", "diastolic", "pulse"]].plot(kind="bar", ax=ax)
    ax.set_ylabel("mmHg / bpm")
    plt.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    img_b64 = base64.b64encode(buf.getvalue()).decode()

    # Build HTML
    html = f"""
    <html><body style='font-family: Arial;'>
    <h2>血圧報告書 {start or df['date'].min()} – {end or df['date'].max()}</h2>
    <img src='data:image/png;base64,{img_b64}' style='width:100%; max-width:700px;' />
    <h3>測定一覧</h3>
    {df[['timestamp','systolic','diastolic','pulse']].to_html(index=False, classes='table', border=0)}
    </body></html>
    """
    pdf_io = io.BytesIO()
    HTML(string=html).write_pdf(pdf_io)
    pdf_io.seek(0)
    return send_file(pdf_io, as_attachment=True, download_name="report.pdf", mimetype="application/pdf")


@app.route("/add", methods=["POST"])
def add_manual():
    """Endpoint to manually add a reading via form or JSON."""
    if request.is_json:
        payload = request.get_json()
    else:
        payload = request.form

    try:
        sys_val = int(payload.get("systolic", ""))
        dia_val = int(payload.get("diastolic", ""))
        pulse_val = int(payload.get("pulse", ""))
    except ValueError:
        return jsonify({"error": "Invalid integers"}), 400

    # Optional date (YYYY-MM-DD) or full ISO timestamp
    date_str = payload.get("date") or payload.get("timestamp")
    if date_str:
        try:
            if len(date_str) == 10:
                # YYYY-MM-DD
                ts = datetime.strptime(date_str, "%Y-%m-%d")
            else:
                ts = datetime.fromisoformat(date_str)
        except ValueError:
            return jsonify({"error": "Invalid date format"}), 400
    else:
        ts = datetime.now()

    timestamp_str = ts.isoformat(timespec="seconds")

    if not (50 <= sys_val <= 300 and 30 <= dia_val <= 200 and 30 <= pulse_val <= 250):
        return jsonify({"error": "Values out of expected range"}), 400

    with get_conn() as conn:
        conn.execute(
            "INSERT INTO readings (timestamp, systolic, diastolic, pulse) VALUES (?, ?, ?, ?)",
            (timestamp_str, sys_val, dia_val, pulse_val),
        )
        conn.commit()

    return jsonify({"systolic": sys_val, "diastolic": dia_val, "pulse": pulse_val})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host="0.0.0.0", port=port)
