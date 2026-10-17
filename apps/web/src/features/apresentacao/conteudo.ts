/**
 * Téchne Care — o texto da apresentação, num lugar só.
 *
 * CADA FRASE AQUI FOI CONFERIDA CONTRA O CÓDIGO E A DOCUMENTAÇÃO
 * (`docs/AI-HANDOFF.md`, `docs/ROADMAP-ANDERSON-2026-10-16.md`,
 * `docs/AUDITORIA-INDICADORES-BASIC-ADVANCED-EXPERT.md`). A regra é a mesma da
 * tela de Ferramentas: o que não existe aparece marcado como não existente.
 *
 * O que ficou DE FORA de propósito, porque não está pronto:
 *   - envio de e-mail (a fila existe, o transporte não);
 *   - pagamento ou checkout na Store (é catálogo com pedido de proposta);
 *   - leiaute final dos documentos dos modelos de relatório;
 *   - fórmulas e nomes de indicadores provisórios ou pendentes;
 *   - rastreio contínuo, mapa ou leitura física do chip geolocalizador;
 *   - leitura automática de instrumentos (a metrologia é registro manual).
 */
import {
  Bell,
  BrainCircuit,
  Building2,
  Cable,
  CalendarRange,
  ClipboardList,
  FileChartColumn,
  FileSignature,
  Fingerprint,
  Gauge,
  Handshake,
  History,
  KeyRound,
  Lightbulb,
  ListChecks,
  Lock,
  MapPin,
  MessageSquareText,
  Network,
  Package,
  Receipt,
  Recycle,
  ScrollText,
  ShieldCheck,
  Stethoscope,
  Store,
  Thermometer,
  Activity,
  Bot,
  Users,
  Wind,
  Workflow,
  Wrench,
  CalendarClock,
  Camera,
  type LucideIcon,
} from 'lucide-react';

export interface Item {
  nome: string;
  texto: string;
  icone: LucideIcon;
}

/* ---------------------------------------------------------------- visão */

export const PUBLICOS: readonly Item[] = [
  {
    nome: 'Engenharia clínica',
    texto: 'Parque de equipamentos, manutenção e indicadores.',
    icone: Stethoscope,
  },
  { nome: 'Hospitais', texto: 'Chamados, setores e equipamentos de cada unidade.', icone: Building2 },
  {
    nome: 'Prestadores de serviço',
    texto: 'Contratos, equipes e atendimento a vários clientes.',
    icone: Handshake,
  },
  { nome: 'Assistência técnica', texto: 'Ordens de serviço, peças e orçamentos.', icone: Wrench },
  { nome: 'Operação multiempresa', texto: 'Vários negócios na mesma plataforma, isolados.', icone: Network },
];

/** O caminho de um atendimento — é uma sequência de verdade, daí a numeração. */
export const FLUXO: readonly string[] = [
  'Solicitação',
  'Triagem',
  'Ordem de serviço',
  'Execução',
  'Indicadores',
];

/* --------------------------------------------------------------- módulos */

export interface GrupoDeModulos {
  grupo: string;
  modulos: readonly Item[];
}

