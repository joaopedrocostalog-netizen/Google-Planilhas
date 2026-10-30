# Google-Planilhas

Editor de planilhas que roda inteiro no navegador, no estilo do Google Planilhas, com interface em preto, branco e vermelho.
Não tem servidor nem etapa de build: são arquivos estáticos (HTML, CSS e JavaScript), prontos para o GitHub Pages.

## Como publicar no GitHub Pages

1. No repositório, abra **Settings → Pages**.
2. Em *Build and deployment*, escolha **Deploy from a branch**, selecione a branch (`main` ou `planilhas-web`) e a pasta **/ (root)**.
3. Clique em **Save**. O site fica em `https://<usuário>.github.io/Google-Planilhas/`.

Para testar localmente:

```sh
python3 -m http.server 8080
# abra http://localhost:8080
```

## Recursos

**Interface no estilo do Google Planilhas**
- Barra de menus completa (Arquivo, Editar, Ver, Inserir, Formatar, Dados, Ferramentas, Extensões, Ajuda), com submenus e atalhos.
- Barra de ferramentas na mesma ordem do Sheets, busca nos menus (Alt+/), barra de fórmulas com caixa de nome.
- Grade desenhada em canvas: linhas e colunas congeladas, texto que transborda para células vazias, mesclagem, bordas, rotação, quebra de texto com ajuste automático de altura.
- Abas de página: adicionar, renomear (duplo clique), arrastar para reordenar, cores, ocultar, duplicar.
- Resumo da seleção no rodapé (soma, média, mínimo, máximo, contagem).
- Menus de contexto na célula, nos cabeçalhos e nas abas.

**Fórmulas**
- 184 funções, com nomes em português e em inglês (SOMA/SUM, PROCV/VLOOKUP, PROCX/XLOOKUP, SE/IF, SOMASES, CONT.SES, ÍNDICE, CORRESP, FILTER, CLASSIFICAR, ÚNICO, SEQUÊNCIA, TEXTO, DATADIF, PGTO, REGEXEXTRACT…).
- Matrizes que transbordam para as células vizinhas (FILTER, ÚNICO, SEQUÊNCIA, ARRAYFORMULA, `={1\2;3\4}`), com `#REF!` quando há dados no caminho.
- Referências entre páginas (`Página2!A1`, `'Minha página'!A1:B5`), colunas e linhas inteiras (`A:A`, `2:2`), intervalos abertos (`A2:B`) e intervalos nomeados.
- Referências coloridas no editor, modo apontar (clique, arraste ou use as setas para inserir referências, inclusive de outras páginas), autocompletar de funções, ajuda de argumentos e F4 para `$`.
- Erros com explicação ao passar o mouse (`#DIV/0!`, `#N/A`, `#REF!`, `#NAME?`, dependência circular).
- Em pt-BR: argumentos separados por `;` e vírgula decimal (`=ARRED(2,345;2)`).

**Formatação**
- Negrito, itálico, sublinhado, tachado, fonte, tamanho, cores, alinhamento horizontal e vertical, quebra de texto, rotação, recuo, bordas (estilos e cores).
- Formatos: automático, número, porcentagem, científico, contábil, financeiro, moeda (R$), data, hora, duração e formatos personalizados (`#,##0.00`, `dd/mm/aaaa`, `[h]:mm:ss`…).
- Formatos automáticos ao digitar (datas, %, R$) e herança de formato em fórmulas (como `=HOJE()` ou `=SOMA()` de valores em reais).
- Pintar formatação, formatação condicional (cor única e escala de cores), cores alternadas.

**Dados**
- Filtros por valores e por condição, classificação de página e de intervalo (inclusive com várias colunas e cabeçalho).
- Validação de dados: lista suspensa com chips coloridos, lista de um intervalo, caixas de seleção, número, texto e data.
- Tabela dinâmica (com fórmulas que se atualizam sozinhas), estatísticas da coluna, remover cópias, cortar espaços, dividir texto em colunas.
- Inserir, excluir, ocultar e redimensionar linhas e colunas, com ajuste automático das fórmulas.

