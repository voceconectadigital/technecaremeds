/**
 * Aurora — Ferramentas (reunião 16/10/2026, Fase 12; textos revistos em 29/10/2026).
 *
 * Vitrine COMERCIAL do que vem por aí. Nenhuma ferramenta aqui tem backend, e
 * nenhuma mostra número: um painel de temperatura com dado inventado é pior do
 * que nenhum — alguém tomaria decisão sobre ele.
 *
 * 19/10/2026 (conversa com o cliente): a frase "Nenhuma destas ferramentas mostra
 * dado ainda — e nenhuma finge mostrar" saiu, a pedido, e virou "Soluções novas de
 * mercado, consulte disponibilidade"; os textos ficaram comerciais ("que encante
 * e demonstre suas soluções") e entrou a Eficiência Energética. O jargão interno
 * (camadas N1–N4 da porta de fonte, `packages/domain/src/medicao.ts`) saiu da
 * tela e ficou só em `falta`, que é a nota técnica para quem mantém o código.
 *
 * A honestidade continua: cada cartão diz a situação (EM BREVE, FUTURO,
 * INTEGRAÇÃO PLANEJADA), o que JÁ existe de verdade no sistema, e nenhum texto
 * descreve leitura, alarme ou IA como ativos.
 */
import {
  Award,
  Bot,
  Cable,
  Gauge,
  MapPin,
  Recycle,
  Thermometer,
  Wind,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Card, StatusChip } from '@aurora/ui';
import { AppShell } from '../../shell/app-shell';

export type SituacaoDaFerramenta = 'em_breve' | 'futuro' | 'integracao_planejada';

export interface Ferramenta {
  key: string;
  nome: string;
  icone: LucideIcon;
  situacao: SituacaoDaFerramenta;
  /** A chamada comercial, em uma frase. */
  chamada: string;
  /** Para que serve e como funciona, em duas ou três frases. */
  proposito: string;
  /** O que a solução entrega — sem prometer dado que o sistema ainda não lê. */
  beneficios: readonly string[];
  /** O que JÁ existe de verdade no sistema e serve de base. */
  hoje: string | null;
  /** Nota técnica (não vai para a tela): o que falta — dependência externa, definição ou hardware. */
  falta: string;
}

export const ROTULO_SITUACAO: Record<SituacaoDaFerramenta, string> = {
  em_breve: 'EM BREVE',
  futuro: 'FUTURO',
  integracao_planejada: 'INTEGRAÇÃO PLANEJADA',
};

/** A frase pedida pelo cliente em 19/10/2026. */
export const CHAMADA_DA_VITRINE = 'Soluções novas de mercado, consulte disponibilidade.';

