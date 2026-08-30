# Aurora — os quatro ambientes, e como pôr a homologação de pé

> **Situação deste documento.** Ele descreve o que EXISTE no repositório e o que
> ainda é DECISÃO. Nada aqui foi contratado, comprado ou publicado. As opções de
> hospedagem estão levantadas e comparadas; escolher uma é decisão de quem paga
> a conta, e está fora do que este trabalho pode fazer sozinho.

---

## 1 · Por que quatro, e não dois

`NODE_ENV` responde **como o código roda** — a convenção do Node, que meia dúzia
de ferramentas usa para ramificar: `development`, `test`, `production`.

`AURORA_AMBIENTE` responde outra coisa: **qual implantação é esta**.

A diferença não é burocracia. Uma homologação roda com build de produção —
`NODE_ENV=production`, minificado, com service worker de verdade — e mesmo assim
**não é produção**: os dados são fictícios, o cliente está avaliando, e ninguém
vai processar uma fatura a partir dali. Um único interruptor para as duas
perguntas obriga a escolher entre "rodar como produção" e "ser tratado como
produção", e as duas coisas precisam ser separadas.

| `AURORA_AMBIENTE` | `NODE_ENV` | Para quê                                     | Dados        |
| ----------------- | ---------- | -------------------------------------------- | ------------ |
| `desenvolvimento` | `development` | A máquina de quem escreve o código        | Descartáveis |
| `teste`           | `test`     | A suíte automatizada, local e na integração  | Recriados a cada execução |
| `homologacao`     | `production` | O cliente clicando, para avaliar            | Fictícios, marcados |
| `producao`        | `production` | O trabalho de verdade                       | Reais        |

### O que a configuração RECUSA

Estão em `packages/config/src/env.ts`, e recusam no arranque — não em tempo de
uso, quando já seria tarde:

- **`AURORA_ALLOW_UNSAFE_DEV`** (entrar com qualquer e-mail, sem senha) é
  recusado em `homologacao` e `producao`, e também sempre que
  `NODE_ENV=production`. As duas condições são somadas, não substituídas: uma
  versão anterior trocou uma pela outra e enfraqueceu a checagem que já existia —
  o teste antigo pegou.
- **`AURORA_AUTH_PROVIDER=local`** é recusado em `homologacao` e `producao`. É a
  mesma porta da anterior, por outro caminho.
- **O papel de banco sem privilégio** (`aurora_app`, sem `BYPASSRLS`, não-dono) é
  exigido em toda implantação exposta. Um papel que ignora RLS transforma
  multitenancy em convenção.
- **A massa de homologação** (`tools/homologacao/semear.mjs`) se recusa a rodar
  com `AURORA_AMBIENTE=producao`, e não há opção para forçar.

### Segredos

Nenhum valor real entra no Git. `.env.example` documenta as chaves; os valores
vivem no cofre de quem hospeda. A verificação `check-secrets` roda na integração
contínua, no trabalho `estatico`, antes de qualquer outra coisa.

---

## 2 · O que a homologação precisa ter de pé

São quatro peças, e três delas já são um comando:

| Peça | O que é | Comando |
| --- | --- | --- |
| **Banco** | PostgreSQL 16 com as 44 migrações aplicadas | `npm run db:migrate` |
| **Massa** | 2 organizações, 8 personas, dado em todos os módulos | `npm run homolog:semear` |
| **API** | NestJS sobre Express, porta única | `node apps/api/dist/main.js` |
| **Três interfaces** | Web (equipe), Portal (cliente), Campo (técnico) | `vite build` × 3, servidas como arquivo estático |

E uma quinta que **não é opcional e é a mais fácil de esquecer**:

> **Um lugar para os bytes dos anexos.** `AURORA_ARQUIVOS_DIR` aponta um
> diretório em disco. Num servidor efêmero — contêiner recriado a cada
> implantação — um caminho comum **some junto com o contêiner**, e as fotos com
> ele. Precisa ser volume persistente, ou um armazenamento de objetos atrás da
> porta `ArmazenamentoDeObjetos`.

---

## 3 · As opções de hospedagem

**Nenhuma foi contratada.** O que segue é o levantamento, com o que cada uma
custa e o que cada uma cobra em troca.

### A · Máquina do cliente, na rede dele

- **Custo:** nenhum, se a máquina já existe.
- **A favor:** o dado fictício não sai da casa; nenhuma conta nova; nenhuma
  decisão de fornecedor tomada às pressas para destravar uma avaliação.
