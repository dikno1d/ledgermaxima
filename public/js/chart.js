const COLORS = [
  ['#f59e0b', '#d97706'],
  ['#10b981', '#059669'],
  ['#3b82f6', '#2563eb'],
  ['#8b5cf6', '#7c3aed'],
  ['#ec4899', '#db2777'],
  ['#06b6d4', '#0891b2'],
  ['#84cc16', '#65a30d'],
  ['#f97316', '#ea580c'],
  ['#6366f1', '#4f46e5'],
  ['#14b8a6', '#0d9488'],
];
const UNALLOC_COLOR = ['#334155', '#1e293b'];

function drawPieChart(canvasId, data, total, centerId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = Math.min(canvas.parentElement.clientWidth, canvas.parentElement.clientHeight) || 260;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  ctx.scale(dpr, dpr);

  const cx = size / 2, cy = size / 2;
  const radius = size * 0.38;
  const innerRadius = radius * 0.5;

  const slices = data.map((d, i) => ({
    label: d.name,
    value: d.amount,
    color: COLORS[i % COLORS.length],
  }));

  const allocSum = slices.reduce((s, sl) => s + sl.value, 0);
  const unalloc = Math.max(0, total - allocSum);
  if (unalloc > 0) {
    slices.push({ label: 'Unallocated', value: unalloc, color: UNALLOC_COLOR });
  }

  const grandTotal = slices.reduce((s, sl) => s + sl.value, 0);
  if (grandTotal === 0) {
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = `${size * 0.045}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('No data', cx, cy);
    return;
  }

  if (centerId) {
    document.getElementById(centerId).textContent = '₹' + grandTotal.toLocaleString();
  }

  let currentAngle = -Math.PI / 2;
  let hoveredSlice = -1;
  let animProgress = 0;
  let animId = null;

  function draw(progress, hoverIdx) {
    ctx.clearRect(0, 0, size, size);

    slices.forEach((slice, idx) => {
      const sliceAngle = (slice.value / grandTotal) * Math.PI * 2 * progress;
      const endAngle = currentAngle + sliceAngle;
      const isHovered = idx === hoverIdx;
      const explode = isHovered ? radius * 0.06 : 0;
      const midAngle = currentAngle + sliceAngle / 2;
      const ex = Math.cos(midAngle) * explode;
      const ey = Math.sin(midAngle) * explode;

      const grad = ctx.createRadialGradient(cx + ex, cy + ey, 0, cx + ex, cy + ey, radius);
      grad.addColorStop(0, slice.color[0] + 'cc');
      grad.addColorStop(1, slice.color[1] + 'cc');

      ctx.beginPath();
      ctx.moveTo(cx + ex, cy + ey);
      ctx.arc(cx + ex, cy + ey, radius, currentAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.shadowColor = slice.color[0] + '60';
      ctx.shadowBlur = isHovered ? 20 : 8;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (progress >= 1 && slice.value / grandTotal > 0.04) {
        const la = currentAngle + sliceAngle / 2;
        const lr = radius * 0.7;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = `bold ${size * 0.035}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(Math.round((slice.value / grandTotal) * 100) + '%', cx + ex + Math.cos(la) * lr, cy + ey + Math.sin(la) * lr);
      }
      currentAngle = endAngle;
    });

    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.stroke();
    currentAngle = -Math.PI / 2;
  }

  function animate() {
    animProgress += 0.03;
    if (animProgress > 1) animProgress = 1;
    draw(animProgress, hoveredSlice);
    if (animProgress < 1) animId = requestAnimationFrame(animate);
  }
  if (animId) cancelAnimationFrame(animId);
  animate();

  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    return { mx: (e.clientX || e.touches?.[0]?.clientX || 0) - r.left, my: (e.clientY || e.touches?.[0]?.clientY || 0) - r.top };
  }

  function handleHover(e) {
    const { mx, my } = getPos(e);
    const dx = mx - cx, dy = my - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < innerRadius || dist > radius) {
      if (hoveredSlice !== -1) { hoveredSlice = -1; animProgress = 0; animate(); }
      return;
    }
    let angle = Math.atan2(dy, dx);
    if (angle < -Math.PI / 2) angle += Math.PI * 2;
    let cum = -Math.PI / 2;
    let found = -1;
    for (let i = 0; i < slices.length; i++) {
      cum += (slices[i].value / grandTotal) * Math.PI * 2;
      if (angle <= cum) { found = i; break; }
    }
    if (found !== hoveredSlice) { hoveredSlice = found; animProgress = 0; animate(); }
  }

  canvas.onmousemove = handleHover;
  canvas.onmouseleave = () => { if (hoveredSlice !== -1) { hoveredSlice = -1; animProgress = 0; animate(); } };
  canvas.ontouchmove = (e) => { e.preventDefault(); handleHover(e); };

  return slices;
}

