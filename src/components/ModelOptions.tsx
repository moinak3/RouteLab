import { useEffect, useRef } from "react";
import { modelFamilies } from "../core/catalog";
import { openRouterFamilyLabels } from "../core/openRouterModels";
import type { Model } from "../types";

const modelDate = (model: Model) => model.openrouter_created_at
  ? new Date(model.openrouter_created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  : model.family === "Router" ? "dynamic per-request selection" : `${model.family_tier} · ${model.quality_tier}`;

const pickerFamilies = (models: Model[]) => {
  const present = new Set(models.map((model) => model.family));
  const ordered = [...modelFamilies.filter((family) => family !== "Router"), ...models.map((model) => model.family), "Router" as const];
  return [...new Set(ordered)].filter((family) => present.has(family));
};

export function ModelOptions({
  models,
  valueForModel = (model) => model.id,
}: {
  models: Model[];
  valueForModel?: (model: Model) => string;
}) {
  return <>{pickerFamilies(models).map(family=>{const familyModels=models.filter(model=>model.family===family);return familyModels.length?<optgroup label={openRouterFamilyLabels[family]} key={family}>{familyModels.map(model=><option value={valueForModel(model)} key={model.id}>{model.display_name} · {modelDate(model)}</option>)}</optgroup>:null})}</>;
}

export function ModelPicker({ models, value, onChange }: { models: Model[]; value: string; onChange: (value: string) => void }) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const selected = models.find((model) => model.id === value) ?? models[0];

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (detailsRef.current && !detailsRef.current.contains(event.target as Node)) detailsRef.current.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && detailsRef.current?.open) {
        detailsRef.current.open = false;
        detailsRef.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const choose = (model: Model) => {
    onChange(model.id);
    if (detailsRef.current) detailsRef.current.open = false;
  };

  return <details className="model-picker" ref={detailsRef}>
    <summary aria-label="Choose candidate model">
      <span>{selected ? <><b>{selected.display_name}</b><small> · {modelDate(selected)}</small></> : "Choose a model"}</span>
      <i aria-hidden="true" />
    </summary>
    <div className="model-picker-menu" role="listbox" aria-label="Candidate models">
      {pickerFamilies(models).map((family) => {
        const familyModels = models.filter((model) => model.family === family);
        if (!familyModels.length) return null;
        return <section className="model-picker-group" key={family}>
          <h3>{openRouterFamilyLabels[family]}</h3>
          {familyModels.map((model) => <button
            type="button"
            role="option"
            aria-selected={model.id === value}
            className={model.id === value ? "selected" : ""}
            onClick={() => choose(model)}
            key={model.id}
          >
            <span><b>{model.display_name}</b><small>{modelDate(model)}</small></span>
            <i aria-hidden="true">{model.id === value ? "✓" : ""}</i>
          </button>)}
        </section>;
      })}
    </div>
  </details>;
}
