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
import { useRouterState } from '@tanstack/react-router';
import { AlternadorDeTelas } from '../../shell/alternador';

export function AlternadorDeParque() {
  const caminho = useRouterState({ select: (s) => s.location.pathname });
  const emDocumentos = caminho.startsWith('/documentos');

  return (
    <AlternadorDeTelas
      label="Ativos e documentos"
      itens={[
        { para: '/ativos', rotulo: 'Ativos', ativo: !emDocumentos },
        { para: '/documentos', rotulo: 'Documentos', ativo: emDocumentos },
      ]}
    />
  );
}
