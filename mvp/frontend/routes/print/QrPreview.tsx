import { qrGeometry } from "./artifacts";

export function QrPreview({ destination, preset }: { destination: string; preset: number }) {
  const { view, path, ink } = qrGeometry(destination, preset);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="32mm"
      height="32mm"
      viewBox={`0 0 ${view} ${view}`}
      role="img"
      aria-label="YouTube video QR code"
    >
      <rect width={view} height={view} fill="#ffffff" />
      <path d={path} fill={ink} shapeRendering="crispEdges" />
    </svg>
  );
}
