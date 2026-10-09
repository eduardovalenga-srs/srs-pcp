import type { ReactNode } from "react";

interface HeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

/** Cabeçalho padrão das páginas do painel. */
export function Header({ title, description, actions }: HeaderProps) {
  return (
    <div className="mb-4 flex flex-col gap-2 border-b pb-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
