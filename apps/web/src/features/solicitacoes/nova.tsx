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
 * o que está acontecendo.
 *
 * A ORDEM É A DO CLIENTE (reunião 16/10/2026): Cliente → Equipamento → Tipo →
 * Detalhes → Urgência. Escolhido o cliente, a lista de equipamentos é SÓ a dele
 * — e só dos setores que esta pessoa alcança (o servidor recorta e confere de
 * novo ao gravar). O campo "Sintoma" saiu da tela; o dado antigo continua.
 *
 * O AVISO DE DUPLICIDADE VEM DEPOIS, e não bloqueia (§08). Entre "consultar" e
 * "enviar" alguém pode ter aberto a mesma; avisar depois, apontando a
 * parecida, é honesto. Bloquear seria dizer a quem está com o problema na
 * frente que ele não pode registrá-lo.
 */
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Card, Field, Input, Select, Skeleton, Textarea, useToast } from '@aurora/ui';
import {
  requestCreate,
  requestsQueue,
  assetsList,
  customersDetail,
  customersList,
  SERVICE_REQUEST_TYPE_KEYS,
  type AssetRow,
  type Customer,
  type CustomerLocation,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery, usePermissions } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { DialogoNovoCliente } from '../clientes/novo-cliente';

const PRIORIDADES = [
  { valor: 'none', rotulo: 'Sem urgência declarada' },
  { valor: 'low', rotulo: 'Baixa' },
  { valor: 'urgent', rotulo: 'Urgente' },
  { valor: 'very_urgent', rotulo: 'Muito urgente' },
  { valor: 'emergency', rotulo: 'Emergência' },
] as const;

export const TIPOS_DE_SOLICITACAO: Record<(typeof SERVICE_REQUEST_TYPE_KEYS)[number], string> = {
  corrective: 'Corretiva',
  preventive: 'Preventiva',
  technical_instruction: 'Instrução Técnica',
  training: 'Treinamento',
  calibration: 'Calibração',
  electrical_safety: 'Teste de Segurança Elétrica',
  qualification: 'Qualificação',
};

