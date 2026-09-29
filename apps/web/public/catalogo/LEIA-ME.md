# Imagens do catálogo de peças

Estas são **ilustrações próprias**, em SVG, desenhadas para este produto.

## Por que SVG desenhado, e não fotografia

Três razões, nesta ordem:

1. **Nada é hotlinked.** Uma foto de catálogo de fornecedor carregada por URL
   externa some quando o fornecedor reorganiza o site, e entrega o endereço IP
   de quem abriu a tela a um terceiro a cada carregamento. A restrição
   `inventory_items_image_key_relativa` (migration 0046) impede que uma URL
   absoluta chegue ao banco justamente por isso.

2. **Peso.** As doze ilustrações somadas pesam menos que uma única fotografia
   de produto. O aplicativo de campo funciona offline, e cada kilobyte é um
   kilobyte que precisa ter descido antes de a pessoa entrar no elevador.

3. **Consistência.** Elas usam os tokens do design system (`currentColor` e os
   tons de dados), então mudam junto com o tema claro/escuro — o que nenhuma
   fotografia faz.

## O que elas NÃO são

Não são um substituto para a foto real da peça. Em operação, `image_key` deve
apontar para a foto que alguém tirou do item na prateleira — é ela que permite
a conferência visual de um segundo no almoxarifado. Estas ilustrações são o
**catálogo de partida**: o que a organização vê antes de fotografar o acervo, e
o que continua aparecendo para o item que ninguém fotografou.

## Como usar

`inventory_items.image_key` guarda o caminho **relativo**, sem barra inicial:

    catalogo/filtro-hepa.svg

A borda HTTP (`inventory.controller.ts`) transforma isso em `/catalogo/...`.
