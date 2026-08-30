# Aurora Field — publicação nas lojas

**O que este documento é:** o que precisa estar pronto para publicar o Aurora
Field na Google Play e na App Store, o que já está, e **o que ainda não foi
confirmado**.

**O que ele não é:** uma afirmação sobre as regras da Apple ou do Google. As
duas mudam as exigências com frequência e a versão que vale é a do dia do envio.
Tudo que não pude verificar está marcado **A VALIDAR** — e nada aqui foi
inventado para preencher lacuna.

> **Nada foi publicado. Nenhuma conta paga foi criada. Nenhum pacote foi
> assinado. Nenhum dinheiro foi gasto.** Ver ADR-029.

---

## 1 · Identificador do aplicativo

| | Valor |
| --- | --- |
| Padrão | `br.com.aurora.field` |
| Variável | `AURORA_APP_ID` |
| Homologação sugerida | `br.com.aurora.field.homolog` |

**Por que é configurável, e não literal:** o aparelho de quem testa e o de quem
trabalha precisam conviver. Instalar a homologação por cima da produção apagaria
a base local — com o dia de trabalho dentro.

**Uma vez publicado, o identificador é imutável nas duas lojas.** Trocá-lo cria
um aplicativo novo: sem as instalações, sem as avaliações, sem os aparelhos já
configurados.

**A VALIDAR:** o domínio `br.com.aurora` pertence ao cliente? O identificador
deveria refletir o domínio real da empresa, e ele não me foi informado.

## 2 · Versão e número de build

| Plataforma | Nome | Build | Variável |
| --- | --- | --- | --- |
| Android | `versionName` | `versionCode` (inteiro crescente) | `AURORA_VERSION_NAME`, `AURORA_VERSION_CODE` |
| iOS | `CFBundleShortVersionString` | `CFBundleVersion` | **A VALIDAR** — ver abaixo |

As duas lojas **recusam** um envio cujo número de build já foi usado, e o número
é queimado: não há como corrigir depois. Por isso os valores vêm do ambiente, com
padrão para a máquina de quem desenvolve — deixá-los literais garantiria que o
segundo envio falha e que alguém edita o arquivo com pressa, no dia da publicação.

**A VALIDAR:** o `Info.plist` do iOS ainda usa os valores gerados pelo Capacitor.
Ligá-los ao ambiente exige editar o projeto do Xcode, o que não pode ser feito
com segurança fora do macOS.

## 3 · Permissões declaradas, e o motivo de cada uma

Toda permissão a mais é uma pergunta que a loja faz ao cliente e um motivo a mais
para alguém recusar a instalação. Esta lista sai do `AndroidManifest.xml` e do
`Info.plist` — e não de memória.

### Android

| Permissão | Para quê |
| --- | --- |
| `INTERNET` | falar com a API. Sem ela, nada sincroniza |
| `ACCESS_NETWORK_STATE` | informar a tela se há rede. **Nunca** decide se vale sincronizar — quem decide é a fila, porque tentou |
| `CAMERA` | fotografar a evidência do serviço e ler o QR da etiqueta |

`android.hardware.camera` é declarada com `required="false"`: sem isso, o Google
Play esconderia o aplicativo de todo aparelho sem câmera — inclusive de tablets
da coordenação, que precisam do Aurora e não precisam fotografar.

### iOS

| Chave | Texto |
| --- | --- |
| `NSCameraUsageDescription` | "Para fotografar o equipamento e o serviço executado, e para ler o QR Code da etiqueta de patrimônio." |
| `NSPhotoLibraryAddUsageDescription` | "Para guardar no aparelho as fotos do serviço até que elas cheguem ao servidor." |

A ausência dessas descrições **não é um aviso**: é rejeição na revisão e — pior —
o aplicativo **trava** no instante em que pede a permissão, num aparelho de quem
já instalou.

## 4 · Divulgação de privacidade

As duas lojas exigem declarar que dados o aplicativo coleta, para quê, e se saem
do aparelho. O que o Aurora Field manuseia hoje:

| Dado | Sai do aparelho? | Para quê |
| --- | --- | --- |
| Credencial de sessão | sim | autenticar na API do cliente |
| Ordens de serviço, ativos, locais, catálogos | sim (descem e sobem) | o trabalho em si |
| Fotos do serviço | sim | evidência da execução |
| Apontamento de horas | sim | registro de execução |
| Identificador do aparelho para push | **não hoje** | ver seção 7 |

**Não há telemetria, rastreamento, publicidade nem identificador de anúncio.** O
aplicativo fala com um servidor só: a API do cliente.

**A VALIDAR, e são bloqueadores de publicação:**

- **política de privacidade hospedada em URL pública.** As duas lojas a exigem, e
  ela precisa descrever o tratamento de dado pessoal do técnico e do paciente
  eventualmente presente numa foto. É documento jurídico do cliente, não meu;
- **localização geográfica.** A SPEC menciona ordenar o dia "por horário e
  proximidade". Proximidade exigiria localização — permissão sensível, com
  divulgação própria. **Hoje o aplicativo não pede localização**, e a ordenação é
  só por horário. Se a proximidade entrar, esta seção muda;
- **retenção das fotos no aparelho.** Hoje os bytes são apagados assim que o
  servidor confirma. Se isso mudar, muda a divulgação.

