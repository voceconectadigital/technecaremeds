/**
 * Aurora — abrir chamado (SPEC v0.2 §19).
 *
 * TRINTA SEGUNDOS, EM PÉ, NO CORREDOR.
 *
 * É o requisito literal da SPEC, e ele decide o formulário inteiro. Um campo
 * obrigatório a mais custa cinco segundos e uma chance de desistir; um campo
 * obrigatório que a pessoa não sabe responder custa o chamado inteiro.
 *
 * Por isso só UMA coisa é obrigatória: o que está acontecendo. Equipamento e
 * detalhes ajudam a triagem e não travam o envio — e um chamado sem
 * equipamento é infinitamente melhor do que um chamado que não foi aberto.
 *
 * O EQUIPAMENTO É ESCOLHIDO POR BUSCA, e não por lista.
 *
 * A lista do escopo pode ter trezentos itens. Quem está com o problema na
 * frente sabe o nome ou o patrimônio do aparelho; rolar trezentas linhas em pé
 * é o que faz a pessoa escolher "não sei" e a triagem ligar de volta.
 */
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Button, Card, Field, Input, Textarea, cn, useToast } from '@aurora/ui';
import { ApiError, useApiMutation, useApiQuery } from '@aurora/app-kit';
import {
  portalAssets,
  portalHome,
  portalOpenRequest,
  portalRequests,
  type PortalAsset,
} from '@aurora/contracts';
import { Casca } from '../casca';

export function AbrirPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [resumo, setResumo] = useState('');
  const [detalhes, setDetalhes] = useState('');
  const [equipamento, setEquipamento] = useState<PortalAsset | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const abrir = useApiMutation(portalOpenRequest, {
    invalidates: [portalRequests, portalHome],
    onError: (e: ApiError) => setErro(e.problem.message),
  });

  return (
    <Casca
      titulo="Abrir chamado"
      subtitulo="Diga o que está acontecendo. O resto pode vir depois."
    >
      <Card className="mx-auto max-w-xl">
        {/*
          `noValidate`: a validação nossa é a que roda. A do navegador aparece
          numa bolha no idioma do sistema, sem relação com o campo e invisível
          para leitor de tela.
        */}
        <form
          noValidate
          className="flex flex-col gap-5 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setErro(null);
            if (resumo.trim().length < 3) {
              setErro('Escreva em poucas palavras o que está acontecendo.');
              return;
            }
            abrir.mutate(
              {
                body: {
                  summary: resumo.trim(),
                  description: detalhes.trim() || undefined,
                  asset_id: equipamento?.id,
                },
              },
              {
                onSuccess: (r) => {
                  const criado = r as { id: string; number: string };
                  toast.success(
                    `Chamado ${criado.number} aberto`,
                    'Você acompanha o andamento em "Meus chamados".'
                  );
                  void navigate({ to: '/chamados/$id', params: { id: criado.id } });
                },
              }
            );
          }}
        >
          <Field
            label="O que está acontecendo"
            required
            error={erro}
            hint="Uma linha basta. Ex.: “ventilador do leito 3 apitando”."
          >
            <Textarea
              value={resumo}
              onChange={(e) => setResumo(e.target.value)}
              rows={2}
              autoFocus
              placeholder="Descreva o problema"
            />
          </Field>

          <EscolhaDeEquipamento escolhido={equipamento} onEscolher={setEquipamento} />

          <Field
            label="Mais detalhes"
            hint="Opcional. Desde quando, o que já tentaram, o que muda o quadro."
          >
            <Textarea
              value={detalhes}
              onChange={(e) => setDetalhes(e.target.value)}
              rows={3}
              placeholder="Se souber, conte mais"
            />
          </Field>

          <Button
            type="submit"
            variant="primary"
            loading={abrir.isPending}
            icon={<Check className="size-4" />}
            className="min-h-12 w-full sm:w-auto sm:self-end"
          >
            Abrir chamado
          </Button>
        </form>
      </Card>
    </Casca>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A escolha do equipamento, por BUSCA.
 *
 * A lista chega inteira e é filtrada aqui — no máximo algumas centenas de
 * linhas, e filtrar no navegador é instantâneo. O que NÃO se faz é mostrar as
 * trezentas de uma vez: rolar trezentas linhas em pé é o que faz a pessoa
 * desistir de identificar o aparelho.
 *
 * OPCIONAL, e a tela diz isso. Um chamado sem equipamento é infinitamente
 * melhor do que um chamado que não foi aberto.
 */
function EscolhaDeEquipamento({
  escolhido,
  onEscolher,
}: {
  escolhido: PortalAsset | null;
  onEscolher: (a: PortalAsset | null) => void;
}) {
  const [busca, setBusca] = useState('');

  const { data } = useApiQuery(portalAssets, undefined, { staleTime: 10 * 60_000 }) as {
    data: { items: PortalAsset[] } | undefined;
  };

  const encontrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (termo.length < 2) return [];
    return (data?.items ?? [])
      .filter(
        (a) =>
          a.name.toLowerCase().includes(termo) ||
          (a.tag ?? '').toLowerCase().includes(termo) ||
          (a.serial_number ?? '').toLowerCase().includes(termo)
      )
      .slice(0, 8);
  }, [data, busca]);

  if (escolhido) {
    return (
      <Field label="Equipamento" hint="Opcional — ajuda a triagem a chegar mais rápido.">
        <div className="flex items-center gap-3 rounded-control border border-border-strong bg-surface px-3 py-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-text">{escolhido.name}</span>
            <span className="block truncate text-xs text-muted" data-numeric>
              {[escolhido.tag, escolhido.location_name].filter(Boolean).join(' · ')}
            </span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => onEscolher(null)}>
            Trocar
          </Button>
        </div>
      </Field>
    );
  }

  return (
    <Field label="Equipamento" hint="Opcional — ajuda a triagem a chegar mais rápido.">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle"
        />
        <Input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Nome ou patrimônio"
          aria-label="Procurar equipamento"
          className="pl-8"
        />
      </div>

      {busca.trim().length >= 2 && (
        <ul className="mt-1 flex flex-col overflow-hidden rounded-control border border-border-subtle">
          {encontrados.length === 0 ? (
            <li className="px-3 py-2 text-xs text-subtle">
              Nenhum equipamento com esse nome no seu setor. Você pode abrir o chamado sem
              escolher.
            </li>
          ) : (
            encontrados.map((a, i) => (
              <li key={a.id} className={cn(i > 0 && 'border-t border-border-subtle')}>
                <button
                  type="button"
                  onClick={() => {
                    onEscolher(a);
                    setBusca('');
                  }}
                  className="flex min-h-12 w-full items-center px-3 py-2 text-left transition-colors hover:bg-surface-hover"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text">{a.name}</span>
                    <span className="block truncate text-xs text-muted" data-numeric>
                      {[a.tag, a.location_name].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </Field>
  );
}