**Edição**
- Copiar, recortar e colar (inclusive de/para Excel e Google Planilhas), colar especial (valores, formatação, fórmulas, transposto).
- Alça de preenchimento com séries (números, datas, meses, dias da semana, "Item 1, Item 2…"), Ctrl+D e Ctrl+R.
- Localizar (Ctrl+F) e localizar e substituir (Ctrl+H) com expressões regulares.
- Notas, comentários, links (inclusive para outras páginas).
- Desfazer e refazer ilimitados na sessão, histórico de versões no navegador.

**Gráficos**
- Colunas, colunas empilhadas, barras, linhas, área, pizza, rosca e dispersão.
- Gráficos flutuantes: mover, redimensionar, editar no painel lateral e baixar como PNG ou SVG.
- Minigráficos na célula com SPARKLINE (linha, colunas, barra, ganho/perda), imagens na célula com IMAGEM(url) e imagens sobre as células (Inserir › Imagem).

**Arquivos**
- Várias planilhas salvas no navegador (Arquivo › Abrir), fazer uma cópia, nova planilha.
- Importar e baixar `.xlsx`, `.csv`, `.tsv`, `.json`; abrir também `.xls` e `.ods`; baixar como página da web; imprimir/PDF.
- Arrastar um arquivo para a janela abre como nova planilha.
- Compartilhar por link: os dados vão compactados no endereço e quem abre recebe uma cópia.

## Atalhos principais

| Atalho | Ação |
|---|---|
| Ctrl+Z / Ctrl+Y | Desfazer / refazer |
| Ctrl+C / Ctrl+X / Ctrl+V | Copiar / recortar / colar |
| Ctrl+Shift+V | Colar somente valores |
| Ctrl+B / I / U | Negrito / itálico / sublinhado |
| Ctrl+Shift+1…6 | Número, hora, data, moeda, porcentagem, científico |
| Ctrl+F / Ctrl+H | Localizar / substituir |
| Ctrl+K | Inserir link |
| Shift+F2 / Ctrl+Alt+M | Nota / comentário |
| Ctrl+; | Inserir data |
| Ctrl+D / Ctrl+R | Preencher para baixo / direita |
| Ctrl+Alt+= / Ctrl+Alt+- | Inserir / excluir linhas ou colunas |
| Alt+Enter | Nova linha dentro da célula |
| F4 | Alternar referência absoluta |
| Alt+/ | Pesquisar nos menus |
| Ctrl+/ | Todos os atalhos |

## Estrutura

```
index.html          estrutura da página
src/styles.css      tema (cores da marca em :root: --red, --black, --white)
src/engine.js       tokenizador, parser, avaliador, pasta de trabalho, reescrita de fórmulas
src/functions.js    funções: matemática, estatística, lógica, busca, matrizes
src/functions2.js   funções: texto, data, informações, finanças; formatador de números
src/model.js        documento, histórico, persistência, operações estruturais, filtros, validação
src/grid.js         grade em canvas, seleção, mouse, rolagem
src/editor.js       editor de célula e barra de fórmulas
src/commands.js     comandos, atalhos de teclado, área de transferência
src/chrome.js       menus, barra de ferramentas, paleta, caixa de nome, busca nos menus
src/chrome2.js      abas, avisos, diálogos, dicas, menus de contexto, filtro
src/panels.js       painéis laterais (formatação condicional, validação, tabela dinâmica…)
src/dialogs.js      localizar e substituir, link, nota, comentário, lista de funções…
src/charts.js       gráficos
src/io.js           arquivos, impressão e compartilhamento
src/app.js          inicialização
tests/              testes do motor (node tests/engine.test.js)
```

## Planilhas compartilhadas (tempo real)