export const FERRAMENTAS: readonly Ferramenta[] = Object.freeze([
  {
    key: 'temperatura_umidade',
    nome: 'Temperatura e Umidade',
    icone: Thermometer,
    situacao: 'integracao_planejada',
    chamada: 'Ambientes sensíveis sob vigilância, 24 horas por dia.',
    proposito:
      'Sensores nas salas, geladeiras de medicamento, farmácia e CME registram temperatura e umidade de forma contínua. Saiu da faixa, a equipe certa fica sabendo.',
    beneficios: [
      'Registro contínuo para auditorias e boas práticas de armazenamento',
      'Avisos por ambiente, com a faixa definida por você',
      'Menos perda de medicamentos e insumos por variação térmica',
    ],
    hoje: null,
    falta: 'Sensores e gateway definidos pelo cliente; limites de alarme por ambiente (camada N2 — gateway).',
  },
  {
    key: 'geolocalizacao',
    nome: 'Geolocalização de Equipamentos',
    icone: MapPin,
    situacao: 'em_breve',
    chamada: 'Saiba onde cada equipamento está — sem procurar pelo hospital.',
    proposito:
      'Etiquetas de localização nos equipamentos mostram em que setor cada um está. Menos tempo procurando bomba de infusão e mais tempo atendendo.',
    beneficios: [
      'Localização por setor no mapa do estabelecimento',
      'Histórico de onde o equipamento passou',
      'Aviso quando um equipamento sai da área prevista',
    ],
    hoje: 'O chip geolocalizador já é cadastrado no equipamento e o check-in da OS já grava a posição do técnico.',
    falta: 'Leitura do chip em tempo real: depende do hardware e do provedor do rastreador.',
  },
  {
    key: 'rastreabilidade_cme',
    nome: 'Rastreabilidade CME',
    icone: Recycle,
    situacao: 'futuro',
    chamada: 'Cada instrumental rastreado do expurgo ao paciente.',
    proposito:
      'Gravação a laser ou etiquetas nos instrumentais e kits acompanham o ciclo completo da Central de Material e Esterilização: recepção, limpeza, preparo, esterilização, guarda e distribuição.',
    beneficios: [
      'Saber em que etapa está cada caixa e cada instrumental',
      'Vínculo entre o lote de esterilização e o uso',
      'Indicadores de produtividade e de perdas da CME',
    ],
    hoje: null,
    falta: 'Fluxo e regras da CME a definir com o cliente; impressora, leitor e etiquetas (hardware).',
  },
  {
    key: 'gases_medicinais',
    nome: 'Gases Medicinais',
    icone: Wind,
    situacao: 'futuro',
    chamada: 'A rede de gases do hospital acompanhada de perto.',
    proposito:
      'Acompanhamento da central e dos pontos de oxigênio, ar comprimido, vácuo e óxido nitroso: pressão, consumo e manutenção em um só lugar.',
    beneficios: [
      'Visão da rede por setor e por ponto de consumo',
      'Manutenção preventiva da central e das réguas',
      'Base para identificar consumo fora do padrão',
    ],
    hoje: null,
    falta:
      'Escopo, normas aplicáveis e critérios a definir com o cliente e especialista; medidores (hardware).',
  },
  {
    key: 'simuladores_analisadores',
    nome: 'Simuladores e Analisadores',
    icone: Gauge,
    situacao: 'integracao_planejada',
    chamada: 'As leituras dos seus instrumentos direto na ordem de serviço.',
    proposito:
      'Analisadores de segurança elétrica, simuladores multiparamétricos (ECG, SpO₂, PNI), analisadores de ventiladores e de fluxo de gases e analisadores de desfibriladores e de bombas de infusão enviam o resultado para a OS, sem redigitar.',
    beneficios: [
      'Menos erro de digitação nos ensaios',
      'Laudo com a leitura do instrumento e o certificado dele',
      'Histórico de medições por equipamento',
    ],
    hoje: 'O registro manual das medições já grava a leitura com o instrumento e o certificado usados.',
    falta:
      'Adaptador de arquivo (N1) ou protocolo do fabricante (N3); veredito metrológico segue com o especialista.',
  },
  {
    key: 'eficiencia_energetica',
    nome: 'Eficiência Energética',
    icone: Zap,
    situacao: 'futuro',
    chamada: 'Descubra onde a energia do estabelecimento está indo.',
    proposito:
      'Medição pontual nos equipamentos de grande consumo (tomógrafo, ressonância, autoclave, ar-condicionado), por setor e do estabelecimento como um todo, para enxergar o custo de cada área.',
    beneficios: [
      'Consumo por equipamento, por setor e do estabelecimento',
      'Base para decidir troca de equipamento e horários de uso',
      'Acompanhamento do resultado depois de cada ação',
    ],
    hoje: null,
    falta: 'Medidores de energia (hardware), pontos de medição e tarifa a definir com o cliente.',
  },
  {
    key: 'integracoes_ec',
    nome: 'Integrações de Engenharia Clínica',
    icone: Cable,
    situacao: 'integracao_planejada',
    chamada: 'A engenharia clínica conversando com os sistemas do hospital.',
    proposito:
      'Integração com prontuário, ERP, compras e instrumentos próprios para que cadastro, custo e ordem de serviço não precisem ser digitados duas vezes.',
    beneficios: [
      'Cadastro e custo sincronizados com o ERP',
      'Chamados abertos a partir de outros sistemas',
      'Dados prontos para os relatórios da gestão',
    ],
    hoje: 'A plataforma já tem API documentada e eventos para integração.',
    falta: 'Escolha dos sistemas e credenciais de cada integração (camada N4 — instrumento próprio).',
  },
  {
    key: 'inteligencia_artificial',
    nome: 'Inteligência Artificial',
    icone: Bot,
    situacao: 'futuro',
    chamada: 'O histórico de manutenção trabalhando a seu favor.',
    proposito:
      'Apoio à decisão sobre o histórico de manutenção e criação de planos de manutenção com ajuda de IA, sempre com a revisão de um responsável técnico.',
    beneficios: [
      'Sugestão de plano de manutenção a partir do tipo de equipamento',
      'Equipamentos com falhas que se repetem em destaque',
      'Apoio à decisão de reparo ou substituição',
    ],
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
    chamada: 'Prepare a engenharia clínica para a acreditação hospitalar.',
    proposito:
      'Apoio ao preparo e ao acompanhamento da acreditação hospitalar (ONA): requisitos, evidências e pendências da engenharia clínica organizados em um só lugar.',
    beneficios: [
      'Evidências da manutenção, calibração e treinamento reunidas',
      'Pendências visíveis antes da visita de avaliação',
      'Planos de ação com responsável e prazo',
    ],
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
    <AppShell title="Ferramentas" subtitle={CHAMADA_DA_VITRINE}>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Ferramentas">
        {FERRAMENTAS.map((f) => {
          const Icone = f.icone;
          return (
            <li key={f.key}>
              <Card className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-control bg-accent-soft text-accent-text">
                    <Icone className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold text-text">{f.nome}</h2>
                    <StatusChip size="sm" tone={TOM[f.situacao]}>
                      {ROTULO_SITUACAO[f.situacao]}
                    </StatusChip>
                  </span>
                </div>
                <p className="text-sm font-medium text-text">{f.chamada}</p>
                <p className="text-sm text-muted">{f.proposito}</p>
                <ul className="flex flex-col gap-1 text-sm text-text" aria-label={`Benefícios: ${f.nome}`}>
                  {f.beneficios.map((b) => (
                    <li key={b} className="flex gap-2">
                      <span aria-hidden="true" className="text-accent">
                        ✓
                      </span>
                      {b}
                    </li>
                  ))}
                </ul>
                {f.hoje && (
                  <p className="text-xs text-muted">
                    <span className="font-medium text-text">Já no sistema: </span>
                    {f.hoje}
                  </p>
                )}
                <p className="mt-auto pt-1 text-xs font-medium text-accent-text">Consulte disponibilidade</p>
              </Card>
            </li>
          );
        })}
      </ul>
    </AppShell>
  );
}
