/**
 * Aurora — a tela da sincronização (SPEC §20 · EPIC-014).
 *
 * ELA EXISTE PARA RESPONDER UMA PERGUNTA: "o que ainda não chegou?"
 *
 * O indicador do topo cabe num número. Esta tela é onde o número vira lista: o
 * técnico que vai encerrar o turno precisa poder olhar e ver, item por item, o
 * que ainda está no aparelho — e decidir se pode ir embora.
 *
 * TRÊS FILAS, E ELAS SÃO DIFERENTES:
 *
 *   · comandos esperando rede — um dia normal;
 *   · comandos PARADOS esperando decisão — alguém precisa olhar;
 *   · fotos, que sobem por outro caminho e falham por outros motivos.
 *
 * Somá-las num número só faria as duas últimas sumirem dentro da primeira, que
 * é sempre a maior.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { CloudOff, KeyRound, RefreshCw } from 'lucide-react';
import { useSession } from '@aurora/app-kit';
import { useCampo } from '../campo';
import type { ComandoNaFila } from '../fila';
import { mensagemParaATela } from '../sincronizacao';

const QUANDO = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

function tamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function SincronizacaoPage() {
  const {
    fila,
    estado,
    anexosEstado,
    sincronizar,
    sincronizando,
    online,
    ultimaSincronizacao,
    ultimoResultado,
    dispositivo,
    sessaoExpirada,
  } = useCampo();
  const { signOut } = useSession();
  const navigate = useNavigate();

  const [comandos, setComandos] = useState<ComandoNaFila[]>([]);
  const [tipoDeRede, setTipoDeRede] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void fila.listar().then((c) => vivo && setComandos(c));
    void dispositivo.rede.estado().then((e) => vivo && setTipoDeRede(e.tipo));
    return () => {
      vivo = false;
    };
  }, [fila, estado.pendentes, estado.bloqueados, estado.atencao, estado.deOutraSessao, dispositivo]);

  const meus = comandos.filter((c) => fila.daSessaoAtual(c));
  const deOutros = comandos.filter((c) => !fila.daSessaoAtual(c));

  const tudoEnviado =
    estado.pendentes === 0 &&
    estado.bloqueados === 0 &&
    estado.atencao === 0 &&
    estado.deOutraSessao === 0 &&
    anexosEstado.pendentes === 0 &&
    anexosEstado.falhados === 0;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-lg font-semibold text-text">Sincronização</h1>

      <div className="rounded-panel border border-border-subtle bg-surface p-3">
        <p className="flex items-center gap-2 text-sm text-text">
          {online ? (
            <>
              <RefreshCw aria-hidden className={`size-4 ${sincronizando ? 'animate-spin' : ''}`} />
              Com rede
              {/*
                O TIPO DA CONEXÃO SÓ O APARELHO SABE DIZER, e é informação útil:
                "no 3G, devagar" e "sem rede" pedem coisas diferentes de quem
                está em campo. No navegador vem `null`, e a tela simplesmente
                não mostra — em vez de inventar.
              */}
              {tipoDeRede && tipoDeRede !== 'none' && (
                <span className="text-xs text-muted">({tipoDeRede})</span>
              )}
            </>
          ) : (
            <>
              <CloudOff aria-hidden className="size-4" />
              Sem rede
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-subtle">
          {ultimaSincronizacao
            ? `Último pacote do dia às ${QUANDO.format(new Date(ultimaSincronizacao))}.`
            : 'Este aparelho ainda não baixou o seu dia.'}
        </p>
        {ultimoResultado?.falha && !sessaoExpirada && (
          <p className="mt-1 text-xs text-danger">{mensagemParaATela(ultimoResultado.falha)}</p>
        )}

        {sessaoExpirada && (
          /*
           * SESSÃO VENCIDA É UM ESTADO, e não um erro de comando.
           *
           * A fila está inteira e parada; o que falta é a pessoa entrar de
           * novo. Os comandos continuam neste aparelho, carimbados com quem os
           * fez (ver `Identidade`), e saem sozinhos quando a MESMA pessoa entra
           * de novo — sair aqui não apaga nada.
           */
          <div role="alert" className="mt-2 rounded-control border border-danger p-2">
            <p className="flex items-center gap-2 text-sm font-medium text-danger">
              <KeyRound aria-hidden className="size-4" />
              Sessão expirada — entre de novo
            </p>
            <p className="mt-1 text-xs text-muted">
              O seu trabalho continua guardado neste aparelho e será enviado assim que você entrar.
            </p>
            <button
              type="button"
              onClick={() => {
                signOut();
                void navigate({ to: '/entrar' });
              }}
              className="mt-2 min-h-12 w-full rounded-control border border-danger px-3 text-sm font-medium text-danger"
            >
              Entrar de novo
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => void sincronizar({ manual: true })}
          disabled={sincronizando}
          className="mt-3 min-h-12 w-full rounded-control bg-accent px-4 text-sm font-semibold text-on-accent"
        >
          {sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}
        </button>
      </div>

      {tudoEnviado ? (
        /*
         * "TUDO ENVIADO" É UMA AFIRMAÇÃO FORTE, e por isso ela vem com o que a
         * sustenta: a hora do último pacote. Um visto verde sozinho é a mesma
         * marca de "salvo no aparelho", e a diferença entre as duas é a única
         * coisa que importa aqui.
         */
        <div className="rounded-panel border border-border-subtle bg-surface p-4">
          <p className="text-sm font-medium text-text">Tudo enviado</p>
          <p className="mt-1 text-sm text-muted">
            Nada do seu trabalho está esperando neste aparelho. Você pode encerrar o turno.
          </p>
        </div>
      ) : (
        <>
          {estado.pendentes > 0 && (
            <section aria-labelledby="esperando" className="flex flex-col gap-2">
              <h2 id="esperando" className="text-sm font-semibold text-text">
                Esperando rede ({estado.pendentes})
              </h2>
              <ul className="flex flex-col gap-1">
                {meus
                  .filter((c) => !c.bloqueado)
                  .map((c) => (
                    <li
                      key={c.id}
                      className="rounded-control border border-border-subtle bg-surface px-3 py-2"
                    >
                      <p className="text-sm text-text">{c.rotulo}</p>
                      <p className="text-xs text-subtle">
                        desde {QUANDO.format(new Date(c.criadoEm))}
                        {c.tentativas > 0 && ` · ${c.tentativas} tentativas`}
                      </p>
                      {c.ultimoErro && (
                        <p className="text-xs text-muted">{mensagemParaATela(c.ultimoErro)}</p>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          )}

          {deOutros.length > 0 && (
            /*
             * TRABALHO DE OUTRA SESSÃO: guardado, listado, e NÃO enviado.
             *
             * Mandá-lo com a credencial de quem está agora poria o nome errado
             * no trabalho, ou o mandaria para a organização errada. Apagar
             * seria perder o dia de alguém. Ele fica aqui, à vista, até o dono
             * entrar de novo neste aparelho.
             */
            <section aria-labelledby="outra-sessao" className="flex flex-col gap-2">
              <h2 id="outra-sessao" className="text-sm font-semibold text-text">
                De outra sessão ({deOutros.length})
              </h2>
              <p className="text-sm text-muted">
                Feito por outra pessoa ou em outra organização neste aparelho. Continua guardado e é enviado
                quando quem fez entrar de novo.
              </p>
              <ul className="flex flex-col gap-1">
                {deOutros.map((c) => (
                  <li key={c.id} className="rounded-control border border-border-subtle bg-surface px-3 py-2">
                    <p className="text-sm text-text">{c.rotulo}</p>
                    <p className="text-xs text-subtle">desde {QUANDO.format(new Date(c.criadoEm))}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(estado.bloqueados > 0 || estado.atencao > 0) && (
            <section aria-labelledby="parados" className="flex flex-col gap-2">
              <h2 id="parados" className="text-sm font-semibold text-danger">
                Esperando a sua decisão ({estado.atencao + estado.bloqueados})
              </h2>
              <p className="text-sm text-muted">
                O servidor recusou alguma coisa que você fez, e o que veio depois ficou parado. Nada foi
                jogado fora.
              </p>
              <Link
                to="/atencao"
                className="flex min-h-12 items-center justify-center rounded-control border border-danger px-3 text-sm font-medium text-danger"
              >
                Ver o que precisa da sua atenção
              </Link>
            </section>
          )}

          {(anexosEstado.pendentes > 0 || anexosEstado.falhados > 0) && (
            <section aria-labelledby="fotos" className="flex flex-col gap-2">
              <h2 id="fotos" className="text-sm font-semibold text-text">
                Fotos ({anexosEstado.pendentes + anexosEstado.falhados})
              </h2>
              <p className="text-sm text-muted">
                {tamanho(anexosEstado.bytesPendentes)} ainda no aparelho.
                {anexosEstado.falhados > 0 && ` ${anexosEstado.falhados} com falha.`}
              </p>
              {anexosEstado.progresso !== null && (
                <>
                  {/*
                    A barra tem `role="progressbar"` com os valores declarados:
                    sem isso, quem usa leitor de tela ouve "imagem" e não sabe
                    de quanto em quanto o envio está andando.
                  */}
                  <div
                    role="progressbar"
                    aria-label="Envio das fotos"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(anexosEstado.progresso * 100)}
                    className="h-2 overflow-hidden rounded-full bg-surface-sunken"
                  >
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${Math.round(anexosEstado.progresso * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-subtle">{Math.round(anexosEstado.progresso * 100)}% enviado</p>
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
