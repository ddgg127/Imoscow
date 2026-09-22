type ValidationIssue = { loc?: unknown; msg?: unknown };

export function solverServiceError(status: number, body: unknown): string {
  const detail = body && typeof body === "object" ? (body as { detail?: unknown }).detail : undefined;
  const explanation = typeof detail === "string"
    ? detail
    : Array.isArray(detail)
      ? detail.slice(0, 3).map((issue: ValidationIssue) => {
        const path = Array.isArray(issue?.loc) ? issue.loc.filter(part => part !== "body").join(".") : "данные";
        return `${path}: ${String(issue?.msg ?? "неверное значение")}`;
      }).join("; ")
      : "";
  return explanation
    ? `OR-Tools отклонил входные данные (${status}): ${explanation}`
    : `OR-Tools service ${status}`;
}
