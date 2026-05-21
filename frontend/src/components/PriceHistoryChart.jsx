import React, { useState, useEffect, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import api from '../api';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const COLORS = [
  { bg: 'rgba(79, 70, 229, 0.1)',  border: 'rgb(79, 70, 229)'  },
  { bg: 'rgba(236, 72, 153, 0.1)', border: 'rgb(236, 72, 153)' },
  { bg: 'rgba(6, 182, 212, 0.1)',  border: 'rgb(6, 182, 212)'  },
  { bg: 'rgba(245, 158, 11, 0.1)', border: 'rgb(245, 158, 11)' },
  { bg: 'rgba(16, 185, 129, 0.1)', border: 'rgb(16, 185, 129)' },
];

const PriceHistoryChart = ({ productId }) => {
  const [priceHistory, setPriceHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchPriceHistory = async () => {
      try {
        setLoading(true);
        const { data } = await api.get(`/api/products/${productId}/price-history`);
        if (data.priceHistory && data.priceHistory.length > 0) {
          setPriceHistory(data.priceHistory);
        } else {
          setError(true);
        }
      } catch (_err) {
        // Chart renders an empty-state card on error already; no toast needed.
        setError(true);
      } finally {
        setLoading(false);
      }
    };
    fetchPriceHistory();
  }, [productId]);

  // Read CSS custom properties once per render instead of forcing five
  // separate style flushes (was 5x getComputedStyle in the options block).
  const themeColors = useMemo(() => {
    if (typeof document === 'undefined') {
      return { text: '#1e293b', muted: '#64748b', border: '#e2e8f0' };
    }
    const cs = getComputedStyle(document.documentElement);
    return {
      text:   cs.getPropertyValue('--sc-text').trim()        || '#1e293b',
      muted:  cs.getPropertyValue('--sc-text-muted').trim()  || '#64748b',
      border: cs.getPropertyValue('--sc-border').trim()      || '#e2e8f0',
    };
  }, [priceHistory]);

  // Build the chart payload from priceHistory. Key correctness point: every
  // chain's data array is aligned to the same `labels` axis (union of all
  // dates, ASC), with `null` filled in for dates the chain didn't update.
  // Previously labels was `.slice(-30)` of the union while each dataset
  // contained the chain's FULL price array — Chart.js plots positionally,
  // so a chain with 50 points and 30 labels rendered its oldest data point
  // under a recent-looking label. The X-axis was lying.
  const chartData = useMemo(() => {
    if (priceHistory.length === 0) return null;
    const byChain = {};
    for (const entry of priceHistory) {
      const chain = entry.chain_name || 'לא ידוע';
      if (!byChain[chain]) byChain[chain] = new Map();
      const dateKey = new Date(entry.updated_at).toLocaleDateString('he-IL');
      // If a chain has multiple updates on the same date, keep the latest.
      byChain[chain].set(dateKey, parseFloat(entry.price));
    }

    const allDateKeys = [
      ...new Set(
        priceHistory.map((p) =>
          new Date(p.updated_at).toLocaleDateString('he-IL'),
        ),
      ),
    ].sort((a, b) => new Date(a) - new Date(b));

    const datasets = Object.keys(byChain).map((chain, idx) => {
      const color = COLORS[idx % COLORS.length];
      return {
        label: chain,
        data: allDateKeys.map((d) => byChain[chain].get(d) ?? null),
        spanGaps: true,
        borderColor: color.border,
        backgroundColor: color.bg,
        borderWidth: 2,
        tension: 0.3,
        fill: true,
        pointRadius: 4,
        pointHoverRadius: 6,
      };
    });

    return { labels: allDateKeys, datasets };
  }, [priceHistory]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: { font: { size: 12, family: 'Segoe UI' }, color: themeColors.text, padding: 12 },
      },
      title: {
        display: true,
        text: 'מגמת מחירים',
        font: { size: 16, weight: 'bold', family: 'Segoe UI' },
        color: themeColors.text,
        padding: { bottom: 20 },
      },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        titleColor: '#fff',
        bodyColor: '#fff',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        padding: 12,
        displayColors: true,
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ₪${ctx.parsed.y.toFixed(2)}`,
        },
      },
    },
    scales: {
      y: {
        beginAtZero: false,
        ticks: {
          callback: (v) => '₪' + v.toFixed(2),
          color: themeColors.muted,
          font: { size: 11 },
        },
        grid: { color: themeColors.border },
      },
      x: {
        ticks: { color: themeColors.muted, font: { size: 11 }, maxRotation: 45, minRotation: 45 },
        grid: { display: false },
      },
    },
  }), [themeColors]);

  if (loading) {
    return (
      <div className="sc-card p-4 text-center">
        <div className="spinner-border spinner-border-sm" style={{ color: 'var(--sc-primary)' }}></div>
        <p className="mt-2 mb-0" style={{ fontSize: '0.85rem', color: 'var(--sc-text-muted)' }}>טוען היסטוריית מחירים...</p>
      </div>
    );
  }

  if (error || !chartData) {
    return (
      <div className="sc-card p-4 text-center" style={{ background: 'rgba(100,116,139,0.05)' }}>
        <i className="bi bi-graph-up" style={{ fontSize: '2rem', color: 'var(--sc-text-muted)', opacity: 0.3 }}></i>
        <p className="mt-2 mb-0" style={{ fontSize: '0.85rem', color: 'var(--sc-text-muted)' }}>
          אין נתוני היסטוריית מחירים זמינים עבור מוצר זה
        </p>
      </div>
    );
  }

  // Stat strip. Renamed "מחיר נוכחי" (current price) to "מחיר אחרון" (latest
  // price): the backend orders by updated_at DESC across all chains, so the
  // first element is the most-recent update somewhere — not "current" at
  // any specific chain. Calling it "latest" actually matches what it is.
  const allPrices = priceHistory.map((p) => parseFloat(p.price));
  const latestPrice = allPrices[0];
  const avgPrice = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);

  return (
    <div className="sc-card p-4">
      <div className="row mb-3">
        <div className="col-6 col-md-3 mb-2">
          <small style={{ color: 'var(--sc-text-muted)', fontSize: '0.75rem' }}>מחיר אחרון</small>
          <div className="fw-bold" style={{ fontSize: '1.1rem', color: 'var(--sc-primary)' }}>₪{latestPrice?.toFixed(2)}</div>
        </div>
        <div className="col-6 col-md-3 mb-2">
          <small style={{ color: 'var(--sc-text-muted)', fontSize: '0.75rem' }}>ממוצע</small>
          <div className="fw-bold" style={{ fontSize: '1.1rem' }}>₪{avgPrice.toFixed(2)}</div>
        </div>
        <div className="col-6 col-md-3 mb-2">
          <small style={{ color: 'var(--sc-text-muted)', fontSize: '0.75rem' }}>מינימום</small>
          <div className="fw-bold" style={{ fontSize: '1.1rem', color: 'var(--sc-success)' }}>₪{minPrice.toFixed(2)}</div>
        </div>
        <div className="col-6 col-md-3 mb-2">
          <small style={{ color: 'var(--sc-text-muted)', fontSize: '0.75rem' }}>מקסימום</small>
          <div className="fw-bold" style={{ fontSize: '1.1rem', color: 'var(--sc-danger)' }}>₪{maxPrice.toFixed(2)}</div>
        </div>
      </div>
      <div style={{ height: '280px' }}>
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
};

export default PriceHistoryChart;
