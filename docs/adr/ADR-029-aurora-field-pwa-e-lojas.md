# ADR-029 — Aurora Field: PWA **e** distribuição nas lojas, via Capacitor

**Data:** 29/08/2026
**Situação:** aceita — **requisito confirmado pelo cliente**, não hipótese
**Substitui:** a parte de distribuição do **ADR-018** (ver abaixo)

---

## Contexto

O ADR-018 decidiu **PWA** para o mobile, com a justificativa registrada: *"uma
base de código, distribuição sem loja, atualização imediata"*. Duas das três
razões continuam válidas; a do meio deixou de valer.

O cliente confirmou que o Aurora Field precisa **também** ser publicado na
**Google Play Store** e na **Apple App Store**. Isso não substitui o requisito
de PWA offline — as duas distribuições coexistem.

Nada nesta decisão vem de suposição sobre o que as lojas exigem. O que ainda não
foi confirmado com elas está marcado **A VALIDAR** e listado em
[`AURORA-FIELD-LOJAS.md`](../AURORA-FIELD-LOJAS.md).

## Decisão

**Uma base principal de código — React, TypeScript, Vite — empacotada para as
lojas com Capacitor.**

```
apps/field
   ├── Web/PWA        · vite build → dist, service worker, manifest
   ├── Android        · Capacitor → apps/field/android
   └── iOS            · Capacitor → apps/field/ios
```

Não se cria um segundo aplicativo em React Native. Não se duplica domínio, tela
nem regra.

### Por que Capacitor, e não React Native

A pergunta não é qual tecnologia é melhor para escrever um aplicativo do zero. É
qual delas **preserva o que já existe**: quatro telas, a fila de saída com
`client_operation_id`, a sincronização, o motor de conflito, e as 51 provas que
sustentam a promessa de oito horas offline.

O Capacitor executa esse código como está. O React Native exigiria reescrever
todas as telas — e a versão reescrita divergiria da original em algum detalhe,
sempre na direção de quem é menos usado. Aqui o menos usado seria o PWA, que é
justamente a distribuição que não depende de aprovação de loja.

O custo do Capacitor é conhecido e aceito: o aplicativo roda num `WebView`, e o
desempenho de animação e a fidelidade de gesto ficam abaixo do nativo. Para um
aplicativo de campo — listas, formulários, câmera, leitor de código — isso não é
o que decide se ele serve.

### O que muda por plataforma, e o que não muda

**A semântica NÃO muda.** A fila continua sendo uma só, conceitualmente:
`client_operation_id`, idempotência, ordem por agregado, retentativa com espera
crescente, conflito visível e estado na tela. Só a implementação de
armazenamento varia.

**Tudo que toca a plataforma passa por uma porta**, e nenhuma tela importa um
plugin:

| Porta | Navegador | Aparelho |
| --- | --- | --- |
| `ArmazenamentoOffline` | IndexedDB | IndexedDB hoje, **SQLite preparado** |
| `AdaptadorDeArquivos` | Cache Storage | sistema de arquivos (Capacitor) |
| `AdaptadorDeCamera` | seletor com `capture` | câmera nativa |
| `AdaptadorDeLeituraDeCodigo` | `BarcodeDetector` | leitor nativo |
| `AdaptadorDeRede` | `online`/`offline` | plugin de rede, com tipo de conexão |
| `AdaptadorDePush` | indisponível (**A VALIDAR**) | plugin, sem servidor (**A VALIDAR**) |

Os nomes são portugueses porque o resto do código é. A correspondência com o
vocabulário do requisito é direta: `ArmazenamentoOffline` = *OfflineStore*,
`armazenamentoIndexedDb` = *IndexedDbOfflineStore*, `armazenamentoSqlite` =
*NativeSqliteOfflineStore*.

### A porta de persistência tem semântica declarada e verificada

Uma porta em TypeScript garante que duas implementações têm as mesmas
assinaturas. Não garante que se comportam igual — e é o comportamento que a fila
assume. Por isso a porta declara **oito regras** e existe uma **suíte de
conformidade** que todo adaptador precisa passar:

- no Vitest, contra memória e contra **SQLite de verdade** (`node:sqlite`);
- no navegador, contra **IndexedDB de verdade**, pela tela de diagnóstico do
  aparelho — que é uma tela de produto, e não um artifício de teste: quando
  alguém liga dizendo "sumiu tudo", ela é o que o suporte pede para abrir.

