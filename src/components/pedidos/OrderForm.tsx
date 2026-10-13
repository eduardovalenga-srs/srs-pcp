"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { saveOrderAction } from "@/lib/actions/orders.actions";
import type { MaterialInput } from "@/lib/validators/material.schema";
import { ORDER_TYPES } from "@/lib/constants/orders";
import { MP_PROCESS_CODE } from "@/lib/constants/processes";
import type { OrderDetails } from "@/lib/types/order";
import {
  orderWithItemsSchema,
  type OrderWithItemsInput,
  type OrderWithItemsOutput,
} from "@/lib/validators/order-item.schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaterialsEditor } from "@/components/pedidos/MaterialsEditor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** Processo ativo do catálogo, serializado pela página do servidor. */
export interface OrderProcessOption {
  code: string;
  name: string;
}

interface OrderFormProps {
  processes: OrderProcessOption[];
  initialOrder?: OrderDetails | null;
}

type OrderItemInput = OrderWithItemsInput["items"][number];

/**
 * Item em branco: só o MP nasce marcado (021 — pré-requisito para
 * iniciar a produção); os demais processos ficam a cargo do usuário,
 * que marca pelo que o item realmente passa.
 */
function emptyItem(activeCodes: Set<string>): OrderItemInput {
  return {
    op: "",
    family: "",
    parentItem: "",
    description: "",
    quantity: "",
    unitWeightKg: "",
    deliveryDate: "",
    processCodes: activeCodes.has(MP_PROCESS_CODE) ? [MP_PROCESS_CODE] : [],
    materials: [],
  };
}

/** Valores iniciais do formulário (novo pedido ou edição a partir do servidor). */
function buildDefaultValues(
  initialOrder: OrderDetails | null | undefined,
  activeCodes: Set<string>,
): OrderWithItemsInput {
  if (!initialOrder) {
    return {
      type: "OF",
      code: "",
      customerName: "",
      description: "",
      orderDate: "",
      deliveryDate: "",
      items: [emptyItem(activeCodes)],
    };
  }

  return {
    type: initialOrder.type,
    code: initialOrder.code,
    customerName: initialOrder.customerName ?? "",
    description: initialOrder.description ?? "",
    orderDate: initialOrder.orderDate ?? "",
    deliveryDate: initialOrder.deliveryDate ?? "",
    items: initialOrder.items.map((item) => {
      const statusByCode = new Map(item.processes.map((process) => [process.code, process.status]));

      // Marcado = existe linha E ela não é "não aplicável". Linha ausente
      // também nasce desmarcada: era essa a leitura que fazia o desmarcar
      // "não salvar" (processo sem linha não tinha o que gravar e voltava
      // marcado na próxima abertura).
      const selectedCodes = [...activeCodes].filter((code) => {
        const status = statusByCode.get(code);
        return status !== undefined && status !== "NAO_APLICAVEL";
      });
      // MP é pré-requisito da produção: marcado em todo item (021).
      if (activeCodes.has(MP_PROCESS_CODE) && !selectedCodes.includes(MP_PROCESS_CODE)) {
        selectedCodes.push(MP_PROCESS_CODE);
      }

      return {
        id: item.id,
        op: item.op ?? "",
        family: item.family ?? "",
        parentItem: item.parentItem ?? "",
        description: item.description,
        quantity: String(item.quantity),
        unitWeightKg: item.unitWeightKg === null ? "" : String(item.unitWeightKg),
        // Item sem entrega própria herda a do pedido — mesma regra da
        // importação (entrega em todo registro) e da grade (022).
        deliveryDate: item.deliveryDate ?? initialOrder.deliveryDate ?? "",
        // Códigos desativados ficam de fora (não passam na validação do servidor).
        processCodes: selectedCodes,
        // Matérias-primas já cadastradas (011) nascem carregadas.
        materials: item.materials.map((material) => ({
          description: material.description,
          quantity: material.quantity,
          unit: material.unit as MaterialInput["unit"],
          notes: material.notes ?? "",
        })),
      };
    }),
  };
}

