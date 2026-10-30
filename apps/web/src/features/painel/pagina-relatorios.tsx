/**
 * Aurora — a página própria do gerador de relatório, `/relatorios` (REL-03, 29/10/2026).
 *
 * "Aba própria de geração multifiltro": o MESMO diálogo do Painel (`relatorio.tsx`), aberto ao
 * entrar e sem herdar o recorte do Painel. Um gerador só — dois diálogos divergiriam no primeiro
 * filtro novo.
 */
import { Link } from '@tanstack/react-router';
import { Card } from '@aurora/ui';
import { AppShell } from '../../shell/app-shell';
import { BotaoGerarRelatorio, type RecorteInicial } from './relatorio';

const SEM_RECORTE: RecorteInicial = { periodo: '30d', de: '', ate: '', cliente: '', setor: '' };

export function RelatoriosPage() {
  return (
    <AppShell
      title="Relatórios"
      subtitle="Basic, Advanced, Expert e Patrimonial — na tela, em PDF e em Excel, no recorte que você escolher."
      actions={<BotaoGerarRelatorio f={SEM_RECORTE} abertoNoInicio />}
    >
      <Card className="flex flex-col gap-2 p-5 text-sm text-muted">
        <p>
          Escolha o modelo, o período, o cliente, o setor, o tipo de manutenção, a família ou o tipo de
          equipamento e os indicadores. O nível de relatório contratado pelo cliente vale como limite.
        </p>
        <p>
          Para receber o mesmo relatório todo mês, use <strong>Criar automação com estes filtros</strong> no
          gerador, ou veja as{' '}
          <Link to="/configuracoes/automacoes" className="font-medium text-accent-text underline">
            automações
          </Link>
          .
        </p>
      </Card>
    </AppShell>
  );
}
