/**
 * Aurora — abrir solicitação (SPEC v0.2 §08 · EPIC-007).
 *
 * O PEDIDO PRECISA SER RÁPIDO DE FAZER, e o resto pode ser aos poucos.
 *
 * Quem abre uma solicitação está com o problema na frente: o ventilador
 * apitando, o cliente ao telefone. Um formulário com quinze campos
 * obrigatórios produz solicitação abandonada — ou, pior, solicitação com campo
 * preenchido de qualquer jeito só para o botão liberar.
 *
 * Por isso o obrigatório é o mínimo que torna o pedido acionável: para quem, e
 * o que está acontecendo. Equipamento, local e sintoma ajudam a triagem e não
 * travam o envio.
 *
 * O AVISO DE DUPLICIDADE VEM DEPOIS, e não bloqueia (§08). Entre "consultar" e
 * "enviar" alguém pode ter aberto a mesma; avisar depois, apontando a
 * parecida, é honesto. Bloquear seria dizer a quem está com o problema na
 * frente que ele não pode registrá-lo.
 */
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Card, Field, Input, Select, Skeleton, Textarea, useToast } from '@aurora/ui';
import { requestCreate, requestsQueue, catalogItems, type CatalogItem } from '@aurora/contracts';
import { customersList, type Customer } from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery } from '../../lib/api';
import { AppShell } from '../../shell/app-shell';

const PRIORIDADES = [
  { valor: 'none', rotulo: 'Sem urgência declarada' },
  { valor: 'low', rotulo: 'Baixa' },
  { valor: 'urgent', rotulo: 'Urgente' },
  { valor: 'very_urgent', rotulo: 'Muito urgente' },
  { valor: 'emergency', rotulo: 'Emergência' },
] as const;

export function NovaSolicitacaoPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [cliente, setCliente] = useState('');
  const [resumo, setResumo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [prioridade, setPrioridade] = useState<string>('none');
  const [sintoma, setSintoma] = useState('');
  const [erro, setErro] = useState<{ campo?: string; mensagem: string } | null>(null);

  const { data: clientes, isLoading: carregandoClientes } = useApiQuery(customersList, undefined, {
    staleTime: 5 * 60_000,
  }) as { data: { items: Customer[]; single_customer: boolean } | undefined; isLoading: boolean };

  const { data: sintomas } = useApiQuery(
    catalogItems,
    { params: { catalog: 'failure_symptom' } },
    { staleTime: 10 * 60_000 }
  ) as { data: { items: CatalogItem[] } | undefined };

  const lista = clientes?.items ?? [];
  // Uma organização que atende só a si mesma não escolhe cliente: escolher
  // entre uma opção não é escolha, é obstáculo.
  const clienteUnico = clientes?.single_customer ? lista[0] : undefined;
  const clienteEscolhido = clienteUnico?.id ?? cliente;

  const criar = useApiMutation(requestCreate, {
    invalidates: [requestsQueue],
    onError: (e: ApiError) => setErro({ campo: e.field, mensagem: e.problem.message }),
  });

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (!clienteEscolhido) {
      setErro({ campo: 'customer_id', mensagem: 'Escolha para qual cliente é a solicitação.' });
      return;
    }
    if (resumo.trim().length < 3) {
      setErro({ campo: 'summary', mensagem: 'Descreva em poucas palavras o que está acontecendo.' });
      return;
    }

    criar.mutate(
      {
        body: {
          customer_id: clienteEscolhido,
          summary: resumo.trim(),
          description: descricao.trim() || undefined,
          source: 'phone',
          requested_priority: prioridade as never,
          reported_failure_code_id: sintoma || null,
        },
      },
      {
        onSuccess: (r) => {
          const criada = r as { id: string; number: string; duplicate_hints: unknown[] };
          const parecidas = criada.duplicate_hints?.length ?? 0;

          toast.success(
            `Solicitação ${criada.number} aberta`,
            parecidas > 0
              ? `Atenção: há ${parecidas} solicitação${parecidas === 1 ? '' : 'ões'} parecida${parecidas === 1 ? '' : 's'} em aberto para este equipamento.`
              : 'Ela já está na fila de triagem.'
          );
          void navigate({ to: '/solicitacoes/$id', params: { id: criada.id } });
        },
      }
    );
  }

  return (
    <AppShell
      title="Abrir solicitação"
      subtitle="Registre o pedido. O que falta pode ser completado na triagem."
      breadcrumbs={[{ label: 'Solicitações', href: '/solicitacoes' }, { label: 'Nova' }]}
    >
      <Card className="mx-auto max-w-2xl">
        {/*
         * A FORMA do formulário depende da resposta: uma organização que
         * atende só a si mesma não mostra seletor de cliente. Enquanto a
         * resposta não chega, não dá para desenhar o formulário certo — e
         * deixar enviar nesse meio-tempo produz o erro mais confuso possível:
         * "escolha o cliente", falando de um campo que a pessoa não vê.
         */}
        {carregandoClientes ? (
          <div className="flex flex-col gap-4 p-5">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          // `noValidate`: a validação nossa é a que roda. A do navegador
          // aparece numa bolha no idioma do sistema, sem relação com o campo e
          // invisível para leitor de tela.
          <form onSubmit={enviar} noValidate className="flex flex-col gap-5 p-5">
            {!clienteUnico && (
              <Field label="Cliente" required error={erro?.campo === 'customer_id' ? erro.mensagem : null}>
                <Select value={cliente} onChange={(e) => setCliente(e.target.value)}>
                  <option value="">Selecione…</option>
                  {lista.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field
              label="O que está acontecendo"
              required
              error={erro?.campo === 'summary' ? erro.mensagem : null}
              hint="Uma linha. É o que aparece na fila de triagem."
            >
              <Input
                value={resumo}
                onChange={(e) => setResumo(e.target.value)}
                placeholder="Ex.: ventilador da UTI apitando durante o uso"
                autoFocus
              />
            </Field>

            <Field label="Detalhes" hint="Opcional. Desde quando, o que já tentaram, o que muda o quadro.">
              <Textarea
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                rows={4}
                placeholder="Ex.: começou hoje de manhã, o alarme soa a cada dez minutos e para sozinho."
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Urgência" hint="É o que VOCÊ percebe. A prioridade final é definida na triagem.">
                <Select value={prioridade} onChange={(e) => setPrioridade(e.target.value)}>
                  {PRIORIDADES.map((p) => (
                    <option key={p.valor} value={p.valor}>
                      {p.rotulo}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Sintoma" hint="Ajuda a triagem a agrupar problemas parecidos.">
                <Select value={sintoma} onChange={(e) => setSintoma(e.target.value)}>
                  <option value="">Não sei dizer</option>
                  {(sintomas?.items ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {erro && !erro.campo && (
              <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
                {erro.mensagem}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-4">
              <Button onClick={() => void navigate({ to: '/solicitacoes' })}>Cancelar</Button>
              <Button type="submit" variant="primary" loading={criar.isPending}>
                Abrir solicitação
              </Button>
            </div>
          </form>
        )}
      </Card>
    </AppShell>
  );
}
