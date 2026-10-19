/**
 * Téchne Care — apresentação comercial (`/apresentacao`).
 *
 * PÚBLICA, SEM CONTA E SEM REDE. A página não chama a API, não usa consulta,
 * não lê sessão e não depende da moldura da aplicação (barra lateral e barra
 * superior exigem sessão). O que ela mostra está escrito em `conteudo.ts`,
 * conferido contra o código; os gráficos são os componentes do painel com
 * números fictícios declarados como tal.
 *
 * A DIREÇÃO VISUAL sai da logo: o azul-marinho estrutural da navegação, o azul
 * da marca e o verde-limão como LIGAÇÃO — no símbolo, o verde é o traço que
 * une os nós, e aqui ele faz o mesmo papel: liga as etapas do fluxo, marca o
 * passo da execução, une a plataforma às organizações. Um único elemento
 * ousado (a rede do herói); o resto é quieto.
 *
 * O que está por vir aparece com BORDA TRACEJADA e selo: a forma diz "ainda
 * não construído" antes de a pessoa ler o selo.
 */
import { useEffect, type MouseEvent, type ReactNode } from 'react';
import { Check, LogIn, WifiOff } from 'lucide-react';
import { Logo, StatusChip, cn } from '@aurora/ui';
import { MARCA } from '@aurora/app-kit';
import {
  CAMPO,
  ECOSSISTEMA,
  FLUXO,
  IA,
  MODELOS_DE_RELATORIO,
  MODULOS,
  MULTIEMPRESA,
  ORGANIZACOES_ILUSTRATIVAS,
  PASSOS_DA_EXECUCAO,
  PERFIS,
  PUBLICOS,
  SEGURANCA,
  TRILHA_ILUSTRATIVA,
  type Ferramenta,
} from './conteudo';
import { RedeDaPlataforma } from './rede';
import { PainelIlustrativo } from './painel-ilustrativo';
import { Revelar, escalonar } from './animacao';

const ENTRAR = '/entrar';

/* --------------------------------------------------------------- peças */

const CONTEUDO = 'mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8';

/** Fundo azul-marinho FIXO: é a cor da marca, e não muda com o tema escolhido. */
const TINTA = 'bg-[var(--aurora-brand-950)] text-[var(--aurora-neutral-0)]';

const BOTAO =
  'apr-btn inline-flex min-h-12 items-center justify-center gap-2 rounded-control px-6 text-base font-semibold';
const BOTAO_MARCA =
  'apr-btn--marca bg-[var(--aurora-lime-500)] text-[var(--aurora-neutral-900)] hover:bg-[var(--aurora-lime-400)] focus-visible:outline-[var(--aurora-neutral-0)]';
const BOTAO_CONTORNO =
  'apr-btn--contorno border border-[rgb(255_255_255/0.32)] text-[var(--aurora-neutral-0)] hover:bg-[rgb(255_255_255/0.08)] focus-visible:outline-[var(--aurora-neutral-0)]';

const LINK_DO_MENU =
  'inline-flex min-h-10 items-center rounded-control px-3 text-sm font-medium text-[var(--aurora-brand-100)] hover:bg-[rgb(255_255_255/0.08)] hover:text-[var(--aurora-neutral-0)] focus-visible:outline-[var(--aurora-neutral-0)]';

const SECOES_DO_MENU: readonly (readonly [string, string])[] = [
  ['modulos', 'Módulos'],
  ['painel', 'Painel'],
  ['campo', 'Campo'],
  ['ecossistema', 'Ecossistema'],
  ['seguranca', 'Segurança'],
];

