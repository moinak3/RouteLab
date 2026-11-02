import { useEffect, useMemo, useRef, useState } from "react";
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

type ModelPickerOption = {
  value: string;
  label: string;
  description?: string;
};

type ModelPickerProps = {
  models: Model[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  searchAriaLabel?: string;
  emptyOption?: ModelPickerOption;
  unresolvedLabel?: string;
};

export function ModelPicker({
  models,
  value,
  onChange,
  ariaLabel = "Choose candidate model",
  searchAriaLabel = "Search candidate models",
  emptyOption,
  unresolvedLabel,
}: ModelPickerProps) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const selected = models.find((model) => model.id === value) ?? (!emptyOption ? models[0] : undefined);
  const normalizedQuery = query.trim().toLowerCase();
  const emptyOptionMatches = Boolean(emptyOption && (!normalizedQuery || [emptyOption.label, emptyOption.description]
    .some((field) => String(field ?? "").toLowerCase().includes(normalizedQuery))));
  const filteredModels = useMemo(() => {
    if (!normalizedQuery) return models;
    return models.filter((model) => [
      model.display_name,
      model.id,
      model.provider,
      model.family,
      openRouterFamilyLabels[model.family],
    ].some((field) => String(field ?? "").toLowerCase().includes(normalizedQuery)));
  }, [models, normalizedQuery]);

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (detailsRef.current && !detailsRef.current.contains(event.target as Node)) detailsRef.current.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && detailsRef.current?.open) {
        detailsRef.current.open = false;
        setQuery("");
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

  const choose = (nextValue: string) => {
    onChange(nextValue);
    setQuery("");
    if (detailsRef.current) detailsRef.current.open = false;
  };

  const handleToggle = () => {
    if (detailsRef.current?.open) requestAnimationFrame(() => searchRef.current?.focus());
    else setQuery("");
  };

  const summary = selected
    ? <><b>{selected.display_name}</b><small> · {modelDate(selected)}</small></>
    : emptyOption && value === emptyOption.value
      ? <><b>{emptyOption.label}</b>{emptyOption.description ? <small> · {emptyOption.description}</small> : null}</>
      : <b>{unresolvedLabel ?? "Choose a model"}</b>;

  return <details className="model-picker" ref={detailsRef} onToggle={handleToggle}>
    <summary aria-label={ariaLabel}>
      <span>{summary}</span>
      <i aria-hidden="true" />
    </summary>
    <div className="model-picker-menu">
      <label className="model-picker-search">
        <span>Search models</span>
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by model, provider, or ID"
          aria-label={searchAriaLabel}
        />
      </label>
      <div role="listbox" aria-label={ariaLabel}>
      {emptyOptionMatches && emptyOption ? <section className="model-picker-group model-picker-default-option">
        <h3>Routing</h3>
        <button
          type="button"
          role="option"
          aria-selected={value === emptyOption.value}
          className={value === emptyOption.value ? "selected" : ""}
          onClick={() => choose(emptyOption.value)}
        >
          <span><b>{emptyOption.label}</b>{emptyOption.description ? <small>{emptyOption.description}</small> : null}</span>
          <i aria-hidden="true">{value === emptyOption.value ? "✓" : ""}</i>
        </button>
      </section> : null}
      {pickerFamilies(filteredModels).map((family) => {
        const familyModels = filteredModels.filter((model) => model.family === family);
        if (!familyModels.length) return null;
        return <section className="model-picker-group" key={family}>
          <h3>{openRouterFamilyLabels[family]}</h3>
          {familyModels.map((model) => <button
            type="button"
            role="option"
            aria-selected={model.id === value}
            className={model.id === value ? "selected" : ""}
            onClick={() => choose(model.id)}
            key={model.id}
          >
            <span><b>{model.display_name}</b><small>{modelDate(model)}</small></span>
            <i aria-hidden="true">{model.id === value ? "✓" : ""}</i>
          </button>)}
        </section>;
      })}
      {!filteredModels.length && !emptyOptionMatches && <p className="model-picker-empty">No models match “{query.trim()}”.</p>}
      </div>
    </div>
  </details>;
}
