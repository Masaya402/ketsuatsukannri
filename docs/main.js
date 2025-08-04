// Placeholder JS – full client implementation will be added in next step
// Client-side blood pressure manager Phase 1: manual entry + IndexedDB + Chart.js

(async () => {
  const db = await idb.openDB("bp-db", 1, {
    upgrade(db) {
      db.createObjectStore("readings", { keyPath: "timestamp" });
    },
  });

  const statusEl = document.getElementById("status");
  const toastEl = document.getElementById("toast");
  const toastBody = document.getElementById("toastBody");
  const toast = new bootstrap.Toast(toastEl, { delay: 3000 });
  function showToast(msg, success = true) {
    toastEl.classList.toggle("text-bg-primary", success);
    toastEl.classList.toggle("text-bg-danger", !success);
    toastBody.textContent = msg;
    toast.show();
  }
  const form = document.getElementById("manualForm");
  const rangeSelect = document.getElementById("rangeSelect");
  const imgInput = document.getElementById("imgInput");
  const pdfBtn = document.getElementById("pdfBtn");
  const dataTable = document.getElementById("dataTable");
  const editModalEl = document.getElementById("editModal");
  const editModal = new bootstrap.Modal(editModalEl);
  const editForm = document.getElementById("editForm");
  const saveEditBtn = document.getElementById("saveEditBtn");
  const ctx = document.getElementById("bpChart").getContext("2d");

  const chart = window.myChart = new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets: [] },
    options: {
      parsing: false,
      responsive: true,
      scales: {
        x: { type: "time", time: { unit: "day" }, ticks:{color:'#e9ecef'}, grid:{color:'#333'} },
        y: { ticks:{color:'#e9ecef'}, grid:{color:'#333'} }
      },
      plugins:{ legend:{ labels:{ color:'#e9ecef'} } }
    },
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    let ts;
    if (data.date) {
      // combine chosen date with current time to ensure uniqueness (seconds precision)
      const now = new Date();
      const timePart = now.toISOString().slice(11,19); // HH:MM:SS
      ts = `${data.date}T${timePart}`;
    } else {
      ts = new Date().toISOString();
    }
    const reading = {
      timestamp: ts,
      systolic: Number(data.systolic),
      diastolic: Number(data.diastolic),
      pulse: Number(data.pulse),
    };
    try {
      await db.put("readings", reading);
      console.log("saved OK", reading);
    } catch (e) {
      console.error("save error", e);
      showToast("保存失敗", false);
      return;
    }
    statusEl.textContent = "保存しました";
    showToast("保存しました✅");
    form.reset();
    updateChart();
    renderTable();
  });

  rangeSelect.addEventListener("change", updateChart);

  // OCR image upload
  imgInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    statusEl.textContent = "OCR 解析中…";
    const worker = await Tesseract.createWorker();
    await worker.loadLanguage("eng+jpn");
    await worker.initialize("eng+jpn");
    const {
      data: { text },
    } = await worker.recognize(file);
    await worker.terminate();
    const match = text.match(/(\d{2,3})\D+(\d{2,3})\D+(\d{2,3})/);
    if (match) {
      const [_, sys, dia, pulse] = match.map(Number);
      const reading = {
        timestamp: new Date().toISOString(),
        systolic: sys,
        diastolic: dia,
        pulse: pulse,
      };
      try {
      await db.put("readings", reading);
      console.log("saved OK", reading);
    } catch (e) {
      console.error("save error", e);
      showToast("保存失敗", false);
      return;
    }
      statusEl.textContent = "OCR 追加しました";
      showToast("OCR 追加しました✅");
      updateChart();
    renderTable();
    } else {
      statusEl.textContent = "OCR 解析失敗";
      showToast("OCR 解析失敗❌", false);
    }
    imgInput.value = "";
  });

  // PDF generation
  pdfBtn.addEventListener("click", async () => {
    statusEl.textContent = "PDF 生成中…";
    const canvasElem = document.getElementById("bpChart");
    const chartImg = canvasElem.toDataURL("image/png", 1.0);

    const tableHTML = await buildTableHTML();
    const tableCanvas = await html2canvas(tableHTML);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.text("血圧＆脈拍 レポート", 10, 10);
    doc.addImage(chartImg, "PNG", 10, 20, 180, 80);
    const tableImg = tableCanvas.toDataURL("image/png");
    doc.addImage(tableImg, "PNG", 10, 105, 180, 80);
    doc.save("bp_report.pdf");
    statusEl.textContent = "PDF 保存完了";
    showToast("PDF 保存完了✅");
  });

  async function getAll() {
    return (await db.getAll("readings")).sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );
  }

  function aggregate(data, range) {
    if (range === "raw") return data;
    const map = new Map();
    data.forEach((r) => {
      const d = new Date(r.timestamp);
      let key;
      if (range === "daily") key = d.toISOString().slice(0, 10);
      else if (range === "weekly") {
        const w = new Date(d);
        w.setDate(d.getDate() - d.getDay());
        key = w.toISOString().slice(0, 10);
      } else if (range === "monthly") key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    return Array.from(map.entries()).map(([key, arr]) => {
      const avg = (f) => arr.reduce((s, x) => s + x[f], 0) / arr.length;
      return {
        timestamp: key,
        systolic: avg("systolic"),
        diastolic: avg("diastolic"),
        pulse: avg("pulse"),
      };
    });
  }

  // --- Table helpers ---
  async function renderTable() {
    const rows = await getAll();
    let html = `<thead><tr><th>日時</th><th>SYS</th><th>DIA</th><th>PULSE</th><th></th></tr></thead><tbody>`;
    rows.forEach((r) => {
      html += `<tr data-ts="${r.timestamp}"><td>${r.timestamp.slice(0,19)}</td><td>${r.systolic}</td><td>${r.diastolic}</td><td>${r.pulse}</td><td>` +
        `<button class='btn btn-sm btn-outline-secondary me-1 edit-btn'>✏️</button>` +
        `<button class='btn btn-sm btn-outline-danger delete-btn'>🗑️</button></td></tr>`;
    });
    html += "</tbody>";
    dataTable.innerHTML = html;
  }

  async function buildTableHTML() {
    // Returns DOM element of a table for html2canvas
    const wrapper = document.createElement("div");
    wrapper.innerHTML = dataTable.outerHTML;
    return wrapper.firstChild;
  }

  async function updateChart() {
    const raw = await getAll();
    const range = rangeSelect.value;
    const rows = aggregate(raw, range);

    chart.data.labels = []; // use x/y points instead
    chart.data.datasets = [
      {
        label: "SYS",
        borderColor: "red",
        tension: 0.1,
        data: rows.map((r) => ({ x: r.timestamp, y: r.systolic })),
      },
      {
        label: "DIA",
        borderColor: "blue",
        tension: 0.1,
        data: rows.map((r) => ({ x: r.timestamp, y: r.diastolic })),
      },
      {
        label: "PULSE",
        borderColor: "green",
        tension: 0.1,
        data: rows.map((r) => ({ x: r.timestamp, y: r.pulse })),
      },
    ];
    chart.update("active");
    await renderTable();
  }

  updateChart();
  renderTable();
})();
