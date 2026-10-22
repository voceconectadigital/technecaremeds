/**
 * Aurora — Ferramentas (reunião 16/10/2026, Fase 12).
 *
 * Vitrine HONESTA do que vem por aí. Nenhuma ferramenta aqui tem backend, e
 * nenhuma mostra número: um painel de temperatura com dado inventado é pior do
 * que nenhum — alguém tomaria decisão sobre ele.
 *
 * Cada cartão diz a situação (EM BREVE, FUTURO, INTEGRAÇÃO PLANEJADA), o que JÁ
 * existe de verdade no sistema e o que falta. As integrações de medição seguem
 * a arquitetura N1–N4 da porta de fonte (`packages/domain/src/medicao.ts`):
 * N1 arquivo · N2 gateway · N3 protocolo/SDK · N4 instrumento próprio — todas
 * produzem o MESMO envelope; nenhuma está implementada nesta rodada.
 */
import { Award, Bot, Cable, Gauge, MapPin, Recycle, Thermometer, Wind, type LucideIcon } from 'lucide-react';
import { Card, StatusChip } from '@aurora/ui';
import { AppShell } from '../../shell/app-shell';

export type SituacaoDaFerramenta = 'em_breve' | 'futuro' | 'integracao_planejada';

export interface Ferramenta {
  key: string;
  nome: string;
  icone: LucideIcon;
  situacao: SituacaoDaFerramenta;
  /** Para que serve, em uma frase. */
  proposito: string;
  /** O que JÁ existe de verdade no sistema e serve de base. */
  hoje: string | null;
  /** O que falta — dependência externa, definição ou hardware. */
  falta: string;
  /** Camada da porta de fonte de medição, quando a ferramenta é medição. */
  camada?: string;
}

export const ROTULO_SITUACAO: Record<SituacaoDaFerramenta, string> = {
  em_breve: 'EM BREVE',
  futuro: 'FUTURO',
  integracao_planejada: 'INTEGRAÇÃO PLANEJADA',
};

export const FERRAMENTAS: readonly Ferramenta[] = Object.freeze([
  {
    key: 'temperatura_umidade',
    nome: 'Temperatura e Umidade',
    icone: Thermometer,
    situacao: 'integracao_planejada',
    proposito: 'Monitorar ambientes e equipamentos sensíveis (salas, geladeiras de medicamento, CME).',
    hoje: null,
    falta: 'Sensores e gateway definidos pelo cliente; limites de alarme por ambiente.',
    camada: 'N2 — gateway',
  },
  {
    key: 'geolocalizacao',
    nome: 'Geolocalização',
    icone: MapPin,
    situacao: 'em_breve',
    proposito: 'Saber onde o equipamento e a equipe estão.',
    hoje: 'Chip geolocalizador cadastrável no equipamento (com filtro) e check-in/check-out com posição na OS.',
    falta: 'Leitura do chip em tempo real: depende do hardware e do provedor do rastreador.',
  },
  {
    key: 'rastreabilidade_cme',
    nome: 'Rastreabilidade CME',
    icone: Recycle,
    situacao: 'futuro',
    proposito: 'Acompanhar o ciclo de materiais na Central de Material e Esterilização.',
    hoje: null,
    falta: 'Fluxo e regras da CME a definir com o cliente.',
  },
  {
    key: 'gases_medicinais',
    nome: 'Gases Medicinais',
    icone: Wind,
    situacao: 'futuro',
    proposito: 'Controle da rede e dos pontos de gases medicinais.',
    hoje: null,
    falta: 'Escopo, normas aplicáveis e critérios a definir com o cliente e especialista.',
  },
  {
    key: 'simuladores_analisadores',
    nome: 'Simuladores e Analisadores',
    icone: Gauge,
    situacao: 'integracao_planejada',
    proposito: 'Trazer as leituras de simuladores e analisadores direto para a OS.',
    hoje: 'Medição manual (N0) já grava no envelope neutro de medição, com instrumento e certificado.',
    falta:
      'Adaptador de arquivo (N1) ou protocolo do fabricante (N3); veredito metrológico segue com o especialista.',
    camada: 'N1 — arquivo · N3 — protocolo/SDK',
  },
  {
    key: 'integracoes_ec',
    nome: 'Integrações de Engenharia Clínica',
    icone: Cable,
    situacao: 'integracao_planejada',
    proposito: 'Conectar com sistemas hospitalares, ERP e instrumentos próprios.',
    hoje: 'API documentada (OpenAPI) e eventos de domínio com outbox.',
    falta: 'Escolha dos sistemas e credenciais de cada integração.',
    camada: 'N4 — instrumento próprio',
  },
  {
    key: 'inteligencia_artificial',
    nome: 'Inteligência Artificial',
    icone: Bot,
    situacao: 'futuro',
    proposito: 'Apoio à decisão sobre o histórico de manutenção.',
    hoje: null,
    falta: 'Nada de IA está ativo: casos de uso, provedor e regras de procedência ainda não definidos.',
  },
  {
    key: 'ona',
    nome: 'ONA — Acreditação',
    icone: Award,
    situacao: 'futuro',
    // Pedido do cliente em 21/10/2026: a ONA entra só como ferramenta de apresentação; o
    // acompanhamento de acreditação fica para a V2.
    proposito: 'Apoio ao preparo e ao acompanhamento da acreditação hospitalar (ONA).',
    hoje: null,
    falta: 'Vitrine para apresentação: os requisitos da ONA e o acompanhamento entram na versão 2.',
  },
]);

const TOM: Record<SituacaoDaFerramenta, 'info' | 'neutral' | 'warn'> = {
  em_breve: 'info',
  futuro: 'neutral',
  integracao_planejada: 'warn',
};

export function FerramentasPage() {
  return (
    <AppShell
      title="Ferramentas"
      subtitle="O que está a caminho. Nenhuma destas ferramentas mostra dado ainda — e nenhuma finge mostrar."
    >
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Ferramentas">
        {FERRAMENTAS.map((f) => {
          const Icone = f.icone;
          return (
            <li key={f.key}>
              <Card className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-control bg-surface-sunken text-muted">
                    <Icone className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold text-text">{f.nome}</h2>
                    <StatusChip size="sm" tone={TOM[f.situacao]}>
                      {ROTULO_SITUACAO[f.situacao]}
                    </StatusChip>
                  </span>
                </div>
                <p className="text-sm text-text">{f.proposito}</p>
                <dl className="flex flex-col gap-1 text-xs text-muted">
                  {f.hoje && (
                    <div>
                      <dt className="inline font-medium text-text">Já existe: </dt>
                      <dd className="inline">{f.hoje}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="inline font-medium text-text">Falta: </dt>
                    <dd className="inline">{f.falta}</dd>
                  </div>
                  {f.camada && (
                    <div>
                      <dt className="inline font-medium text-text">Camada: </dt>
                      <dd className="inline">{f.camada}</dd>
                    </div>
                  )}
                </dl>
              </Card>
            </li>
          );
        })}
      </ul>
    </AppShell>
  );
}