- **Contra:** exige alguém de TI do lado do cliente; o técnico só testa o
  aplicativo de campo dentro da rede — e o teste que mais importa (oito horas
  sem rede, no corredor de um hospital) é justamente o que a rede interna não
  reproduz bem.
- **Bloqueio:** nenhum.

### B · Supabase, plano gratuito

- **Custo:** zero no plano gratuito.
- **A favor:** PostgreSQL gerenciado, autenticação e armazenamento de arquivos
  na mesma conta; o adaptador de autenticação do Aurora já prevê Supabase.
- **Contra:** o plano gratuito **pausa o projeto por inatividade**, e uma
  homologação que o cliente abre uma vez por semana vive pausada. O
  armazenamento gratuito tem teto pequeno para fotos.
- **Bloqueio real, hoje:** a sessão autenticada **não tem acesso** ao projeto
  `egoajboqzhnvkpenrszw`. Não é limitação técnica — é permissão que ninguém
  concedeu. Enquanto isso não mudar, nada foi tentado: nenhum vínculo, nenhuma
  migração, nenhum outro projeto tocado.

### C · Plataforma de contêiner com camada gratuita (Render, Railway, Fly)

- **Custo:** zero até o teto da camada gratuita; a partir dali, pago.
- **A favor:** implantação a partir do repositório, sem servidor para cuidar.
- **Contra:** **o disco é efêmero na camada gratuita.** As fotos somem na
  primeira reimplantação, e some sem aviso — o registro do anexo continua no
  banco, e o arquivo não. Volume persistente costuma ser recurso pago.
- **Bloqueio:** volume persistente exige contratação. **Não contratado.**

### D · Servidor virtual pequeno (VPS)

- **Custo:** faixa de cinco a dez dólares por mês. **Não contratado.**
- **A favor:** disco de verdade, controle completo, custo previsível.
- **Contra:** alguém precisa cuidar dele — sistema, certificado, cópia de
  segurança.
- **Bloqueio:** exige contratação.

### Recomendação

**A (máquina do cliente)** para começar, porque não gasta nada, não decide nada
de forma irreversível e coloca o produto na frente de quem precisa avaliá-lo esta
semana. **B (Supabase)** assim que o acesso ao projeto for concedido, com o
armazenamento de arquivos no Supabase Storage em vez do disco — que resolve o
problema do disco efêmero sem custo.

**O que NÃO fazer agora:** contratar VPS ou volume pago para uma avaliação que
pode acontecer na rede do cliente. Isso é gastar antes de saber.

---

## 4 · O roteiro, quando a máquina existir

```bash
# 1 · o banco
createdb aurora_homologacao
DATABASE_URL=postgresql://.../aurora_homologacao npm run db:migrate

# 2 · o papel sem privilégio (uma vez por banco)
node tools/e2e/provision-role.mjs

# 3 · a massa
DATABASE_URL=postgresql://.../aurora_homologacao npm run homolog:semear

# 4 · as interfaces
npm run build

# 5 · a API — com o ambiente declarado
AURORA_AMBIENTE=homologacao NODE_ENV=production \
AURORA_DB_APP_ROLE=aurora_app \
AURORA_ARQUIVOS_DIR=/var/lib/aurora/arquivos \
node apps/api/dist/main.js
```

O passo 5 **vai recusar arrancar** se a autenticação estiver em modo local ou se
`AURORA_ALLOW_UNSAFE_DEV` estiver ligado. Isso é o desenho funcionando, e não um
obstáculo a contornar: uma homologação com login sem senha é uma homologação
cujo teste de permissões não vale nada.

### O que ainda falta decidir, e não dá para decidir sozinho

1. **Como as pessoas entram.** O modo local está bloqueado em homologação, e com
   razão. Supabase Auth é o caminho previsto — e depende do acesso ao projeto.
   **A VALIDAR.**
2. **Onde ficam as fotos**, se o disco for efêmero. Ver §3.
3. **Endereço.** Nenhum domínio foi registrado, e nenhum será: `NÃO AUTORIZADO`.
   Um endereço de teste da própria plataforma resolve a avaliação.

---

## 5 · O que continua não autorizado

Produção · domínio oficial · DNS de produção · App Store · Google Play ·
qualquer upgrade pago · contratação de recurso · transferência de organização no
Supabase · e-mail real · WhatsApp real · dado pessoal real.

**Este documento não declara nada pronto para produção.**