export const MODULOS: readonly GrupoDeModulos[] = [
  {
    grupo: 'Atendimento',
    modulos: [
      {
        nome: 'Solicitações',
        texto: 'Cliente, equipamento, tipo e urgência, com triagem.',
        icone: MessageSquareText,
      },
      {
        nome: 'Ordens de Serviço',
        texto: 'Do agendamento à conclusão, com execução guiada.',
        icone: ClipboardList,
      },
      {
        nome: 'Agenda',
        texto: 'OS com técnico e horário, atrasos e o que é para hoje.',
        icone: CalendarRange,
      },
    ],
  },
  {
    grupo: 'Manutenção planejada',
    modulos: [
      {
        nome: 'Planos de Manutenção',
        texto: 'Preventiva, calibração, TSE e qualificação com cronograma.',
        icone: CalendarClock,
      },
      {
        nome: 'Checklists e Procedimentos',
        texto: 'Modelos versionados, publicados e usados na execução.',
        icone: ListChecks,
      },
    ],
  },
  {
    grupo: 'Cadastro',
    modulos: [
      { nome: 'Clientes', texto: 'Hospitais e empresas, com setores e unidades.', icone: Building2 },
      {
        nome: 'Equipamentos',
        texto: 'Ficha por cliente e setor, criticidade e histórico de atendimentos.',
        icone: Activity,
      },
    ],
  },
  {
    grupo: 'Suprimentos e comercial',
    modulos: [
      { nome: 'Estoque', texto: 'Saldo, mínimo e máximo, curva ABC e baixa vinculada à OS.', icone: Package },
      { nome: 'Store', texto: 'Catálogo de produtos com pedido de proposta.', icone: Store },
      { nome: 'Contratos', texto: 'Cobertura, vigência e o que está por vencer.', icone: FileSignature },
      { nome: 'Orçamentos', texto: 'Gerados da OS, com aprovação registrada.', icone: Receipt },
    ],
  },
  {
    grupo: 'Gestão',
    modulos: [
      { nome: 'Indicadores', texto: 'Painel por período, cliente e setor, com metas.', icone: Gauge },
      {
        nome: 'Relatórios',
        texto: 'Gerados nos modelos Basic, Advanced e Expert.',
        icone: FileChartColumn,
      },
      {
        nome: 'Automações',
        texto: 'Relatório, lembrete, tarefa, 5W2H e PDCA agendados.',
        icone: Workflow,
      },
    ],
  },
];

/* ------------------------------------------------------- relatórios */

export const MODELOS_DE_RELATORIO: readonly { nome: string; texto: string }[] = [
  { nome: 'Basic', texto: 'Indicadores essenciais do período.' },
  { nome: 'Advanced', texto: 'Inclui SLA, evolução dos chamados, backlog e OS por situação.' },
  { nome: 'Expert', texto: 'Conjunto contratual, em estruturação com o cliente.' },
];

/* ----------------------------------------------------------- campo */

/** Os passos do assistente "Executar" da OS (`features/ordens/executar.tsx`). */
export const PASSOS_DA_EXECUCAO: readonly string[] = [
  'Resumo',
  'Check-in',
  'Procedimento',
  'Preencher OS',
  'Anexos',
  'Parecer',
  'Revisão',
  'Concluir',
];

export const CAMPO: readonly Item[] = [
  {
    nome: 'Execução guiada da OS',
    texto: 'Procedimento, checklist, peças e parecer, passo a passo.',
    icone: ClipboardList,
  },
  {
    nome: 'Check-in e check-out',
    texto: 'Registra a posição do aparelho na chegada e na saída, ou uma justificativa.',
    icone: MapPin,
  },
  {
    nome: 'Evidências e fotos',
    texto: 'Fotos de antes e depois e anexos ligados à OS.',
    icone: Camera,
  },
  {
    nome: 'Checklist no aparelho',
    texto: 'Respostas item a item, com foto quando há falha.',
    icone: ListChecks,
  },
];

/* ----------------------------------------------------- multiempresa */

export const ORGANIZACOES_ILUSTRATIVAS: readonly { nome: string; cor: string; sigla: string }[] = [
  { nome: 'Organização A', cor: 'var(--aurora-brand-500)', sigla: 'A' },
  { nome: 'Organização B', cor: 'var(--aurora-lime-700)', sigla: 'B' },
  { nome: 'Organização C', cor: 'var(--aurora-brand-800)', sigla: 'C' },
];

export const PERFIS: readonly string[] = ['Gestor', 'Operador', 'Solicitante'];

export const MULTIEMPRESA: readonly Item[] = [
  {
    nome: 'Isolamento por organização',
    texto: 'Cada negócio só enxerga os próprios dados, garantido no banco.',
    icone: Lock,
  },
  {
    nome: 'Identidade de cada negócio',
    texto: 'Nome de exibição e cor registrados por organização.',
    icone: Building2,
  },
  {
    nome: 'Perfis e permissões',
    texto: 'Gestor, Operador e Solicitante, com escopo por cliente e setor.',
    icone: Users,
  },
];

/* -------------------------------------------------------- ecossistema */

export type Situacao = 'EM DESENVOLVIMENTO' | 'FUTURO';

export interface Ferramenta extends Item {
  situacao: Situacao;
}

