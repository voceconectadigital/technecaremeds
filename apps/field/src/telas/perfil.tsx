/**
 * Aurora — perfil e diagnóstico do aparelho (EPIC-014 · ADR-029).
 *
 * A TELA QUE O SUPORTE PEDE PARA ABRIR.
 *
 * Um aplicativo que guarda oito horas de trabalho num aparelho alheio precisa
 * poder ser interrogado. Quando alguém liga dizendo "sumiu tudo", a primeira
 * pergunta é qual plataforma, qual armazenamento, quanto espaço, e se a base
 * local está se comportando — e nenhuma dessas respostas está disponível se o
 * aplicativo não as mostrar.
 *
 * O DIAGNÓSTICO DE ARMAZENAMENTO RODA A SUÍTE DE CONFORMIDADE, aqui, no
 * aparelho de verdade.
 *
 * É a mesma suíte que o Vitest roda contra a memória e o SQLite. Rodá-la
 * também no navegador fecha o buraco que nenhum teste de Node fecha: o
 * IndexedDB do WebView de um Android específico, com a versão de sistema
 * daquele aparelho. Se uma regra reprovar ali, a resposta do suporte deixa de
 * ser "deve ser o aparelho" e passa a ser uma linha com nome.
 */
import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, Loader } from 'lucide-react';
import { useSession } from '@aurora/app-kit';
import { useCampo } from '../campo';
import { armazenamentoIndexedDb, conferirConformidade, type ResultadoDeConformidade } from '../armazenamento';

function tamanho(bytes: number | null): string {
  if (bytes === null) return 'não dá para saber';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function PerfilPage() {
  const { dispositivo, base, arquivos, estado, anexosEstado } = useCampo();
  const { signOut } = useSession();

  const [espaco, setEspaco] = useState<number | null | 'carregando'>('carregando');
  const [conformidade, setConformidade] = useState<ResultadoDeConformidade[] | 'rodando' | null>(null);

  useEffect(() => {
    if (!arquivos) return;
    let vivo = true;
    void arquivos
      .espacoLivre()
      .then((e) => vivo && setEspaco(e))
      .catch(() => vivo && setEspaco(null));
    return () => {
      vivo = false;
    };
  }, [arquivos]);

  async function diagnosticar() {
    setConformidade('rodando');
    /*
     * A SUÍTE RODA NUMA BASE DESCARTÁVEL, com nome próprio.
     *
     * Rodá-la contra a base de trabalho apagaria o dia do técnico: a regra 5
     * chama `limpar()`. O nome com carimbo de tempo garante que duas execuções
     * não se atrapalham, e a base é fechada e apagada ao fim.
     */
    const prefixo = `aurora-diagnostico-${Date.now()}`;
    const usadas: string[] = [];
    try {
      /*
       * UMA BASE POR REGRA. Reabrir a mesma devolveria o que a regra anterior
       * escreveu, e a suíte reprovaria por sujeira em vez de por defeito.
       */
      const r = await conferirConformidade((regra) => {
        const nome = `${prefixo}-${regra}`;
        usadas.push(nome);
        return armazenamentoIndexedDb(nome);
      });
      setConformidade(r);
    } catch (e) {
      setConformidade([
        {
          regra: 'abrir a base local',
          passou: false,
          detalhe: e instanceof Error ? e.message : String(e),
        },
      ]);
    } finally {
      // Não deixa lixo no aparelho de quem só quis conferir.
      for (const nome of usadas) {
        try {
          indexedDB.deleteDatabase(nome);
        } catch {
          /* alguns navegadores recusam apagar com conexão aberta; não é grave */
        }
      }
    }
  }

  const linhas: [string, string][] = [
    ['Distribuição', dispositivo.nativo ? `aplicativo (${dispositivo.plataforma})` : 'navegador'],
    ['Armazenamento', base.nome],
    ['Arquivos', arquivos?.nome ?? 'abrindo…'],
    ['Câmera', dispositivo.camera.nome],
    ['Leitor de código', dispositivo.leitorDeCodigo.nome],
    ['Rede', dispositivo.rede.nome],
    ['Espaço para fotos', espaco === 'carregando' ? 'vendo…' : tamanho(espaco)],
    [
      'No aparelho, sem enviar',
      `${estado.pendentes + estado.bloqueados} ações, ${anexosEstado.pendentes + anexosEstado.falhados} fotos`,
    ],
  ];

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-lg font-semibold text-text">Este aparelho</h1>

      <dl className="overflow-hidden rounded-panel border border-border-subtle bg-surface">
        {linhas.map(([rotulo, valor]) => (
          <div
            key={rotulo}
            className="flex items-baseline justify-between gap-3 border-b border-border-subtle px-3 py-2 last:border-b-0"
          >
            <dt className="text-xs text-subtle">{rotulo}</dt>
            <dd className="text-right text-sm text-text">{valor}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="diagnostico" className="flex flex-col gap-2">
        <h2 id="diagnostico" className="text-sm font-semibold text-text">
          Diagnóstico do armazenamento
        </h2>
        <p className="text-xs text-subtle">
          Confere, neste aparelho, as regras que a base local precisa cumprir para guardar o seu trabalho. Usa
          uma base descartável — o que você fez hoje não é tocado.
        </p>

        <button
          type="button"
          onClick={() => void diagnosticar()}
          disabled={conformidade === 'rodando'}
          className="min-h-12 rounded-control border border-border-subtle bg-surface px-3 text-sm font-medium text-text"
        >
          {conformidade === 'rodando' ? 'Conferindo…' : 'Conferir o armazenamento'}
        </button>

        {conformidade === 'rodando' && (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <Loader aria-hidden className="size-4 animate-spin" />
            Conferindo…
          </p>
        )}

        {Array.isArray(conformidade) && (
          <ul aria-label="Resultado do diagnóstico" className="flex flex-col gap-1">
            {conformidade.map((r) => (
              <li
                key={r.regra}
                className="flex items-start gap-2 rounded-control border border-border-subtle bg-surface px-3 py-2"
              >
                {r.passou ? (
                  <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <CircleX aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
                )}
                <span className="flex flex-col">
                  <span className="text-sm text-text">{r.regra}</span>
                  {r.detalhe && <span className="text-xs text-danger">{r.detalhe}</span>}
                  <span className="sr-only">{r.passou ? 'passou' : 'reprovou'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sair" className="flex flex-col gap-2">
        <h2 id="sair" className="text-sm font-semibold text-text">
          Sair deste aparelho
        </h2>
        {/*
          O AVISO É OBRIGATÓRIO, e não zelo.

          Sair apaga a credencial, e sem credencial a fila não consegue enviar
          nada — o trabalho continua guardado e vira inalcançável. Um botão de
          sair sem esta frase, tocado por engano no fim do turno, transforma
          oito horas de trabalho num problema de suporte.
        */}
        {estado.pendentes + estado.bloqueados + anexosEstado.pendentes > 0 ? (
          <p className="rounded-control border border-danger p-2 text-sm text-danger">
            Ainda há trabalho seu esperando para ser enviado. Se sair agora, ele continua guardado neste
            aparelho, mas só será enviado quando você entrar de novo. Sincronize antes.
          </p>
        ) : (
          <p className="text-sm text-muted">Nada seu está esperando para ser enviado.</p>
        )}
        <button
          type="button"
          onClick={() => signOut()}
          className="min-h-12 rounded-control border border-border-subtle px-3 text-sm text-muted"
        >
          Sair
        </button>
      </section>
    </div>
  );
}
