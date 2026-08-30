/**
 * Aurora — os bytes das fotos e o envio retomável (EPIC-014).
 *
 * Quem consome importa DAQUI. A tela de execução não sabe se a foto está num
 * cache do navegador ou no sistema de arquivos do Android — e é isso que
 * permite a mesma tela nas três distribuições.
 */
export * from './porta';
export * from './envio';
export {
  arquivosEmMemoria,
  arquivosNoCacheStorage,
  arquivosNoAparelho,
  type PluginDeArquivos,
} from './adaptadores';