O servidor (`server/`, Node.js + Postgres) guarda as planilhas na nuvem e sincroniza as edições ao vivo.

- **Conta:** cada pessoa entra com e-mail e senha. Só administradores criam e salvam planilhas na nuvem (Arquivo › Salvar na nuvem); quem salva é o dono e administrador dela. Os administradores gerais ficam na variável `ADMIN_EMAILS` do servidor (separados por vírgula).
- **Setores são executores:** quem não é administrador preenche valores nas colunas liberadas e usa só esta parte da barra: pesquisa nos menus, desfazer/refazer, imprimir, pintar formatação, zoom, formatos de número (R$, %, casas decimais, 123), fonte, tamanho, negrito, itálico, tachado, cor do texto e cor de preenchimento. Bordas, alinhamento, mesclagem, notas, links, regras, filtros, congelar, tamanho de linhas e colunas, páginas e estrutura são dos administradores, e essas opções nem aparecem para os setores. Cada pessoa só vê o cursor de quem é do mesmo setor; administradores veem todos.
- **Filtro a partir da coluna:** botão direito no cabeçalho › Criar um filtro a partir da coluna. O botão do filtro fica no cabeçalho (A, B… ou o nome da coluna) e filtra desde a linha 1.
- **Compartilhar:** o administrador adiciona pessoas (administrador, editor ou leitor), cria setores e define, por setor ou por pessoa, o que cada um pode fazer em cada página e em cada coluna: oculta, somente ver ou editar. A regra da pessoa tem prioridade sobre a do setor.
- **Colunas por setor:** em Compartilhar › Colunas, um quadro mostra todas as colunas da página × todos os setores; o administrador escolhe em cada cruzamento: padrão, oculta, ver ou editar.
- **Nome das colunas:** o administrador troca a letra do cabeçalho por um nome (ex.: A → CLIENTE) com duplo clique no cabeçalho, no menu do cabeçalho (Nome e permissões da coluna) ou em Compartilhar › Colunas, que lista todas as colunas da página.
- **Estrutura das colunas:** só administradores renomeiam, inserem, excluem, ocultam ou redimensionam colunas (A, B, C…).
- **Permissões da coluna:** clique com o botão direito no cabeçalho de uma coluna (ou Dados › Permissões por coluna). Colunas ocultas não aparecem para a pessoa e os dados delas nem chegam ao navegador dela; fórmulas visíveis que dependem delas mostram `#OCULTO!`. Colunas somente leitura têm um cadeado no cabeçalho.
- **Histórico de edições:** clique com o botão direito numa célula › Mostrar histórico de edições (quem alterou, quando, valor anterior e novo).
- **Intervalos protegidos:** Dados › Proteger páginas e intervalos.

Variáveis do servidor: `DATABASE_URL` (Postgres), `ADMIN_EMAILS` (administradores gerais), `PGSCHEMA` (opcional, schema próprio), `ALLOWED_ORIGINS` (sites que podem usar a API). Sem `DATABASE_URL`, os dados ficam em memória (apenas para testes). Testes: `npm test`.

## Limitações

- O histórico de edições registra alterações de valor; inserir ou excluir linhas e colunas não desloca o histórico das células.
- Quem tem colunas ocultas não pode ordenar a página nem inserir/excluir linhas que mexeriam nelas; em páginas com permissões por coluna, só administradores inserem ou excluem colunas.
- O `.xlsx` exportado leva valores, fórmulas, formatos de número, mesclagens, larguras e notas, mas não cores e fontes (limite da biblioteca SheetJS gratuita).
- Não há Apps Script, macros, GOOGLEFINANCE, IMPORTRANGE nem QUERY.

## Logo e cores

As cores ficam em `src/styles.css` (`--red`, `--red-dark`, `--black`). O logotipo está em `index.html` (dentro de `.app-logo`) e em `assets/favicon.svg`. Para usar a logo oficial da empresa, troque esses SVGs.
