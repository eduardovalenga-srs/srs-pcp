import Image from "next/image";
import type { ReactNode } from "react";

interface HeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

/**
 * Cabeçalho padrão das páginas do painel: nome da tela à esquerda e a marca
 * (SRS) no canto direito. Quando há botões de ação, eles ocupam a linha de
 * baixo para não competir com o título nem com o logo.
 */
export function Header({ title, description, actions }: HeaderProps) {
  return (
    <div className="mb-4 space-y-2 border-b pb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        <Image
          src="/logo-srs.png"
          alt="SRS Prestadora de Serviços"
          width={190}
          height={70}
          className="mt-0.5 h-6 w-auto shrink-0 sm:h-7"
        />
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
