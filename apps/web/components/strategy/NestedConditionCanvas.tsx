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
    const newRule: SingleRule = {
      id: "rule_rv_" + Math.random().toString(36).slice(2, 9),
      type: "RULE",
      leftOperand: {
        type: "RELATIVE_VALUE_SPREAD",
        assetA: availableSymbols[0] || "BTCUSDT",
        assetB: availableSymbols[1] || "ETHUSDT",
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

  return (
    <div
      className={`p-3.5 rounded-xl border ${
        depth === 0 ? "border-slate-700 bg-slate-900/90" : "border-slate-800 bg-slate-950/80 my-2"
      }`}
    >
      {/* Group Logical Header */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Condition Block:</span>
          {(["AND", "OR", "NOT"] as LogicalOperator[]).map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => updateLogicalOp(op)}
              className={`px-3 py-1 rounded text-xs font-bold tracking-wide transition-all ${
                group.logicalOperator === op
                  ? "bg-sky-500 text-white shadow-md shadow-sky-500/30"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
              }`}
            >
              {op}
            </button>
          ))}
          <span className="text-xs text-slate-400 hidden sm:inline">of all rules must evaluate to true</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addRule}
            className="px-2.5 py-1 text-xs bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg hover:bg-emerald-600/50 transition-all font-medium"
          >
            + Standard Indicator
          </button>
          <button
            type="button"
            onClick={addRelativeValueRule}
            className="px-2.5 py-1 text-xs bg-purple-600/30 text-purple-300 border border-purple-500/30 rounded-lg hover:bg-purple-600/50 transition-all font-medium"
          >
            + Relative Value / Spread Z-Score
          </button>
          {depth < 3 && (
            <button
              type="button"
              onClick={addNestedGroup}
              className="px-2.5 py-1 text-xs bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg hover:bg-indigo-600/50 transition-all font-medium"
            >
              + Nested Group
            </button>
          )}
        </div>
      </div>

      {/* Nested Conditions List */}
      <div className="space-y-2.5 pl-2.5 border-l-2 border-slate-800/80">
        {group.conditions.map((item) => {
          if (item.type === "GROUP") {
            return (
              <div key={item.id} className="relative">
                <button
                  type="button"
                  onClick={() => removeCondition(item.id)}
                  className="absolute top-2 right-2 text-rose-400 hover:text-rose-200 text-xs z-10 bg-slate-900 px-2 py-0.5 rounded border border-rose-500/30"
                >
                  ✕ Remove Block
                </button>
                <NestedConditionCanvas
                  group={item}
                  onChange={(upd) => updateChild(item.id, upd)}
                  availableSymbols={availableSymbols}
                  depth={depth + 1}
                />
              </div>
            );
          }

          // Single Rule Card
          const isRv = item.leftOperand.type === "RELATIVE_VALUE_SPREAD";

          return (
            <div
              key={item.id}
              className="flex items-center gap-2 flex-wrap bg-slate-950/90 p-2.5 rounded-lg border border-slate-800 text-xs"
            >
              {/* Left Operand Controls */}
              {isRv ? (
                <div className="flex items-center gap-1.5 bg-purple-950/40 border border-purple-800/50 p-1.5 rounded">
                  <span className="text-purple-300 font-bold text-[11px]">SPREAD Z-SCORE:</span>
                  <select
                    value={(item.leftOperand as any).assetA}
                    onChange={(e) =>
                      updateChild(item.id, {
                        ...item,
                        leftOperand: { ...item.leftOperand, assetA: e.target.value } as any,
                      })
                    }
                    className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-1.5 py-0.5"
                  >
                    {availableSymbols.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <span className="text-slate-400">-</span>
                  <select
                    value={(item.leftOperand as any).assetB}
                    onChange={(e) =>
                      updateChild(item.id, {
                        ...item,
                        leftOperand: { ...item.leftOperand, assetB: e.target.value } as any,
                      })
                    }
                    className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-1.5 py-0.5"
                  >
                    {availableSymbols.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <span className="text-slate-400">N=</span>
                  <input
                    type="number"
                    value={(item.leftOperand as any).zScoreLookback || 30}
                    onChange={(e) =>
                      updateChild(item.id, {
                        ...item,
                        leftOperand: { ...item.leftOperand, zScoreLookback: Number(e.target.value) } as any,
                      })
                    }
                    className="w-12 bg-slate-900 border border-slate-700 text-slate-200 rounded px-1 py-0.5 text-center"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-sky-950/40 border border-sky-800/50 p-1.5 rounded">
                  <select
                    value={(item.leftOperand as any).timeframe}
                    onChange={(e) =>
                      updateChild(item.id, {
                        ...item,
                        leftOperand: { ...item.leftOperand, timeframe: e.target.value } as any,
                      })
                    }
                    className="bg-slate-900 border border-slate-700 text-sky-300 font-semibold rounded px-1.5 py-0.5"
                  >
                    {TIMEFRAME_OPTIONS.map((tf) => (
                      <option key={tf} value={tf}>
                        {tf}
                      </option>
                    ))}
                  </select>
                  <select
                    value={(item.leftOperand as any).indicator}
                    onChange={(e) =>
                      updateChild(item.id, {
                        ...item,
                        leftOperand: { ...item.leftOperand, indicator: e.target.value } as any,
                      })
                    }
                    className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-1.5 py-0.5"
                  >
                    <option value="EMA">EMA</option>
                    <option value="SMA">SMA</option>
                    <option value="RSI">RSI</option>
                    <option value="ATR">ATR</option>
                    <option value="PRICE">Price (Close)</option>
                    <option value="RETURN">Return (%)</option>
                  </select>
                  <span className="text-slate-400">Period:</span>
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
                    className="w-12 bg-slate-900 border border-slate-700 text-slate-200 rounded px-1 py-0.5 text-center"
                  />
                </div>
              )}

              {/* Comparison Operator */}
              <select
                value={item.operator}
                onChange={(e) =>
                  updateChild(item.id, { ...item, operator: e.target.value as ComparisonOperator })
                }
                className="bg-slate-800 text-amber-300 font-bold rounded px-2 py-1 text-xs border border-slate-700"
              >
                <option value=">">&gt;</option>
                <option value=">=">&gt;=</option>
                <option value="<">&lt;</option>
                <option value="<=">&lt;=</option>
                <option value="==">==</option>
                <option value="!=">!=</option>
                <option value="CROSSES_ABOVE">CROSSES ABOVE</option>
                <option value="CROSSES_BELOW">CROSSES BELOW</option>
              </select>

              {/* Right Operand Controls */}
              {item.rightOperand.type === "CONSTANT" ? (
                <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700 p-1.5 rounded">
                  <span className="text-slate-400">Value:</span>
                  <input
                    type="number"
                    step="0.1"
                    value={item.rightOperand.value}
                    onChange={(e) =>
                      updateChild(item.id, {
                        ...item,
                        rightOperand: { type: "CONSTANT", value: Number(e.target.value) },
                      })
                    }
                    className="w-16 bg-slate-950 border border-slate-700 text-slate-200 rounded px-1.5 py-0.5"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-emerald-950/40 border border-emerald-800/50 p-1.5 rounded">
                  <select
                    value={(item.rightOperand as any).timeframe}
                    onChange={(e) =>
                      updateChild(item.id, {
                        ...item,
                        rightOperand: { ...item.rightOperand, timeframe: e.target.value } as any,
                      })
                    }
                    className="bg-slate-900 border border-slate-700 text-emerald-300 font-semibold rounded px-1.5 py-0.5"
                  >
                    {TIMEFRAME_OPTIONS.map((tf) => (
                      <option key={tf} value={tf}>
                        {tf}
                      </option>
                    ))}
                  </select>
                  <select
                    value={(item.rightOperand as any).indicator}
                    onChange={(e) =>
                      updateChild(item.id, {
                        ...item,
                        rightOperand: { ...item.rightOperand, indicator: e.target.value } as any,
                      })
                    }
                    className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-1.5 py-0.5"
                  >
                    <option value="EMA">EMA</option>
                    <option value="SMA">SMA</option>
                    <option value="RSI">RSI</option>
                    <option value="PRICE">Price (Close)</option>
                    <option value="RETURN">Return (%)</option>
                  </select>
                  <span className="text-slate-400">Period:</span>
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
                    className="w-12 bg-slate-900 border border-slate-700 text-slate-200 rounded px-1 py-0.5 text-center"
                  />
                </div>
              )}

              {/* Remove Rule Button */}
              <button
                type="button"
                onClick={() => removeCondition(item.id)}
                className="ml-auto text-rose-400 hover:text-rose-200 text-xs px-2 py-0.5 rounded bg-rose-950/40 border border-rose-800/40"
              >
                ✕
              </button>
            </div>
          );
        })}

        {group.conditions.length === 0 && (
          <div className="text-xs text-slate-500 py-2 italic">
            No rules in this block yet. Click &apos;+ Standard Indicator&apos; or &apos;+ Relative Value / Spread Z-Score&apos; above.
          </div>
        )}
      </div>
    </div>
  );
}