function reduzMovimento(): boolean {
  return (
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Âncora para uma seção da própria página.
 *
 * O clique é tratado aqui, e não deixado ao navegador: o roteador escuta a
 * troca de endereço e restaura a rolagem, o que brigaria com o salto. E o
 * FOCO vai junto com a rolagem — quem navega por teclado continua a partir da
 * seção, e não do botão lá em cima.
 */
function IrPara({ alvo, className, children }: { alvo: string; className?: string; children: ReactNode }) {
  function aoClicar(e: MouseEvent<HTMLAnchorElement>) {
    const destino = document.getElementById(alvo);
    if (!destino) return;
    e.preventDefault();
    destino.scrollIntoView({ behavior: reduzMovimento() ? 'auto' : 'smooth', block: 'start' });
    destino.focus({ preventScroll: true });
  }
  return (
    <a href={`#${alvo}`} onClick={aoClicar} className={className}>
      {children}
    </a>
  );
}

function Secao({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-titulo`}
      tabIndex={-1}
      className={cn('scroll-mt-4 py-20 outline-none md:py-28', className)}
    >
      <div className={CONTEUDO}>{children}</div>
    </section>
  );
}

function Titulo({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <Revelar
      as="h2"
      id={`${id}-titulo`}
      className={cn(
        'max-w-[20ch] text-[clamp(1.875rem,4.2vw,3rem)] leading-[1.08] font-bold tracking-[-0.03em] text-balance',
        className
      )}
    >
      {children}
    </Revelar>
  );
}

function Abertura({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Revelar
      as="p"
      atraso={90}
      className={cn('mt-5 max-w-[58ch] text-lg leading-relaxed text-muted', className)}
    >
      {children}
    </Revelar>
  );
}

/* ---------------------------------------------------------------- página */

export function ApresentacaoPage() {
  useEffect(() => {
    const anterior = document.title;
    document.title = `${MARCA.produto} — Apresentação`;
    return () => {
      document.title = anterior;
    };
  }, []);

  return (
    <div id="topo" className="min-h-dvh overflow-x-clip bg-bg text-text">
      <IrPara alvo="conteudo" className="aurora-skip-link">
        Pular para o conteúdo
      </IrPara>

      <header className={TINTA}>
        <div className={cn(CONTEUDO, 'flex items-center justify-between gap-4 py-5')}>
          <Logo
            src={MARCA.logoHorizontalEscuro}
            srcEscuro={MARCA.logoHorizontalEscuro}
            nome={MARCA.produto}
            largura={140}
          />
          <nav aria-label="Seções da apresentação" className="flex items-center gap-1">
            <ul className="hidden items-center gap-1 lg:flex">
              {SECOES_DO_MENU.map(([alvo, nome]) => (
                <li key={alvo}>
                  <IrPara alvo={alvo} className={LINK_DO_MENU}>
                    {nome}
                  </IrPara>
                </li>
              ))}
            </ul>
            <a
              href={ENTRAR}
              className={cn(
                LINK_DO_MENU,
                'ml-2 gap-2 border border-[rgb(255_255_255/0.32)] px-4 font-semibold text-[var(--aurora-neutral-0)]'
              )}
            >
              <LogIn aria-hidden="true" className="size-4" />
              Entrar
            </a>
          </nav>
        </div>
      </header>

      <main id="conteudo" tabIndex={-1} className="outline-none">
        <Heroi />
        <Visao />
        <Modulos />
        <Painel />
        <Campo />
        <Multiempresa />
        <Ecossistema />
        <InteligenciaArtificial />
        <Seguranca />
        <ChamadaFinal />
      </main>

      <Rodape />
    </div>
  );
}

/* ------------------------------------------------------------ 1 · herói */

function Grade() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 opacity-[0.06]"
      style={{
        backgroundImage:
          'linear-gradient(var(--aurora-brand-100) 1px, transparent 1px), linear-gradient(90deg, var(--aurora-brand-100) 1px, transparent 1px)',
        backgroundSize: '56px 56px',
        maskImage: 'radial-gradient(80% 70% at 70% 55%, black, transparent 75%)',
      }}
    />
  );
}

function Heroi() {
  return (
    <section aria-labelledby="heroi-titulo" className={cn(TINTA, 'relative overflow-hidden')}>
      <Grade />
      <div
        className={cn(
          CONTEUDO,
          'relative grid items-center gap-10 pt-8 pb-20 lg:grid-cols-12 lg:pt-14 lg:pb-28'
        )}
      >
        <div className="lg:col-span-7">
          <Revelar
            as="p"
            dist={14}
            className="mb-6 flex items-center gap-3 text-xs font-bold tracking-[0.14em] text-[var(--aurora-lime-400)] sm:text-sm"
          >
            <span
              aria-hidden="true"
              className="h-0.5 w-8 shrink-0 rounded-pill bg-[var(--aurora-lime-500)]"
            />
            GESTÃO INTELIGENTE PARA O SETOR DE SAÚDE
          </Revelar>
          <Revelar
            as="h1"
            id="heroi-titulo"
            atraso={90}
            dist={20}
            className="text-[clamp(2.25rem,4.5vw,3.75rem)] leading-[1.04] font-extrabold tracking-[-0.04em] text-balance"
          >
            <span className="block">Toda a sua operação.</span>{' '}
            <span className="block text-[var(--aurora-lime-500)]">Uma única plataforma.</span>
          </Revelar>
          <Revelar
            as="p"
            atraso={180}
            dist={16}
            className="mt-6 max-w-[46ch] text-[clamp(1.0625rem,1.6vw,1.3125rem)] leading-relaxed font-medium text-[var(--aurora-brand-100)]"
          >
            Conecte engenharia clínica, assistência técnica, hospitais e prestadores de serviços em um
            ecossistema inteligente de gestão.
          </Revelar>
          <Revelar atraso={270} dist={16} className="mt-10 flex flex-col gap-3 sm:flex-row">
            <IrPara alvo="visao" className={cn(BOTAO, BOTAO_MARCA)}>
              Conhecer a plataforma
            </IrPara>
            <a href={ENTRAR} className={cn(BOTAO, BOTAO_CONTORNO)}>
              Entrar no sistema
            </a>
          </Revelar>
        </div>
        <div className="mx-auto w-full max-w-[560px] lg:col-span-5">
          <RedeDaPlataforma className="h-auto w-full" />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ 2 · visão */

function Visao() {
  return (
    <Secao id="visao">
      <div className="grid gap-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Titulo id="visao">Do chamado ao indicador, num só lugar.</Titulo>
          <Abertura>
            Gestão de engenharia clínica para hospitais, prestadores de serviço e assistência técnica — com
            várias empresas operando na mesma plataforma, cada uma no seu espaço.
          </Abertura>
        </div>

        <ol
          aria-label="O caminho de um atendimento"
          className="relative grid gap-0 lg:col-span-7 lg:self-center"
        >
          {FLUXO.map((etapa, i) => (
            <Revelar
              as="li"
              key={etapa}
              tipo="direita"
              atraso={escalonar(i, 0, 110)}
              className="relative flex items-center gap-5 py-3"
            >
              {i < FLUXO.length - 1 && (
                <span
                  aria-hidden="true"
                  className="apr-linha-y absolute top-1/2 left-[23px] h-full w-[3px] bg-[var(--aurora-lime-500)]"
                  style={{ ['--apr-d2' as string]: `${escalonar(i, 280, 110)}ms` }}
                />
              )}
              <span
                aria-hidden="true"
                className={cn(
                  'relative grid size-12 shrink-0 place-items-center rounded-full text-base font-bold',
                  i === FLUXO.length - 1
                    ? 'bg-[var(--aurora-brand-950)] text-[var(--aurora-neutral-0)]'
                    : 'border-[3px] border-[var(--aurora-brand-500)] bg-surface text-accent-text'
                )}
              >
                {i + 1}
              </span>
              <span className="text-[clamp(1.25rem,2.6vw,1.75rem)] font-semibold tracking-[-0.02em]">
                {etapa}
              </span>
            </Revelar>
          ))}
        </ol>
      </div>

      <ul className="mt-16 grid gap-x-8 gap-y-8 border-t border-border pt-10 sm:grid-cols-2 lg:grid-cols-5">
        {PUBLICOS.map(({ nome, texto, icone: Icone }, i) => (
          <Revelar as="li" key={nome} atraso={escalonar(i)} className="apr-gancho">
            <Icone aria-hidden="true" strokeWidth={1.75} className="apr-icone size-6 text-accent-text" />
            <h3 className="mt-3 text-md font-semibold">{nome}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted">{texto}</p>
          </Revelar>
        ))}
      </ul>
    </Secao>
  );
}

/* ---------------------------------------------------------- 3 · módulos */

function Modulos() {
  return (
    <Secao id="modulos" className="bg-surface">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Titulo id="modulos">Catorze módulos que já conversam entre si.</Titulo>
          <Abertura>
            O chamado vira ordem de serviço, a OS dá baixa no estoque, gera orçamento e alimenta o indicador.
          </Abertura>
        </div>
      </div>

      <div className="mt-14 border-t border-border">
        {MODULOS.map(({ grupo, modulos }) => (
          <div
            key={grupo}
            className="grid gap-4 border-b border-border py-8 lg:grid-cols-[220px_minmax(0,1fr)]"
          >
            <Revelar as="h3" tipo="esquerda" className="text-sm font-semibold text-muted">
              {grupo}
            </Revelar>
            <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-4">
              {modulos.map(({ nome, texto, icone: Icone }, i) => (
                <Revelar
                  as="li"
                  key={nome}
                  dist={18}
                  atraso={escalonar(i % 4, 60)}
                  className="apr-gancho flex gap-4"
                >
                  <span
                    aria-hidden="true"
                    className="apr-icone apr-icone--tile grid size-11 shrink-0 place-items-center rounded-control bg-accent-soft text-accent-text"
                  >
                    <Icone strokeWidth={1.75} className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h4 className="text-md font-semibold">{nome}</h4>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{texto}</p>
                  </div>
                </Revelar>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Secao>
  );
}

/* ----------------------------------------------------------- 4 · painel */

function Painel() {
  return (
    <Secao id="painel">
      <div className="grid gap-12 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Titulo id="painel">Painel de controle e relatórios.</Titulo>
          <Abertura>
            Indicadores com metas configuráveis, gráficos e filtros por período, cliente e setor. O relatório
            sai do mesmo painel.
          </Abertura>

          <Revelar as="h3" atraso={150} className="mt-10 text-sm font-semibold text-muted">
            Relatórios em três modelos
          </Revelar>
          <ul className="mt-4 grid gap-0 overflow-hidden rounded-card border border-border bg-surface">
            {MODELOS_DE_RELATORIO.map(({ nome, texto }, i) => (
              <Revelar
                as="li"
                key={nome}
                tipo="esquerda"
                atraso={escalonar(i, 200, 100)}
                className="flex items-baseline gap-4 border-b border-border-subtle px-4 py-3.5 transition-colors last:border-b-0 hover:bg-surface-subtle"
              >
                <span className="w-[5.5rem] shrink-0 text-md font-bold text-accent-text">{nome}</span>
                <span className="text-sm leading-relaxed text-muted">{texto}</span>
              </Revelar>
            ))}
          </ul>
        </div>
        <div className="min-w-0 lg:col-span-8">
          <PainelIlustrativo />
        </div>
      </div>
    </Secao>
  );
}

/* ------------------------------------------------------------ 5 · campo */

function Campo() {
  const atual = 3; // "Preencher OS": os três primeiros já foram feitos
  return (
    <Secao id="campo" className="bg-surface">
      <div className="grid items-center gap-14 lg:grid-cols-12">
        <Revelar
          as="figure"
          tipo="escala"
          dist={28}
          className="m-0 flex flex-col items-center lg:order-2 lg:col-span-5"
        >
          <div className="apr-flutua w-full max-w-[300px] rounded-[2.25rem] border-[10px] border-[var(--aurora-neutral-900)] bg-surface shadow-sheet">
            <div className="px-5 pt-6 pb-5">
              <p className="text-xs font-semibold text-subtle">OS 1042</p>
              <p className="mt-1 text-md font-bold leading-snug">Monitor multiparamétrico</p>
              <p className="text-sm text-muted">UTI Adulto</p>
              <div className="mt-4 h-1.5 overflow-hidden rounded-pill bg-surface-sunken">
                <div
                  className="apr-linha-x h-full rounded-pill bg-[var(--aurora-lime-500)]"
                  style={{
                    width: `${((atual + 0.5) / PASSOS_DA_EXECUCAO.length) * 100}%`,
                    ['--apr-d2' as string]: '450ms',
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-muted">
                Passo {atual + 1} de {PASSOS_DA_EXECUCAO.length}
              </p>
            </div>
            <ol aria-label="Passos da execução da OS" className="border-t border-border-subtle px-3 py-3">
              {PASSOS_DA_EXECUCAO.map((passo, i) => {
                const feito = i < atual;
                const agora = i === atual;
                return (
                  <Revelar
                    as="li"
                    key={passo}
                    dist={10}
                    atraso={escalonar(i, 350, 70, 8)}
                    aria-current={agora ? 'step' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-control px-2 py-2 text-sm',
                      agora && 'bg-accent-soft font-semibold text-accent-text'
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        agora && 'apr-pulso',
                        'grid size-6 shrink-0 place-items-center rounded-full text-2xs font-bold',
                        feito && 'bg-[var(--aurora-lime-500)] text-[var(--aurora-neutral-900)]',
                        agora && 'bg-accent text-on-accent',
                        !feito && !agora && 'border border-border-strong text-subtle'
                      )}
                    >
                      {feito ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                    </span>
                    <span className={cn(!feito && !agora && 'text-muted')}>{passo}</span>
                    {feito && <span className="sr-only">(feito)</span>}
                  </Revelar>
                );
              })}
            </ol>
          </div>
          <figcaption className="mt-4 text-xs text-subtle">
            Execução guiada da OS. Dados ilustrativos.
          </figcaption>
        </Revelar>

        <div className="lg:order-1 lg:col-span-7">
          <Titulo id="campo">Operação em campo, com ou sem rede.</Titulo>
          <Abertura>
            O técnico executa a OS no celular: chega, registra, fotografa, preenche e conclui. O que foi feito
            fica guardado junto da ordem.
          </Abertura>

          <ul className="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2">
            {CAMPO.map(({ nome, texto, icone: Icone }, i) => (
              <Revelar
                as="li"
                key={nome}
                atraso={escalonar(i % 2, 120, 100)}
                className="apr-gancho flex gap-4"
              >
                <Icone
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="apr-icone mt-0.5 size-6 shrink-0 text-accent-text"
                />
                <div>
                  <h3 className="text-md font-semibold">{nome}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{texto}</p>
                </div>
              </Revelar>
            ))}
          </ul>

          <Revelar
            className="apr-card apr-gancho mt-10 flex items-start gap-4 rounded-card border border-border bg-surface-subtle p-5"
            atraso={100}
          >
            <span
              aria-hidden="true"
              className="apr-icone grid size-11 shrink-0 place-items-center rounded-full bg-[var(--aurora-brand-950)] text-[var(--aurora-lime-400)]"
            >
              <WifiOff className="size-5" />
            </span>
            <div>
              <h3 className="text-md font-semibold">{MARCA.campo.nomeNaTela}: offline primeiro</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                O aplicativo de campo funciona sem rede — no subsolo, na casa de máquinas — e envia tudo
                quando a conexão volta, sem perder nem duplicar.
              </p>
            </div>
          </Revelar>
        </div>
      </div>
    </Secao>
  );
}

/* ----------------------------------------------------- 6 · multiempresa */

function Multiempresa() {
  return (
    <Secao id="multiempresa">
      <Titulo id="multiempresa">Muitas empresas. Uma plataforma.</Titulo>
      <Abertura>
        Cada negócio opera no seu espaço, com seus clientes, sua equipe e suas permissões — sobre a mesma
        base.
      </Abertura>

      <Revelar as="figure" tipo="escala" dist={28} className="m-0 mt-14">
        <div className="rounded-sheet border-2 border-[var(--aurora-brand-950)] p-3 sm:p-4">
          <p className="flex items-center gap-2 px-2 pb-3 text-sm font-bold">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-[var(--aurora-lime-500)]" />
            {MARCA.produto}
          </p>
          <ul className="grid gap-3 md:grid-cols-3">
            {ORGANIZACOES_ILUSTRATIVAS.map((org, i) => (
              <Revelar
                as="li"
                key={org.nome}
                atraso={escalonar(i, 250, 110)}
                className="apr-card apr-gancho overflow-hidden rounded-card border border-border bg-surface"
              >
                <div
                  aria-hidden="true"
                  className="apr-linha-x h-1.5"
                  style={{ background: org.cor, ['--apr-d2' as string]: `${escalonar(i, 500, 110)}ms` }}
                />
                <div className="p-5">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="apr-icone grid size-10 place-items-center rounded-control text-md font-bold text-[var(--aurora-neutral-0)]"
                      style={{ background: org.cor }}
                    >
                      {org.sigla}
                    </span>
                    <span className="text-md font-semibold">{org.nome}</span>
                  </div>
                  <ul aria-label={`Perfis da ${org.nome}`} className="mt-4 flex flex-wrap gap-1.5">
                    {PERFIS.map((p) => (
                      <li key={p}>
                        <StatusChip size="sm" tone="neutral" withoutDot>
                          {p}
                        </StatusChip>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-xs text-subtle">
                    Clientes, equipamentos e OS só desta organização.
                  </p>
                </div>
              </Revelar>
            ))}
          </ul>
        </div>
        <figcaption className="mt-3 text-xs text-subtle">Organizações ilustrativas.</figcaption>
      </Revelar>

      <ul className="mt-12 grid gap-8 md:grid-cols-3">
        {MULTIEMPRESA.map(({ nome, texto, icone: Icone }, i) => (
          <Revelar as="li" key={nome} atraso={escalonar(i, 0, 100)} className="apr-gancho">
            <Icone aria-hidden="true" strokeWidth={1.75} className="apr-icone size-6 text-accent-text" />
            <h3 className="mt-3 text-md font-semibold">{nome}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted">{texto}</p>
          </Revelar>
        ))}
      </ul>
    </Secao>
  );
}

/* ------------------------------------------------------ 7 · ecossistema */

function SeloSituacao({ situacao }: { situacao: Ferramenta['situacao'] }) {
  return (
    <StatusChip size="sm" tone={situacao === 'EM DESENVOLVIMENTO' ? 'info' : 'neutral'}>
      {situacao}
    </StatusChip>
  );
}

function Ecossistema() {
  const ia = ECOSSISTEMA.find((f) => f.nome === 'Inteligência Artificial');
  const demais = ECOSSISTEMA.filter((f) => f !== ia);
  return (
    <Secao id="ecossistema" className="bg-surface">
      <Titulo id="ecossistema">Ecossistema em evolução.</Titulo>
      <Abertura>
        As próximas frentes da plataforma. Estão em desenvolvimento ou planejadas — nenhuma delas está
        disponível hoje.
      </Abertura>

      <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {demais.map((f, i) => (
          <Revelar
            as="li"
            key={f.nome}
            tipo="escala"
            dist={20}
            atraso={escalonar(i % 4)}
            className={cn(
              'apr-card apr-card--borda apr-gancho flex flex-col gap-4 rounded-card border-2 border-dashed border-border-strong p-6',
              f.situacao === 'EM DESENVOLVIMENTO' && 'lg:col-span-2'
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <f.icone aria-hidden="true" strokeWidth={1.75} className="apr-icone size-7 text-muted" />
              <SeloSituacao situacao={f.situacao} />
            </div>
            <div>
              <h3 className="text-lg font-semibold">{f.nome}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.texto}</p>
            </div>
          </Revelar>
        ))}
        {ia && (
          <Revelar
            as="li"
            tipo="escala"
            dist={20}
            className="apr-card apr-card--borda apr-gancho flex flex-col gap-4 rounded-card border-2 border-dashed border-[var(--aurora-brand-400)] bg-accent-soft p-6 sm:col-span-2 sm:flex-row sm:items-center lg:col-span-4"
          >
            <ia.icone
              aria-hidden="true"
              strokeWidth={1.75}
              className="apr-icone size-8 shrink-0 text-accent-text"
            />
            <div className="flex-1">
              <h3 className="text-lg font-semibold">{ia.nome}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">{ia.texto}</p>
            </div>
            <SeloSituacao situacao={ia.situacao} />
          </Revelar>
        )}
      </ul>
    </Secao>
  );
}

/* --------------------------------------------------------------- 8 · IA */

function InteligenciaArtificial() {
  return (
    <Secao id="ia" className={cn(TINTA, 'relative overflow-hidden')}>
      <Brilho className="-top-40 -right-32 size-[34rem]" />
      <div className="relative grid gap-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Revelar
            as="span"
            dist={12}
            className="inline-flex items-center rounded-pill border border-[var(--aurora-lime-500)] px-3 py-1 text-xs font-bold tracking-[0.08em] text-[var(--aurora-lime-400)]"
          >
            ROADMAP
          </Revelar>
          <Titulo id="ia" className="mt-6">
            Inteligência Artificial sobre o histórico da operação.
          </Titulo>
          <Abertura className="text-[var(--aurora-brand-100)]">
            A plataforma já organiza chamados, ordens, planos e indicadores. A próxima etapa é usar esse
            histórico para apoiar a gestão.
          </Abertura>
          <Revelar
            as="p"
            atraso={180}
            className="mt-6 max-w-[58ch] border-l-[3px] border-[var(--aurora-lime-500)] pl-4 text-sm leading-relaxed text-[var(--aurora-brand-200)]"
          >
            Ainda não faz parte do produto: casos de uso, provedor e regras estão em definição.
          </Revelar>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:col-span-7">
          {IA.map(({ nome, texto, icone: Icone }, i) => (
            <Revelar
              as="li"
              key={nome}
              tipo="escala"
              dist={20}
              atraso={escalonar(i % 2, 100, 110)}
              className="apr-card apr-card--escuro apr-gancho rounded-card border border-dashed border-[rgb(255_255_255/0.22)] bg-[rgb(255_255_255/0.03)] p-5"
            >
              <Icone
                aria-hidden="true"
                strokeWidth={1.75}
                className="apr-icone size-6 text-[var(--aurora-lime-400)]"
              />
              <h3 className="mt-3 text-md font-semibold text-[var(--aurora-neutral-0)]">{nome}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[var(--aurora-brand-200)]">{texto}</p>
            </Revelar>
          ))}
        </ul>
      </div>
    </Secao>
  );
}

/* --------------------------------------------------------- 9 · segurança */

function Seguranca() {
  return (
    <Secao id="seguranca">
      <div className="grid gap-14 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <Titulo id="seguranca">Segurança e governança desde a base.</Titulo>
          <Abertura>Quem pode o quê, sobre quais dados — e o registro de tudo o que aconteceu.</Abertura>
          <ul className="mt-10 grid gap-6">
            {SEGURANCA.map(({ nome, texto, icone: Icone }, i) => (
              <Revelar
                as="li"
                key={nome}
                tipo="esquerda"
                atraso={escalonar(i, 120, 100)}
                className="apr-gancho flex gap-4"
              >
                <Icone
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="apr-icone mt-0.5 size-6 shrink-0 text-accent-text"
                />
                <div>
                  <h3 className="text-md font-semibold">{nome}</h3>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted">{texto}</p>
                </div>
              </Revelar>
            ))}
          </ul>
        </div>

        <Revelar as="figure" tipo="direita" className="m-0 lg:col-span-6 lg:self-center">
          <div className="apr-card rounded-card border border-border bg-surface p-6 shadow-raised">
            <div className="flex items-center justify-between gap-3">
              <p className="text-md font-semibold">Trilha da OS 1042</p>
              <StatusChip tone="warn" size="sm">
                Ilustrativo
              </StatusChip>
            </div>
            <ol aria-label="Eventos registrados" className="mt-6">
              {TRILHA_ILUSTRATIVA.map((ev, i) => (
                <Revelar
                  as="li"
                  key={ev.hora}
                  dist={12}
                  atraso={escalonar(i, 300, 120, 8)}
                  className="relative flex gap-4 pb-6 last:pb-0"
                >
                  {i < TRILHA_ILUSTRATIVA.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="apr-linha-y absolute top-3 left-[5px] h-full w-0.5 bg-[var(--aurora-lime-500)]"
                      style={{ ['--apr-d2' as string]: `${escalonar(i, 500, 120, 8)}ms` }}
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className="relative mt-1.5 size-3 shrink-0 rounded-full border-2 border-[var(--aurora-brand-500)] bg-surface"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-subtle" data-numeric>
                      {ev.hora}
                    </p>
                    <p className="text-sm">
                      <span className="font-semibold">{ev.quem}</span> {ev.oque}
                    </p>
                  </div>
                </Revelar>
              ))}
            </ol>
          </div>
          <figcaption className="mt-3 text-xs text-subtle">
            Eventos fictícios de uma trilha de auditoria.
          </figcaption>
        </Revelar>
      </div>
    </Secao>
  );
}

/* ------------------------------------------------------- 10 · chamada final */

function ChamadaFinal() {
  return (
    <Secao id="conheca" className={cn(TINTA, 'relative overflow-hidden')}>
      <Brilho className="-bottom-48 -left-40 size-[36rem]" lento />
      <div className="relative flex flex-col items-start gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Revelar tipo="escala" dist={12} className="mb-8 size-[72px]">
            <img
              src={MARCA.logoSimboloEscuro}
              alt=""
              width={72}
              height={72}
              className="size-[72px]"
              draggable={false}
            />
          </Revelar>
          <Titulo id="conheca" className="max-w-[16ch] text-[clamp(2.25rem,6vw,4.25rem)]">
            Conheça a {MARCA.produto}
          </Titulo>
          <Revelar
            as="p"
            atraso={90}
            className="mt-5 max-w-[48ch] text-lg leading-relaxed text-[var(--aurora-brand-100)]"
          >
            {MARCA.descricao}, para quem cuida de equipamento crítico.
          </Revelar>
        </div>
        <Revelar atraso={200} className="flex flex-col gap-3 sm:flex-row">
          <a href={ENTRAR} className={cn(BOTAO, BOTAO_MARCA)}>
            Entrar na plataforma
          </a>
          <IrPara alvo="topo" className={cn(BOTAO, BOTAO_CONTORNO)}>
            Voltar ao início
          </IrPara>
        </Revelar>
      </div>
    </Secao>
  );
}

/** Halo decorativo das seções escuras: deriva lenta, só `transform`, sem filtro de blur. */
function Brilho({ className, lento }: { className?: string; lento?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'apr-deriva pointer-events-none absolute rounded-full',
        lento && '[animation-duration:18s] [animation-delay:-6s]',
        className
      )}
      style={{
        background:
          'radial-gradient(closest-side, color-mix(in srgb, var(--aurora-lime-500) 11%, transparent), transparent 70%)',
      }}
    />
  );
}

function Rodape() {
  return (
    <footer className="border-t border-border bg-surface">
      <div
        className={cn(CONTEUDO, 'flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between')}
      >
        <Logo
          src={MARCA.logoHorizontal}
          srcEscuro={MARCA.logoHorizontalEscuro}
          nome={MARCA.produto}
          largura={112}
        />
        <p className="text-sm text-muted">
          {MARCA.produto} — {MARCA.descricao}
        </p>
      </div>
    </footer>
  );
}
