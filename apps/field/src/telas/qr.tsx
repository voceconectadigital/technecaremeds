/**
 * Aurora — ler o QR do equipamento (SPEC §20 · EPIC-014).
 *
 * A TELA NÃO SABE COMO SE LÊ UM CÓDIGO.
 *
 * Ela pede ao adaptador. No navegador isso vira `BarcodeDetector` sobre a
 * câmera; no aplicativo, o leitor nativo. Se um dia entrar NFC, entra por aqui
 * também — e esta tela não muda.
 *
 * A RESOLUÇÃO É LOCAL, e é o ponto do épico.
 *
 * O código lido é procurado na base do aparelho, e não no servidor. Um leitor
 * que precisa de rede para dizer que equipamento é aquele não serve para nada
 * na casa de máquinas — que é exatamente onde as etiquetas estão.
 *
 * E QUANDO NÃO HÁ LEITOR, HÁ O CAMPO DE TEXTO.
 *
 * Nem todo navegador tem detector de código. Um botão que falha ao ser tocado é
 * pior do que um campo onde se digita o número do patrimônio — que está escrito
 * na mesma etiqueta, logo abaixo do quadrado.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { QrCode, ScanLine } from 'lucide-react';
import { useCampo, useColecaoLocal } from '../campo';

interface AtivoLocal {
  id: string;
  tag: string | null;
  asset_number: string | null;
  name: string;
  serial_number: string | null;
  qr_token: string | null;
  location_id: string | null;
}

interface OrdemLocal {
  id: string;
  number: string | null;
  title: string;
  asset_id: string | null;
  status_label: string;
}

/**
 * O que a etiqueta pode conter, e como reconhecemos o ativo.
 *
 * O QR do Aurora carrega uma URL terminada no token (`/q/<token>`), mas a
 * etiqueta de um parque herdado carrega o número de patrimônio, ou a TAG, ou o
 * número de série. Aceitar as quatro formas é o que faz o leitor servir no
 * primeiro dia de uso, antes de o parque inteiro ser reetiquetado.
 */
function acharAtivo(codigo: string, ativos: AtivoLocal[]): AtivoLocal | undefined {
  const limpo = codigo.trim();
  const ultimo = limpo.split('/').filter(Boolean).pop() ?? limpo;
  const alvo = ultimo.toLowerCase();

  return ativos.find(
    (a) =>
      a.qr_token?.toLowerCase() === alvo ||
      a.asset_number?.toLowerCase() === alvo ||
      a.tag?.toLowerCase() === alvo ||
      a.serial_number?.toLowerCase() === alvo
  );
}

