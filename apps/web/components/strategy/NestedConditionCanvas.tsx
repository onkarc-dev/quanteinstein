"use client";

import React from "react";
import { RuleGroup, SingleRule, LogicalOperator, ComparisonOperator, ConditionOperand } from "../../types/strategy_v3";

interface Props {
  group: RuleGroup;
  onChange: (updated: RuleGroup) => void;
  availableSymbols: string[];
  depth?: number;
}

const TIMEFRAME_OPTIONS = ["1m", "5m", "15m", "1h", "4h", "1d"];

const OPERATOR_LABELS: Record<string, string> = {
  ">": "> Greater Than",
  ">=": ">= Greater or Equal",
  "<": "< Less Than",
  "<=": "<= Less or Equal",
  "==": "== Equals",
  "!=": "!= Not Equals",
  "CROSSES_ABOVE": "Crosses Above",
  "CROSSES_BELOW": "Crosses Below",
};

export default function NestedConditionCanvas({
  group,
  onChange,
  availableSymbols,
  depth = 0,
}: Props) {
  function updateLogicalOp(op: LogicalOperator) {
    onChange({ ...group, logicalOperator: op });
  }

  function addRule() {
    const newRule: SingleRule = {
      id: "rule_" + Math.random().toString(36).slice(2, 9),
      type: "RULE",
      leftOperand: {
        type: "INDICATOR",
        timeframe: "1h",
        indicator: "EMA",
        params: { period: 20 },
        field: "close",
      },
      operator: ">",
      rightOperand: {
        type: "INDICATOR",
        timeframe: "1h",
        indicator: "EMA",
        params: { period: 50 },
        field: "close",
      },
    };
    onChange({ ...group, conditions: [...group.conditions, newRule] });
  }

  function addRelativeValueRule() {
    const symA = availableSymbols[0] || "BTCUSDT";
    const symB = availableSymbols[1] || "ETHUSDT";
    const newRule: SingleRule = {
      id: "rule_rv_" + Math.random().toString(36).slice(2, 9),
      type: "RULE",
      leftOperand: {
        type: "RELATIVE_VALUE_SPREAD",
        assetA: symA,
        assetB: symB,
        timeframe: "1h",
        hedgeRatio: 1.0,
        metric: "Z_SCORE",
        zScoreLookback: 30,
      },
      operator: "<=",
      rightOperand: {
        type: "CONSTANT",
        value: -2.0,
      },
    };
    onChange({ ...group, conditions: [...group.conditions, newRule] });
  }

  function addNestedGroup() {
    const subGroup: RuleGroup = {
      id: "group_" + Math.random().toString(36).slice(2, 9),
      type: "GROUP",
      logicalOperator: "AND",
      conditions: [],
    };
    onChange({ ...group, conditions: [...group.conditions, subGroup] });
  }

  function removeCondition(id: string) {
    onChange({ ...group, conditions: group.conditions.filter((c) => c.id !== id) });
  }

  function updateChild(id: string, updated: SingleRule | RuleGroup) {
    onChange({
      ...group,
      conditions: group.conditions.map((c) => (c.id === id ? updated : c)),
    });
  }

  const selectStyle: React.CSSProperties = {
    background: "#0a0f1d",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    color: "#f8fafc",
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 12,
    fontWeight: 600,
    outline: "none",
    width: "auto",
    cursor: "pointer",
  };

  const inputStyle: React.CSSProperties = {
    background: "#0a0f1d",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    color: "#f8fafc",
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 12,
    outline: "none",
    width: "60px",
    textAlign: "center",
  };

  const depthBorderColor = depth === 0 ? "rgba(168, 85, 247, 0.35)" : depth === 1 ? "rgba(56, 189, 248, 0.35)" : "rgba(244, 63, 94, 0.35)";

  return (
    <div
      style={{
        background: depth === 0 ? "rgba(10, 14, 24, 0.85)" : "rgba(6, 10, 18, 0.9)",
        border: `1.5px solid ${depthBorderColor}`,
        borderRadius: 14,
        padding: depth === 0 ? "16px 18px" : "12px 14px",
        margin: depth > 0 ? "10px 0" : "0",
        boxShadow: depth === 0 ? "0 8px 24px rgba(0, 0, 0, 0.25)" : "none",
      }}
    >
      {/* ─── Group Header & Control Toolbar ─── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          paddingBottom: 12,
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          marginBottom: 12,
        }}
      >
        {/* Logical Operator Switcher */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Logic Block {depth > 0 ? `(Level ${depth})` : ""}:
          </span>

          <div style={{ display: "inline-flex", background: "#060911", borderRadius: 8, padding: 3, border: "1px solid rgba(255, 255, 255, 0.08)" }}>
            {(["AND", "OR", "NOT"] as LogicalOperator[]).map((op) => {
              const active = group.logicalOperator === op;
              const activeColor = op === "AND" ? "#0284c7" : op === "OR" ? "#7c3aed" : "#e11d48";
              return (
                <button
                  key={op}
                  type="button"
                  onClick={() => updateLogicalOp(op)}
                  style={{
                    background: active ? activeColor : "transparent",
                    color: active ? "#ffffff" : "#64748b",
                    border: "none",
                    borderRadius: 6,
                    padding: "4px 12px",
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: "pointer",
                    transition: "all 0.12s ease",
                  }}
                >
                  {op}
                </button>
              );
            })}
          </div>

          <span style={{ fontSize: 11, color: "#64748b" }}>
            {group.logicalOperator === "AND"
              ? "All rules in this block must be TRUE"
              : group.logicalOperator === "OR"
              ? "At least one rule must be TRUE"
              : "Inverts condition evaluation (NOT TRUE)"}
          </span>
        </div>

        {/* Action Buttons: Add Rules */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={addRule}
            style={{
              background: "rgba(16, 185, 129, 0.15)",
              color: "#34d399",
              border: "1px solid rgba(16, 185, 129, 0.35)",
              borderRadius: 6,
              padding: "5px 10px",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span>+</span> Standard Indicator
          </button>

          <button
            type="button"
            onClick={addRelativeValueRule}
            style={{
              background: "rgba(168, 85, 247, 0.15)",
              color: "#c084fc",
              border: "1px solid rgba(168, 85, 247, 0.35)",
              borderRadius: 6,
              padding: "5px 10px",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span>+</span> Spread Z-Score
          </button>

          {depth < 2 && (
            <button
              type="button"
              onClick={addNestedGroup}
              style={{
                background: "rgba(56, 189, 248, 0.15)",
                color: "#38bdf8",
                border: "1px solid rgba(56, 189, 248, 0.35)",
                borderRadius: 6,
                padding: "5px 10px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span>+</span> Nested Block
            </button>
          )}
        </div>
      </div>

      {/* ─── Conditions List ─── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {group.conditions.length === 0 ? (
          <div
            style={{
              padding: "24px 16px",
              textAlign: "center",
              background: "rgba(255, 255, 255, 0.02)",
              borderRadius: 10,
              border: "1px dashed rgba(255, 255, 255, 0.08)",
              color: "#64748b",
              fontSize: 12,
            }}
          >
            No rules in this block yet. Click <strong>+ Standard Indicator</strong> or <strong>+ Spread Z-Score</strong> above.
          </div>
        ) : (
          group.conditions.map((item, idx) => {
            if (item.type === "GROUP") {
              return (
                <div key={item.id} style={{ position: "relative" }}>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: -6 }}>
                    <button
                      type="button"
                      onClick={() => removeCondition(item.id)}
                      style={{
                        background: "rgba(239, 68, 68, 0.12)",
                        border: "1px solid rgba(239, 68, 68, 0.3)",
                        color: "#f87171",
                        fontSize: 10,
                        fontWeight: 700,
                        borderRadius: 4,
                        padding: "3px 8px",
                        cursor: "pointer",
                        zIndex: 2,
                      }}
                    >
                      ✕ Remove Nested Block
                    </button>
                  </div>
                  <NestedConditionCanvas
                    group={item}
                    onChange={(upd) => updateChild(item.id, upd)}
                    availableSymbols={availableSymbols}
                    depth={depth + 1}
                  />
                </div>
              );
            }

            // Single Rule Row
            const isRv = item.leftOperand.type === "RELATIVE_VALUE_SPREAD";

            return (
              <div
                key={item.id}
                style={{
                  background: isRv ? "rgba(24, 16, 42, 0.85)" : "rgba(10, 16, 28, 0.85)",
                  border: isRv ? "1px solid rgba(168, 85, 247, 0.25)" : "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 10,
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                  transition: "all 0.12s ease",
                }}
              >
                {/* Rule Index Pill */}
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: isRv ? "rgba(168, 85, 247, 0.2)" : "rgba(56, 189, 248, 0.2)",
                    color: isRv ? "#c084fc" : "#38bdf8",
                  }}
                >
                  #{idx + 1}
                </span>

                {/* ─── LEFT OPERAND ─── */}
                {isRv ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: "rgba(168, 85, 247, 0.12)",
                      border: "1px solid rgba(168, 85, 247, 0.3)",
                      borderRadius: 6,
                      padding: "4px 8px",
                    }}
                  >
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#c084fc" }}>SPREAD Z-SCORE</span>
                    <select
                      value={(item.leftOperand as any).assetA}
                      onChange={(e) =>
                        updateChild(item.id, {
                          ...item,
                          leftOperand: { ...item.leftOperand, assetA: e.target.value } as any,
                        })
                      }
                      style={{ ...selectStyle, padding: "4px 6px", fontSize: 11 }}
                    >
                      {availableSymbols.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <span style={{ color: "#94a3b8", fontSize: 11 }}>-</span>
                    <select
                      value={(item.leftOperand as any).assetB}
                      onChange={(e) =>
                        updateChild(item.id, {
                          ...item,
                          leftOperand: { ...item.leftOperand, assetB: e.target.value } as any,
                        })
                      }
                      style={{ ...selectStyle, padding: "4px 6px", fontSize: 11 }}
                    >
                      {availableSymbols.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <span style={{ color: "#94a3b8", fontSize: 10, marginLeft: 2 }}>Lookback:</span>
                    <input
                      type="number"
                      value={(item.leftOperand as any).zScoreLookback || 30}
                      onChange={(e) =>
                        updateChild(item.id, {
                          ...item,
                          leftOperand: { ...item.leftOperand, zScoreLookback: Number(e.target.value) } as any,
                        })
                      }
                      style={{ ...inputStyle, width: "45px", padding: "4px 4px", fontSize: 11 }}
                    />
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: "rgba(56, 189, 248, 0.08)",
                      border: "1px solid rgba(56, 189, 248, 0.25)",
                      borderRadius: 6,
                      padding: "4px 8px",
                    }}
                  >
                    {/* Timeframe */}
                    <select
                      value={(item.leftOperand as any).timeframe}
                      onChange={(e) =>
                        updateChild(item.id, {
                          ...item,
                          leftOperand: { ...item.leftOperand, timeframe: e.target.value } as any,
                        })
                      }
                      style={{ ...selectStyle, color: "#38bdf8", padding: "4px 6px", fontSize: 11 }}
                    >
                      {TIMEFRAME_OPTIONS.map((tf) => (
                        <option key={tf} value={tf}>
                          {tf}
                        </option>
                      ))}
                    </select>

                    {/* Indicator */}
                    <select
                      value={(item.leftOperand as any).indicator}
                      onChange={(e) =>
                        updateChild(item.id, {
                          ...item,
                          leftOperand: { ...item.leftOperand, indicator: e.target.value } as any,
                        })
                      }
                      style={{ ...selectStyle, padding: "4px 6px", fontSize: 11 }}
                    >
                      <option value="EMA">EMA</option>
                      <option value="SMA">SMA</option>
                      <option value="RSI">RSI</option>
                      <option value="ATR">ATR</option>
                      <option value="PRICE">Price (Close)</option>
                      <option value="RETURN">Return (%)</option>
                    </select>

                    {/* Period (for EMA, SMA, RSI, ATR, Return) */}
                    {(item.leftOperand as any).indicator !== "PRICE" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                        <span style={{ fontSize: 10, color: "#64748b" }}>N:</span>
                        <input
                          type="number"
                          value={Number((item.leftOperand as any).params?.period || 20)}
                          onChange={(e) =>
                            updateChild(item.id, {
                              ...item,
                              leftOperand: {
                                ...item.leftOperand,
                                params: { ...(item.leftOperand as any).params, period: Number(e.target.value) },
                              } as any,
                            })
                          }
                          style={{ ...inputStyle, width: "45px", padding: "4px 4px", fontSize: 11 }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* ─── COMPARISON OPERATOR ─── */}
                <select
                  value={item.operator}
                  onChange={(e) =>
                    updateChild(item.id, { ...item, operator: e.target.value as ComparisonOperator })
                  }
                  style={{
                    background: "rgba(245, 158, 11, 0.15)",
                    border: "1.5px solid rgba(245, 158, 11, 0.4)",
                    color: "#fbbf24",
                    borderRadius: 6,
                    padding: "5px 8px",
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: "pointer",
                    outline: "none",
                    width: "auto",
                  }}
                >
                  <option value=">">&gt; (Greater Than)</option>
                  <option value=">=">&gt;= (Greater or Equal)</option>
                  <option value="<">&lt; (Less Than)</option>
                  <option value="<=">&lt;= (Less or Equal)</option>
                  <option value="==">== (Equals)</option>
                  <option value="!=">!= (Not Equal)</option>
                  <option value="CROSSES_ABOVE">Crosses Above</option>
                  <option value="CROSSES_BELOW">Crosses Below</option>
                </select>

                {/* ─── RIGHT OPERAND ─── */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {/* Operand Type Switcher */}
                  <select
                    value={item.rightOperand.type}
                    onChange={(e) => {
                      const newType = e.target.value;
                      if (newType === "CONSTANT") {
                        updateChild(item.id, {
                          ...item,
                          rightOperand: { type: "CONSTANT", value: 50 },
                        });
                      } else {
                        updateChild(item.id, {
                          ...item,
                          rightOperand: {
                            type: "INDICATOR",
                            timeframe: "1h",
                            indicator: "SMA",
                            params: { period: 50 },
                            field: "close",
                          },
                        });
                      }
                    }}
                    style={{ ...selectStyle, padding: "4px 6px", fontSize: 11, color: "#94a3b8" }}
                  >
                    <option value="CONSTANT">Numeric Value</option>
                    <option value="INDICATOR">Indicator / Reference</option>
                  </select>

                  {item.rightOperand.type === "CONSTANT" ? (
                    <input
                      type="number"
                      step="any"
                      value={Number((item.rightOperand as any).value ?? 0)}
                      onChange={(e) =>
                        updateChild(item.id, {
                          ...item,
                          rightOperand: { type: "CONSTANT", value: Number(e.target.value) },
                        })
                      }
                      style={{ ...inputStyle, width: "70px", padding: "4px 6px", fontSize: 11 }}
                    />

                  ) : (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        background: "rgba(255, 255, 255, 0.03)",
                        border: "1px solid rgba(255, 255, 255, 0.1)",
                        borderRadius: 6,
                        padding: "4px 6px",
                      }}
                    >
                      <select
                        value={(item.rightOperand as any).timeframe || "1h"}
                        onChange={(e) =>
                          updateChild(item.id, {
                            ...item,
                            rightOperand: { ...item.rightOperand, timeframe: e.target.value } as any,
                          })
                        }
                        style={{ ...selectStyle, color: "#38bdf8", padding: "4px 6px", fontSize: 11 }}
                      >
                        {TIMEFRAME_OPTIONS.map((tf) => (
                          <option key={tf} value={tf}>
                            {tf}
                          </option>
                        ))}
                      </select>

                      <select
                        value={(item.rightOperand as any).indicator || "EMA"}
                        onChange={(e) =>
                          updateChild(item.id, {
                            ...item,
                            rightOperand: { ...item.rightOperand, indicator: e.target.value } as any,
                          })
                        }
                        style={{ ...selectStyle, padding: "4px 6px", fontSize: 11 }}
                      >
                        <option value="EMA">EMA</option>
                        <option value="SMA">SMA</option>
                        <option value="RSI">RSI</option>
                        <option value="ATR">ATR</option>
                        <option value="PRICE">Price</option>
                        <option value="RETURN">Return (%)</option>
                      </select>

                      {(item.rightOperand as any).indicator !== "PRICE" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                          <span style={{ fontSize: 10, color: "#64748b" }}>N:</span>
                          <input
                            type="number"
                            value={Number((item.rightOperand as any).params?.period || 50)}
                            onChange={(e) =>
                              updateChild(item.id, {
                                ...item,
                                rightOperand: {
                                  ...item.rightOperand,
                                  params: { ...(item.rightOperand as any).params, period: Number(e.target.value) },
                                } as any,
                              })
                            }
                            style={{ ...inputStyle, width: "45px", padding: "4px 4px", fontSize: 11 }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ─── DELETE RULE BUTTON ─── */}
                <button
                  type="button"
                  onClick={() => removeCondition(item.id)}
                  title="Remove rule"
                  style={{
                    marginLeft: "auto",
                    background: "rgba(239, 68, 68, 0.1)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    color: "#f87171",
                    borderRadius: 6,
                    width: 26,
                    height: 26,
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