/** Extrai a mensagem de um erro do react-hook-form (campo, array ou aninhado). */
function fieldMessage(error: unknown): string | undefined {
  if (Array.isArray(error)) {
    for (const entry of error) {
      const message = fieldMessage(entry);
      if (message) return message;
    }
    return undefined;
  }
  if (error && typeof error === "object") {
    const { message } = error as { message?: unknown };
    if (typeof message === "string") return message;
    // Leaf do RHF sem mensagem própria (ex.: { ref }) — nada a extrair.
    if ("ref" in error) return undefined;
    // Erros aninhados (ex.: linha de material: { description: { message } }).
    for (const value of Object.values(error)) {
      const nested = fieldMessage(value);
      if (nested) return nested;
    }
  }
  return undefined;
}

/** Mensagem de erro de campo (associada ao controle via aria-describedby). */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs font-medium text-status-blocked">
      {message}
    </p>
  );
}

/**
 * Formulário de pedido (criação e edição).
 * A validação vem 100% do zod (orderWithItemsSchema) — sem regras de negócio aqui.
 */
export function OrderForm({ processes, initialOrder }: OrderFormProps) {
  const router = useRouter();

  const activeCodes = useMemo(() => new Set(processes.map((process) => process.code)), [processes]);
  const defaultValues = useMemo(
    () => buildDefaultValues(initialOrder, activeCodes),
    [initialOrder, activeCodes],
  );

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OrderWithItemsInput, unknown, OrderWithItemsOutput>({
    resolver: zodResolver(orderWithItemsSchema),
    defaultValues,
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
    keyName: "rowId",
  });

  const onSubmit = handleSubmit(async (values) => {
    const result = await saveOrderAction(values);
    if (!result.success) {
      toast.error(result.message);
      return;
    }
    toast.success(result.message);
    // Pós-criação vai direto para a tela de detalhes (hub da OF).
    router.push(result.orderId ? `/pedidos/${result.orderId}` : "/pedidos");
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-busy={isSubmitting}>
      <section aria-label="Dados do pedido" className="rounded border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Dados do pedido</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="pedido-tipo">Tipo (OF/OS)</Label>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="pedido-tipo"
                    aria-invalid={!!errors.type}
                    aria-describedby="pedido-tipo-erro"
                  >
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDER_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError id="pedido-tipo-erro" message={errors.type?.message} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="pedido-codigo">Número do pedido</Label>
            <Input
              id="pedido-codigo"
              placeholder="EX: OF-1234"
              autoCapitalize="characters"
              {...register("code")}
              aria-invalid={!!errors.code}
              aria-describedby="pedido-codigo-erro"
            />
            <FieldError id="pedido-codigo-erro" message={errors.code?.message} />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="pedido-cliente">Cliente</Label>
            <Input
              id="pedido-cliente"
              placeholder="Nome do cliente (opcional)"
              {...register("customerName")}
              aria-invalid={!!errors.customerName}
              aria-describedby="pedido-cliente-erro"
            />
            <FieldError id="pedido-cliente-erro" message={errors.customerName?.message} />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="pedido-descricao">Descrição</Label>
            <Textarea
              id="pedido-descricao"
              rows={3}
              placeholder="Observações gerais do pedido (opcional)"
              {...register("description")}
              aria-invalid={!!errors.description}
              aria-describedby="pedido-descricao-erro"
            />
            <FieldError id="pedido-descricao-erro" message={errors.description?.message} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="pedido-data">Data do pedido</Label>
            <Input
              id="pedido-data"
              type="date"
              {...register("orderDate")}
              aria-invalid={!!errors.orderDate}
              aria-describedby="pedido-data-erro"
            />
            <FieldError id="pedido-data-erro" message={errors.orderDate?.message} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="pedido-entrega">Data de entrega</Label>
            <Input
              id="pedido-entrega"
              type="date"
              {...register("deliveryDate")}
              aria-invalid={!!errors.deliveryDate}
              aria-describedby="pedido-entrega-erro"
            />
            <FieldError id="pedido-entrega-erro" message={errors.deliveryDate?.message} />
          </div>
        </div>
      </section>

      <section aria-label="Itens do pedido">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Itens do pedido</h2>
            <p className="text-xs text-muted-foreground">
              Família, quantidades, entrega, OP e processos de cada item.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => append(emptyItem(activeCodes))}>
            <Plus className="h-4 w-4" aria-hidden />
            Adicionar item
          </Button>
        </div>

        <FieldError id="pedido-itens-erro" message={fieldMessage(errors.items)} />

        <div className="space-y-3">
          {fields.map((row, index) => {
            const itemErrors = errors.items?.[index];
            const processMessage = fieldMessage(itemErrors?.processCodes);
            const processLabelId = `item-${index}-processos-label`;
            const processErrorId = `item-${index}-processos-erro`;
            const materialMessage = fieldMessage(itemErrors?.materials);
            const materialLabelId = `item-${index}-materiais-label`;
            const materialErrorId = `item-${index}-materiais-erro`;

            return (
              <Card key={row.rowId}>
                <CardHeader className="flex flex-row items-center justify-between border-b">
                  <CardTitle>Item {index + 1}</CardTitle>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => remove(index)}
                    disabled={fields.length <= 1}
                    aria-label={`Remover item ${index + 1}`}
                    title={`Remover item ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </CardHeader>

                <CardContent className="space-y-4 pt-3">
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="space-y-1">
                      <Label htmlFor={`item-${index}-familia`}>Família</Label>
                      <Input
                        id={`item-${index}-familia`}
                        placeholder="Ex: Portas"
                        {...register(`items.${index}.family`)}
                        aria-invalid={!!itemErrors?.family}
                        aria-describedby={`item-${index}-familia-erro`}
                      />
                      <FieldError
                        id={`item-${index}-familia-erro`}
                        message={itemErrors?.family?.message}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor={`item-${index}-pai`}>Item pai</Label>
                      <Input
                        id={`item-${index}-pai`}
                        placeholder="Ex: ITEM 1"
                        {...register(`items.${index}.parentItem`)}
                        aria-invalid={!!itemErrors?.parentItem}
                        aria-describedby={`item-${index}-pai-erro`}
                      />
                      <FieldError
                        id={`item-${index}-pai-erro`}
                        message={itemErrors?.parentItem?.message}
                      />
                    </div>

                    <div className="space-y-1 sm:col-span-2">
                      <Label htmlFor={`item-${index}-descricao`}>Descrição</Label>
                      <Input
                        id={`item-${index}-descricao`}
                        placeholder="Ex: Porta 1,00 x 2,10"
                        {...register(`items.${index}.description`)}
                        aria-invalid={!!itemErrors?.description}
                        aria-describedby={`item-${index}-descricao-erro`}
                      />
                      <FieldError
                        id={`item-${index}-descricao-erro`}
                        message={itemErrors?.description?.message}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor={`item-${index}-quantidade`}>Quantidade</Label>
                      <Input
                        id={`item-${index}-quantidade`}
                        inputMode="decimal"
                        placeholder="Ex: 4"
                        {...register(`items.${index}.quantity`)}
                        aria-invalid={!!itemErrors?.quantity}
                        aria-describedby={`item-${index}-quantidade-erro`}
                      />
                      <FieldError
                        id={`item-${index}-quantidade-erro`}
                        message={itemErrors?.quantity?.message}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor={`item-${index}-peso`}>Peso unitário (kg)</Label>
                      <Input
                        id={`item-${index}-peso`}
                        inputMode="decimal"
                        placeholder="Ex: 12,5"
                        {...register(`items.${index}.unitWeightKg`)}
                        aria-invalid={!!itemErrors?.unitWeightKg}
                        aria-describedby={`item-${index}-peso-erro`}
                      />
                      <FieldError
                        id={`item-${index}-peso-erro`}
                        message={itemErrors?.unitWeightKg?.message}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor={`item-${index}-entrega`}>Data de entrega</Label>
                      <Input
                        id={`item-${index}-entrega`}
                        type="date"
                        {...register(`items.${index}.deliveryDate`)}
                        aria-invalid={!!itemErrors?.deliveryDate}
                        aria-describedby={`item-${index}-entrega-erro`}
                      />
                      <FieldError
                        id={`item-${index}-entrega-erro`}
                        message={itemErrors?.deliveryDate?.message}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor={`item-${index}-op`}>Ordem de Produção (OP)</Label>
                      <Input
                        id={`item-${index}-op`}
                        placeholder="Ex.: OP-1234"
                        autoCapitalize="characters"
                        {...register(`items.${index}.op`)}
                        aria-invalid={!!itemErrors?.op}
                        aria-describedby={`item-${index}-op-erro`}
                      />
                      <FieldError
                        id={`item-${index}-op-erro`}
                        message={itemErrors?.op?.message}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <span id={processLabelId} className="text-sm font-medium">
                      Processos
                    </span>
                    <Controller
                      control={control}
                      name={`items.${index}.processCodes`}
                      render={({ field }) => (
                        <div
                          role="group"
                          aria-labelledby={processLabelId}
                          aria-describedby={processMessage ? processErrorId : undefined}
                          className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4"
                        >
                          {processes.map((process) => {
                            const checkboxId = `item-${index}-processo-${process.code}`;
                            // MP (021) é pré-requisito para iniciar a
                            // produção: vem marcado e não é removível —
                            // os demais processos ficam a cargo do usuário.
                            const isMp = process.code === MP_PROCESS_CODE;
                            const hint = isMp
                              ? `${process.name} — pré-requisito para iniciar a produção (sempre aplicável)`
                              : process.name;
                            return (
                              <label
                                key={process.code}
                                htmlFor={checkboxId}
                                title={hint}
                                className={`flex items-center gap-2 rounded border px-2 py-1.5 text-sm transition-colors has-[data-state=checked]:border-primary has-[data-state=checked]:bg-primary/5 ${
                                  isMp ? "cursor-default" : "cursor-pointer hover:bg-accent"
                                }`}
                              >
                                <Checkbox
                                  id={checkboxId}
                                  checked={isMp || field.value.includes(process.code)}
                                  disabled={isMp}
                                  onCheckedChange={(checked) => {
                                    if (isMp) return;
                                    field.onChange(
                                      checked === true
                                        ? [...field.value, process.code]
                                        : field.value.filter((code) => code !== process.code),
                                    );
                                  }}
                                />
                                <span className="truncate">
                                  {process.name}
                                  {isMp ? (
                                    <span className="ml-1 text-xs text-muted-foreground">
                                      (obrigatório)
                                    </span>
                                  ) : null}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    />
                    <FieldError id={processErrorId} message={processMessage} />
                    <p className="text-xs text-muted-foreground">
                      Desmarcado = não se aplica ao item (sem janela prevista na gestão de
                      entregas). Selecione ao menos um processo além do MP.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <span id={materialLabelId} className="text-sm font-medium">
                      Matérias-primas
                    </span>
                    <Controller
                      control={control}
                      name={`items.${index}.materials`}
                      render={({ field }) => (
                        <MaterialsEditor
                          value={field.value ?? []}
                          onChange={field.onChange}
                          idPrefix={`item-${index}-material`}
                        />
                      )}
                    />
                    <FieldError id={materialErrorId} message={materialMessage} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" asChild>
          <Link href="/pedidos">Cancelar</Link>
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Save className="h-4 w-4" aria-hidden />
          )}
          {isSubmitting ? "Salvando…" : "Salvar pedido"}
        </Button>
      </div>
    </form>
  );
}
