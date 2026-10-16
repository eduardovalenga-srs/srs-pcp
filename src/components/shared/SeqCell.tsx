"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

interface SeqCellProps {
  /** Sequência vigente (null = linha sem número). */
  value: number | null;
  /** Edição liberada (orders.edit — ADMIN/GESTOR). */
  canEdit: boolean;
  /** Rótulo do registro (OF/ descrição) em aria-label e mensagens. */
  label: string;
  /** Gravação: chama o Server Action do contexto (item, grupo ou OF). */
  onCommit: (seq: number | null) => Promise<{ success: boolean; message: string }>;
}

/**
 * Célula de edição INLINE da sequência de fabricação (036): número
 * inteiro >= 1; vazio limpa a sequência. Enter grava, Esc cancela, e a
 * saída da célula (blur) grava o que foi digitado — commit
 * instantâneo, sem botão (mesma disciplina do Select da tela de
 * configurações). Gravada a sequência, o refresh da página reordena as
 * linhas (seq nulls last).
 */
export function SeqCell({ value, canEdit, label, onCommit }: SeqCellProps) {
  const router = useRouter();
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [saving, setSaving] = useState(false);
  // Guarda síncrona: Enter + blur não podem disparar duas gravações
  // iguais (o estado React só atualiza no próximo render).
  const savingRef = useRef(false);

  if (!canEdit) {
    return (
      <span
        className="block w-full text-center tabular-nums"
        title={`Sequência de fabricação de ${label}`}
      >
        {value ?? "—"}
      </span>
    );
  }

  const trimmed = draft.trim();
  const parsed = trimmed === "" ? null : Number(trimmed);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 1);
  const unchanged = parsed === value;

  const commit = async () => {
    if (!valid || unchanged || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await onCommit(parsed);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.refresh();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
      // A gravação já está em curso — o blur disparado aqui não re-grava.
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      // Cancela: volta ao valor vigente e sai da célula sem gravar
      // (o blur encontra o draft já restaurado e vê "sem mudança").
      setDraft(value === null ? "" : String(value));
      event.currentTarget.blur();
    }
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      step={1}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => void commit()}
      disabled={saving}
      aria-label={`Sequência de fabricação de ${label}`}
      title="Sequência de fabricação — digite o número da prioridade; Enter ou sair da célula grava, Esc cancela"
      className={cn(
        "h-7 w-12 rounded border border-transparent bg-transparent px-1 text-center text-xs tabular-nums",
        "hover:border-border focus:border-ring focus:outline-none",
        "disabled:opacity-60",
        !valid && "border-status-late",
      )}
    />
  );
}
