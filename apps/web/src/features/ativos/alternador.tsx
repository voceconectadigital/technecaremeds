/**
 * Aurora — o alternador entre o parque e os papéis dele.
 *
 * Documento técnico é sobre EQUIPAMENTO: laudo de segurança elétrica,
 * certificado de calibração, relatório de inspeção. A pergunta "cadê o laudo?"
 * nasce olhando o equipamento, e é por isso que os dois dividem o item de
 * menu — como contrato e orçamento, e como ordem e plano.
 *
 * O menu tem oito itens por decisão escrita em `shell/navigation.ts`: acima
 * disso a barra deixa de ser navegação e vira lista para procurar, e quem
 * procura usa a busca.
 */
import { Link, useRouterState } from '@tanstack/react-router';
import { cn } from '@aurora/ui';

export function AlternadorDeParque() {
  const caminho = useRouterState({ select: (s) => s.location.pathname });
  const emDocumentos = caminho.startsWith('/documentos');

  return (
    <nav aria-label="Ativos e documentos" className="flex gap-1">
      {[
        { para: '/ativos', rotulo: 'Ativos', ativo: !emDocumentos },
        { para: '/documentos', rotulo: 'Documentos', ativo: emDocumentos },
      ].map((x) => (
        <Link
          key={x.para}
          to={x.para}
          aria-current={x.ativo ? 'page' : undefined}
          className={cn(
            'rounded-control px-3 py-1.5 text-sm transition-colors',
            x.ativo
              ? 'bg-accent-soft text-accent-text'
              : 'text-muted hover:bg-surface-hover hover:text-text'
          )}
        >
          {x.rotulo}
        </Link>
      ))}
    </nav>
  );
}