function drawBarChart(containerId, allocations, total) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const allocSum = allocations.reduce((s, a) => s + a.amount, 0);
  const unalloc = Math.max(0, total - allocSum);
  const allItems = allocations.map((a, i) => ({ label: a.name, value: a.amount, color: COLORS[i % COLORS.length], pct: total > 0 ? (a.amount / total) * 100 : 0, target: a.targetAmount || 0, goalPct: a.goalPercent || 0 }));
  if (unalloc > 0) allItems.push({ label: 'Unallocated', value: unalloc, color: UNALLOC_COLOR, pct: (unalloc / total) * 100, target: 0, goalPct: 0 });

  if (allItems.length === 0) {
    container.innerHTML = '<div class="text-center text-slate-600 py-6 text-sm">No allocations</div>';
    return;
  }

  container.innerHTML = allItems.map(item => {
    const goalPct = item.goalPct;
    const gbColor = goalPct >= 100 ? 'bg-emerald-500' : goalPct > 0 ? 'bg-cyan-500' : 'bg-slate-600';
    return `
    <div class="bar-item fade-in">
      <div class="flex justify-between text-xs mb-1">
        <span class="text-slate-300">${item.label}</span>
        <span class="text-slate-400">₹${item.value.toLocaleString()} (${Math.round(item.pct)}%)</span>
      </div>
      <div class="w-full h-2.5 bg-white/5 rounded-full overflow-hidden">
        <div class="h-full rounded-full transition-all duration-1000 ease-out"
             style="width: ${Math.min(100, item.pct)}%; background: linear-gradient(90deg, ${item.color[0]}, ${item.color[1]})">
        </div>
      </div>
      ${item.target > 0 ? `
      <div class="flex justify-between text-[10px] mt-1.5">
        <span class="text-slate-500">Goal: ₹${item.target.toLocaleString()}</span>
        <span class="${goalPct >= 100 ? 'text-emerald-400' : 'text-cyan-400'}">${goalPct}% collected</span>
      </div>
      <div class="w-full h-1 bg-white/5 rounded-full overflow-hidden">
        <div class="h-full rounded-full transition-all duration-700 ease-out ${gbColor}" style="width:${Math.min(goalPct, 100)}%"></div>
      </div>` : ''}
    </div>`;
  }).join('');

  requestAnimationFrame(() => {
    container.querySelectorAll('.bar-item').forEach((el, i) => {
      el.style.animationDelay = (i * 0.1) + 's';
    });
  });
}

function renderChartLegend(legendId, slices) {
  const el = document.getElementById(legendId);
  if (!el) return;
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  el.innerHTML = slices.map(s => `
    <div class="flex items-center gap-1.5 px-2.5 py-1 bg-white/[0.03] rounded-lg border border-white/5">
      <span class="w-2.5 h-2.5 rounded-full" style="background: ${s.color[0]}"></span>
      <span class="text-[11px] text-slate-300">${s.label}</span>
      <span class="text-[11px] text-slate-500">₹${s.value.toLocaleString()} (${total > 0 ? Math.round((s.value/total)*100) : 0}%)</span>
    </div>
  `).join('');
}