/*
 * Os nomes seguem o menu Ferramentas (`features/ferramentas/ferramentas.tsx`).
 * "EM DESENVOLVIMENTO" só onde já há base de verdade no sistema: o chip
 * geolocalizador é cadastrável e o check-in grava posição; a medição manual
 * já registra leituras com instrumento e certificado. Nenhuma lê hardware.
 */
export const ECOSSISTEMA: readonly Ferramenta[] = [
  {
    nome: 'Geolocalização',
    texto: 'Onde estão o equipamento e a equipe. Hoje: chip cadastrável e check-in com posição.',
    icone: MapPin,
    situacao: 'EM DESENVOLVIMENTO',
  },
  {
    nome: 'Simuladores e analisadores',
    texto: 'Leituras dos instrumentos direto na OS. Hoje: registro manual das medições.',
    icone: Gauge,
    situacao: 'EM DESENVOLVIMENTO',
  },
  {
    nome: 'Temperatura e umidade',
    texto: 'Monitoramento de salas, geladeiras de medicamento e CME.',
    icone: Thermometer,
    situacao: 'FUTURO',
  },
  {
    nome: 'Rastreabilidade CME',
    texto: 'O ciclo dos materiais na Central de Material e Esterilização.',
    icone: Recycle,
    situacao: 'FUTURO',
  },
  {
    nome: 'Gases medicinais',
    texto: 'Controle da rede e dos pontos de gases medicinais.',
    icone: Wind,
    situacao: 'FUTURO',
  },
  {
    nome: 'Integrações com hardware',
    texto: 'Sensores, gateways e instrumentos conectados à plataforma.',
    icone: Cable,
    situacao: 'FUTURO',
  },
  {
    nome: 'Inteligência Artificial',
    texto: 'Apoio à decisão sobre o histórico de manutenção.',
    icone: Bot,
    situacao: 'FUTURO',
  },
];

/* ----------------------------------------------------------------- IA */

export const IA: readonly Item[] = [
  { nome: 'Análises críticas', texto: 'Leitura do histórico de falhas e manutenções.', icone: Activity },
  { nome: 'Relatórios', texto: 'Rascunho de relatórios a partir dos dados do período.', icone: ScrollText },
  { nome: 'Sugestões', texto: 'Próximos passos para planos e ordens de serviço.', icone: Lightbulb },
  { nome: 'Pareceres', texto: 'Apoio à redação do parecer técnico.', icone: FileSignature },
  { nome: 'Alertas', texto: 'Sinais de risco antes que virem parada.', icone: Bell },
  { nome: 'Suporte à gestão', texto: 'Respostas sobre o parque e a operação.', icone: BrainCircuit },
];

/* ---------------------------------------------------------- segurança */

export const SEGURANCA: readonly Item[] = [
  {
    nome: 'Perfis e permissões',
    texto: 'Cada pessoa vê e faz só o que o perfil dela permite.',
    icone: KeyRound,
  },
  {
    nome: 'Isolamento por organização',
    texto: 'Os dados de um negócio nunca aparecem para outro.',
    icone: ShieldCheck,
  },
  {
    nome: 'Rastreabilidade',
    texto: 'Cada equipamento com histórico de atendimentos e movimentações.',
    icone: History,
  },
  { nome: 'Auditoria', texto: 'Quem fez o quê, e quando, fica registrado.', icone: Fingerprint },
  { nome: 'Evidências', texto: 'Fotos, anexos e check-in guardados junto da OS.', icone: Camera },
];

/** Eventos ILUSTRATIVOS da trilha — nomes e números fictícios. */
export const TRILHA_ILUSTRATIVA: readonly { hora: string; quem: string; oque: string }[] = [
  { hora: '08:12', quem: 'Solicitante', oque: 'abriu a solicitação 2187 — UTI Adulto' },
  { hora: '08:40', quem: 'Gestor', oque: 'fez a triagem e gerou a OS 1042' },
  { hora: '10:05', quem: 'Operador', oque: 'fez check-in na OS 1042' },
  { hora: '11:31', quem: 'Operador', oque: 'anexou 3 fotos e concluiu o checklist' },
  { hora: '11:48', quem: 'Operador', oque: 'concluiu a OS 1042 — equipamento liberado' },
];
