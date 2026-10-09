/**
 * Aurora — o perfil do contrato, como selo.
 *
 * O PERFIL É O TIPO DO CONTRATO, E SÓ ELE: Básico, Completo ou Expert
 * (confirmado pelo cliente). O título do contrato é texto livre — "manutenção
 * de imagem", "contrato 2026" — e não classifica nada; por isso o selo fica
 * ao lado do título, e não dentro dele.
 *
 * O MESMO TOM PARA OS TRÊS. Cor diferente por perfil leria como "bom, médio,
 * ruim", e o perfil é o que foi contratado, não uma nota. O que cada perfil
 * libera (indicadores, SLA, relatórios) é NS-008, e ainda não existe.
 */
import { StatusChip } from '@aurora/ui';
import { CONTRACT_PROFILE_LABELS, type ContractProfile } from '@aurora/contracts';

export function SeloDePerfil({ perfil }: { perfil: ContractProfile | null }) {
  if (!perfil) {
    return (
      <StatusChip
        tone="warn"
        size="sm"
        withoutDot
        hint="Contrato anterior à classificação por perfil — ninguém definiu ainda se é Básico, Completo ou Expert"
      >
        Perfil não definido
      </StatusChip>
    );
  }
  return (
    <StatusChip tone="accent" size="sm" withoutDot hint="Perfil do contrato">
      {CONTRACT_PROFILE_LABELS[perfil]}
    </StatusChip>
  );
}

/**
 * O contrato de um cliente, numa palavra.
 *
 * "Sem contrato" é resposta, e não ausência de dado: o cliente atendido
 * avulso existe, e a ficha precisa dizê-lo em vez de deixar o espaço vazio.
 */
export function SeloContratoDoCliente({
  possui,
  perfil,
}: {
  possui: boolean;
  perfil: ContractProfile | null;
}) {
  if (!possui) {
    return (
      <StatusChip tone="neutral" size="sm" withoutDot hint="Nenhum contrato vigente, suspenso ou em rascunho">
        Sem contrato
      </StatusChip>
    );
  }
  return <SeloDePerfil perfil={perfil} />;
}