export function QrPage() {
  const { dispositivo } = useCampo();
  const navegar = useNavigate();
  const { linhas: ativos } = useColecaoLocal<AtivoLocal>('ativos');
  const { linhas: ordens } = useColecaoLocal<OrdemLocal>('ordens');

  const [temLeitor, setTemLeitor] = useState<boolean | null>(null);
  const [lendo, setLendo] = useState(false);
  const [digitado, setDigitado] = useState('');
  const [achado, setAchado] = useState<AtivoLocal | null>(null);
  const [semResultado, setSemResultado] = useState<string | null>(null);

  useEffect(() => {
    void dispositivo.leitorDeCodigo.disponivel().then(setTemLeitor);
  }, [dispositivo]);

  function resolver(codigo: string) {
    const a = acharAtivo(codigo, ativos);
    if (a) {
      setAchado(a);
      setSemResultado(null);
    } else {
      setAchado(null);
      setSemResultado(codigo);
    }
  }

  async function abrirLeitor() {
    setLendo(true);
    try {
      const r = await dispositivo.leitorDeCodigo.ler();
      // `null` é desistência, e não erro: fechar o leitor é uma decisão.
      if (r) resolver(r.valor);
    } finally {
      setLendo(false);
    }
  }

  const daOrdem = achado ? ordens.filter((o) => o.asset_id === achado.id) : [];

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-lg font-semibold text-text">Ler etiqueta</h1>

      {temLeitor === null ? (
        <p className="text-sm text-muted" role="status">
          Vendo o que este aparelho consegue fazer…
        </p>
      ) : temLeitor ? (
        <button
          type="button"
          onClick={() => void abrirLeitor()}
          disabled={lendo}
          className="flex min-h-14 items-center justify-center gap-2 rounded-control bg-accent px-4 text-base font-semibold text-on-accent"
        >
          <ScanLine aria-hidden className="size-5" />
          {lendo ? 'Aponte para a etiqueta…' : 'Abrir a câmera'}
        </button>
      ) : (
        /*
         * SEM LEITOR, A TELA DIZ POR QUÊ — e não some com o botão.
         *
         * Um recurso que desaparece sem explicação faz a pessoa procurar o que
         * ela fez de errado. Dizer que este navegador não lê código, e oferecer
         * o número, resolve o problema dela na mesma tela.
         */
        <p className="rounded-panel border border-border-subtle bg-surface p-3 text-sm text-muted">
          Este navegador não lê códigos. Digite abaixo o número de patrimônio — ele está impresso na mesma
          etiqueta, logo abaixo do quadrado. No aplicativo instalado, a câmera funciona.
        </p>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="codigo-digitado" className="text-sm font-semibold text-text">
          Ou digite o número
        </label>
        <div className="flex gap-2">
          <input
            id="codigo-digitado"
            value={digitado}
            onChange={(e) => setDigitado(e.target.value)}
            inputMode="text"
            autoCapitalize="characters"
            placeholder="PAT-ALFA-001"
            className="min-h-12 flex-1 rounded-control border border-border-subtle bg-surface px-3 text-sm text-text"
          />
          <button
            type="button"
            onClick={() => resolver(digitado)}
            disabled={digitado.trim().length === 0}
            className="min-h-12 rounded-control border border-border-subtle px-3 text-sm font-medium text-text"
          >
            Buscar
          </button>
        </div>
      </div>

      {semResultado && (
        /*
         * NÃO ACHOU NO APARELHO — e a tela diz isso, e não "não existe".
         *
         * A diferença é tudo em campo: o equipamento pode existir e estar fora
         * do escopo baixado hoje. "Não existe" faria o técnico concluir que a
         * etiqueta está errada e procurar um problema que não há.
         */
        <div className="rounded-panel border border-border-subtle bg-surface p-3">
          <p className="text-sm font-medium text-text">Não encontrei no aparelho</p>
          <p className="mt-1 text-sm text-muted">
            Nada com o código <span className="font-medium text-text">{semResultado}</span> foi baixado neste
            aparelho. O equipamento pode existir e estar fora do escopo de hoje — sincronize quando tiver
            rede.
          </p>
        </div>
      )}

      {achado && (
        <div className="rounded-panel border border-border-subtle bg-surface p-3">
          <p className="flex items-center gap-2 text-xs font-medium text-subtle">
            <QrCode aria-hidden className="size-3.5" />
            {achado.asset_number ?? achado.tag ?? 'sem patrimônio'}
          </p>
          <h2 className="mt-0.5 text-base font-semibold text-text">{achado.name}</h2>
          {achado.serial_number && <p className="text-xs text-muted">série {achado.serial_number}</p>}

          <h3 className="mt-3 text-sm font-semibold text-text">Ordens deste equipamento</h3>
          {daOrdem.length === 0 ? (
            <p className="mt-1 text-sm text-muted">
              Nenhuma ordem sua para este equipamento hoje. Abra uma solicitação se encontrou algo.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {daOrdem.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => void navegar({ to: '/ordens/$id', params: { id: o.id } })}
                    className="flex min-h-12 w-full flex-col items-start rounded-control border border-border-subtle px-3 py-2 text-left"
                  >
                    <span className="text-xs text-subtle">{o.number ?? 'sem número'}</span>
                    <span className="text-sm font-medium text-text">{o.title}</span>
                    <span className="text-xs text-muted">{o.status_label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
