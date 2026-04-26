import { useId } from "react";
import { APP_NAME } from "@/lib/app-config";

type BrandLogoVariant = "mark" | "wordmark";

function CiphoraMark({
  className = "",
  title,
}: {
  className?: string;
  title?: string;
}) {
  const gradientId = `${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-ciphora-gold`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={className}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="22"
          y1="110"
          x2="104"
          y2="18"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#F5A400" />
          <stop offset="0.5" stopColor="#FFD33D" />
          <stop offset="1" stopColor="#F6A800" />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${gradientId})`} strokeLinejoin="miter">
        <path
          d="M42 45V34C42 20.8 51.8 12 64 12s22 8.8 22 22v11"
          strokeWidth="12"
          strokeLinecap="square"
        />
        <path
          d="M22 56l42-15 42 15v27c0 20.5-15.7 35.8-42 43-26.3-7.2-42-22.5-42-43V56Z"
          strokeWidth="12"
        />
        <path
          d="M76.5 82.5A21.5 21.5 0 1 1 76.5 45.5"
          strokeWidth="12"
          strokeLinecap="butt"
        />
      </g>
      <path
        d="M64 68.5a7.5 7.5 0 1 0-5.4 12.7l-3.3 15.2h17.4l-3.3-15.2A7.5 7.5 0 0 0 64 68.5Z"
        fill={`url(#${gradientId})`}
      />
      <path
        className="ciphora-mark-separator"
        d="M64 42v19M64 93v28"
        strokeWidth="4"
        strokeLinecap="square"
      />
    </svg>
  );
}

export default function BrandLogo({
  variant = "wordmark",
  className = "",
}: {
  variant?: BrandLogoVariant;
  className?: string;
}) {
  if (variant === "mark") {
    return (
      <CiphoraMark
        title={`${APP_NAME} logo`}
        className={`block select-none ${className}`}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={APP_NAME}
      className={`inline-flex items-center gap-2 select-none ${className}`}
    >
      <CiphoraMark
        className="block h-full w-auto shrink-0"
      />
      <span className="ciphora-wordmark-text" aria-hidden="true">
        {"C"}
        <span className="ciphora-wordmark-i">
          ı<span className="ciphora-wordmark-i-dot" />
        </span>
        {"phora"}
      </span>
    </span>
  );
}
