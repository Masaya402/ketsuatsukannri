const ctx = document.getElementById("bpChart");
let bpChart;

async function fetchData() {
  const res = await fetch("/data");
  const data = await res.json();
  return data;
}

function groupByPeriod(data, period) {
  const groups = {};
  data.forEach((d) => {
    const date = new Date(d.timestamp);
    let key;
    if (period === "daily") {
      key = date.toISOString().slice(0, 10); // YYYY-MM-DD
    } else if (period === "weekly") {
      const first = new Date(date);
      first.setDate(first.getDate() - first.getDay());
      key = first.toISOString().slice(0, 10);
    } else if (period === "monthly") {
      key = date.toISOString().slice(0, 7); // YYYY-MM
    } else {
      key = d.timestamp;
    }
    if (!groups[key]) {
      groups[key] = { systolic: [], diastolic: [], pulse: [] };
    }
    groups[key].systolic.push(d.systolic);
    groups[key].diastolic.push(d.diastolic);
    groups[key].pulse.push(d.pulse);
  });

  return Object.entries(groups).map(([k, v]) => {
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    return {
      label: k,
      systolic: avg(v.systolic),
      diastolic: avg(v.diastolic),
      pulse: avg(v.pulse),
    };
  });
}

function buildChart(data, period = "raw") {
    let processed = data;
  if (period !== "raw") {
    processed = groupByPeriod(data, period);
  }
  const labels = processed.map((d) => d.label || new Date(d.timestamp).toLocaleString());
  const sys = processed.map((d) => d.systolic);
  const dia = processed.map((d) => d.diastolic);
  const pulse = processed.map((d) => d.pulse);

  if (bpChart) {
    bpChart.destroy();
  }

  bpChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "収縮期 (SYS)",
          data: sys,
          borderColor: "#dc3545",
          tension: 0.2,
        },
        {
          label: "拡張期 (DIA)",
          data: dia,
          borderColor: "#0d6efd",
          tension: 0.2,
        },
        {
          label: "脈拍 (PULSE)",
          data: pulse,
          borderColor: "#198754",
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: false,
        },
      },
    },
  });
}

async function refresh() {
  const period = document.getElementById("rangeSelect").value;
  const data = await fetchData();
  buildChart(data, period);
}

document.getElementById("uploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("status");
  statusEl.textContent = "解析中...";

  const formData = new FormData(e.target);
  try {
    const res = await fetch("/upload", {
      method: "POST",
      body: formData,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Upload failed");

    statusEl.textContent = `SYS ${json.systolic}/DIA ${json.diastolic} PULSE ${json.pulse}`;
    await refresh();
  } catch (err) {
    statusEl.textContent = err.message;
  }
});

window.addEventListener("DOMContentLoaded", refresh);

document.getElementById("rangeSelect").addEventListener("change", refresh);

document.getElementById("pdfBtn").addEventListener("click", () => {
  const from = prompt("開始日 (YYYY-MM-DD)");
  const to = prompt("終了日 (YYYY-MM-DD)");
  if (!from || !to) return;
  window.open(`/report?from=${from}&to=${to}`, "_blank");
});

document.getElementById("manualForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const params = new URLSearchParams(formData);
  try {
    const res = await fetch("/add", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Add failed");
    document.getElementById("status").textContent = `手入力: SYS ${json.systolic}/DIA ${json.diastolic} PULSE ${json.pulse}`;
    await refresh();
  } catch (err) {
    document.getElementById("status").textContent = err.message;
  }
});
