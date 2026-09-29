/**
 * Aurora — design system (SPEC v0.2 §34, §40).
 *
 * PRÓPRIO, e não uma cópia de nada. O ponto de partida é o assunto: um
 * instrumento de trabalho para quem mantém equipamento crítico funcionando.
 * A leitura completa da identidade está em `styles/tokens.css`, que é a fonte
 * de toda cor, medida e movimento — os componentes daqui só a consomem.
 *
 * O QUE ESTE PACOTE NÃO TEM
 *
 * Componente sem consumidor. A lista cresce quando uma tela precisa, não
 * antes: um catálogo de cinquenta peças vazias é um catálogo que ninguém
 * mantém, e a primeira tela de verdade acaba escrevendo as suas próprias.
 */
export { cn } from './lib/cn';

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './components/button';
export { Spinner, type SpinnerProps } from './components/spinner';
export {
  StatusChip,
  CountBadge,
  Progress,
  type Tone,
  type StatusChipProps,
  type CountBadgeProps,
  type ProgressProps,
} from './components/status';
export {
  Field,
  Input,
  Textarea,
  Select,
  useFieldControl,
  type FieldProps,
  type InputProps,
  type TextareaProps,
  type SelectProps,
} from './components/field';
export {
  Card,
  CardHeader,
  EmptyState,
  Skeleton,
  SkeletonList,
  type CardProps,
  type CardHeaderProps,
  type EmptyStateProps,
  type SkeletonListProps,
} from './components/surfaces';
export {
  Dialog,
  Menu,
  Tooltip,
  TooltipProvider,
  type DialogProps,
  type MenuProps,
  type MenuItem,
  type TooltipProps,
} from './components/overlays';
export { ToastProvider, useToast, type ToastInput, type ToastProviderProps } from './components/toast';
export {
  Breadcrumbs,
  Avatar,
  Tabs,
  tabIds,
  type BreadcrumbsProps,
  type Crumb,
  type AvatarProps,
  type TabsProps,
  type TabItem,
} from './components/navigation';
export { CommandPalette, type CommandPaletteProps, type CommandItem } from './components/command-palette';

/* ---------------------------------------------------------------------------
 * As peças que o redesenho de 29/09/2026 acrescentou.
 *
 * Elas nasceram de um diagnóstico específico: o produto tinha componentes de
 * CONTROLE (botão, campo, diálogo) e quase nenhum de APRESENTAÇÃO DE DADOS. O
 * resultado é o que se via na tela — números soltos sem referência, listas
 * textuais sem imagem, seções sem hierarquia e cada tela inventando a própria
 * barra de filtros.
 * ------------------------------------------------------------------------- */
export {
  Metric,
  MetricGrid,
  type MetricProps,
  type MetricTrend,
  type MetricGridProps,
} from './components/metric';
export {
  BarChart,
  DonutChart,
  Sparkline,
  type ChartDatum,
  type BarChartProps,
  type DonutChartProps,
  type SparklineProps,
} from './components/charts';
export { Thumb, type ThumbProps } from './components/thumb';
export { Logo, type LogoProps } from './components/logo';
export {
  Section,
  Toolbar,
  FilterChip,
  StatStrip,
  FieldPair,
  type SectionProps,
  type ToolbarProps,
  type FilterChipProps,
  type StatStripProps,
  type StatStripItem,
  type FieldPairProps,
} from './components/layout';
