import React, { useId } from "react";

export const AGY_LOGO_PATH =
  "M19.94 20.59c1.09.82 2.73.27 1.23-1.23C16.67 15 17.62 3 12.03 3S7.39 15 2.89 19.36c-1.64 1.64.14 2.05 1.23 1.23c4.23-2.86 3.95-7.91 7.91-7.91s3.68 5.05 7.91 7.91";

/** Authentic Antigravity soaring mark, optionally filled to a 0–100 remaining percentage. */
export function AgyMark({
  size = 20,
  fillPercent = 100,
  prism = true,
  tint,
}: {
  size?: number;
  fillPercent?: number;
  prism?: boolean;
  tint?: string;
}) {
  const uid = useId();
  const clamped = Math.max(0, Math.min(100, fillPercent));
  const fillH = 18 * (clamped / 100);
  const fillY = 21 - fillH;
  const fillColor = tint ? tint : prism ? `url(#${uid}-grad)` : "currentColor";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${uid}-grad`} x1="2" y1="21" x2="22" y2="3">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="55%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
        <clipPath id={`${uid}-clip`}>
          <path d={AGY_LOGO_PATH} />
        </clipPath>
      </defs>
      <path d={AGY_LOGO_PATH} fill={fillColor} fillOpacity="0.22" />
      {clamped > 0 && (
        <rect
          x="0"
          y={fillY}
          width="24"
          height={fillH + 1}
          fill={fillColor}
          clipPath={`url(#${uid}-clip)`}
        />
      )}
    </svg>
  );
}
