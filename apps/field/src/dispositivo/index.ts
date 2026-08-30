/**
 * Aurora — a escolha dos adaptadores, feita UMA VEZ (EPIC-014).
 *
 * É o único lugar do aplicativo que sabe em que plataforma ele está rodando.
 * Qualquer outro `if (nativo)` espalhado numa tela é a duplicação que as portas
 * existem para impedir — e é o começo de duas versões da mesma tela.
 */
import {
  armazenamentoIndexedDb,
  armazenamentoSqlite,
  type ArmazenamentoOffline,
  type DriverSql,
} from '../armazenamento';
import {
  arquivosNoAparelho,
  arquivosNoCacheStorage,
  type AdaptadorDeArquivos,
  type PluginDeArquivos,
} from '../arquivos';
import { cameraDoAparelho, leitorDoAparelho, pushDoAparelho, redeDoAparelho } from './capacitor';
import type { Dispositivo, Plataforma } from './porta';
import { cameraDoNavegador, leitorDoNavegador, pushDoNavegador, redeDoNavegador } from './web';

export * from './porta';

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

/**
 * Em que plataforma estamos.
 *
 * Lido do global e não de `import { Capacitor }`, de propósito: o pacote do PWA
 * não deve carregar nada do Capacitor para descobrir que não é Capacitor. O
 * runtime nativo injeta este global antes de o aplicativo montar.
 */
export function plataformaAtual(): Plataforma {
  const cap = (globalThis as Record<string, unknown>).Capacitor as CapacitorGlobal | undefined;
  const nome = cap?.getPlatform?.() ?? 'web';
  return nome === 'android' || nome === 'ios' ? nome : 'web';
}

export function ehNativo(): boolean {
  const cap = (globalThis as Record<string, unknown>).Capacitor as CapacitorGlobal | undefined;
  return cap?.isNativePlatform?.() === true;
}

/** Os recursos do aparelho, escolhidos pela plataforma. */
export function resolverDispositivo(): Dispositivo {
  const nativo = ehNativo();
  return {
    plataforma: plataformaAtual(),
    nativo,
    camera: nativo ? cameraDoAparelho() : cameraDoNavegador(),
    leitorDeCodigo: nativo ? leitorDoAparelho() : leitorDoNavegador(),
    rede: nativo ? redeDoAparelho() : redeDoNavegador(),
    push: nativo ? pushDoAparelho() : pushDoNavegador(),
  };
}

/**
 * O armazenamento, escolhido pela plataforma.
 *
 * NO NATIVO AINDA É IndexedDB, e isso está escrito de propósito.
 *
 * O `WebView` do Android e do iOS tem IndexedDB, e ele funciona — a
 * distribuição pela loja não fica bloqueada esperando o SQLite. O adaptador de
 * SQLite existe, é exercitado a cada execução da suíte contra um motor de
 * verdade, e entra quando o driver nativo for ligado: uma linha aqui, e nada
 * acima muda. É exatamente o que a porta existe para permitir.
 *
 * O que se ganha ao trocar: o SQLite do aparelho não é limpo pelo sistema
 * quando o espaço aperta, e o IndexedDB do WebView pode ser. Para um aplicativo
 * que guarda oito horas de trabalho, essa diferença importa — e é por isso que
 * a troca está preparada, e não descartada.
 */
export async function resolverArmazenamento(driverNativo?: DriverSql): Promise<ArmazenamentoOffline> {
  if (driverNativo) return armazenamentoSqlite(driverNativo);
  return armazenamentoIndexedDb();
}

/** Os bytes das fotos, escolhidos pela plataforma. */
export function resolverArquivos(plugin?: PluginDeArquivos): AdaptadorDeArquivos {
  if (plugin) return arquivosNoAparelho(plugin);
  return arquivosNoCacheStorage();
}

/**
 * O plugin de sistema de arquivos, quando estamos no aparelho.
 *
 * Carregado sob demanda pelo mesmo motivo dos outros: o PWA não paga por ele.
 */
export async function pluginDeArquivosDoAparelho(): Promise<PluginDeArquivos | undefined> {
  if (!ehNativo()) return undefined;
  const { Filesystem } = await import('@capacitor/filesystem');
  return Filesystem as unknown as PluginDeArquivos;
}
