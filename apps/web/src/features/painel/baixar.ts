/**
 * Aurora — baixar um relatório (PDF ou Excel) gerado pela API.
 *
 * O cliente de contratos fala JSON; o arquivo vem como binário, então a chamada é um `fetch`
 * direto, com a MESMA credencial e a mesma organização da sessão — e o servidor confere a
 * permissão e o escopo exatamente como no JSON.
 */
import { lerSessaoGuardada } from '@aurora/app-kit';

export async function baixarRelatorio(
  url: string,
  formato: 'pdf' | 'xlsx',
  corpo: unknown,
  nomeDoArquivo: string
): Promise<void> {
  const { token, organizationId } = lerSessaoGuardada();
  const resp = await fetch(`${url}?format=${formato}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token ?? ''}`,
      ...(organizationId ? { 'x-aurora-organization': organizationId } : {}),
    },
    body: JSON.stringify(corpo),
  });
  if (!resp.ok) throw new Error(`o servidor respondeu ${resp.status}`);
  const blob = await resp.blob();
  const endereco = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = endereco;
  a.download = nomeDoArquivo;
  a.click();
  URL.revokeObjectURL(endereco);
}
