import { useEffect, useMemo, useState } from "react";
import { DEFAULT_GENERATE_PARAMS, type GenerateParams } from "./engine/types";
import { datasetSummary, generateDataset } from "./data/generate";
import { parseGenerateParams, UI_PARAMS_KEY } from "./data/params-store";
import { catalogSkillsToCsv, catalogTasksToCsv, datasetToJson, encodeCsvForExcel, engineersToCsv, jobsToCsv } from "./data/serialize";

function download(filename: string, data: BlobPart, type: string) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCsv(filename: string, csv: string) {
  const encoded = encodeCsvForExcel(csv);
  const ab = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(ab).set(encoded);
  download(filename, ab, "text/csv");
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function loadUiParams(): GenerateParams {
  try {
    const raw = localStorage.getItem(UI_PARAMS_KEY);
    if (!raw) return { ...DEFAULT_GENERATE_PARAMS };
    return parseGenerateParams(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_GENERATE_PARAMS };
  }
}

export default function App() {
  const [params, setParams] = useState<GenerateParams>(loadUiParams);
  const set = (key: keyof GenerateParams) => (n: number) =>
    setParams((p) => ({ ...p, [key]: n }));

  useEffect(() => {
    localStorage.setItem(UI_PARAMS_KEY, JSON.stringify(params));
  }, [params]);

  const data = useMemo(() => generateDataset(params), [params]);
  const summary = datasetSummary(data);

  return (
    <main className="lab">
      <header>
        <p className="eyebrow">генератор наборов</p>
        <h1>Датасеты заявок и инженеров</h1>
      </header>

      <form
        className="grid"
        onSubmit={(e) => {
          e.preventDefault();
          download("dataset.json", datasetToJson(data), "application/json");
        }}
      >
        <Field label="Инженеров" value={params.engineerCount} onChange={set("engineerCount")} />
        <Field label="Заявок" value={params.jobCount} onChange={set("jobCount")} />
        <Field label="Заявки с 1 навыком, доля" value={params.jobEasy} onChange={set("jobEasy")} />
        <Field label="Заявки с 2 навыками, доля" value={params.jobMedium} onChange={set("jobMedium")} />
        <Field label="Заявки с 3 навыками, доля" value={params.jobHard} onChange={set("jobHard")} />
        <Field label="Новички" value={params.novice} onChange={set("novice")} />
        <Field label="Специалисты" value={params.specialist} onChange={set("specialist")} />
        <Field label="Профи" value={params.pro} onChange={set("pro")} />
        <Field label="% срочных" value={params.urgentShare} onChange={set("urgentShare")} />
        <Field label="% заявок с ТС" value={params.vehicleConstraintShare} onChange={set("vehicleConstraintShare")} />
        <Field label="Seed" value={params.seed} onChange={set("seed")} />
      </form>

      <pre className="summary">{summary}</pre>

      <div className="actions">
        <button type="button" onClick={() => download("dataset.json", datasetToJson(data), "application/json")}>
          JSON
        </button>
        <button type="button" onClick={() => downloadCsv("jobs.csv", jobsToCsv(data.jobs))}>
          jobs.csv
        </button>
        <button type="button" onClick={() => downloadCsv("engineers.csv", engineersToCsv(data.engineers))}>
          engineers.csv
        </button>
        <button type="button" onClick={() => downloadCsv("catalog-tasks.csv", catalogTasksToCsv())}>
          справочник задач
        </button>
        <button type="button" onClick={() => downloadCsv("catalog-skills.csv", catalogSkillsToCsv())}>
          справочник навыков
        </button>
      </div>
    </main>
  );
}
