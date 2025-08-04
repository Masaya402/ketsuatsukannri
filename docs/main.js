// Placeholder JS – full client implementation will be added in next step
// Client-side blood pressure manager Phase 1: manual entry + IndexedDB + Chart.js

(async () => {
  const db = await idb.openDB("bp-db", 1, {
    upgrade(db) {
      db.createObjectStore("readings", { keyPath: "timestamp" });
    },
  });

  const statusEl = document.getElementById("status");
  const form = document.getElementById("manualForm");
  const rangeSelect = document.getElementById("rangeSelect");
  const ctx = document.getElementById("bpChart").getContext("2d");

  const chart = new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      scales: { x: { type: "time", time: { unit: "day" } } },
    },
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const ts = data.date ? `${data.date}T00:00:00` : new Date().toISOString();
    const reading = {
      timestamp: ts,
      systolic: Number(data.systolic),
      diastolic: Number(data.diastolic),
      pulse: Number(data.pulse),
    };
    await db.put("readings", reading);
    statusEl.textContent = "保存しました";
    form.reset();
    updateChart();
  });

  rangeSelect.addEventListener("change", updateChart);

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

  async function updateChart() {
    const raw = await getAll();
    const range = rangeSelect.value;
    const data = aggregate(raw, range);
    chart.data.labels = data.map((d) => d.timestamp);
    chart.data.datasets = [
      { label: "SYS", data: data.map((d) => d.systolic), borderColor: "red" },
      { label: "DIA", data: data.map((d) => d.diastolic), borderColor: "blue" },
      { label: "PULSE", data: data.map((d) => d.pulse), borderColor: "green" },
    ];
    chart.update();
  }

  updateChart();
})();
