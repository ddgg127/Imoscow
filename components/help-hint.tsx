import { CircleHelp } from "lucide-react";

export function HelpHint({ label, children }: { label: string; children: React.ReactNode }) {
  return <details className="help-hint"><summary aria-label={`Подсказка: ${label}`} title={`Подсказка: ${label}`}><CircleHelp size={16} /></summary><div className="help-hint-content">{children}</div></details>;
}