export function NovaSolicitacaoPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [cliente, setCliente] = useState('');
  const [resumo, setResumo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [prioridade, setPrioridade] = useState<string>('none');
  const [equipamento, setEquipamento] = useState('');
  const [setor, setSetor] = useState('');
  const [tipo, setTipo] = useState<string>('corrective');
  const [erro, setErro] = useState<{ campo?: string; mensagem: string } | null>(null);
  const [cadastrandoCliente, setCadastrandoCliente] = useState(false);
  /** O cliente cadastrado aqui mesmo, enquanto a lista ainda não voltou com ele. */
  const [clienteNovo, setClienteNovo] = useState<Customer | null>(null);
  const { can } = usePermissions();
  const podeCadastrarCliente = can('customer.create');

  const { data: clientes, isLoading: carregandoClientes } = useApiQuery(customersList, undefined, {
    staleTime: 5 * 60_000,
  }) as { data: { items: Customer[]; single_customer: boolean } | undefined; isLoading: boolean };

  const carregados = clientes?.items ?? [];
  // O recém-cadastrado entra na lista na hora. Esperar a recarga deixaria o
  // seletor apontando para um valor sem opção — em branco, como se o cadastro
  // tivesse falhado.
  const lista =
    clienteNovo && !carregados.some((c) => c.id === clienteNovo.id)
      ? [...carregados, clienteNovo]
      : carregados;
  // Uma organização que atende só a si mesma não escolhe cliente: escolher
  // entre uma opção não é escolha, é obstáculo. Até ela cadastrar o segundo.
  const clienteUnico = clientes?.single_customer && !clienteNovo ? lista[0] : undefined;
  const clienteEscolhido = clienteUnico?.id ?? cliente;

  // SOL-01: os setores do cliente que esta pessoa alcança (a ficha do cliente já vem recortada
  // pelo escopo no servidor). Escolher o setor reduz a lista de equipamentos.
  const { data: ficha } = useApiQuery(
    customersDetail,
    { params: { id: clienteEscolhido } },
    { enabled: Boolean(clienteEscolhido) && can('customer.read') }
  ) as { data: { customer: Customer; locations: CustomerLocation[] } | undefined };
  const setores = (ficha?.locations ?? []).filter((l) => l.location_type_key === 'setor');

  // SÓ os equipamentos do cliente escolhido (e do setor, se escolhido) — já recortados pelo
  // escopo no servidor, que confere de novo ao gravar.
  const { data: ativos, isLoading: carregandoAtivos } = useApiQuery(
    assetsList,
    { query: { customer: clienteEscolhido, ...(setor ? { location: setor } : {}), limit: 500 } },
    { enabled: Boolean(clienteEscolhido) && can('asset.read') }
  ) as { data: { items: AssetRow[] } | undefined; isLoading: boolean };

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
          requested_type: tipo as (typeof SERVICE_REQUEST_TYPE_KEYS)[number],
          asset_id: equipamento || null,
          location_id: setor || null,
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
              <Field
                label="Cliente"
                required
                error={erro?.campo === 'customer_id' ? erro.mensagem : null}
                hint={
                  lista.length === 0
                    ? podeCadastrarCliente
                      ? 'Nenhum cliente cadastrado ainda. Cadastre o primeiro aqui ao lado.'
                      : 'Nenhum cliente cadastrado ainda. Peça a quem administra a organização para cadastrar.'
                    : undefined
                }
              >
                {/*
                 * O cadastro mora AO LADO do seletor porque é aqui que a falta
                 * aparece: o hospital está ao telefone e não está na lista.
                 * Mandar a pessoa para outra tela é perder o que ela já digitou.
                 */}
                <div className="flex items-center gap-2">
                  <Select
                    value={cliente}
                    onChange={(e) => {
                      setCliente(e.target.value);
                      // Setor e equipamento são sempre DE um cliente: trocar o cliente os descarta.
                      setSetor('');
                      setEquipamento('');
                    }}
                    className="min-w-0 flex-1"
                  >
                    <option value="">Selecione…</option>
                    {lista.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  {podeCadastrarCliente && (
                    <Button
                      variant="ghost"
                      icon={<Plus className="size-4" />}
                      onClick={() => setCadastrandoCliente(true)}
                    >
                      Novo cliente
                    </Button>
                  )}
                </div>
              </Field>
            )}

            {setores.length > 0 && (
              <Field
                label="Setor"
                error={erro?.campo === 'location_id' ? erro.mensagem : null}
                hint="Opcional. Reduz a lista de equipamentos aos deste setor."
              >
                <Select
                  value={setor}
                  onChange={(e) => {
                    setSetor(e.target.value);
                    // O equipamento escolhido pode não estar no setor novo.
                    setEquipamento('');
                  }}
                >
                  <option value="">Todos os setores</option>
                  {setores.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field
              label="Equipamento"
              error={erro?.campo === 'asset_id' ? erro.mensagem : null}
              hint={
                !clienteEscolhido
                  ? 'Escolha o cliente primeiro.'
                  : !carregandoAtivos && (ativos?.items.length ?? 0) === 0
                    ? setor
                      ? 'Nenhum equipamento neste setor.'
                      : 'Nenhum equipamento deste cliente nos setores que você alcança.'
                    : setor
                      ? 'Só os equipamentos deste setor.'
                      : 'Só os equipamentos deste cliente, nos setores que você alcança.'
              }
            >
              <Select
                value={equipamento}
                disabled={!clienteEscolhido}
                onChange={(e) => setEquipamento(e.target.value)}
              >
                <option value="">Sem equipamento específico</option>
                {(ativos?.items ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {[a.name, a.tag, a.location_name].filter(Boolean).join(' · ')}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Tipo" required error={erro?.campo === 'requested_type' ? erro.mensagem : null}>
              <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {SERVICE_REQUEST_TYPE_KEYS.map((t) => (
                  <option key={t} value={t}>
                    {TIPOS_DE_SOLICITACAO[t]}
                  </option>
                ))}
              </Select>
            </Field>

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

            <Field label="Urgência" hint="É o que VOCÊ percebe. A prioridade final é definida na triagem.">
              <Select value={prioridade} onChange={(e) => setPrioridade(e.target.value)}>
                {PRIORIDADES.map((p) => (
                  <option key={p.valor} value={p.valor}>
                    {p.rotulo}
                  </option>
                ))}
              </Select>
            </Field>

            {erro &&
              ![
                'customer_id',
                'summary',
                'asset_id',
                'requested_type',
                ...(setores.length > 0 ? ['location_id'] : []),
              ].includes(erro.campo ?? '') && (
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

      {/*
       * FORA do formulário da solicitação, e não dentro dele. O diálogo vai
       * para um portal no DOM, mas os eventos do React sobem pela árvore de
       * componentes: o "Cadastrar cliente" dentro do <form> dispararia também o
       * envio da solicitação.
       */}
      {podeCadastrarCliente && (
        <DialogoNovoCliente
          open={cadastrandoCliente}
          onOpenChange={setCadastrandoCliente}
          onCriado={(c) => {
            setClienteNovo(c);
            setCliente(c.id);
            if (erro?.campo === 'customer_id') setErro(null);
          }}
        />
      )}
    </AppShell>
  );
}
