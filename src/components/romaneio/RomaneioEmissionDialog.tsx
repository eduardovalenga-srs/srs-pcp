"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import {
  confirmRomaneioAction,
  getRomaneioEmissionAction,
  saveRomaneioNfAction,
  type RomaneioEmissionGate,
} from "@/lib/actions/romaneio.actions";
import type { RomaneioSummary } from "@/lib/types/romaneio";
import { errorMessage } from "@/lib/utils/supabase-result";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** "emit" = CONFERIDO → gates + NF + confirmar; "edit" = CONFIRMADO → só NF. */
export type RomaneioNfDialogMode = "emit" | "edit";

/**
 * Painel de pré-requisitos do diálogo de emissão — loading, erro da
 * busca, checklist "Para emitir, falta:" ou o ok. Exportado à parte
 * para os testes (o efeito que busca os gates não roda em SSR).
 */
export function RomaneioEmissionStatus({
  isEmit,
  loading,
  loadError,
  blockers,
}: {
  isEmit: boolean;
  loading: boolean;
  loadError: string | null;
  blockers: readonly string[];
}) {
  if (!isEmit && !loadError) return null;

  return (
    <>
      {isEmit && loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Verificando pré-requisitos da emissão…
        </p>
      ) : null}

      {loadError ? (
        <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {loadError}
        </p>
      ) : null}

      {isEmit && !loading && !loadError && blockers.length > 0 ? (
        <div className="rounded border border-status-progress-bg bg-status-progress/10 px-3 py-2">
          <p className="flex items-center gap-1.5 text-sm font-medium text-status-progress">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Para emitir, falta:
          </p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {isEmit && !loading && !loadError && blockers.length === 0 ? (
        <p className="rounded border border-status-done-bg bg-status-done/10 px-3 py-2 text-sm text-status-done">
          Pronto para emitir — todos os pré-requisitos atendidos.
        </p>
      ) : null}
    </>
  );
}

interface RomaneioEmissionDialogProps {
  romaneio: RomaneioSummary;
  mode: RomaneioNfDialogMode;
  /** Fecha o diálogo (o componente é montado só enquanto está aberto). */
  onOpenChange: (open: boolean) => void;
}

/**
 * Diário de emissão da listagem de romaneios (050): o caminho único para
 * registrar NF e emitir. Em **emit** (status CONFERIDO) busca os
 * pré-requisitos na Server Action, mostra o checklist e — com a nota de
 * industrialização preenchida e nada bloqueando — grava as NFs e confirma o
 * romaneio (baixa dos itens). Em **edit** (status CONFIRMADO) só ajusta
 * os números de NF. A conferência sempre vem antes: sem status
 * CONFERIDO o botão nem aparece na lista.
 */
export function RomaneioEmissionDialog({
  romaneio,
  mode,
  onOpenChange,
}: RomaneioEmissionDialogProps) {
  const router = useRouter();

  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(mode === "emit");
  const [gate, setGate] = useState<RomaneioEmissionGate | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nfNumber, setNfNumber] = useState(() => romaneio.nfNumber ?? "");
  const [returnNfNumber, setReturnNfNumber] = useState(() => romaneio.returnNfNumber ?? "");

  const close = () => {
    setOpen(false);
    onOpenChange(false);
  };

  // Pré-requisitos da emissão — buscados uma vez na abertura.
  useEffect(() => {
    if (mode !== "emit") return;
    let cancelled = false;

    (async () => {
      try {
        const result = await getRomaneioEmissionAction(romaneio.id);
        if (cancelled) return;
        if (!result.success) {
          setLoadError(result.message);
          return;
        }
        setGate(result.gate);
      } catch (error) {
        if (cancelled) return;
        console.error("[RomaneioEmissionDialog]", error);
        setLoadError(errorMessage(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, romaneio.id]);

  const nfMissing = mode === "emit" && nfNumber.trim() === "";
  const blockers = gate ? [...gate.blockers, ...(nfMissing ? ["Registre o número da nota de industrialização."] : [])] : [];
  const ready = mode === "edit" || (gate !== null && gate.canConfirm && !nfMissing);

  const submit = async () => {
    if (busy) return;
    const nf = nfNumber.trim();
    if (mode === "emit" && nf === "") {
      toast.error("Informe o número da nota de industrialização.");
      return;
    }
    setBusy(true);
    try {
      const saved = await saveRomaneioNfAction(romaneio.id, {
        nfNumber: nf || null,
        returnNfNumber: returnNfNumber.trim() || null,
      });
      if (!saved.success) {
        toast.error(saved.message);
        return;
      }

      if (mode === "emit") {
        const confirmed = await confirmRomaneioAction(romaneio.id);
        // A NF já está gravada: fecha e deixa a lista mostrar o novo
        // estado (os pré-requisitos podem ter mudado — reabrir mostra
        // o checklist atualizado).
        router.refresh();
        if (!confirmed.success) {
          toast.error(confirmed.message);
          close();
          return;
        }
        toast.success(confirmed.message);
        close();
        return;
      }

      toast.success(saved.message);
      router.refresh();
      close();
    } catch (error) {
      console.error("[RomaneioEmissionDialog]", error);
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const isEmit = mode === "emit";

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busy && (nextOpen ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEmit ? `Emitir NF — Romaneio nº ${romaneio.number}` : `Notas fiscais — Romaneio nº ${romaneio.number}`}
          </DialogTitle>
          <DialogDescription>
            {isEmit
              ? `A emissão registra a nota de industrialização e BAIXA as quantidades na pendência de expedição da OF ${romaneio.orderCode}. Depois disso cabeçalho, itens e materiais ficam travados — cancelar depois devolve as quantidades à OF.`
              : `Ajuste os números de NF do romaneio ${romaneio.orderCode}. A emissão em si acontece no emissor externo.`}
          </DialogDescription>
        </DialogHeader>

        <RomaneioEmissionStatus
          isEmit={isEmit}
          loading={loading}
          loadError={loadError}
          blockers={blockers}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="romaneio-emit-nf" className="text-xs text-muted-foreground">
              Nota de industrialização
            </Label>
            <Input
              id="romaneio-emit-nf"
              type="text"
              value={nfNumber}
              disabled={busy}
              maxLength={60}
              onChange={(event) => setNfNumber(event.target.value)}
              placeholder={isEmit ? "Obrigatória para emitir" : "Número da nota de industrialização"}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="romaneio-emit-nf-dev" className="text-xs text-muted-foreground">
              NF de devolução
            </Label>
            <Input
              id="romaneio-emit-nf-dev"
              type="text"
              value={returnNfNumber}
              disabled={busy}
              maxLength={60}
              onChange={(event) => setReturnNfNumber(event.target.value)}
              placeholder="Opcional — preenche quando o material voltar"
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={busy}>
            Voltar
          </Button>
          <Button type="button" disabled={busy || !ready} onClick={() => void submit()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            {busy ? "Salvando…" : isEmit ? "Emitir" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