A regra que mais importa é a sétima: **só JSON atravessa**. O IndexedDB guardaria
uma `Date` e devolveria uma `Date`; o SQLite guarda texto. Sem impor a mesma
perda nos dois, o mesmo código mostraria data certa no navegador e data errada no
aplicativo da loja — e a causa seria indetectável a partir do sintoma.

Essa divergência **existia** e foi encontrada pela suíte rodando no navegador de
verdade.

### SQLite está preparado, e não ligado

O `WebView` do Android e do iOS tem IndexedDB, e ele funciona: a distribuição
pela loja não fica esperando a troca. O adaptador de SQLite existe, é exercitado
a cada execução da suíte contra um motor real, e entra quando o driver nativo for
ligado — uma linha em `resolverArmazenamento`, sem tocar em fila, sincronização
ou tela.

O que se ganha ao trocar: o SQLite do aparelho não é recolhido pelo sistema
quando o espaço aperta, e o IndexedDB de um `WebView` pode ser. Para um
aplicativo que guarda oito horas de trabalho, essa diferença importa — e é por
isso que a troca está preparada em vez de descartada.

### Arquivos e fotos: três coisas, três lugares

O metadado do anexo vive na base local; o estado do envio vive no mesmo
registro; **os bytes vivem num adaptador de arquivos**. Juntar os três faria toda
leitura da lista de anexos carregar as fotos inteiras para a memória — e, no
aparelho, encheria a base de dados com o que pertence ao sistema de arquivos.

A separação também é o que torna o **envio retomável** possível: retomar exige
ler um pedaço a partir de um deslocamento, e um blob dentro de um registro JSON
não tem pedaço.

## Consequências

**Aceitas:**

- o repositório passa a conter dois projetos nativos gerados (`android`, `ios`);
  o que é copiado da build web não é versionado, o resto é — são decisões de
  empacotamento e precisam ser revisadas como código;
- `apps/field` ganha um `package.json` próprio, porque o CLI do Capacitor exige
  um manifesto no diretório em que roda;
- o `dist` de `apps/field` passa a ser a build do Vite (o Capacitor copia dali),
  e a saída do `tsc -b` foi movida para `.tsc-out`;
- entram sete dependências do Capacitor. Uma delas trouxe um aviso de segurança
  transitivo (`uuid` via `xcode`), resolvido com `overrides` — o padrão que este
  repositório já usa. **Zero vulnerabilidades permanece sendo a barra.**

**Não aceitas, e por quê:**

- **não publicamos em loja agora.** Publicar exige conta paga em ambas, chave de
  assinatura, política de privacidade hospedada e decisões de identidade visual
  que são do cliente;
- **não assinamos release nem criamos conta paga.** Nada nesta sessão gastou
  dinheiro;
- **não inventamos conformidade.** O que as lojas exigem e ainda não foi
  confirmado está listado como **A VALIDAR**, e não como fato.

**Limite conhecido:** o projeto iOS foi gerado, mas **não pode ser compilado
neste ambiente** — Xcode e CocoaPods exigem macOS. O que existe é a estrutura e
a configuração; a primeira compilação é uma etapa futura, num Mac.

## Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| Só PWA, sem loja | O cliente confirmou o requisito. Não é hipótese. |
| React Native, aplicativo separado | Reescreveria as telas e duplicaria domínio; as duas versões divergiriam, e a que ficaria para trás é o PWA. |
| Cordova | O Capacitor é o sucessor mantido, com plugins atuais e melhor integração com projetos nativos versionados. |
| Trocar tudo para SQLite agora | Atrasaria o épico sem ganho imediato: o `WebView` tem IndexedDB e ele funciona. A porta permite trocar depois sem reescrever nada. |
| Dexie no navegador | A porta pede seis operações de chave e valor; o Dexie resolve consultas e índices, que não são usados. Seria uma dependência no caminho crítico do primeiro carregamento, e uma segunda camada onde a porta já é a primeira. Trocável a qualquer momento: basta passar na suíte de conformidade. |

## Relação com o ADR-018

O ADR-018 **não é revogado**. A escolha de "uma base de código" foi confirmada
pelos fatos e continua valendo — é justamente ela que torna esta decisão barata.

O que muda é a frase *"distribuição sem loja"*: passa a ser **distribuição pela
web E pelas lojas**. E a consequência que vem junto: *"atualização imediata"*
continua verdadeira no PWA e passa a ter, no aplicativo instalado, o tempo de
revisão de cada loja — que é um fato a considerar no planejamento de correções
urgentes, e está registrado em `AURORA-FIELD-LOJAS.md`.
