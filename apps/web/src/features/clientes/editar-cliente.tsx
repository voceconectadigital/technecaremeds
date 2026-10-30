/**
 * Aurora — editar o cadastro do cliente (reunião 16/10/2026, Fase 2).
 *
 * Mesmos campos do "Novo cliente", mais a classificação. O cliente interno (a
 * própria organização) não troca de classificação: o servidor recusa, e a tela
 * já mostra a escolha travada. O contrato (relatório incluso e vigência —
 * CLI-05/06) é editado aqui também; deixar em branco limpa.
 */
import { useState, type FormEvent } from 'react';
import { Button, Dialog, Field, Input, useToast } from '@aurora/ui';
import { customersDetail, customersList, customersUpdate, type Customer } from '@aurora/contracts';
import { ApiError, useApiMutation } from '@aurora/app-kit';
import { CamposDeClassificacao, type TipoDeCliente } from './classificacao';
import { CamposDoContrato, problemaDaVigencia } from './contrato';

export function DialogoEditarCliente({ cliente, onFechar }: { cliente: Customer; onFechar: () => void }) {
  const toast = useToast();
  const [nome, setNome] = useState(cliente.name);
  const [fantasia, setFantasia] = useState(cliente.trade_name ?? '');
  const [documento, setDocumento] = useState(cliente.tax_id ?? '');
  const [codigo, setCodigo] = useState(cliente.code ?? '');
  const [tipo, setTipo] = useState<TipoDeCliente>((cliente.kind as TipoDeCliente) ?? 'eas');
  const [subtipo, setSubtipo] = useState(cliente.subtype ?? '');
  const [relatorio, setRelatorio] = useState<string>(cliente.report_tier ?? '');
  const [inicioContrato, setInicioContrato] = useState(cliente.contract_starts_on ?? '');
  const [fimContrato, setFimContrato] = useState(cliente.contract_ends_on ?? '');
  const [erro, setErro] = useState<{ campo?: string; mensagem: string } | null>(null);

  const salvar = useApiMutation(customersUpdate, {
    invalidates: [customersList, customersDetail],
    onError: (e: ApiError) => setErro({ campo: e.field, mensagem: e.problem.message }),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const vigencia = problemaDaVigencia(inicioContrato, fimContrato);
    if (vigencia) {
      setErro(vigencia);
      return;
    }
    salvar.mutate(
      {
        params: { id: cliente.id },
        body: {
          name: nome.trim(),
          trade_name: fantasia.trim(),
          tax_id: documento.trim(),
          code: codigo.trim(),
          ...(cliente.is_internal ? {} : { kind: tipo }),
          subtype: subtipo || null,
          report_tier: (relatorio || null) as 'basic' | 'advanced' | 'expert' | null,
          contract_starts_on: inicioContrato || null,
          contract_ends_on: fimContrato || null,
        },
      },
      {
        onSuccess: () => {
          toast.success('Cliente atualizado');
          onFechar();
        },
      }
    );
  }

  const erroDe = (c: string) => (erro?.campo === c ? erro.mensagem : null);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title={`Editar ${cliente.name}`}
      description="Dados cadastrais e classificação (EAS ou empresa corporativa)."
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button type="submit" form="form-editar-cliente" variant="primary" loading={salvar.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="form-editar-cliente" onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <Field label="Nome" required error={erroDe('name')}>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} />
        </Field>
        <Field label="Nome fantasia" error={erroDe('trade_name')}>
          <Input value={fantasia} onChange={(e) => setFantasia(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CNPJ" error={erroDe('tax_id')}>
            <Input inputMode="numeric" value={documento} onChange={(e) => setDocumento(e.target.value)} />
          </Field>
          <Field label="Código" error={erroDe('code')}>
            <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          </Field>
        </div>
        <CamposDeClassificacao
          tipo={tipo}
          subtipo={subtipo}
          onTipo={setTipo}
          onSubtipo={setSubtipo}
          erroSubtipo={erroDe('subtype') ?? erroDe('kind')}
          bloquearTipo={cliente.is_internal}
          subtipoOriginal={cliente.subtype ?? null}
        />
        <CamposDoContrato
          relatorio={relatorio}
          inicio={inicioContrato}
          fim={fimContrato}
          onRelatorio={setRelatorio}
          onInicio={setInicioContrato}
          onFim={setFimContrato}
          erroDe={erroDe}
        />
        {erro &&
          ![
            'name',
            'trade_name',
            'tax_id',
            'code',
            'subtype',
            'kind',
            'report_tier',
            'contract_starts_on',
            'contract_ends_on',
          ].includes(erro.campo ?? '') && (
            <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
              {erro.mensagem}
            </p>
          )}
      </form>
    </Dialog>
  );
}
