const SPIKE_PATH = (() => {
  const points = [];
  for (let i = 0; i < 16; i += 1) {
    const radius = i % 2 === 0 ? 11 : 3.2;
    const angle = (Math.PI / 8) * i - Math.PI / 2;
    points.push(`${(12 + radius * Math.cos(angle)).toFixed(2)} ${(12 + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join(' L')}Z`;
})();

export default function Spike({ size = 16 }) {
  return (
    <svg className="spike" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d={SPIKE_PATH} />
    </svg>
  );
}