## 5 · Ícones, splash e capturas de tela

| Item | Estado |
| --- | --- |
| Ícone do aplicativo | placeholder gerado pelo Capacitor + `icone.svg` do PWA |
| Splash | cor de fundo definida (`#0f3d3a`), sem arte |
| Capturas de tela | **não existem** |

**A VALIDAR:** identidade visual. Ícone de loja, ícone adaptativo do Android (com
área segura), splash e as capturas exigidas por cada tamanho de tela dependem de
decisão de marca do cliente. Gerar arte aqui seria inventar identidade visual de
uma empresa.

O `launchAutoHide` do splash está **desligado de propósito**: o Aurora Field abre
a base local antes de mostrar qualquer coisa, e num aparelho lento isso leva um
instante. Com o esconde-automático, o técnico veria uma tela branca entre a
abertura e a lista — indistinguível de um aplicativo travado.

## 6 · Links profundos

**Hoje:** esquema próprio `aurora-campo://`, que funciona sem verificação de
domínio. Permite abrir uma ordem direto de um aviso ou de um QR impresso.

**A VALIDAR:** *App Links* (Android) e *Universal Links* (iOS) — abrir o
aplicativo a partir de um endereço `https://` — exigem publicar
`assetlinks.json` e `apple-app-site-association` no domínio de produção. **O
domínio de produção não está definido.**

É por isso que `limitsNavigationsToAppBoundDomains` está fora da configuração do
iOS: ligá-lo com a lista errada quebraria a chamada à API dentro do aplicativo
publicado, e o sintoma seria idêntico ao de estar sem rede.

## 7 · Notificação empurrada

**O plugin está integrado; a infraestrutura não existe.**

Falta, e tudo é decisão do cliente com custo associado:

- projeto de Firebase Cloud Messaging (Android) e certificado APNs (Apple);
- rota no servidor que receba e guarde a inscrição de cada aparelho;
- decisão de quais avisos justificam empurrar — a §23 já tem catálogo de
  notificação por canal, e `push` está lá como canal previsto.

O adaptador existe agora para que a tela e o domínio já falem com a porta certa.
Quando a infraestrutura for decidida, muda um arquivo e mais nada.

**A VALIDAR** — e, até lá, `disponivel()` devolve `false` no navegador: um botão
que pede permissão e não entrega nada é a forma mais rápida de fazer alguém negar
a permissão para sempre.

## 8 · Processo de build

```bash
npm run build --workspace @aurora/field
```

```bash
npx cap sync
```

O `sync` copia `apps/field/dist` para os dois projetos nativos e atualiza os
plugins. **A build web é a fonte** — não existe um segundo conjunto de telas.

### Android

```bash
AURORA_VERSION_NAME=0.2.0 AURORA_VERSION_CODE=2 npx cap open android
```

O Android Studio abre o projeto. O pacote de release (`.aab`) sai dali.

### iOS

**Bloqueado neste ambiente.** O projeto foi gerado, mas Xcode e CocoaPods exigem
macOS. A primeira compilação é uma etapa futura, num Mac.

## 9 · Assinatura

**Nada foi assinado, e nenhuma chave existe neste repositório.**

| Plataforma | O que falta |
| --- | --- |
| Android | keystore de release, guardada fora do repositório; senha em segredo de CI |
| iOS | conta paga do Apple Developer Program, certificado de distribuição, perfil de provisionamento |

**A VALIDAR:** onde as chaves ficam. Perder a keystore do Android significa não
conseguir mais atualizar o aplicativo publicado — a Play Store recusa um pacote
assinado com outra chave. É decisão de operação, com consequência permanente.

## 10 · Teste de fumaça em aparelho — etapa futura

O que a suíte cobre hoje:

- **51 provas** de unidade da camada de campo, incluindo oito horas offline em
  quarenta comandos e a conformidade da porta contra memória e SQLite real;
- **11 provas** de ponta a ponta num Pixel 7 emulado, com a rede desligada de
  verdade, contra a build de produção — incluindo a conformidade do IndexedDB
  rodando no navegador.

O que **nenhuma delas cobre**, e por isso é etapa futura:

- a ponte nativa do Capacitor;
- a câmera e o leitor de código reais, com as permissões do sistema;
- o comportamento sob pouca memória, quando o sistema derruba o aplicativo;
- o `WebView` de um Android específico, com a versão de sistema daquele aparelho.

A tela **"Este aparelho"** existe justamente para esse último caso: ela roda a
suíte de conformidade no aparelho de quem reclamou. Quando uma regra reprovar, a
resposta do suporte deixa de ser "deve ser o aparelho" e passa a ser uma linha
com nome.

---

## Resumo do que está travado, e por quem

| Item | Depende de |
| --- | --- |
| Identificador definitivo | domínio real do cliente |
| Política de privacidade | jurídico do cliente |
| Ícones, splash, capturas | identidade visual do cliente |
| App Links / Universal Links | domínio de produção definido |
| Push | projeto de FCM, certificado APNs, rota no servidor |
| Assinatura Android | keystore e onde guardá-la |
| Assinatura e build iOS | conta paga da Apple e um Mac |
| Versão do iOS por ambiente | edição do projeto Xcode, num Mac |

Nenhum desses itens bloqueia o desenvolvimento. Todos bloqueiam a **publicação**.
