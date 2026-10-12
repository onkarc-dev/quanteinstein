"use client";

import React, { useState } from "react";

export interface InfoTipProps {
  text: string;
  size?: "sm" | "md";
}

export function InfoTip({ text, size = "sm" }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{
    top: number;
    bottom: number;
    left: number;
    winW: number;
    winH: number;
  } | null>(null);

  if (!text) return null;

  const dim = size === "md" ? 18 : 15;

  function handleEnter(e: React.MouseEvent<HTMLSpanElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setCoords({
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      winW: typeof window !== "undefined" ? window.innerWidth : 1200,
      winH: typeof window !== "undefined" ? window.innerHeight : 800,
    });
    setOpen(true);
  }

  function handleLeave() {
    setOpen(false);
  }

  const showBelow = coords ? coords.top < 110 : false;
  const clampedLeft = coords
    ? Math.min(Math.max(12, coords.left - 8), Math.max(12, coords.winW - 320))
    : 0;

  return (
    <span
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (open) {
          setOpen(false);
        } else {
          handleEnter(e);
        }
      }}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: dim,
        height: dim,
        borderRadius: "50%",
        background: open ? "rgba(56, 189, 248, 0.22)" : "rgba(148, 163, 184, 0.14)",
        border: `1px solid ${open ? "#38bdf8" : "rgba(148, 163, 184, 0.38)"}`,
        color: open ? "#38bdf8" : "#94a3b8",
        fontSize: size === "md" ? 11 : 10,
        fontWeight: 700,
        fontStyle: "italic",
        fontFamily: "Georgia, serif",
        cursor: "help",
        userSelect: "none",
        flexShrink: 0,
        transition: "all 0.15s ease",
        verticalAlign: "middle",
        lineHeight: 1,
      }}
      aria-label={text}
    >
      i
      {open && coords && (
        <span
          style={{
            position: "fixed",
            ...(showBelow
              ? { top: coords.bottom + 8 }
              : { bottom: coords.winH - coords.top + 8 }),
            left: clampedLeft,
            background: "rgba(15, 23, 42, 0.98)",
            border: "1px solid rgba(56, 189, 248, 0.45)",
            boxShadow:
              "0 12px 28px -4px rgba(0, 0, 0, 0.85), 0 0 14px rgba(56, 189, 248, 0.2)",
            color: "#f1f5f9",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 500,
            fontStyle: "normal",
            fontFamily: "system-ui, -apple-system, sans-serif",
            lineHeight: 1.45,
            textTransform: "none",
            letterSpacing: "normal",
            whiteSpace: "normal",
            width: "max-content",
            maxWidth: 300,
            zIndex: 99999,
            pointerEvents: "none",
            textAlign: "left",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

export function LabelWithInfo({
  title,
  info,
}: {
  title: string;
  info: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
      }}
    >
      <span>{title}</span>
      <InfoTip text={info} size="sm" />
    </span>
  );
}

export default InfoTip;

