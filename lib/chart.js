/**
 * Zero-dependency SVG Price History Chart Renderer (Apple Pro Aesthetics)
 * Features tabular numeral alignment, SF Pro typography, frosted glass tooltips,
 * source provenance badge, and boundary-clamped hit targets with zero emojis.
 */

const PriceChart = {
  render(container, points, options = {}) {
    if (!container) return;
    container.innerHTML = '';

    if (!points || points.length === 0) {
      container.innerHTML = '<div class="chart-empty">No price history available.</div>';
      return;
    }

    const width = options.width || container.clientWidth || 352;
    const height = options.height || 150;
    container.style.position = 'relative';
    container.style.height = `${height}px`;
    container.style.overflow = 'visible';

    // Provenance / Source pill badge
    const badgeLabel = options.sourceLabel || (options.isEstimated ? 'Estimated from Live Price & MRP' : 'Verified Multi-Source Curve');
    const estBadge = document.createElement('div');
    estBadge.className = options.isEstimated ? 'chart-estimated-badge' : 'chart-estimated-badge verified';
    estBadge.textContent = badgeLabel;
    container.appendChild(estBadge);

    const padding = { top: 22, right: 18, bottom: 24, left: 52 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    const currency = options.currency || '₹';

    const prices = points.map(p => Number(p.price) || 0);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const range = (maxPrice - minPrice) || (minPrice * 0.1) || 100;
    const yMin = Math.max(0, Math.floor((minPrice - range * 0.08) / 50) * 50);
    const yMax = Math.ceil((maxPrice + range * 0.08) / 50) * 50;
    const yRange = (yMax - yMin) || 1;

    const getX = (i) => padding.left + (points.length > 1 ? (i / (points.length - 1)) * chartW : chartW / 2);
    const getY = (price) => padding.top + chartH - ((price - yMin) / yRange) * chartH;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'price-history-svg');
    svg.style.width = '100%';
    svg.style.height = `${height}px`;
    svg.style.display = 'block';

    const defs = document.createElementNS(svgNS, 'defs');
    defs.innerHTML = `
      <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0A84FF" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#0A84FF" stop-opacity="0.0"/>
      </linearGradient>
      <linearGradient id="strokeGradient" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#0A84FF"/>
        <stop offset="100%" stop-color="#5E5CE6"/>
      </linearGradient>
    `;
    svg.appendChild(defs);

    const gridSteps = [yMin, Math.round((yMin + yMax) / 2), yMax];
    gridSteps.forEach(val => {
      const y = getY(val);
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', padding.left);
      line.setAttribute('y1', y);
      line.setAttribute('x2', width - padding.right);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', 'rgba(255, 255, 255, 0.07)');
      line.setAttribute('stroke-dasharray', '2 2');
      svg.appendChild(line);

      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', padding.left - 6);
      label.setAttribute('y', y + 3.5);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('fill', '#86868B');
      label.setAttribute('font-size', '9.5px');
      label.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif');
      label.setAttribute('style', 'font-variant-numeric: tabular-nums;');
      label.textContent = `${currency}${val.toLocaleString('en-IN')}`;
      svg.appendChild(label);
    });

    // Lowest Price benchmark line (Apple Green #30D158)
    const lowY = getY(minPrice);
    const lowLine = document.createElementNS(svgNS, 'line');
    lowLine.setAttribute('x1', padding.left);
    lowLine.setAttribute('y1', lowY);
    lowLine.setAttribute('x2', width - padding.right);
    lowLine.setAttribute('y2', lowY);
    lowLine.setAttribute('stroke', '#30D158');
    lowLine.setAttribute('stroke-width', '1');
    lowLine.setAttribute('stroke-dasharray', '2 2');
    lowLine.setAttribute('opacity', '0.5');
    svg.appendChild(lowLine);

    const coords = points.map((pt, i) => ({
      x: getX(i),
      y: getY(pt.price),
      ...pt
    }));

    if (coords.length > 1) {
      let areaD = `M ${coords[0].x} ${padding.top + chartH} L ${coords[0].x} ${coords[0].y}`;
      for (let i = 1; i < coords.length; i++) areaD += ` L ${coords[i].x} ${coords[i].y}`;
      areaD += ` L ${coords[coords.length - 1].x} ${padding.top + chartH} Z`;

      const areaPath = document.createElementNS(svgNS, 'path');
      areaPath.setAttribute('d', areaD);
      areaPath.setAttribute('fill', 'url(#chartGradient)');
      svg.appendChild(areaPath);

      let lineD = `M ${coords[0].x} ${coords[0].y}`;
      for (let i = 1; i < coords.length; i++) lineD += ` L ${coords[i].x} ${coords[i].y}`;

      const linePath = document.createElementNS(svgNS, 'path');
      linePath.setAttribute('d', lineD);
      linePath.setAttribute('fill', 'none');
      linePath.setAttribute('stroke', 'url(#strokeGradient)');
      linePath.setAttribute('stroke-width', '2');
      linePath.setAttribute('stroke-linejoin', 'round');
      linePath.setAttribute('stroke-linecap', 'round');
      svg.appendChild(linePath);
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'chart-point-tooltip';
    tooltip.style.position = 'absolute';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.zIndex = '20';
    tooltip.style.opacity = '0';
    tooltip.style.whiteSpace = 'nowrap';
    tooltip.style.transition = 'opacity 0.12s ease, transform 0.12s ease';
    container.appendChild(tooltip);

    const dotsGroup = document.createElementNS(svgNS, 'g');
    dotsGroup.setAttribute('class', 'chart-dots-group');

    coords.forEach((pt, i) => {
      const isLowest = pt.price === minPrice;
      const isCurrent = i === coords.length - 1;

      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', pt.x);
      circle.setAttribute('cy', pt.y);
      circle.setAttribute('r', isLowest || isCurrent ? '3.8' : '2.5');
      circle.setAttribute('fill', isLowest ? '#30D158' : (isCurrent ? '#FF9F0A' : '#0A84FF'));
      circle.setAttribute('stroke', '#09090B');
      circle.setAttribute('stroke-width', '1.5');
      circle.style.pointerEvents = 'none';
      circle.style.transition = 'r 0.15s ease, fill 0.15s ease';
      dotsGroup.appendChild(circle);

      const hitArea = document.createElementNS(svgNS, 'circle');
      hitArea.setAttribute('cx', pt.x);
      hitArea.setAttribute('cy', pt.y);
      hitArea.setAttribute('r', '9');
      hitArea.setAttribute('fill', 'transparent');
      hitArea.style.cursor = 'pointer';

      hitArea.addEventListener('mouseenter', () => {
        circle.setAttribute('r', '5.5');

        tooltip.innerHTML = `
          <div class="tooltip-date">${pt.formattedDate || pt.date}</div>
          <div class="tooltip-price">${currency}${Number(pt.price).toLocaleString('en-IN')}</div>
          ${isLowest ? '<span class="tooltip-tag low">Lowest</span>' : ''}
          ${isCurrent ? '<span class="tooltip-tag cur">Latest</span>' : ''}
        `;

        const contW = container.clientWidth || width;
        let leftX = pt.x;
        let topY = pt.y - 10;
        let transformX = '-50%';
        let transformY = '-100%';

        if (pt.x < 55) {
          leftX = Math.max(8, pt.x - 4);
          transformX = '0%';
        } else if (pt.x > contW - 55) {
          leftX = Math.min(contW - 8, pt.x + 4);
          transformX = '-100%';
        }

        if (pt.y < 42) {
          topY = pt.y + 12;
          transformY = '0%';
        }

        tooltip.style.left = `${leftX}px`;
        tooltip.style.top = `${topY}px`;
        tooltip.style.transform = `translate(${transformX}, ${transformY})`;
        tooltip.style.opacity = '1';
      });

      hitArea.addEventListener('mouseleave', () => {
        circle.setAttribute('r', isLowest || isCurrent ? '3.8' : '2.5');
        tooltip.style.opacity = '0';
      });

      dotsGroup.appendChild(hitArea);
    });

    svg.appendChild(dotsGroup);

    if (coords.length > 0) {
      const labelIndexes = [0, Math.floor(coords.length / 2), coords.length - 1];
      const uniqueIndexes = [...new Set(labelIndexes)];
      uniqueIndexes.forEach(idx => {
        const pt = coords[idx];
        if (!pt) return;
        const text = document.createElementNS(svgNS, 'text');
        text.setAttribute('x', pt.x);
        text.setAttribute('y', height - 6);
        text.setAttribute('text-anchor', idx === 0 ? 'start' : (idx === coords.length - 1 ? 'end' : 'middle'));
        text.setAttribute('fill', '#86868B');
        text.setAttribute('font-size', '9px');
        text.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif');
        text.textContent = pt.formattedDate || pt.date;
        svg.appendChild(text);
      });
    }

    container.appendChild(svg);
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PriceChart;
}
